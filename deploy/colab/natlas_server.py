"""
Minimal OpenAI-compatible server for the official N-ATLaS (NCAIR1/N-ATLaS) on a single GPU.

Uses Hugging Face transformers with 4-bit quantisation, so the 8B model fits a free
Colab T4 (16 GB VRAM, ~12 GB system RAM) where vLLM is not reliable.
Endpoints: GET /health, GET /v1/models, POST /v1/chat/completions (streaming and not).

Environment: HF_TOKEN (read token with access to the gated repo), UPSTREAM_KEY (bearer key
clients must send), PORT (default 8000).
"""
import json
import os
import threading
import time
import uuid

import torch
import uvicorn
from fastapi import Body, FastAPI, Header, HTTPException
from fastapi.responses import StreamingResponse
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig, TextIteratorStreamer

MODEL_ID = "NCAIR1/N-ATLaS"
SERVED_NAME = "n-atlas-8b"
API_KEY = os.environ["UPSTREAM_KEY"]
HF_TOKEN = os.environ["HF_TOKEN"]

print("Loading tokenizer...", flush=True)
tok = AutoTokenizer.from_pretrained(MODEL_ID, token=HF_TOKEN)
print("Loading N-ATLaS in 4-bit (first run downloads ~16 GB)...", flush=True)
model = AutoModelForCausalLM.from_pretrained(
    MODEL_ID,
    token=HF_TOKEN,
    device_map="cuda:0",
    low_cpu_mem_usage=True,
    torch_dtype=torch.float16,
    quantization_config=BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.float16,
    ),
)
model.eval()
print("Model loaded.", flush=True)

# Llama-3 ends a turn with <|eot_id|>; stop on it as well as the normal EOS token.
EOT = tok.convert_tokens_to_ids("<|eot_id|>")
TERMINATORS = [t for t in {tok.eos_token_id, EOT} if isinstance(t, int)]
LOCK = threading.Lock()  # one generation at a time on a single small GPU

app = FastAPI()


def check_key(authorization):
    if authorization != f"Bearer {API_KEY}":
        raise HTTPException(status_code=401, detail="invalid key")


def text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(p.get("text", "") for p in content if isinstance(p, dict))
    return ""


def prepare(body):
    messages = [{"role": m.get("role", "user"), "content": text_of(m.get("content"))} for m in body.get("messages", [])]
    enc = tok.apply_chat_template(messages, add_generation_prompt=True, return_tensors="pt", return_dict=True)
    inputs = {k: v.to(model.device) for k, v in enc.items()}
    temperature = float(body.get("temperature", 0.7) or 0)
    max_new = int(body.get("max_tokens") or body.get("max_completion_tokens") or 256)
    kwargs = dict(max_new_tokens=max(1, min(max_new, 512)), eos_token_id=TERMINATORS, pad_token_id=tok.eos_token_id)
    if temperature > 0.01:
        kwargs.update(do_sample=True, temperature=temperature, top_p=float(body.get("top_p", 0.9) or 0.9))
    else:
        kwargs.update(do_sample=False)
    return inputs, kwargs


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL_ID}


@app.get("/v1/models")
def models():
    return {"object": "list", "data": [{"id": SERVED_NAME, "object": "model", "owned_by": "NCAIR1"}]}


@app.post("/v1/chat/completions")
def chat(body: dict = Body(...), authorization: str = Header(default="")):
    check_key(authorization)
    inputs, kwargs = prepare(body)
    rid = "chatcmpl-" + uuid.uuid4().hex[:12]
    created = int(time.time())
    prompt_tokens = int(inputs["input_ids"].shape[1])

    def chunk(delta, finish=None):
        return "data: " + json.dumps({
            "id": rid, "object": "chat.completion.chunk", "created": created, "model": SERVED_NAME,
            "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
        }) + "\n\n"

    if body.get("stream"):
        streamer = TextIteratorStreamer(tok, skip_prompt=True, skip_special_tokens=True)

        def run():
            with LOCK, torch.no_grad():
                model.generate(**inputs, streamer=streamer, **kwargs)

        threading.Thread(target=run, daemon=True).start()

        def events():
            yield chunk({"role": "assistant", "content": ""})
            pieces = 0
            for text in streamer:
                if text:
                    pieces += 1
                    yield chunk({"content": text})
            yield chunk({}, "stop")
            usage = {"prompt_tokens": prompt_tokens, "completion_tokens": pieces, "total_tokens": prompt_tokens + pieces}
            yield "data: " + json.dumps({"id": rid, "object": "chat.completion.chunk", "created": created, "model": SERVED_NAME, "choices": [], "usage": usage}) + "\n\n"
            yield "data: [DONE]\n\n"

        return StreamingResponse(events(), media_type="text/event-stream")

    with LOCK, torch.no_grad():
        out = model.generate(**inputs, **kwargs)
    new_tokens = out[0][prompt_tokens:]
    text = tok.decode(new_tokens, skip_special_tokens=True).strip()
    completion_tokens = int(new_tokens.shape[0])
    return {
        "id": rid, "object": "chat.completion", "created": created, "model": SERVED_NAME,
        "choices": [{"index": 0, "message": {"role": "assistant", "content": text}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": prompt_tokens, "completion_tokens": completion_tokens, "total_tokens": prompt_tokens + completion_tokens},
    }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")), log_level="warning")

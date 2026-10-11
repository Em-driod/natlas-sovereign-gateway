"""Drop-in: the official OpenAI Python SDK, pointed at the gateway. One line changes: base_url.

    pip install openai
    python examples/openai_python.py
"""
import os
from openai import OpenAI

client = OpenAI(
    base_url=os.getenv("GATEWAY_URL", "http://127.0.0.1:8080/v1"),  # <- the only change
    api_key=os.getenv("GATEWAY_KEY", "sk-natlas-demo-key"),
)

response = client.chat.completions.create(
    model="n-atlas-8b",
    temperature=0.2,
    messages=[{"role": "user", "content": "My customer NIN is 12345678901, explain loan policy in Pidgin."}],
)
print(response.choices[0].message.content)

# Gateway metadata (cache result, redaction counts, latency) rides along on the raw response.
raw = client.chat.completions.with_raw_response.create(
    model="n-atlas-8b",
    temperature=0.2,
    messages=[{"role": "user", "content": "My customer NIN is 12345678901, explain loan policy in Pidgin."}],
)
print("cache:", raw.headers.get("x-natlas-cache"), "| redactions:", raw.headers.get("x-natlas-redactions"),
      "| latency:", raw.headers.get("x-natlas-latency-ms"), "ms")

# Streaming
for chunk in client.chat.completions.create(
    model="n-atlas-8b",
    stream=True,
    messages=[{"role": "user", "content": "Customer phone is 08031234567. Translate 'your loan is approved' to Hausa."}],
):
    print(chunk.choices[0].delta.content or "", end="", flush=True) if chunk.choices else None
print()

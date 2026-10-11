#!/usr/bin/env sh
# Plain HTTP. Watch the x-natlas-* response headers.
GATEWAY=${GATEWAY_URL:-http://127.0.0.1:8080/v1}
curl -s -D - "$GATEWAY/chat/completions" \
  -H "Authorization: Bearer ${GATEWAY_KEY:-sk-natlas-demo-key}" \
  -H "Content-Type: application/json" \
  -H "X-Natlas-Debug: 1" \
  -d '{"model":"n-atlas-8b","temperature":0.2,"messages":[{"role":"user","content":"My customer NIN is 12345678901, explain loan policy in Pidgin."}]}'

# Contributing

Thanks for helping make N-ATLAS safe to use with Nigerian data.

## Getting started

```bash
npm install
npm start        # gateway + built-in mock N-ATLAS on http://localhost:8080
npm test         # unit and end-to-end tests
npm run eval:injection
```

Node.js 20+ is all you need; Redis is optional (`REDIS_URL`).

## Ways to contribute

- **New Nigerian identifiers or formats** for redaction: add a detector in `src/pii/redactor.ts` with tests in `test/redactor.test.ts`, including at least one "must not match" example (prices, years, reference numbers).
- **Jailbreak phrasings**, especially in Pidgin, Yoruba, Hausa or Igbo: add them to `scripts/eval-injection.ts` first (so the miss is recorded), then a rule in `src/security/injection.ts`. Keep the normal-question set at zero false positives.
- **Regions** for GPS and address coarsening: `src/pii/regions.ts`.
- **Docs and translations** of the quick start.

## Pull requests

1. Fork, branch from `main`, keep changes focused.
2. `npm run typecheck && npm test` must pass (CI runs both, plus a dependency audit and a live smoke test).
3. Never commit real personal data: use obviously fake BVNs, NINs and phone numbers in tests.
4. Describe what changed and why; for redaction or injection changes, include before/after `npm run eval:injection` output.

## Reporting security issues

Please do not open a public issue for a vulnerability (for example a way to get raw PII past the gateway). Open a private security advisory on GitHub instead.

## Licence

By contributing you agree that your contributions are licensed under the MIT License (see `LICENSE`).

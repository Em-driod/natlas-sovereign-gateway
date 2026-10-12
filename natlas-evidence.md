# N-ATLAS integration evidence

Generated 2026-10-12T20:56:20.838Z by `npm run evidence` against `https://natlas-gateway.onrender.com/v1`.

**Upstream:** NCAIR1/N-ATLaS on Colab T4 · served model name `n-atlas-8b`

Each prompt below went through the full gateway pipeline (auth, rate limit, injection scan, PII redaction, cache bypassed, N-ATLAS, restoration). "What N-ATLAS received" is the exact redacted prompt the model saw.

### Yoruba

| | |
|---|---|
| **Prompt (from the user)** | Translate 'Good morning, how can I help you today?' to Yoruba. |
| **What N-ATLAS received** | Translate 'Good morning, how can I help you today?' to Yoruba. |
| **Answer returned to the user** | Bawo ni, kini mo le ran o lowo loni? |
| Upstream model id | `n-atlas-8b` |
| Detected language | `en` |
| Redactions | `none` |
| Gateway trace | `auth=0.224;limits=5.007;scan=9.441;redact=5.032;cache=1.163;model=1533.357;rehydrate=2.988` |
| Round trip | 1772 ms |

### Hausa

| | |
|---|---|
| **Prompt (from the user)** | Translate 'Good morning, how can I help you today?' to Hausa. |
| **What N-ATLAS received** | Translate 'Good morning, how can I help you today?' to Hausa. |
| **Answer returned to the user** | Barka da safiya, ta yaya zan iya taimaka muku yau? |
| Upstream model id | `n-atlas-8b` |
| Detected language | `en` |
| Redactions | `none` |
| Gateway trace | `auth=0.077;limits=2.821;scan=6.192;redact=0.433;cache=0.124;model=1759.591;rehydrate=0.790` |
| Round trip | 2043 ms |

### Igbo

| | |
|---|---|
| **Prompt (from the user)** | Translate 'Good morning, how can I help you today?' to Igbo. |
| **What N-ATLAS received** | Translate 'Good morning, how can I help you today?' to Igbo. |
| **Answer returned to the user** | Ụtụtụ ọma, kedu ka m ga-esi nyere gị aka taa? |
| Upstream model id | `n-atlas-8b` |
| Detected language | `en` |
| Redactions | `none` |
| Gateway trace | `auth=0.075;limits=8.746;scan=0.106;redact=0.283;cache=0.094;model=1831.093;rehydrate=3.389` |
| Round trip | 2055 ms |

### Pidgin

| | |
|---|---|
| **Prompt (from the user)** | Abeg explain wetin BVN be and why bank dey ask for am. Make e short. |
| **What N-ATLAS received** | Abeg explain wetin BVN be and why bank dey ask for am. Make e short. |
| **Answer returned to the user** | BVN naa jẹ nọmba idanimọ ti banki ti n ṣiṣẹ ni Nigeria fun, ti a ṣẹda ni ọdun 2014. Awọn banki n beere fun BVN lati ṣe iranlọwọ fun wọn lati ṣayẹwo idanimọ awọn onibara ati jẹrisi awọn iṣowo, eyiti o jẹ ki ilana ijẹrisi rọrun ati yiyara. |
| Upstream model id | `n-atlas-8b` |
| Detected language | `pcm` |
| Redactions | `none` |
| Gateway trace | `auth=0.075;limits=3.213;scan=0.111;redact=0.185;cache=0.095;model=8207.303;rehydrate=0.770` |
| Round trip | 8451 ms |

### English + PII

| | |
|---|---|
| **Prompt (from the user)** | Customer Adaeze Okafor, BVN 22345678901, phone 0803 123 4567, lives at No. 12, Adeola Odeku Street, Victoria Island, Lagos. Is she eligible for a POS terminal? |
| **What N-ATLAS received** | Customer [NAME_1], BVN [BVN_1], phone [PHONE_1], lives at [ADDRESS_1:Lagos/Victoria Island]. Is she eligible for a POS terminal? |
| **Answer returned to the user** | Yes, Adaeze Okafor is eligible for a POS terminal. |
| Upstream model id | `n-atlas-8b` |
| Detected language | `en` |
| Redactions | `NAME=1,BVN=1,PHONE=1,ADDRESS=1` |
| Gateway trace | `auth=0.076;limits=2.131;scan=0.112;redact=1.156;cache=0.162;model=1283.925;rehydrate=1.649` |
| Round trip | 1527 ms |


## Observations

- Yoruba, Hausa and Igbo translations were correct and fluent.
- The Pidgin question was answered in Yoruba rather than Pidgin. This is model behaviour (the gateway forwards the prompt unchanged apart from PII tokens) and is noted here for the N-ATLAS team.
- In the PII-heavy prompt, N-ATLAS received only tokens (`[NAME_1]`, `[BVN_1]`, `[PHONE_1]`, `[ADDRESS_1:Lagos/Victoria Island]`), and the customer's name was restored in the answer returned to the user.

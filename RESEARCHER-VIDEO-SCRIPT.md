# Video narration: N-ATLAS Sovereign Gateway (about 4 minutes)

**Roles:** the researcher narrates (voice, optionally on camera for the opening and closing); a teammate drives the screen.
**Before recording:** Colab tab open and running; open https://natlas-gateway.onrender.com, press Ctrl+Shift+R, check the header badge is green ("Upstream: N-ATLaS · NCAIR1/N-ATLaS on Colab T4"), and click each scenario once to warm up. Zoom the browser to about 110%.

Pace: calm and clear. Pause while each request runs; the real model takes a few seconds.

---

### 1. Opening (0:00 to 0:25) · Screen: the dashboard hero, or the narrator on camera

> "Hello, I'm **[name]**, a researcher on the **[team name]** team. N-ATLAS is Nigeria's own language model, and the organisations that could benefit most from it are banks, fintechs, hospitals and government agencies. But they hold our most sensitive data: BVNs, NINs, phone numbers and home addresses. Under the Nigeria Data Protection Act, they can't simply send that to an AI model. We built the **N-ATLAS Sovereign Gateway** to fix that."

### 2. One line to adopt (0:25 to 0:45) · Screen: Developers tab, the highlighted base_url line

> "A developer doesn't rewrite their app. The gateway speaks the same API as the tools they already use, so they change just one line, the address, and every request now goes through the gateway."

### 3. Privacy in action (0:45 to 1:45) · Screen: Playground, KYC scenario, click Send request

> "Here a loan officer types a real-looking customer request: name, BVN, phone number, email, home address and shop location."
>
> *(while it runs)* "This is the Request X-ray. You can watch each step: authentication, rate limits, an injection scan, and then personal data redaction, all in a few milliseconds."
>
> *(point to pane 2)* "This is exactly what N-ATLAS received. No BVN, no phone number, no email, just tokens. Even the address is reduced to 'Lagos, Victoria Island', so the model still has useful context without knowing where she lives."
>
> *(point to pane 3)* "And this is the official N-ATLaS model's answer. The gateway puts the real details back before the officer sees it. The badge at the top confirms we are running on NCAIR's N-ATLaS."

### 4. Speed and cost (1:45 to 2:10) · Screen: click Send request again

> "If the same question comes in again, even about a different customer, it's answered from our cache in a fraction of a second instead of several seconds, with no GPU cost. The cache only ever stores the redacted version, so no personal data is kept."

### 5. Nigerian languages (2:10 to 2:30) · Screen: Translate to Yoruba scenario

> "N-ATLAS speaks Yoruba, Hausa, Igbo and English, and so does the gateway. It recognises the language of every request, and it never reuses an answer from one language for another."

### 6. Security (2:30 to 3:00) · Screen: Jailbreak attempt, then Pidgin jailbreak

> "People will try to trick the model into ignoring its rules. The gateway blocks these attacks before they ever reach N-ATLAS, in English and in Pidgin, Yoruba, Hausa and Igbo, and even when the attack is disguised. You can see the X-ray turn red at the exact step that stopped it."

### 7. Accountability (3:00 to 3:30) · Screen: Compliance tab, then Download NDPA report

> "Regulators need proof, not promises. Every request is recorded in an audit trail that stores no conversation content, and each record is chained to the one before it, so any tampering is detected. With one click, an organisation gets a compliance report it can hand to NDPC, NITDA or the CBN."

### 8. For developers (3:30 to 3:50) · Screen: Developers tab, Create key, then the GitHub README

> "Any developer can get a free sandbox key in seconds and start building. The project is open source, with automated tests, continuous integration and full documentation."

### 9. Close (3:50 to 4:05) · Screen: the dashboard, or the narrator on camera

> "The N-ATLAS Sovereign Gateway lets Nigerian organisations use our own AI safely, legally and affordably. Sovereign AI, safely in production. Thank you."

---

**Tips**
- If a request is slow, keep talking over it; the line in step 3 covers the wait.
- Don't ask the model questions in Pidgin on camera (it tends to reply in Yoruba). Jailbreak attempts in Pidgin are fine, because they are blocked before the model.
- Upload as unlisted on YouTube, or as a Google Drive link set to "Anyone with the link", and paste it in the form.

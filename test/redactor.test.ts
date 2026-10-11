import { describe, expect, it } from "vitest";
import { Vault, redactText, rehydrateText, StreamRehydrator, redactMessages } from "../src/pii/redactor.js";

const redact = (s: string) => {
  const v = new Vault();
  return { out: redactText(s, v), v };
};

describe("Nigerian PII redaction", () => {
  it("labels 11-digit numbers as BVN or NIN from context", () => {
    const { out, v } = redact("NIN: 12345678901, BVN 22345678901, ref 33345678901");
    expect(out).toBe("NIN: [NIN_1], BVN [BVN_1], ref [ID_1]");
    expect(v.counts).toEqual({ NIN: 1, BVN: 1, ID: 1 });
  });

  it("catches every common Nigerian phone format", () => {
    for (const p of ["08031234567", "0803 123 4567", "0803-123-4567", "+2348031234567", "+234 803 123 4567", "2347061234567", "09051234567"]) {
      expect(redact(`call ${p} now`).out).toBe("call [PHONE_1] now");
    }
  });

  it("does not treat prices, years or amounts as PII", () => {
    const s = "Pay ₦25,000 by 2026, rate 1500.50, 20.5 litres, order 4521.";
    expect(redact(s).out).toBe(s);
  });

  it("redacts emails, Luhn-valid cards and NUBAN accounts with banking context", () => {
    const { out } = redact("Email ada@gtbank.com, card 4111 1111 1111 1111, account number 0123456789, invalid card 4111 1111 1111 1112");
    expect(out).toBe("Email [EMAIL_1], card [CARD_1], account number [ACCOUNT_1], invalid card 4111 1111 1111 1112");
  });

  it("coarsens GPS to a Nigerian region token", () => {
    expect(redact("shop at 6.6018, 3.3515.").out).toBe("shop at [GPS_1:Lagos/Ikeja].");
    expect(redact("lat: 9.0765, lng: 7.4797").out).toBe("[GPS_1:FCT/Wuse]");
    expect(redact("6.4281° N, 3.4219° E").out).toBe("[GPS_1:Lagos/Victoria Island]");
  });

  it("coarsens street addresses to a region token", () => {
    expect(redact("She lives at No. 12, Adeola Odeku Street, Victoria Island, Lagos. Thanks").out).toBe(
      "She lives at [ADDRESS_1:Lagos/Victoria Island]. Thanks"
    );
    expect(redact("Deliver to 14b Bode Thomas Road, Surulere").out).toBe("Deliver to [ADDRESS_1:Lagos/Surulere]");
  });

  it("gives the same value the same token across messages", () => {
    const v = new Vault();
    const msgs = redactMessages(
      [
        { role: "user", content: "My NIN is 12345678901" },
        { role: "assistant", content: "Noted NIN 12345678901" },
      ],
      v
    );
    expect(msgs.map((m) => m.content)).toEqual(["My NIN is [NIN_1]", "Noted NIN [NIN_1]"]);
    expect(v.size).toBe(1);
  });

  it("round-trips: rehydrate(redact(x)) === x", () => {
    const s = "NIN 12345678901, phone 08031234567, a@b.ng, GPS 6.6018, 3.3515, lives at 5 Allen Avenue, Ikeja";
    const { out, v } = redact(s);
    expect(out).not.toMatch(/\d{11}|@/);
    expect(rehydrateText(out, v)).toBe(s);
  });

  it("rehydrates tokens even when the model drops the brackets", () => {
    const { v } = redact("NIN 12345678901");
    expect(rehydrateText("Your NIN_1 is verified", v)).toBe("Your 12345678901 is verified");
  });

  it("rehydrates tokens split across stream chunks", () => {
    const { v } = redact("NIN 12345678901 at 6.6018, 3.3515");
    const r = new StreamRehydrator(v);
    let out = "";
    for (const c of ["For [N", "IN_", "1] at [GPS_1:Lag", "os/Ikeja] done"]) out += r.push(c);
    out += r.flush();
    expect(out).toBe("For 12345678901 at 6.6018, 3.3515 done");
  });
});

describe("person names", () => {
  it("redacts names after honorifics and cue words", () => {
    expect(redact("Customer Adaeze Okafor wants a loan").out).toBe("Customer [NAME_1] wants a loan");
    expect(redact("Alhaji Musa Bello and Mrs. Funke Adeyemi").out).toBe("Alhaji [NAME_1] and Mrs. [NAME_2]");
    expect(redact("My name is Chukwuemeka Obi").out).toBe("My name is [NAME_1]");
  });

  it("leaves ordinary capitalised phrases alone", () => {
    for (const s of ["Contact customer Service for help", "The client Lagos State Government", "Dear Sir, how are you", "Explain the loan policy to my customer in Pidgin"]) {
      expect(redact(s).out).toBe(s);
    }
  });
});

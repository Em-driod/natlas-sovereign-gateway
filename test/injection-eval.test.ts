import { describe, expect, it } from "vitest";
import { scoreText } from "../src/security/injection.js";
import { BENIGN, ROUND1, ROUND2, ROUND3 } from "../scripts/eval-injection.js";

const blocked = (t: string) => scoreText(t).score >= 0.7;

// Guards against regressions: these numbers can only go up.
describe("prompt-injection evaluation sets", () => {
  it("blocks every round-1 attack", () => {
    expect(ROUND1.filter(([, t]) => !blocked(t)).map(([n]) => n)).toEqual([]);
  });
  it("blocks at least 11 of 12 round-2 and all round-3 attacks", () => {
    expect(ROUND2.filter(blocked).length).toBeGreaterThanOrEqual(11);
    expect(ROUND3.filter(blocked).length).toBe(ROUND3.length);
  });
  it("never blocks the 30 normal fintech and support questions", () => {
    expect(BENIGN.filter(blocked)).toEqual([]);
  });
});

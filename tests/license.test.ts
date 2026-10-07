import { describe, expect, it } from "vitest";
import {
  OFFLINE_GRACE_MS,
  REVALIDATE_AFTER_MS,
  evaluateCache,
  type LicenseCache,
} from "@/lib/license";

const NOW = 1_800_000_000_000;
const cache = (over: Partial<LicenseCache> = {}): LicenseCache => ({
  key: "K-1",
  instanceId: "i-1",
  paid: true,
  checkedAt: NOW,
  ...over,
});

describe("evaluateCache", () => {
  it("is not Pro without a key", () => {
    expect(evaluateCache(null, NOW)).toEqual({
      pro: false,
      shouldRevalidate: false,
      graceExpired: false,
    });
  });

  it("is not Pro once a key has been rejected", () => {
    expect(evaluateCache(cache({ paid: false }), NOW).pro).toBe(false);
  });

  it("is Pro on a fresh check, without wanting the network", () => {
    const verdict = evaluateCache(cache(), NOW);
    expect(verdict.pro).toBe(true);
    expect(verdict.shouldRevalidate).toBe(false);
  });

  it("asks for a background re-check after a week", () => {
    const verdict = evaluateCache(cache({ checkedAt: NOW - REVALIDATE_AFTER_MS - 1 }), NOW);
    expect(verdict.shouldRevalidate).toBe(true);
    // Still Pro: revalidation must never gate an export.
    expect(verdict.pro).toBe(true);
  });

  it("stays Pro through the whole offline grace window", () => {
    const nearlyOut = NOW - (REVALIDATE_AFTER_MS + OFFLINE_GRACE_MS - 1);
    expect(evaluateCache(cache({ checkedAt: nearlyOut }), NOW).pro).toBe(true);
  });

  it("stops being Pro once the grace window is past", () => {
    const expired = NOW - (REVALIDATE_AFTER_MS + OFFLINE_GRACE_MS + 1);
    const verdict = evaluateCache(cache({ checkedAt: expired }), NOW);
    expect(verdict.pro).toBe(false);
    expect(verdict.graceExpired).toBe(true);
  });

  it("tolerates a clock that has moved backwards", () => {
    expect(evaluateCache(cache({ checkedAt: NOW + 60_000 }), NOW).pro).toBe(true);
  });
});

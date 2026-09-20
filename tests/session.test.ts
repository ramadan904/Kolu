import { describe, expect, it } from "vitest";
import {
  getMarketSession,
  referenceQualityFor,
  regularCloseMinute,
  timeUntilClose,
  toEasternParts,
} from "@/lib/market/session";

const at = (iso: string) => getMarketSession(new Date(iso));

describe("toEasternParts", () => {
  it("converts UTC to New York wall time across DST", () => {
    // January is EST (UTC-5).
    expect(toEasternParts(new Date("2026-01-15T14:00:00Z")).time).toBe("09:00");
    // July is EDT (UTC-4) — same UTC instant, different wall clock.
    expect(toEasternParts(new Date("2026-07-15T14:00:00Z")).time).toBe("10:00");
  });

  it("keys the date by New York, not UTC", () => {
    // 01:30 UTC on the 22nd is still 21:30 on the 21st in New York.
    expect(toEasternParts(new Date("2026-09-22T01:30:00Z")).date).toBe("2026-09-21");
  });

  it("normalises midnight to hour 00", () => {
    expect(toEasternParts(new Date("2026-09-21T04:00:00Z")).time).toBe("00:00");
  });
});

describe("getMarketSession", () => {
  it("classifies the continuous session", () => {
    const s = at("2026-09-21T14:00:00Z"); // Mon 10:00 ET
    expect(s.phase).toBe("regular");
    expect(s.isRegularHours).toBe(true);
    expect(s.isTradingHours).toBe(true);
    expect(s.minutesToNextPhase).toBe(360); // 10:00 -> 16:00
    expect(s.nextPhase).toBe("afterhours");
  });

  it("classifies pre-market and after-hours as trading but not regular", () => {
    const pre = at("2026-09-21T12:00:00Z"); // 08:00 ET
    expect(pre.phase).toBe("premarket");
    expect(pre.isTradingHours).toBe(true);
    expect(pre.isRegularHours).toBe(false);

    const post = at("2026-09-21T21:00:00Z"); // 17:00 ET
    expect(post.phase).toBe("afterhours");
    expect(post.isTradingHours).toBe(true);
    expect(post.isRegularHours).toBe(false);
  });

  it("treats the overnight gap as closed", () => {
    const s = at("2026-09-22T03:00:00Z"); // Mon 23:00 ET
    expect(s.phase).toBe("closed");
    expect(s.isTradingHours).toBe(false);
  });

  it("detects weekends", () => {
    const s = at("2026-09-20T16:00:00Z"); // Sunday
    expect(s.phase).toBe("weekend");
    expect(s.isTradingHours).toBe(false);
    expect(s.label).toBe("Weekend");
  });

  it("detects holidays and names them", () => {
    const s = at("2026-11-26T15:00:00Z"); // Thanksgiving, 10:00 ET
    expect(s.phase).toBe("holiday");
    expect(s.label).toBe("Thanksgiving Day");
    expect(s.isTradingHours).toBe(false);
  });

  it("honours the 13:00 close on half days", () => {
    // Day after Thanksgiving 2026. 13:30 ET would be mid-session on a normal day.
    const s = at("2026-11-27T18:30:00Z");
    expect(s.isHalfDay).toBe(true);
    expect(s.phase).toBe("afterhours");
    expect(s.label).toContain("early close");

    const before = at("2026-11-27T17:30:00Z"); // 12:30 ET
    expect(before.phase).toBe("regular");
    expect(before.minutesToNextPhase).toBe(30);
  });

  it("ends the half-day after-hours session at 17:00 ET", () => {
    expect(at("2026-11-27T21:30:00Z").phase).toBe("afterhours"); // 16:30 ET
    expect(at("2026-11-27T22:30:00Z").phase).toBe("closed"); // 17:30 ET
  });

  it("flags dates outside the hardcoded calendar", () => {
    expect(at("2026-09-21T14:00:00Z").calendarStale).toBe(false);
    expect(at("2031-09-22T14:00:00Z").calendarStale).toBe(true);
  });

  it("does not claim a countdown it cannot know", () => {
    // Next boundary crosses a day that might be a holiday.
    expect(at("2026-09-20T16:00:00Z").minutesToNextPhase).toBeNull();
    expect(at("2026-09-22T03:00:00Z").minutesToNextPhase).toBeNull();
  });
});

describe("regularCloseMinute", () => {
  it("returns 16:00 normally and 13:00 on half days", () => {
    expect(regularCloseMinute("2026-09-21")).toBe(960);
    expect(regularCloseMinute("2026-11-27")).toBe(780);
  });
});

describe("referenceQualityFor", () => {
  it("only trusts the continuous session fully", () => {
    expect(referenceQualityFor("regular")).toBe("live");
    expect(referenceQualityFor("premarket")).toBe("thin");
    expect(referenceQualityFor("afterhours")).toBe("thin");
    expect(referenceQualityFor("weekend")).toBe("stale");
    expect(referenceQualityFor("holiday")).toBe("stale");
    expect(referenceQualityFor("closed")).toBe("stale");
  });
});

describe("timeUntilClose", () => {
  it("counts down to the bell while the session is open", () => {
    // Mon 10:00 ET, close at 16:00.
    expect(timeUntilClose(at("2026-09-21T14:00:00Z"))).toBe("6 hours");
    // Mon 15:20 ET.
    expect(timeUntilClose(at("2026-09-21T19:20:00Z"))).toBe("40 minutes");
    // Mon 13:45 ET.
    expect(timeUntilClose(at("2026-09-21T17:45:00Z"))).toBe("2h 15m");
  });

  it("honours the early close on a half day", () => {
    // Day after Thanksgiving, 12:30 ET, closes 13:00.
    expect(timeUntilClose(at("2026-11-27T17:30:00Z"))).toBe("30 minutes");
  });

  it("is null whenever the market is not open", () => {
    expect(timeUntilClose(at("2026-09-20T16:00:00Z"))).toBeNull(); // weekend
    expect(timeUntilClose(at("2026-09-21T12:00:00Z"))).toBeNull(); // premarket
    expect(timeUntilClose(at("2026-09-21T21:00:00Z"))).toBeNull(); // after hours
    expect(timeUntilClose(at("2026-11-26T15:00:00Z"))).toBeNull(); // holiday
  });
});

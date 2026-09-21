import { afterEach, describe, expect, it } from "vitest";
import { buildBoard, clearBoardCache } from "@/lib/board";
import { clear as clearHistory, observed } from "@/lib/history";

const OPEN = new Date("2026-09-21T14:00:00Z");
const env = { ...process.env };

afterEach(() => {
  process.env = { ...env };
  clearBoardCache();
  clearHistory();
});

describe("requested demo scenario", () => {
  it("is labelled as fixture data with its scenario, whatever the live mode", async () => {
    process.env.KOLU_PRICE_SOURCE = "pyth"; // live mode configured; the request wins
    const board = await buildBoard({ tier: "core", now: OPEN, scenario: "live_dislocation" });
    expect(board.source).toBe("fixture");
    expect(board.scenario).toBe("live_dislocation");
    expect(board.fellBack).toBe(false);
  });

  it("shows one actionable dislocation — the state a quiet market never shows", async () => {
    const board = await buildBoard({ tier: "core", now: OPEN, scenario: "live_dislocation" });
    const actionable = board.readings.filter((r) => r.signal === "actionable");
    expect(actionable.length).toBe(1);
    expect(Math.abs(actionable[0].basisBps!)).toBeGreaterThan(150);
  });

  it("is never recorded into price history", async () => {
    const board = await buildBoard({ tier: "core", now: OPEN, scenario: "live_dislocation" });
    for (const r of board.readings) expect(observed(r.ticker)).toHaveLength(0);
  });
});

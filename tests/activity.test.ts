import { describe, expect, it } from "vitest";
import { ago, classify, nativeSolDelta, type ParsedTxLike } from "@/lib/activity";

const OWNER = "Owner1111111111111111111111111111111111111";
const OTHER = "Other1111111111111111111111111111111111111";
const TSLAX = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const tokens = { [TSLAX]: "TSLAX" };

const bal = (mint: string, owner: string, uiAmount: number) => ({
  mint,
  owner,
  uiTokenAmount: { uiAmount },
});

function tx(pre: ReturnType<typeof bal>[], post: ReturnType<typeof bal>[], err: unknown = null): ParsedTxLike {
  return {
    blockTime: 1_000,
    meta: { err, preTokenBalances: pre, postTokenBalances: post },
    transaction: { signatures: ["sig"] },
  };
}

describe("classify", () => {
  it("reads a USDC -> xStock swap as a buy, with both amounts", () => {
    const a = classify(
      tx([bal(USDC, OWNER, 100), bal(TSLAX, OWNER, 0)], [bal(USDC, OWNER, 75), bal(TSLAX, OWNER, 0.0666)]),
      OWNER,
      tokens,
      USDC,
    );
    expect(a).toMatchObject({ kind: "bought", tokenTicker: "TSLAX", usdcAmount: 25 });
    expect(a!.tokenAmount).toBeCloseTo(0.0666);
  });

  it("reads an xStock -> USDC swap as a sell", () => {
    const a = classify(
      tx([bal(TSLAX, OWNER, 1), bal(USDC, OWNER, 0)], [bal(TSLAX, OWNER, 0.5), bal(USDC, OWNER, 187)]),
      OWNER,
      tokens,
      USDC,
    );
    expect(a).toMatchObject({ kind: "sold", tokenAmount: 0.5, usdcAmount: 187 });
  });

  it("treats a movement with no USDC leg as a transfer", () => {
    const a = classify(tx([bal(TSLAX, OWNER, 5)], [bal(TSLAX, OWNER, 2)]), OWNER, tokens, USDC);
    expect(a).toMatchObject({ kind: "sent", tokenAmount: 3, usdcAmount: null });
  });

  it("counts an account created in the transaction (no pre-balance)", () => {
    const a = classify(tx([], [bal(TSLAX, OWNER, 2)]), OWNER, tokens, USDC);
    expect(a).toMatchObject({ kind: "received", tokenAmount: 2 });
  });

  it("ignores other owners' accounts and untracked mints", () => {
    expect(classify(tx([bal(TSLAX, OTHER, 5)], [bal(TSLAX, OTHER, 0)]), OWNER, tokens, USDC)).toBeNull();
    expect(classify(tx([bal(USDC, OWNER, 5)], [bal(USDC, OWNER, 0)]), OWNER, tokens, USDC)).toBeNull();
  });

  it("flags a failed transaction rather than hiding it", () => {
    const a = classify(tx([bal(TSLAX, OWNER, 1)], [bal(TSLAX, OWNER, 0)], { InstructionError: [0, "x"] }), OWNER, tokens, USDC);
    expect(a?.failed).toBe(true);
  });
});

describe("ago", () => {
  it("formats relative time", () => {
    expect(ago(1000, 1030)).toBe("just now");
    expect(ago(1000, 1000 + 5 * 60)).toBe("5m ago");
    expect(ago(1000, 1000 + 3 * 3600)).toBe("3h ago");
    expect(ago(1000, 1000 + 2 * 86_400)).toBe("2d ago");
    expect(ago(null, 1)).toBe("");
  });
});

describe("nativeSolDelta", () => {
  const owner = "Owner111111111111111111111111111111111111111";
  const tx = (over: Partial<NonNullable<import("@/lib/activity").ParsedTxLike["meta"]>> = {}) => ({
    blockTime: 1,
    transaction: { signatures: ["s"], message: { accountKeys: [{ pubkey: owner }, { pubkey: "pool" }, { pubkey: "newAta" }] } },
    meta: {
      err: null,
      fee: 5_000,
      preBalances: [1_000_000_000, 0, 0],
      // Spent 0.02 SOL on the swap, 5,000 lamports fee, 2,100,000 lamports rent for a new token account.
      postBalances: [1_000_000_000 - 20_000_000 - 5_000 - 2_100_000, 0, 2_100_000],
      preTokenBalances: [],
      postTokenBalances: [{ accountIndex: 2, mint: "xstock", owner, uiTokenAmount: { uiAmount: 0.013 } }],
      ...over,
    },
  });

  it("excludes the fee and a new account's rent from what was traded", () => {
    expect(nativeSolDelta(tx(), owner)).toBeCloseTo(-0.02, 9);
  });

  it("does not treat an account that already existed as new rent", () => {
    const t = tx({
      preTokenBalances: [{ accountIndex: 2, mint: "xstock", owner, uiTokenAmount: { uiAmount: 0 } }],
      postBalances: [1_000_000_000 - 20_000_000 - 5_000, 0, 2_100_000],
    });
    expect(nativeSolDelta(t, owner)).toBeCloseTo(-0.02, 9);
  });

  it("is null when the owner is not in the transaction", () => {
    expect(nativeSolDelta(tx(), "someoneElse")).toBeNull();
  });
});

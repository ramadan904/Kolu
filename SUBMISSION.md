# Kolu — STOCKLANA submission

Everything here is ready to paste into the submission form. Nothing in it
claims more than the repo actually does.

---

## One-line pitch

**Kolu shows you when a tokenized stock is trading away from fair value — and
what that gap is actually worth after costs.**

## Tagline (short form)

Fair-value basis terminal for tokenized stocks on Solana.

---

## Description

Tokenized stocks trade 24/7. The companies they track do not. For about 118 of
the 168 hours in a week, an xStock is priced by a market with no reference to
check itself against — and it drifts.

Kolu measures that drift. It puts Pyth's equity feed for the real share
(`Equity.US.AAPL/USD`) next to Pyth's feed for the token (`Crypto.AAPLX/USD`),
ranks every pair by how far apart they are, and then does the three things that
turn a number into a decision:

**It tells you whether the gap is real.** Pyth publishes a confidence interval
with every price. Add both legs' bands and you get a noise floor. A 60bps
"dislocation" between two feeds each carrying a 25bps band is not a trade, it is
two error bars overlapping — so Kolu draws that band on the chart and greys out
anything that fails to escape it.

**It tells you whether the gap is opening or closing.** The 48h chart shades the
periods when the underlying market was shut. You can watch the basis sit pinned
near zero through the session, open once the market closes, and collapse at the
next open. That shape is the whole thesis, and it is visible rather than
asserted.

**It tells you what the gap is worth, and what kind of trade it is.** Set your
size and Kolu breaks out swap fees per leg, price impact measured from a live
Jupiter route quote, and amortised network cost — then states plainly whether
what survives is a hedgeable edge or a directional bet. Because while NYSE is
shut there is no short leg available: you are not arbitraging, you are hoping it
converges by the open. Kolu never calls that arbitrage, and never shows the
number in confident green.

A brokerage cannot build this screen. Not for lack of engineering — the thing
being measured does not exist in its world. There is no AAPL price at 3am on a
Sunday, so there is no gap. The basis is an artifact of a 24/7 settlement layer
wrapped around a 09:30–16:00 asset, and it exists only where those two clocks
touch.

---

## Why it belongs on Solana

- The asset only exists here. xStocks are Solana tokens; the 24/7 price that
  creates the basis is produced by Solana venues.
- The reference data is here. Pyth publishes both the equity feed and the
  tokenized feed on-chain, on the same clock, which is what makes the comparison
  trustworthy rather than two screen-scrapes.
- The execution is here. The gap is actionable because Jupiter can route the
  trade in the same block-time the signal appears in.

Take any of those three away and the product is impossible.

---

## Pyth track

Kolu's core operation is a comparison that only Pyth makes possible: the same
asset, priced two ways, on one clock.

- Uses **both** the US equity feeds and the tokenized-equity crypto feeds.
- Uses the **confidence interval**, not just the price — it is what separates a
  signal from two overlapping error bars, and it is drawn on the chart.
- Uses **publish time** to distinguish a reference that is stale because the
  market is shut from one that is stale because the feed has stalled. These are
  reported as different conditions because a trader responds to each
  differently.
- Feed ids are **resolved from Hermes by symbol at runtime**, never hardcoded.
  A wrong feed id is a silently wrong price, and a price wrong by a factor of
  100 looks like the trade of the year.

---

## Demo script (~2:30)

**0:00 — The setup.** Open on the board, weekend. "Tokenized stocks trade around
the clock. The companies they track don't. Right now NYSE has been shut for
fourteen hours, and these five names have all drifted." Point at the session
strip: *US equities: Weekend*. Point at the third tile: *Can it be hedged? No.*

**0:20 — The board.** "Widest dislocation is SPYX at +1.73%. The bar is
diverging around zero — warm is a premium, cool is a discount, and AAPLX has
gone the other way. The grey band around zero is the oracles' own confidence.
Anything inside it we grey out, because it isn't signal."

**0:45 — The proof.** Expand SPYX. Point at the chart. "This is the last 48
hours. The shaded region is when the underlying market was shut. Look at the
shape: flat through Friday's session — arbitrageurs can hedge, so they do — and
then it opens the moment the market closes and keeps going all weekend. That's
the whole thesis in one picture."

**1:15 — The honesty.** Scroll to the edge panel. "173bps gross. Two legs of
swap fees, measured price impact for this size from a Jupiter route quote,
network cost. 83bps left on a $10k clip." Pause on the caveat. "And this is the
part most tools won't tell you: the market is shut, so there's no short leg.
This is a directional bet that it converges by the open — not an arbitrage. We
never show that number in green."

**1:45 — The failure mode.** Point at the amber banner. "This is running on demo
data right now because the live feed was unreachable from this machine — and it
says so. It never passes modelled numbers off as live prices."

**2:00 — The close.** "Four scenarios ship with it, so you can see a live
dislocation, a calm market, or a stalled feed on demand. 69 tests. No wallet, no
RPC, no API key — clone it and it runs." Cut to the repo.

---

## What is real, and what is not

Judges can check every line of this.

**Working:** market session engine (DST, half-day closes, holiday calendar),
Pyth Hermes adapter with runtime feed resolution, basis computation with the
oracle noise floor, stale-vs-degraded classification, 48h history with
closed-market shading, cost and edge model, the full board and action surface.
69 tests. Falls back to labelled demo data when the live source is unreachable.

**Built and tested against recorded responses, not yet run live:** the Jupiter
quote path. It is quote-only — Kolu never builds, signs or sends a transaction,
and holds no key material.

**Deliberately absent:** token mint addresses. A wrong mint does not throw, it
routes an order into a different asset that happens to share a ticker. The repo
ships an example config and a loader that rejects anything which is not base58,
so a leftover placeholder is dropped rather than handed to a router.

---

## Links

- **GitHub:** https://github.com/ramadan904/Kolu
- **Run it:** `npm install && npm run dev` — no key, no wallet, no RPC

## Tech

Next.js 15 (App Router), React 19, TypeScript, Tailwind v4. Pyth Hermes for
prices, Jupiter for route quotes. No chain calls on the read path, which is why
it works from a cold clone.

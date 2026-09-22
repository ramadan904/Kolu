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
periods when the underlying market was shut, and it is drawn from real trades:
the xStock's own on-chain pool candles against the real share's last exchange
print. You can watch the gap widen across the overnight closure and snap back
at the open. Measured over 48h: TSLAX averaged ~19bps off its share while the
market was open and ~39bps while it was shut; NVDAX 28bps vs 48bps. That shape
is the whole thesis, and it is shown from data rather than asserted.

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
  100 looks like the trade of the year. Resolution is verified against the live
  endpoint in CI — 24/24 symbols, all 12 tickers with both legs — on every
  change to the universe and on a weekday schedule.

---

## Demo script (~2:30)

Works on any day. Most of the open session every pair is inside the noise floor
— the replay covers that without passing anything off as live.

**0:00 — The setup.** Open the live board. "Tokenized stocks trade around the
clock. The companies they track don't." Point at the session strip — open,
after hours or closed — and the *Live* badge: both legs are live prices.

**0:15 — The honest board.** "Every pair is measured against its real share.
The grey band on the map is the oracles' own confidence; inside it is noise,
and Kolu says *Hold* rather than invent a trade." If a real gap is open, it
leads the page; if nothing pays, the hero says so and offers the replay.

**0:35 — What acting looks like.** Click *See what Kolu does when a gap opens*.
Amber banner: modelled, trading off, your position hidden. Open the ticket:
"*Sell NVDAX · +130bps survives at $2k.* Net edge at four sizes from live
Jupiter quotes — here's where it stops paying. The market is shut, so it's
directional, not an arbitrage, and never shown in green." *Back to live prices.*

**1:10 — Prove the trade, without a wallet.** Open any live ticket, press *Dry
run*. "That's the exact Jupiter transaction, built and simulated on mainnet —
it delivers this many tokens right now. Nothing signed, nothing sent." The step
tracker shows Quote → Build → Simulate → Sign (needs a wallet).

**1:35 — Your position.** Click *see a live example*. "A public exchange wallet
— sixteen million dollars of real xStocks, valued against the live gaps, with
what each would gain or lose if its gap closed, and its latest xStock activity
read from chain." Point at the rings on the map. "Connect your own wallet and
Buy or Sell opens the ticket on that side; a fill lands here without a reload."

**1:55 — Act on a gap while you sleep.** In any ticket, *Limit at a gap*:
"Buy TSLAX if it trades 0.5% under the real share — that's a real Jupiter limit
order, filled on-chain with Kolu closed." *Dry run* simulates the exact order.

**2:05 — Alerts.** On a quiet board: *Alert me when a gap pays* — every pair
armed at the break-even gap for a $10k trade. "It never fires on noise or on a
stalled feed; one false alarm at 3am gets the feature muted."

**2:20 — The close.** "Live prices, live routes, verified mints, a swap that
can't be reported as filled when it reverted. 213 tests. Every view is a link —
this one opens the ticket." Copy link from the ticket; cut to the repo.

---

## What is real, and what is not

Judges can check every line of this.

**Working:** market session engine (DST, half-day closes, holiday calendar),
Pyth Hermes adapter with runtime feed resolution, basis computation with the
oracle noise floor, stale-vs-degraded classification, 48h history with
closed-market shading, cost and edge model, threshold alerts, the full board and
action surface. A wallet trade flow — live Jupiter quote, wallet signature,
polled confirmation that never reports a reverted swap as filled — and a
positions view that values any Solana address's real xStock holdings against
the live gaps. 213 tests. Falls back to labelled demo data when the live source
is unreachable.

**Live, unauthenticated:** Pyth symbol resolution. All 24 symbols — twelve
tickers, both legs — resolve against `hermes.pyth.network` in CI, on every
change to the universe and on a weekday schedule. The tokenized twins are
`Crypto.<TICKER>X/USD`, confirmed rather than assumed.

**Live, on chain:** all twelve xStock mints plus USDC, resolved and verified
against mainnet — exact symbol match, mint account owned by Token-2022, and
registry decimals equal to on-chain decimals.

**Live prices:** both legs of every pair come from Jupiter's price service,
with no key required — the deployed board shows *Live* and `/api/health` says
`serving: jupiter`. Pyth remains the authenticated source: it began requiring a
key for price *updates* on 26 August 2026 (plans from $500/month), so set
`PYTH_API_KEY` to switch to it with no other change. If the live source is
unreachable, the board falls back to labelled demo data — banner on screen,
alerts prefixed `[demo]`, never passed off as live.

**Verified against live Jupiter:** the trade path. All twelve pairs, both
directions — quote fetched, parsed by the production adapter, sanity-checked,
then the real swap transaction built and deserialized as a
`VersionedTransaction`. 24/24 legs, in CI, on every change to the routing code
(`.github/workflows/verify-routes.yml`).

That covers route, assembly, encoding and deserialization. What is **not**
tested is the signature itself — by design, nothing but the user's own wallet
can produce one. Kolu holds no key material and never signs.

**Deliberately absent:** token mint addresses. A wrong mint does not throw, it
routes an order into a different asset that happens to share a ticker. The repo
ships an example config and a loader that rejects anything which is not base58,
so a leftover placeholder is dropped rather than handed to a router.

---

## Links

- **Live:** https://kolu-ramrex904-5914.vercel.app
- **Straight to it:** [replay a dislocation](https://kolu-ramrex904-5914.vercel.app/?replay=1) ·
  [a live portfolio](https://kolu-ramrex904-5914.vercel.app/?view=example) · [a TSLAX ticket](https://kolu-ramrex904-5914.vercel.app/?trade=TSLA)
- **Health:** https://kolu-ramrex904-5914.vercel.app/api/health
- **GitHub:** https://github.com/ramadan904/Kolu
- **Run it:** `npm install && npm run dev` — no key, no wallet, no RPC for the board; set `SOLANA_RPC_URL` to trade

## Tech

Next.js 15 (App Router), React 19, TypeScript, Tailwind v4. Pyth Hermes for
prices, Jupiter for route quotes. No chain calls on the read path, which is why
it works from a cold clone.

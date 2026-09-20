# Kolu

**The tool that shows you when a tokenized stock is trading away from fair value — and what that gap is actually worth.**

Tokenized stocks trade 24/7. The companies they track do not. For roughly 118
of every 168 hours in a week, an xStock is priced by a market with no reference
to check itself against, and it drifts. Kolu measures that drift, prices it
after costs, and tells you whether it can be hedged or only bet on.

Built for [STOCKLANA](https://hackathons.solana.com/hackathons/stocklana).

---

## Why this can't be built off-chain

A brokerage cannot show you this screen. Not because it lacks the engineering,
but because the thing being measured does not exist in its world: there is no
AAPL price at 3am on a Sunday, so there is no gap to measure. The basis is an
artifact of a 24/7 settlement layer wrapping a 09:30–16:00 asset, and it only
appears where those two clocks touch.

Pyth publishes both sides of that seam — `Equity.US.AAPL/USD` for the real
share, `Crypto.AAPLX/USD` for the token. Kolu is what you get when you put them
next to each other and take the difference seriously.

## What it does

**A ranked board.** Every tracked pair, widest dislocation first, showing the
underlying, the token, the gap in bps and percent, and a diverging bar with the
oracle confidence band drawn around zero.

**An honest signal, not just a number.** Each row is classified:

| Signal | Meaning |
|---|---|
| **Actionable** | Gap exceeds combined oracle confidence, with a live reference |
| **Drift** | Real gap, but the reference is a stale print because the market is shut |
| **Within noise** | Gap is smaller than the oracles' own confidence bands |
| **Feed stalled** | Market is open and the reference has stopped ticking — upstream problem |
| **No data** | A leg is missing. Nothing is guessed |

**History, with the closures shaded.** Expand a row and the 48h basis chart
shows the mechanism rather than asserting it: the gap sits pinned near zero
through the session, opens once the underlying market shuts, and collapses at
the next open. A single number cannot tell you whether a dislocation is
widening or already halfway closed.

**An action surface.** Set your size: gross gap, swap fees per leg, price
impact, amortised network cost, and what survives. Price impact is a **measured
route quote from Jupiter** when mints are configured, and your own assumption —
labelled as such — when they are not. Then the sentence that matters: whether
this is a hedgeable edge or a directional bet.

## The three judgement calls

Most of the value here is in what the app *refuses* to say.

**1. A gap inside oracle confidence is not a signal.** Pyth ships a confidence
interval with every price. Add both legs' bands and you get a noise floor; a
60bps "dislocation" on two feeds each carrying a 25bps band is not a trade, it
is two error bars overlapping. Kolu draws that band on the chart and greys out
anything that fails to escape it.

**2. Stale-because-closed and stale-because-broken are different emergencies.**
A 14-hour-old AAPL print at 3am is the expected state of the world. The same
print at 11am on a Tuesday means something upstream has died. Most dashboards
collapse these into one "stale" badge. Kolu reports them as `Drift` and
`Feed stalled`, because you respond to them differently.

**3. An unhedgeable gap is never called arbitrage.** Capturing a basis means
shorting the rich leg against the cheap one. While NYSE is shut that short leg
does not exist — you are taking a directional position and hoping it converges
by the open. Same number, completely different trade. Kolu labels it
`Directional`, and the net-edge figure is never shown in confident green no
matter how wide the gap is.

## Run it

```bash
npm install
npm run dev          # http://localhost:3000
```

No API key, no wallet, no RPC. Pyth's Hermes endpoint is public and needs no
auth. **If it is unreachable — locked-down wifi, a corporate proxy, an offline
demo machine — the app falls back to deterministic fixture data and says so in
a banner on screen.** It never passes demo numbers off as live prices.

To see a specific market state on demand:

```bash
KOLU_PRICE_SOURCE=fixture KOLU_SCENARIO=weekend_drift npm run dev
```

| Scenario | What it shows |
|---|---|
| `weekend_drift` | Market shut, board drifted off Friday's close, one name gapped the other way |
| `live_dislocation` | Market open, one name genuinely dislocated, everything else tight |
| `calm` | Everything inside the noise floor — the honest common case |
| `degraded` | The equity reference has stalled mid-session |

Other commands:

```bash
npm test             # 69 tests
npm run typecheck
npm run sync-feeds   # report which Pyth feeds actually exist for the universe
```

## How it's built

```
src/lib/market/     NYSE calendar + session classification (DST, half days, holidays)
src/lib/data/       Pyth Hermes adapter, Jupiter quotes, fixtures, source selection
src/lib/basis/      Basis computation, noise floor, cost and edge model
src/lib/history.ts  Basis history: in-process samples + modelled demo backfill
src/lib/mints.ts    Token registry, loaded from config rather than compiled in
src/lib/board.ts    Assembles the ranked snapshot
src/components/     Board, diverging bar, basis chart, edge panel, session strip
```

Next.js 15 (App Router), React 19, TypeScript, Tailwind v4. No wallet
dependency, no chain calls — the read path is entirely oracle data, which is
why it works from a cold clone.

**Feed ids are resolved from Hermes by symbol at runtime and cached.** There is
not a single hardcoded 32-byte hex id in this repository. A wrong feed id is a
silently wrong price, and a price that is wrong by a factor of 100 looks like
the trade of the year.

### Tests

69 tests, covering the parts where being quietly wrong is expensive:

- DST transitions, half-day 13:00 closes, holiday tables, ET-vs-UTC date keying
- The noise floor, and the stale-vs-degraded split
- Exponent scaling on Pyth responses, and exact-symbol feed matching
  (so `AAPL` never binds to a feed that merely contains "AAPL")
- Cost amortisation, and the invariant that a directional trade can never
  render in the confident tone
- Jupiter's `priceImpactPct` being a fraction and not a percentage (reading it
  the other way understates impact 100x and turns every losing trade into a
  winner), and amounts past `Number.MAX_SAFE_INTEGER` surviving as `bigint`
- Mint config rejecting placeholders and non-base58 strings
- The shape of the modelled history, so the chart cannot silently invert
- The live-source failure path, end to end

## Enabling measured quotes

```bash
cp config/mints.example.json config/mints.json
# fill in addresses you have verified yourself
```

With that file present, the edge panel replaces your assumed price impact with
a live Jupiter route quote for the size you picked, and names the AMMs it
routed through. Without it, everything else still works and the panel says
exactly what is missing.

**This repo ships no token addresses.** A wrong mint does not throw — it routes
an order into a different asset that happens to share a ticker. The loader
rejects anything that is not base58, so a leftover `<AAPLx mint address>`
placeholder is dropped rather than sent to a router.

## Status

The read and analysis path is complete: prices, sessions, basis, noise floor,
history and costs. Quoting is built and tested against recorded responses but
has not been run against live Jupiter from this machine. Kolu never builds,
signs or sends a transaction, and holds no key material.

Kolu is analysis, not investment advice. Oracle prices are a mid, not a quote
you can hit.

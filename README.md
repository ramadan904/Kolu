# Kolu

**The tool that shows you when a tokenized stock is trading away from fair value — and what that gap is actually worth.**

Tokenized stocks trade 24/7. The companies they track do not. For roughly 118
of every 168 hours in a week, an xStock is priced by a market with no reference
to check itself against, and it drifts. Kolu measures that drift, prices it
after costs, and tells you whether it can be hedged or only bet on.

Built for [STOCKLANA](https://hackathons.solana.com/hackathons/stocklana).

**[Open the live board](#)** · [Deploy your own](DEPLOY.md) · [QA checklist](QA.md) · [Submission](SUBMISSION.md)

---

## Judge path — 90 seconds

1. **Open the board.** Read the session strip first: it says whether US equities
   are open, and every number below means something different depending on that.
   The third tile answers *Can it be hedged?* — while the market is shut, no.

2. **Read the top row.** Widest dislocation, in percent and bps. The bar
   diverges around zero: warm is a premium, cool is a discount. The grey band
   around zero is the two oracles' combined confidence — anything that fails to
   escape it is greyed out and labelled *Within noise*, because it is not signal.

3. **Expand that row.** The chart is the thesis. Shaded = the underlying market
   was shut. The basis sits pinned near zero through the session, opens the
   moment the market closes, and collapses at the next open.

4. **Look at the cost breakdown.** Gross gap, swap fees per leg, price impact,
   network cost, and what survives. Then the caveat: on a closed market it reads
   **Directional, not an arbitrage** — there is no short leg available, so this
   is a bet on convergence. That number is never shown in confident green.

5. **Arm an alert.** Alerts → threshold → Arm. It fires on the next poll. What
   matters is what it refuses to fire on: a gap inside the noise floor, or one
   measured against a feed that has stopped ticking.

6. **Check `/api/health`** if you want to know whether you are looking at live
   oracle data or labelled demo data. It says so explicitly.

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

**Alerts that respect your sleep.** Arm a threshold per ticker and Kolu watches
for you, in-page and via browser notification. What matters is what it refuses
to fire on: a gap inside the oracle noise floor, or one measured against a feed
that has stopped ticking, never alerts. A stalled reference manufactures an
arbitrarily large apparent basis, and waking someone at 3am for a data outage
dressed up as an opportunity is the fastest way to get the whole feature muted.

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

Deploying: see **[DEPLOY.md](DEPLOY.md)** — Vercel via GitHub Actions (with a
health smoke test that fails the job on an unhealthy deploy), or the Dockerfile
for anywhere else. No environment variable is required to boot.

No wallet, no RPC. For **live** prices set `PYTH_API_KEY` — Pyth began
requiring authentication on Hermes in August 2026, and without a key the board
runs on labelled demo data instead (see [DEPLOY.md](DEPLOY.md)). **If it is unreachable — locked-down wifi, a corporate proxy, an offline
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
npm test             # 104 tests
npm run typecheck
npm run sync-feeds   # resolve the universe against live Hermes and report
```

`sync-feeds` resolves the universe against live Hermes. It has been run in CI
against the real endpoint: **24/24 symbols resolve, all 12 tickers with both
legs.** The tokenized twins are `Crypto.<TICKER>X/USD` as assumed — confirmed,
not guessed.

It stays in CI (Actions → **Verify Pyth feeds**, also on a weekday schedule)
because that convention could change under us. If it ever does, the fix is an
environment variable (`KOLU_TOKEN_SYMBOL_TEMPLATE`), not a code change, and the
script prints every symbol Hermes publishes for the affected ticker. It also
fails loudly at runtime: an oracle that answers with none of our symbols shows
*"Misconfigured, not offline"* and **refuses to substitute demo data**, because
plausible fake numbers would hide the bug.

## How it's built

```
src/lib/market/     NYSE calendar + session classification (DST, half days, holidays)
src/lib/data/       Pyth Hermes adapter, Jupiter quotes, fixtures, source selection
src/lib/basis/      Basis computation, noise floor, cost and edge model
src/lib/history.ts  Basis history: in-process samples + modelled demo backfill
src/lib/alerts.ts   Alert rules, and the conditions they refuse to fire on
src/lib/mints.ts    Token registry, loaded from config rather than compiled in
src/lib/board.ts    Assembles the ranked snapshot
src/components/ui/  Button, badge — the primitives
src/components/app/ Shell, market clock, hero, asset list, basis chart, trade panel
```

Next.js 15 (App Router), React 19, TypeScript, Tailwind v4, Solana wallet
adapter. The read path is entirely oracle data and needs no wallet or RPC,
which is why the board works from a cold clone; the wallet is required only to
sign a swap.

Dark only, Inter, one accent. The market-direction pair (`#1aa179` cheap,
`#ef4444` rich) is validated against the dark surface for lightness band,
chroma, colour-vision separation and contrast — and direction is always carried
by a sign as well as a hue.

**Feed ids are resolved from Hermes by symbol at runtime and cached.** There is
not a single hardcoded 32-byte hex id in this repository. A wrong feed id is a
silently wrong price, and a price that is wrong by a factor of 100 looks like
the trade of the year.

### Tests

104 tests, covering the parts where being quietly wrong is expensive:

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
- Feed resolution: one request per pair rather than per symbol, misses cached
  so the board stops re-asking, and exact-symbol matching preserved throughout
- Every condition an alert must stay silent on
- Retry and backoff: rate limits retried, permanent failures not
- The live-source failure path, end to end, and the misconfiguration path
  against a stub oracle that resolves nothing

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

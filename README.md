# Kolu

**The tool that shows you when a tokenized stock is trading away from fair value — and what that gap is actually worth.**

Tokenized stocks trade 24/7. The companies they track do not. For roughly 118
of every 168 hours in a week, an xStock is priced by a market with no reference
to check itself against, and it drifts. Kolu measures that drift, prices it
after costs, and tells you whether it can be hedged or only bet on.

Built for [STOCKLANA](https://hackathons.solana.com/hackathons/stocklana).

**[Open the live board](https://kolu-ramrex904-5914.vercel.app)** · [Deploy your own](DEPLOY.md) · [QA checklist](QA.md) · [Submission](SUBMISSION.md)

---

## Judge path — 90 seconds

1. **Open the board.** Read the session strip first: it says whether US equities
   are open, and every number below means something different depending on that.
   The third tile answers *Can it be hedged?* — while the market is shut, no.

2. **Read the top row.** Widest dislocation, in percent and bps. The bar
   diverges around zero: warm is a premium, cool is a discount. The grey band
   around zero is the two oracles' combined confidence — anything that fails to
   escape it is greyed out and labelled *Within noise*, because it is not signal.
   **Quiet market?** Most of the open session is. Click *See what Kolu does
   when a gap opens* to replay a modelled dislocation — labelled as demo on
   every surface, with trading and your position switched off while it runs —
   then *Back to live prices*.

3. **Open the trade ticket** (Trade, or click any row or map tick). It opens on
   a verdict — *Sell NVDAX · +130bps survives at $2k*, *No trade at $2k*, or
   *Hold · priced in line* — with the side that captures the gap pre-selected.
   Without a wallet, press **Dry run**: the exact Jupiter transaction is built
   and simulated on mainnet and reports what it delivers — nothing is signed.
   *Net edge by size* prices $500 / $2k / $10k / $50k from live Jupiter quotes,
   so you can see where the trade stops paying. The cost breakdown shows gross
   gap, fees, measured impact and what survives; on a closed market the caveat
   reads **Directional, not an arbitrage**. The chart below is the thesis:
   shaded = the underlying was shut, and the basis opens exactly then.

4. **See a real portfolio without a wallet.** In *Your position*, click *see a
   live example* (a public exchange wallet) or paste any Solana address, and its
   actual xStock holdings are valued against the live gaps,
   read-only, with what each would gain or lose if its gap closed. Rings on the
   map and *Held* tags in the table show the same exposure.

5. **Connect a wallet to trade.** Your holdings replace the watched address;
   Buy/Sell on a holding opens the ticket on that side. A $5 swap goes quote →
   approve in wallet → confirming → *Filled* with a Solscan link, and the
   position updates without a reload. A swap that reverts on-chain is never
   shown as filled.

6. **Arm an alert.** Alerts → threshold → Arm. What matters is what it refuses
   to fire on: a gap inside the noise floor, or a feed that stopped ticking.

7. **Check `/api/health`** for live vs labelled demo data, and which Solana RPC
   the wallet relay is using.

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

**History, with the closures shaded — from real trades.** The 48h chart is built
per pair from the xStock's deepest on-chain pool (15-minute candles,
GeckoTerminal) against the real share's exchange prints (Yahoo, pre/post
included), each candle measured against the last print at or before it — so the
overnight gap is measured against the stale print a trader actually has. When a
source is down or rate-limited, a modelled shape is drawn instead, dashed and
labelled, and never confused with the real line.

**The mechanism, shaded.** Expand a row and the 48h basis chart
shows the mechanism rather than asserting it: the gap sits pinned near zero
through the session, opens once the underlying market shuts, and collapses at
the next open. A single number cannot tell you whether a dislocation is
widening or already halfway closed.

**The thesis, tested.** *Does the gap close at the open?* takes every
regular-session open in the last week, per pair, and compares the gap in the
hour before 09:30 ET with the gap 30–90 minutes in, once the share trades. It
usually narrows — not always, and the misses are shown, because "it converges
by the open" is exactly the bet a closed-market trade is making. The chart
switches between 48 hours and 7 days, so a full weekend is always in view.

**Alerts that respect your sleep.** Arm a threshold per ticker and Kolu watches
for you, in-page and via browser notification. What matters is what it refuses
to fire on: a gap inside the oracle noise floor, or one measured against a feed
that has stopped ticking, never alerts. A stalled reference manufactures an
arbitrarily large apparent basis, and waking someone at 3am for a data outage
dressed up as an opportunity is the fastest way to get the whole feature muted.

**Slippage you chose, priced.** The ticket shows what the trade nets if the
fill lands at the edge of your tolerance, and says so when that tolerance is
wider than the edge itself. A default 0.5% slippage quietly eating most of an
83bps gap is the exact failure this product exists to prevent.

**Positions against the gap.** Connect a wallet — or paste any address to view
it read-only — and *Your position* values every xStock held (both token
programs, since xStocks are Token-2022 and USDC is not) against the live gaps:
quantity, value, gap, and what each holding gains or loses if the token
converges to the real share. Holdings outside the table's filter are listed,
never silently dropped from the total.

**P&L you can trust.** On a connected wallet, every swap made through Kolu
records its entry from the confirmed transaction's actual balance changes —
slippage included, never the quote. For anything bought elsewhere, type the
entry price in; it is labelled as yours. Kolu does not reconstruct a cost basis
from chain history, because the public RPC reads only recent transactions and
an average over a partial history is a confident wrong number. Stored in this
browser; watched addresses never get P&L.

**Limit orders at a gap.** "Buy TSLAX if it trades 0.5% under the real share":
Kolu turns the gap target into a real Jupiter limit order, held and filled
on-chain while nobody is watching — Kolu can be closed. The limit is fixed from
the real share's price at placement, and the ticket says so: if the share
moves, the order does not follow. Open orders are listed under *Your position*
with Cancel. Without a wallet, *Dry run* builds and simulates the exact order
transaction on mainnet.

**Balance-aware trading.** The ticket reads what you hold; *Max* fills the size.
A trade larger than your holdings is blocked before it reaches the wallet.
Quotes older than 10s are refreshed before signing. Confirmation is polled, and
the outcome is only ever *Filled*, *failed on-chain*, *expired* (certain nothing
landed), or *sent — not confirmed yet* (check before retrying, so nothing fills
twice).

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

The board needs no wallet and no RPC. For trading, set `SOLANA_RPC_URL` to a
dedicated Solana RPC (see `.env.example`). For **live** prices set `PYTH_API_KEY` — Pyth began
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

## What is verified, and where

Three things about this product cannot be checked on a laptop with no network,
so they are checked in CI, against the real services:

| Workflow | Proves |
| --- | --- |
| **Verify Pyth feeds** | All 24 Pyth symbols resolve against live Hermes. The tokenized naming is confirmed, not assumed. |
| **Discover mints** | All 12 xStock mints plus USDC verified against mainnet — exact symbol match, Token-2022 ownership, on-chain decimals agreement. |
| **Verify trade routes** | All 12 pairs, both directions: live Jupiter quote, parsed by the production adapter, swap transaction built and deserialized. 24/24 legs. |

The demo board's reference prices come from that last run, so modelled numbers
sit at realistic levels rather than invented ones.

## Status

The read and analysis path is complete: prices, sessions, basis, noise floor,
history and costs. Quotes and swap transactions come from live Jupiter. Kolu
builds the unsigned swap server-side, the user's wallet signs it, and the
browser submits it; Kolu holds no key material and cannot sign anything.

Wallet RPC goes through a same-origin relay (`/api/rpc`), because the public
Solana endpoint refuses browser requests outright. It forwards only the methods
the wallet flow needs. Set `SOLANA_RPC_URL` to a dedicated provider for
production traffic; the public endpoint behind it is rate-limited.

Kolu is analysis, not investment advice. Oracle prices are a mid, not a quote
you can hit.

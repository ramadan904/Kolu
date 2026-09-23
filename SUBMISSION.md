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

Kolu measures that drift. It prices both legs of every pair — the real share and
its token — on one clock, ranks them by how far apart they are, and then does
the three things that turn a number into a decision. (The deployed board serves
both legs from Jupiter, which needs no key; the Pyth adapter ships and takes
over when `PYTH_API_KEY` is set. `/api/health` always says which is serving.)

**It tells you whether the gap is real.** Every gap is measured against a noise
floor and anything inside it is greyed out as noise, not a trade — two error
bars overlapping is not a dislocation. Where that floor comes from is stated
rather than implied: with Pyth serving it is the confidence interval published
with each price; on the deployed board, where Jupiter serves and publishes no
interval, it is Kolu's own assumption of ±6bps a leg, said in those words on the
board, in *How Kolu reads a gap*, and in `/api/health` (`noiseFloor.basis`).

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

Kolu's core operation is a comparison Pyth is built for: the same asset, priced
two ways, on one clock. The integration ships and is verified in CI; the
deployed board serves Jupiter prices because Pyth began charging for price
updates in August 2026 (plans from $500/month) and this submission has no key.
Set `PYTH_API_KEY` and the same board runs on Pyth with no other change —
`/api/health` will show `serving: pyth` and `noiseFloor.basis: published
confidence`.

- Uses **both** the US equity feeds and the tokenized-equity crypto feeds.
- Uses the **confidence interval**, not just the price — it is what separates a
  signal from two overlapping error bars, and it is drawn on the chart. Without
  a key the band is a labelled assumption, never passed off as an oracle's.
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

**0:35 — A real dislocation, replayed.** Click *Replay a real dislocation*. The
board rebuilds itself as it stood at the widest real gap of the week — AAPLX
+148bps against the real Apple share, Saturday 06:30 ET, from the token's own
pool prints against the share's last exchange print. Same maths, same noise
floor, only the clock is different; the banner says so and trading is off.
Open the ticket:
"*Sell NVDAX · +130bps survives at $2k.* Net edge at four sizes from live
Jupiter quotes — here's where it stops paying. The market is shut, so it's
directional, not an arbitrage, and never shown in green." *Back to live prices.*

**1:10 — Prove the trade, without a wallet.** Open any live ticket, press *Dry
run*. "That's the exact Jupiter transaction, built and simulated on mainnet —
it delivers this many tokens right now. Nothing signed, nothing sent." The step
tracker shows Quote → Build → Simulate → Sign (needs a wallet).

**1:35 — Portfolio.** Open *Portfolio*, click *see a live example*. "A public exchange wallet
— sixteen million dollars of real xStocks, valued against the live gaps, with
what each would gain or lose if its gap closed, and its latest xStock activity
read from chain." Point at the rings on the map. "Connect your own wallet and
Buy or Sell opens the ticket on that side; a fill lands here without a reload."

**1:45 — The bet, with a clock on it.** The ticket's convergence clock: "next
open in 7h 10m · 28% of the gap *added* at this pair's median open · 1 of 3
narrowed". A +148bps gap the verdict says survives costs, and the pair's own
opens say the bet has gone badly — worst open widened it 199%. Kolu argues with
its own headline rather than selling it.

**1:55 — Act on a gap while you sleep.** In any ticket, *Limit at a gap*:
"Buy TSLAX if it trades 0.5% under the real share — that's a real Jupiter limit
order, filled on-chain with Kolu closed." *Dry run* simulates the exact order.

**2:05 — Alerts.** On a quiet board: *Alert me when a gap pays* — every pair
armed at the break-even gap for a $10k trade. "It never fires on noise or on a
stalled feed; one false alarm at 3am gets the feature muted."

**2:20 — The close.** "Live prices, live routes, verified mints, a swap that
can't be reported as filled when it reverted. 236 tests. Every view is a link —
this one opens the ticket." Copy link from the ticket; cut to the repo.

---

## What is real, and what is not

Judges can check every line of this.

**Four pages, one live board.** *Board* (the market now), *Portfolio* (holdings,
P&L, orders, activity), *History* (a week of real gaps, and whether they closed
at the open) and *Backtest* (would trading them have paid). Prices, an open
ticket, the replay and a watched address carry across all four; ⌘K reaches
everything.

**Pay in USDC or SOL.** The ticket trades either side of the pair against USDC
or native SOL, so a wallet holding only SOL can trade; it keeps back only what
the fees need and states the token account's one-time rent before a first buy.

**Working:** market session engine (DST, half-day closes, holiday calendar),
Pyth Hermes adapter with runtime feed resolution, basis computation with the
oracle noise floor, stale-vs-degraded classification, 48h history with
closed-market shading, cost and edge model, threshold alerts, the full board and
action surface. A wallet trade flow — live Jupiter quote, wallet signature,
polled confirmation that never reports a reverted swap as filled — and a
positions view that values any Solana address's real xStock holdings against
the live gaps. 236 tests. Falls back to labelled demo data when the live source
is unreachable.

**The Pyth path, proven without a key:** an integration test stands up Hermes'
own response shapes and gives two pairs the same 40bps gap but different
published confidence — ±120bps a leg for one, ±5bps for the other. The board
classifies the wide one as noise and the narrow one as actionable, so the noise
floor demonstrably comes from the feed rather than the ±6bps assumption the
keyless deployment uses. `/api/health` reports which is in force
(`noiseFloor.basis`), and the board's own chip reads "band · Pyth confidence"
or "band · assumed ±6bps a leg".

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

**Resilient by default:** the wallet relay keeps a second keyless Solana
endpoint behind whatever `SOLANA_RPC_URL` names and moves on when one
throttles or fails, so a rate limit costs a few hundred milliseconds rather
than a balance read or a swap. The response carries `x-kolu-rpc` naming which
endpoint answered, and `/api/health` lists the chain. When a price poll fails
the board keeps the last prices and says how old they are — "Reconnecting ·
44s old" — instead of blanking or pretending they are live.

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
- **Straight to it:** [replay the week's widest real gap](https://kolu-ramrex904-5914.vercel.app/?replay=1) ·
  [a live portfolio](https://kolu-ramrex904-5914.vercel.app/portfolio?view=example) · [gap history](https://kolu-ramrex904-5914.vercel.app/history) · [the backtest](https://kolu-ramrex904-5914.vercel.app/backtest) · [a TSLAX ticket](https://kolu-ramrex904-5914.vercel.app/?trade=TSLA)
- **Health:** https://kolu-ramrex904-5914.vercel.app/api/health
- **GitHub:** https://github.com/ramadan904/Kolu
- **Run it:** `npm install && npm run dev` — no key, no wallet, no RPC for the board; set `SOLANA_RPC_URL` to trade

## Tech

Next.js 15 (App Router), React 19, TypeScript, Tailwind v4. Pyth Hermes for
prices, Jupiter for route quotes. No chain calls on the read path, which is why
it works from a cold clone.

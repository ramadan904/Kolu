# Kolu — QA checklist

Runnable in 20–30 minutes. Each item says **how** to check it, not just what.

`BASE` below is the deployed URL, or `http://localhost:3000` after
`npm install && npm run dev`.

**Two things to know before you start.** `/api/health` answers most data
questions in one request — check it first, it will tell you which mode you are
in. And demo data is *supposed* to appear when the oracle is unreachable; that
is a labelled fallback, not a bug. The bug would be demo data appearing
unlabelled.

---

## 0. Smoke (2 min)

- [ ] `curl -s $BASE/api/health | jq .status` returns `ok` or `degraded`
- [ ] `curl -s $BASE/api/health | jq .build.branch` shows the branch you expect.
      A deployment pointed at the wrong branch serves a bare 404 and looks
      identical to a broken app from outside.
- [ ] If it returns `no_feeds` → **stop**. Symbol naming is wrong; see DEPLOY.md.
      Everything below will be misleading until it is fixed.
- [ ] If it returns `demo_fallback` with `source.apiKeyConfigured: false`, the
      board is on demo data because Hermes needs an API key (required since
      August 2026). Everything is still testable; just remember no number on
      screen is a live market price.
- [ ] `$BASE` loads with no console errors (DevTools → Console)
- [ ] Session strip shows the correct US market phase for the time you are testing

---

## 1. Live path & data integrity

- [ ] **Cold start does not spam the oracle.** Restart the server, load the
      board once, and count outbound requests (server logs, or Vercel function
      logs). A cold start of the 12-name universe should issue roughly **one
      `/v2/price_feeds` request per ticker**, not one per symbol (which would be
      24), plus one batched `/v2/updates/price/latest`.
- [ ] **Negative cache.** With a pair that has no token feed, refresh the board
      5×. The missing symbol must be queried **once**, not on every refresh.
      Confirm via `/api/health` → `universe.pairsMissing` staying stable while
      request count does not grow.
- [ ] **Snapshot cache.** Click 4–5 rows open/closed quickly. Full oracle rounds
      should be at most one per ~4s, not one per click. (`KOLU_BOARD_CACHE_MS`
      controls the window.)
- [ ] **Exact matching.** `/api/health` → `symbolTemplates.exampleToken` shows
      the exact symbol being requested. No row may show a price sourced from a
      partial ticker match — if a ticker resolves, its symbol must equal the
      requested one exactly.
- [ ] **Universe matches reality.** Run Actions → **Verify Pyth feeds**. The
      last run against live Hermes resolved **24/24 symbols, all 12 tickers with
      both legs** — that is the expected result. Any `MISSING` token feed means
      the convention has drifted; reconcile against the candidate list the job
      prints and set `KOLU_TOKEN_SYMBOL_TEMPLATE`.
- [ ] Switch **Liquid ↔ All**. Liquid shows 5 names, All shows 12. No duplicates,
      no blank rows.

## 2. Alerts — highest risk area

- [ ] **Arm → fire.** Alerts → set threshold to `10` on any name showing a
      larger gap → **Arm**. Within one poll (~10s) a fired entry appears and the
      "N fired this session" badge increments.
- [ ] **Noise floor never fires.** Run with `KOLU_SCENARIO=calm`
      (`KOLU_PRICE_SOURCE=fixture`). Every row reads *Within noise*. Arm a rule
      at `1` bps on any name and wait 60s. **It must never fire** — the raw gaps
      exceed 1bps, but they sit inside oracle confidence.
- [ ] **Stalled feed never fires.** Run with `KOLU_SCENARIO=degraded`. Rows read
      *Feed stalled*. Arm at `1` bps and wait 60s. **It must never fire**, even
      though the apparent basis is large. This is the single most important
      check in this document: a stalled reference can manufacture any gap you
      like, and one false 3am alert gets the product muted.
- [ ] **Honest message.** On a weekend/closed market, a fired alert must say
      *"drift against a closed market — directional, not hedgeable"* — not
      "arbitrage".
- [ ] **Tier silence is visible.** Switch to **All**, arm an alert on an
      extended-tier name (e.g. MSTR), switch back to **Liquid**. The rule row
      must show *"not on this board — switch to All to watch it"*. It must not
      silently sit there looking armed.
- [ ] **Demo notifications are marked.** With demo data showing, grant
      notification permission and let an alert fire. The browser notification
      title must begin with `[demo]`.
- [ ] **Cooldown.** After a fire, the same rule must not fire again for 15
      minutes even while the gap persists.
- [ ] **Persistence.** Reload the page. Armed rules survive. Open a private
      window: the app still works (storage may be empty — that is fine).

## 3. UI & product

- [ ] Board ranks by widest dislocation, descending. Unavailable rows sink to
      the bottom.
- [ ] Diverging bar: premium extends right/warm, discount left/cool, grey
      confidence band around zero. A greyed row's bar sits inside that band.
- [ ] Polarity is never colour-only — every basis cell also shows a signed
      number (`+1.73%` / `−1.10%`).
- [ ] **History chart.** Expand a row. Shaded regions = market shut. The line
      should be **flat near zero through the session, then opening across the
      closure** — if it is inverted (huge and shrinking), that is a regression.
- [ ] **Modelled and observed are visually distinct.** The 48h shape is dashed
      and dimmed with a "modelled" legend. Leave the tab open for a few minutes
      and genuinely observed readings draw over it as a solid line, with the
      caption switching to "N readings observed in this browser". The two must
      never be indistinguishable.
- [ ] **Action surface.** Change size ($1k → $250k). Costs recompute. Network
      fee in bps shrinks as size grows.
- [ ] **Directional is never green.** On a closed market the Net edge figure
      must be amber with a *Directional* caveat, no matter how large. Green is
      reserved for hedgeable edges that clear costs.
- [ ] **Measured vs assumed quote.** Without `config/mints.json`, the panel says
      "Assumed price impact" and explains what is missing. With mints
      configured, it says "Measured price impact — buy/sell leg" and names the
      route.
- [ ] **Quote direction.** On a name at a **premium**, the quote request must
      use `side=sell` (Network tab → `/api/quote`). A premium is sold, not
      bought.
- [ ] **Mobile (390px).** No horizontal scroll. You can read a gap, arm an
      alert, and open a row with the chart. Check with the alert panel expanded
      *and* a row open.
- [ ] **Light and dark.** Toggle OS theme. Both readable; no invisible text.

## 4. Failure & edge cases

- [ ] **Oracle unreachable.** Set `PYTH_HERMES_ENDPOINT=http://127.0.0.1:1` and
      reload. Amber *Demo data* banner appears, names the failure, and states
      nothing is a live price. Board still usable.
- [ ] **Oracle reachable but nothing resolves.** Set
      `KOLU_TOKEN_SYMBOL_TEMPLATE=Crypto.DOESNOTEXIST{TOKEN}/USD` and reload.
      Red *"Misconfigured, not offline"* banner. **Demo data must NOT appear** —
      it is withheld on purpose so the misconfiguration is not hidden behind
      plausible numbers.
- [ ] **Mid-session network blip.** Load the board, then kill network. The
      board keeps the last good data and shows *Stale*. It must not blank out or
      invent numbers.
- [ ] **Rate limit.** A single 429 from the oracle must not drop the board to
      demo data — it is retried with backoff.
- [ ] **Tier switch keeps alerts.** Switching Liquid ↔ All never deletes an
      armed rule.
- [ ] **Bad input.** `curl "$BASE/api/quote?ticker=NOPE&notional=-5"` returns a
      structured reason, not a stack trace. Same for
      `/api/history?ticker=NOPE`.

## 4b. Trading (only once config/mints.json exists)

- [ ] **Mints are verified, not pasted.** `config/mints.json` must come from
      the **Discover mints** workflow. Spot-check one mint on Solscan: symbol
      and decimals must match what the file claims.
- [ ] Edge panel shows **"Measured price impact"** with a route, not
      "assumed".
- [ ] **Direction.** On a token at a premium the quote request uses
      `side=sell`; at a discount, `side=buy`.
- [ ] **Slippage is the user's choice, and priced.** Changing Max slippage
      re-requests the quote with that tolerance (Network tab → `slippageBps`).
      The "Worst case at X% slippage" line equals net edge minus the tolerance.
- [ ] **A tolerance wider than the edge is called out.** Pick a slippage larger
      than the net edge: the worst-case line turns red and the panel says a fill
      at that limit wipes out the edge. The headline net edge must NOT silently
      absorb the tolerance — it is a floor, not a deduction.
- [ ] **Connect wallet** — Phantom/Solflare appear, connect succeeds, address
      shown truncated.
- [ ] **Balances appear.** The size row changes from "Sell SPYX" to
      "<amount> SPYX available". Cross-check one against Phantom. Clicking it
      fills the size with your whole balance.
- [ ] **Shortfall is blocked, not attempted.** Set a size larger than you hold.
      The button reads "Not enough USDC" (or the token) and is disabled — it
      must never reach the wallet prompt to fail there.
- [ ] **A balance read failure is not reported as zero.** With the RPC
      unreachable, the panel says it could not read balances; it must not claim
      the wallet is empty.
- [ ] **Swap a trivial size first** ($5). Confirm: transaction builds, wallet
      prompts, signature returns, Solscan link resolves, and the filled amount
      is the asset you expected. Do this before any demo.
- [ ] Cancelling in the wallet shows "You cancelled in your wallet. Nothing
      was sent.", not a stack trace.
- [ ] **A reverted swap is never "Filled".** Set slippage to 0.1% on a thin
      pair at $50k. If the transaction lands but reverts, the ticket shows the
      slippage message with a Solscan link — not the green Filled card.
- [ ] **The fill shows up without a reload.** After a $5 buy, the holding
      appears in "Your position" within a second or two of "Filled".
- [ ] **Net edge by size** fills all four cells from live quotes within a few
      seconds; clicking a cell sets the size. Cells re-quote every ~15s.
- [ ] **USD / token toggle** converts the entered size both ways; "Max" in
      token mode never asks to sell more than the wallet holds.
- [ ] **Against the gap.** On a rich token, switch to Buy: the gap line reads
      "pays", gross gap is negative, and the caveat says so.

### Positions (wallet connected)

- [ ] Wallet with USDC and no xStocks: the empty state names the deepest live
      discount and "Buy XXXX" opens the ticket on the buy side.
- [ ] Wallet holding an xStock: its row shows quantity, value, gap and
      "If gap closes"; the action that captures the gap is the filled button.
- [ ] Row "Sell" opens the ticket on Sell even when the token trades cheap.
- [ ] Switching wallets never shows the previous wallet's holdings.
- [ ] Kill the RPC after the first read: the panel keeps the last read and
      marks it "Stale", rather than blanking.

- [ ] **Watch any address.** With no wallet connected, paste a public address
      (e.g. an exchange hot wallet from Solscan's holders tab) into Your
      Position: it shows "Watching · read-only", real holdings and totals, and
      "Stop" returns to the connect prompt. A malformed address is rejected
      inline. Connecting a wallet always replaces the watched address.
- [ ] **Holdings outside the filter are never silently dropped.** On "Liquid",
      a wallet holding e.g. MSFTX shows "Also holds MSFTX…"; "Show all pairs"
      switches the table to All and the row appears in the totals.

### RPC relay

- [ ] `POST /api/rpc` with `getHealth` returns `ok`; a method outside the
      allowlist (e.g. `requestAirdrop`) returns 403. The public mainnet RPC
      refuses browser requests, so every balance read and swap depends on this.
- [ ] A swap is confirmed by polling, never by websocket. If confirmation
      times out, the ticket says "Sent — not confirmed yet" with a Solscan
      link and **no retry button** — it must never say "nothing was filled"
      unless the blockhash has expired and the signature is absent.

### Board consistency

- [ ] During regular hours with stalled references, the hero reads "No clean
      read" (never "Priced in line") and the map's count excludes delayed pairs.
- [ ] When the widest gap does not survive costs, the hero says so instead of
      "About −Nbps survives".

## 5. Deploy & submission

- [ ] Public URL opens with no local setup, no wallet, no key.
- [ ] `/api/health` reachable on the deployed URL and reports the expected mode.
- [ ] Deploy workflow is green, including its health smoke test.
- [ ] `DEPLOY.md` env table matches the variables actually set on the host.
- [ ] The timed script in `SUBMISSION.md` matches what the live site does —
      walk it once, with a stopwatch.
- [ ] README's 60–90s judge path works verbatim on the deployed URL.

---

## Reporting a failure

Include: the `status` from `/api/health`, whether the board was live or demo,
the market session shown in the strip, and the scenario if running fixtures.
Those four facts identify nearly every issue immediately.

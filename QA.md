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
- [ ] **History chart.** Expand a row. Shaded regions = market shut. On a
      weekend the line should be **flat near zero through the session, then
      opening across the closure** — if it is inverted (huge and shrinking),
      that is a regression.
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

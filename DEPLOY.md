# Deploying Kolu

Two supported targets. Vercel is the fast one; Docker is for anywhere else.

---

## Option A — Vercel via GitHub Actions (recommended)

The workflow is already committed at `.github/workflows/deploy.yml`. It runs
typecheck and the test suite, deploys, then **smoke-tests `/api/health` and
fails the job if the deployment is up but unhealthy**. A green check means a
judge can open the URL.

### One-time setup (about 5 minutes)

1. Create a Vercel project and link it locally:

   ```bash
   npx vercel login
   npx vercel link          # creates .vercel/project.json
   cat .vercel/project.json # copy orgId and projectId
   ```

2. Add three repository secrets under **Settings → Secrets and variables →
   Actions → Secrets**:

   | Secret | Where it comes from |
   | --- | --- |
   | `VERCEL_TOKEN` | https://vercel.com/account/tokens |
   | `VERCEL_ORG_ID` | `orgId` in `.vercel/project.json` |
   | `VERCEL_PROJECT_ID` | `projectId` in `.vercel/project.json` |

3. Push. Pushes to `main` go to production; any other branch gets a preview URL,
   printed in the job summary.

### Or deploy by hand

```bash
npx vercel --prod
```

---

## Option B — Docker (Fly, Render, Cloud Run, a VPS)

```bash
docker build -t kolu .
docker run -p 3000:3000 -e KOLU_PRICE_SOURCE=pyth kolu
```

Multi-stage, runs unprivileged, and carries a `HEALTHCHECK` that polls
`/api/health`. No volumes, no database, no secrets required to boot.

---

## Environment variables

**One matters: `PYTH_API_KEY`.** Without it the app runs and is fully
demonstrable, but on labelled demo data rather than live prices.

| Variable | Default | What it does |
| --- | --- | --- |
| `PYTH_API_KEY` | _(none)_ | **Required for live prices.** See below. |
| `PYTH_HERMES_ENDPOINT` | `https://hermes.pyth.network` | Oracle endpoint. Point at a private Hermes if you have one. |
| `KOLU_PRICE_SOURCE` | `pyth` | `fixture` forces demo data. Use for a guaranteed-stable demo. |
| `KOLU_SCENARIO` | `weekend_drift` | Which demo scenario: `weekend_drift`, `live_dislocation`, `calm`, `degraded`. |
| `KOLU_TOKEN_SYMBOL_TEMPLATE` | `Crypto.{TOKEN}/USD` | **The one to know about.** See below. |
| `KOLU_EQUITY_SYMBOL_TEMPLATE` | `Equity.US.{TICKER}/USD` | Equity symbol naming. |
| `KOLU_TOKEN_TICKER_TEMPLATE` | `{TICKER}X` | How a ticker becomes its tokenized ticker. |
| `KOLU_BOARD_CACHE_MS` | `4000` | Snapshot cache window. `0` disables. |
| `JUPITER_ENDPOINT` | `https://lite-api.jup.ag` | Router used for measured price impact. |
| `SOLANA_RPC_URL` | `https://api.mainnet-beta.solana.com` | **Set this before a demo with wallets.** Upstream for the `/api/rpc` relay (balances, send, confirm). Server-side only, so a keyed provider URL (Alchemy, Helius, QuickNode) never reaches the browser. Tick **Preview** as well as Production on Vercel. `/api/health` → `execution.walletRpc` confirms it. |
| `NEXT_PUBLIC_SOLANA_RPC` | _(none)_ | Lets the browser call a CORS-enabled RPC directly, bypassing the relay. Shipped to every visitor — never a paid key. |

### Why live prices need a key

Pyth began requiring authentication on Hermes in **August 2026**. The split is
awkward and worth knowing: `/v2/price_feeds` still answers anonymously, so
symbol resolution succeeds and the app reports all 12 pairs resolved — but
`/v2/updates/price/latest` returns **401**, so not one price arrives.

The result looks like a working integration serving no data. `/api/health`
names it directly: `source.apiKeyConfigured` tells you whether a key is set,
and the fallback reason says what to do.

Get a key from the Pyth developer hub, then set `PYTH_API_KEY` in your host's
environment (Vercel: Settings → Environment Variables → add → Redeploy).
Without it, `status` reads `demo_fallback` and the board shows the amber
"Demo data" banner — honest and demoable, just not live.

### The symbol-naming variable

Everything downstream depends on the tokenized twins being called
`Crypto.<TICKER>X/USD` on Hermes.

**This has been verified against live Hermes in CI: 24/24 symbols resolve, all
12 tickers with both legs.** You do not need to set this variable. It remains
configurable because the convention is outside our control and could change.

It is a template rather than a hardcoded string precisely so that being wrong
costs an environment-variable change, not a code edit and a redeploy. And it
fails **loudly**: if the oracle answers and none of the symbols resolve, the
board shows "Misconfigured, not offline" and deliberately refuses to substitute
demo data, because plausible fake numbers would hide the bug.

If it ever does change, run the **Verify Pyth feeds** workflow (Actions tab →
Run workflow). It calls Hermes from a GitHub runner and prints a table of what
resolved. For any token symbol that misses, it lists every symbol Hermes
actually publishes for that ticker — so you read the convention off the output
instead of guessing. Then set `KOLU_TOKEN_SYMBOL_TEMPLATE` to match. The same
workflow runs on a weekday schedule, so a drift shows up before a user hits it.

Locally, same thing: `npm run sync-feeds`.

---

## Enabling trading

The trade path is dark until `config/mints.json` exists, because this repo
ships no token addresses. A wrong mint does not throw — it routes an order into
a different asset that happens to share a ticker.

Do not paste addresses from a search result. Run **Actions → Discover mints**
(or `npm run discover-mints` locally). It resolves every ticker against a token
registry and then verifies each candidate against chain before accepting it:
exact symbol match, a real mint account owned by the SPL Token or Token-2022
program, and registry decimals that agree with on-chain decimals. Anything that
fails is reported, not guessed at.

The run writes `config/mints.json` and uploads it as a build artifact. Download
it, drop it in, redeploy. The edge panel switches from "assumed" price impact
to a measured Jupiter quote and the swap button goes live.

`config/mints.json` is gitignored on purpose: addresses should be re-verified
on the machine that will use them, not inherited from a commit.

## Verifying a deployment

```bash
curl -s https://<your-url>/api/health | jq
```

| `status` | Meaning |
| --- | --- |
| `ok` | Live oracle data, every pair resolved. |
| `degraded` | Live, but some pairs are missing a leg. Usable. |
| `demo_fallback` | Oracle unreachable; showing labelled demo data. |
| `demo_configured` | `KOLU_PRICE_SOURCE=fixture` was set deliberately. |
| `no_feeds` | **Symbol naming is wrong.** Board will be empty. Fix the template. |
| `error` | Board could not be built at all. |

The endpoint returns HTTP 200 in every case, with the condition in `status` — a
non-200 would make uptime monitors page about states the product handles on
purpose.

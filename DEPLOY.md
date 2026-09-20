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

**Nothing is required.** Kolu runs against public Pyth with no key. Everything
below is optional.

| Variable | Default | What it does |
| --- | --- | --- |
| `PYTH_HERMES_ENDPOINT` | `https://hermes.pyth.network` | Oracle endpoint. Point at a private Hermes if you have one. |
| `KOLU_PRICE_SOURCE` | `pyth` | `fixture` forces demo data. Use for a guaranteed-stable demo. |
| `KOLU_SCENARIO` | `weekend_drift` | Which demo scenario: `weekend_drift`, `live_dislocation`, `calm`, `degraded`. |
| `KOLU_TOKEN_SYMBOL_TEMPLATE` | `Crypto.{TOKEN}/USD` | **The one to know about.** See below. |
| `KOLU_EQUITY_SYMBOL_TEMPLATE` | `Equity.US.{TICKER}/USD` | Equity symbol naming. |
| `KOLU_TOKEN_TICKER_TEMPLATE` | `{TICKER}X` | How a ticker becomes its tokenized ticker. |
| `KOLU_BOARD_CACHE_MS` | `4000` | Snapshot cache window. `0` disables. |
| `JUPITER_ENDPOINT` | `https://lite-api.jup.ag` | Router used for measured price impact. |

### The symbol-naming variable

Everything downstream depends on the tokenized twins being called
`Crypto.<TICKER>X/USD` on Hermes. That is the documented xStocks convention, but
it is the one claim in this repo that was never verified against a live
endpoint.

It is a template rather than a hardcoded string precisely so that being wrong
costs an environment-variable change, not a code edit and a redeploy. And it
fails **loudly**: if the oracle answers and none of the symbols resolve, the
board shows "Misconfigured, not offline" and deliberately refuses to substitute
demo data, because plausible fake numbers would hide the bug.

To get the real answer, run the **Verify Pyth feeds** workflow (Actions tab →
Run workflow). It calls Hermes from a GitHub runner and prints a table of what
resolved. For any token symbol that misses, it lists every symbol Hermes
actually publishes for that ticker — so you read the convention off the output
instead of guessing. Then set `KOLU_TOKEN_SYMBOL_TEMPLATE` to match.

Locally, same thing: `npm run sync-feeds`.

---

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

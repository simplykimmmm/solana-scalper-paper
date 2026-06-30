# Solana Paper Scalper

A cloud-ready paper trading dashboard for testing Solana memecoin scalping rules with free APIs.

This is not a live trading bot. It does not connect to a wallet, sign transactions, or place orders. It is built to prove whether a strategy survives slippage, route availability, price impact, base fees, priority fees, and failed quotes before any live wallet exists.

## Getting Started

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## What It Does

- Scans Solana token candidates from DexScreener.
- Prices paper entries and exits through Jupiter quotes.
- Models conservative fills using `otherAmountThreshold` where Jupiter returns it.
- Subtracts configurable base signature fees and priority fees from PnL.
- Runs from the browser dashboard or a server-side `/api/tick` endpoint.
- Lets the dashboard Play/Pause button start or pause cloud entries without
  stopping protective exit ticks.
- Supports an unlimited trade count mode that removes only the max-open and
  new-per-tick caps while keeping filters, cash, sizing, and exits active.
- Refreshes cloud dashboard state every 5 seconds while the page is open.
- Appends scan, entry, exit, win, and loss rows to an AI-ready JSONL log.
- Stores state in browser local storage by default.
- Optionally persists server-side state in Upstash Redis REST for cloud scheduler ticks.
- Uses Cloudflare Workers Cron for cloud ticks after the browser tab is closed.
- Includes a GitHub Actions scheduler fallback for free, delayed cloud ticks.
- Includes a continuous Node paper worker for faster stop-loss and max-hold enforcement.

## Deploy To Vercel

Import this repository as a normal Next.js project. The app now lives at the
repository root, so leave Vercel's root directory setting as `/`.

Free mode works with no env vars while the dashboard tab is open.

For cloud-persisted server ticks, create a free Upstash Redis database. The
Vercel Marketplace integration may add `KV_REST_API_URL` and
`KV_REST_API_TOKEN` automatically; the app also supports the direct Upstash
names below.

```text
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
KV_REST_API_URL=
KV_REST_API_TOKEN=
UPSTASH_REDIS_KEY=solana-scalper-paper:v1
UPSTASH_REDIS_TRAINING_LOG_KEY=solana-scalper-paper:v1:training-log
UPSTASH_REDIS_TICK_LOCK_KEY=solana-scalper-paper:v1:tick-lock
TRAINING_LOG_MAX_ROWS=20000
TICK_LOCK_TTL_SECONDS=120
CRON_SECRET=
```

Optional:

```text
JUPITER_API_KEY=
PAPER_WORKER_INTERVAL_SECONDS=10
```

The dashboard does not run a continuous browser loop. It monitors cloud state,
edits settings, exports logs, and can run one manual tick for testing. The
Play/Pause button saves `tradingEnabled` to cloud state: Play allows new paper
entries on the next Cloudflare tick, while Pause blocks new entries but still
allows stop-loss, max-hold, stale-quote, and other exits to run.

## Cloud 24/7 Mode

There are now two cloud runners:

1. **Always-on worker**: use this for the real 10-second paper loop.
2. **Cloudflare Worker Cron**: no-card fallback that runs once per minute and
   calls `/api/tick` 6 times with 10 seconds between calls.

Both runners use the same Upstash state and a Redis tick lock, so overlapping
cloud ticks skip instead of double-opening positions.

### Always-On Worker

The repository includes `render.yaml` for a Render background worker. Create a
Render Blueprint from this repo, use the `solana-scalper-paper-worker` service,
and set these secrets in Render:

```text
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
JUPITER_API_KEY=
```

The worker start command is:

```bash
pnpm paper:worker
```

The worker loads state from Upstash, runs one paper tick about every 10 seconds,
saves state back, and appends training rows. Dry-run mode runs one tick without
writing:

```bash
pnpm paper:worker:dry
```

Keep the Vercel dashboard deployed separately. The worker only runs the paper
engine and writes state back to Upstash.

### Vercel Dashboard/API

Vercel hosts the dashboard and `/api/tick`, but Vercel Cron is intentionally not
enabled in `vercel.json`. Hobby accounts only allow daily cron jobs, which is too
slow for this paper scalper. Cloudflare calls the Vercel API route instead.

### Cloudflare Worker No-Card Fallback

The repo includes `cloudflare-worker/`, which can be deployed to Cloudflare
Workers Cron. It does not need Render and does not run on your PC.

```bash
cd cloudflare-worker
npx wrangler login
npx wrangler secret put CRON_SECRET
npx wrangler deploy
```

Defaults in `cloudflare-worker/wrangler.jsonc`:

```text
PAPER_TICK_URL=https://solana-scalper-paper.vercel.app/api/tick
TICKS_PER_RUN=6
DELAY_SECONDS=10
```

This gives near-10-second paper ticks from Cloudflare, while the main app's
Redis lock prevents overlapping Vercel/GitHub/Cloudflare runners from
double-writing state.

The repo also includes `.github/workflows/cloud-paper-tick.yml`, which runs from
GitHub Actions every 5 minutes and, by default, calls the production `/api/tick`
endpoint 30 times with 10 seconds between calls. GitHub can delay or skip
scheduled jobs, so treat this as a free fallback runner, not a true uptime SLA.

If `CRON_SECRET` is set on Vercel, add the same value as a GitHub Actions secret
named `CRON_SECRET`. The workflow uses this endpoint by default:

```text
GET https://YOUR_APP.vercel.app/api/tick
Authorization: Bearer YOUR_CRON_SECRET
```

Optional repository variable:

```text
PAPER_TICK_URL=https://YOUR_APP.vercel.app/api/tick
```

That server-side path requires Upstash env vars. Without Upstash, closed-tab
cloud ticks cannot persist state.

## AI Training Export

Every saved tick appends structured rows to an Upstash list named
`solana-scalper-paper:v1:training-log` by default. Download it from the
dashboard database icon or directly:

```text
GET https://YOUR_APP.vercel.app/api/training-log
```

The file is JSONL (`.jsonl`), one event per line. Rows include scan candidates,
entries, exits, win/loss outcome, PnL, hold time, account snapshot, and the active
strategy settings. Optional env vars:

```text
UPSTASH_REDIS_TRAINING_LOG_KEY=
TRAINING_LOG_MAX_ROWS=20000
```

## Default Strategy

The default is intentionally safer than the earlier 1 SOL experiments:

- Buy one candidate per tick at most.
- Adaptive paper size: starts between `0.05` and `0.10 SOL`.
- Max default paper size: `0.15 SOL`.
- Risk per trade: `1%`.
- Scale-up requires at least `50` closed trades and profit factor above `1.4`.
- Trade count cap: off by default; candidate scans, cash, sizing, filters, and
  exits still limit entries.
- Take profit: `+4.5%` net after modeled fees.
- Stop loss: `-3.5%` net after modeled fees.
- Emergency stop: `-8%`.
- Trailing stop: activates at `+2.5%`, exits after a `1.25%` pullback.
- Max hold: `8 minutes`.
- Max Jupiter entry price impact: `0.75%`.
- Minimum score: `60`.
- Minimum liquidity: `$50,000`.
- Minimum five-minute volume: `$7,500`.
- Minimum five-minute buys: `15`.
- Minimum buy/sell ratio: `1.15`.
- Daily drawdown lock: `5%`.

All settings are editable in the dashboard.

## Live Mode Requirements Later

If paper trading is positive and you want to discuss a live build, use a dedicated hot wallet only. Never use your main wallet. A live version would need:

- Dedicated trading wallet public address and funded hot-wallet limits.
- Paid or high-quality RPC endpoint.
- Jupiter Pro or equivalent quote/execution access.
- Real-time position indexer or transaction parser.
- Hard daily loss cap, max spend cap, and manual kill switch.

## Sources

- DexScreener API reference: https://docs.dexscreener.com/api/reference
- Jupiter Swap quote docs: https://dev.jup.ag/docs/api/swap-api/quote
- Solana transaction fees: https://solana.com/docs/core/fees
- Solana priority fees RPC: https://solana.com/docs/rpc/http/getrecentprioritizationfees
- Vercel cron jobs: https://vercel.com/docs/cron-jobs
- Render Blueprint spec: https://render.com/docs/blueprint-spec
- Cloudflare Workers Cron Triggers: https://developers.cloudflare.com/workers/configuration/cron-triggers/
- Upstash Redis REST API: https://upstash.com/docs/redis/features/restapi

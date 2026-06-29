# Solana Paper Scalper

A cloud-ready paper trading dashboard for testing Solana memecoin scalping rules with free APIs.

This is not a live trading bot. It does not connect to a wallet, sign transactions, or place orders. It is built to prove whether a strategy survives slippage, route availability, price impact, base fees, priority fees, and failed quotes before any live wallet exists.

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## What It Does

- Scans Solana token candidates from DexScreener.
- Prices paper entries and exits through Jupiter quotes.
- Models conservative fills using `otherAmountThreshold` where Jupiter returns it.
- Subtracts configurable base signature fees and priority fees from PnL.
- Runs from the browser dashboard or a server-side `/api/tick` endpoint.
- Refreshes cloud dashboard state every 5 seconds while the page is open.
- Appends scan, entry, exit, win, and loss rows to an AI-ready JSONL log.
- Stores state in browser local storage by default.
- Optionally persists server-side state in Upstash Redis REST for cloud scheduler ticks.
- Includes a GitHub Actions scheduler that can keep paper ticks running after the browser tab is closed.

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
CRON_SECRET=
```

Optional:

```text
JUPITER_API_KEY=
```

The dashboard Start button runs only while the browser tab is open. For closed-tab
cloud ticks, this repo includes `.github/workflows/cloud-paper-tick.yml`, which
calls the production `/api/tick` endpoint every 5 minutes. GitHub can delay
scheduled jobs, so treat this as a free background runner, not a precise
second-by-second process.

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

The default is intentionally selective:

- Buy one candidate per tick at most.
- Trade size: `0.1 SOL`.
- Max open positions: `3`.
- Take profit: `+8%` net after modeled fees.
- Stop loss: `-5%` net after modeled fees.
- Trailing stop: activates at `+6%`, exits after a `3%` pullback.
- Max hold: `20 minutes`.
- Max Jupiter price impact: `1.5%`.
- Minimum liquidity: `$20,000`.
- Minimum five-minute volume: `$2,500`.

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
- Upstash Redis REST API: https://upstash.com/docs/redis/features/restapi

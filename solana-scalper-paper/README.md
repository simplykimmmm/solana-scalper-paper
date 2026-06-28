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
- Stores state in browser local storage by default.
- Optionally persists server-side state in Upstash Redis REST for cloud scheduler ticks.

## Deploy To Vercel

The app lives in this folder. In Vercel, set the project root to:

```text
solana-scalper-paper
```

Free mode works with no env vars while the dashboard tab is open.

For cloud-persisted server ticks, create a free Upstash Redis database and add:

```text
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
UPSTASH_REDIS_KEY=solana-scalper-paper:v1
CRON_SECRET=
```

Optional:

```text
JUPITER_API_KEY=
```

Vercel Hobby cron has a once-per-day minimum interval. For a free one-hour paper run, keep the dashboard tab open and press Start, or use an external free scheduler to call:

```text
GET https://YOUR_APP.vercel.app/api/tick
Authorization: Bearer YOUR_CRON_SECRET
```

That server-side path requires Upstash env vars.

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

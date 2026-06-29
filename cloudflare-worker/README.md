# Cloudflare Worker Ticker

This is a no-card alternative to a Render background worker.

It uses Cloudflare Workers Cron to run once per minute, then calls the Vercel
`/api/tick` endpoint multiple times with a delay between calls. With the default
settings, one scheduled run performs 6 ticks spaced 10 seconds apart.

This is still paper-only. It does not trade from a wallet.

## Deploy

Install and log in to Wrangler:

```bash
npm create cloudflare@latest
npx wrangler login
```

Deploy this worker from the `cloudflare-worker` folder:

```bash
cd cloudflare-worker
npx wrangler deploy
```

Set the same secret as Vercel if `CRON_SECRET` is enabled:

```bash
npx wrangler secret put CRON_SECRET
```

Optional vars are already in `wrangler.jsonc`:

```text
PAPER_TICK_URL=https://solana-scalper-paper.vercel.app/api/tick
TICKS_PER_RUN=6
DELAY_SECONDS=10
```

## Expected Behavior

Cloudflare calls the Worker every minute. The Worker then calls:

```text
GET https://solana-scalper-paper.vercel.app/api/tick
```

six times, waiting 10 seconds between calls.

The main app's Redis tick lock prevents double ticks if Vercel Cron, GitHub
Actions, or another worker overlaps.

## Limits

This is not a permanent process. It is a scheduled cloud runner. For strict
uptime guarantees, use a paid always-on worker or VM.

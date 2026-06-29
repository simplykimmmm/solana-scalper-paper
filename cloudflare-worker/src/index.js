const DEFAULT_TICK_URL = "https://solana-scalper-paper.vercel.app/api/tick";
const DEFAULT_TICKS_PER_RUN = 6;
const DEFAULT_DELAY_SECONDS = 10;
const MAX_TICKS_PER_RUN = 12;
const MAX_DELAY_SECONDS = 30;

const worker = {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runTickBurst(env));
  },

  async fetch(request, env) {
    if (!isAuthorized(request, env)) {
      return new Response("Unauthorized", { status: 401 });
    }

    const result = await runTickBurst(env);
    return Response.json(result);
  },
};

export default worker;

async function runTickBurst(env) {
  const tickUrl = env.PAPER_TICK_URL || DEFAULT_TICK_URL;
  const ticksPerRun = clampInteger(
    env.TICKS_PER_RUN,
    1,
    MAX_TICKS_PER_RUN,
    DEFAULT_TICKS_PER_RUN,
  );
  const delaySeconds = clampInteger(
    env.DELAY_SECONDS,
    1,
    MAX_DELAY_SECONDS,
    DEFAULT_DELAY_SECONDS,
  );
  const results = [];

  for (let tick = 1; tick <= ticksPerRun; tick += 1) {
    const startedAt = Date.now();
    const result = await callTickEndpoint(tickUrl, env);
    const elapsedMs = Date.now() - startedAt;

    results.push({
      tick,
      ...result,
      elapsedMs,
    });

    if (tick < ticksPerRun) {
      await sleep(delaySeconds);
    }
  }

  return {
    ok: results.some((result) => result.ok),
    tickUrl,
    ticksPerRun,
    delaySeconds,
    results,
  };
}

async function callTickEndpoint(tickUrl, env) {
  const headers = {};

  if (env.CRON_SECRET) {
    headers.authorization = `Bearer ${env.CRON_SECRET}`;
  }

  try {
    const response = await fetch(tickUrl, {
      headers,
      cache: "no-store",
    });
    const body = await response.text();

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        body: body.slice(0, 500),
      };
    }

    return {
      ok: true,
      status: response.status,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: error instanceof Error ? error.message : "Unknown fetch error.",
    };
  }
}

function isAuthorized(request, env) {
  if (!env.CRON_SECRET) {
    return false;
  }

  return request.headers.get("authorization") === `Bearer ${env.CRON_SECRET}`;
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function sleep(seconds) {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1_000));
}

import type { ActivityEvent, BotConfig, BotState } from "./types";

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const LAMPORTS_PER_SOL = 1_000_000_000;

export const DEFAULT_CONFIG: BotConfig = {
  startingCashSol: 10,
  tradeSizeSol: 0.1,
  maxOpenPositions: 3,
  maxNewPositionsPerTick: 1,
  takeProfitNetPct: 8,
  stopLossNetPct: -5,
  trailingActivationPct: 6,
  trailingDrawdownPct: 3,
  maxHoldMinutes: 20,
  cooldownMinutes: 30,
  tickIntervalSeconds: 30,
  slippageBps: 100,
  priorityFeeLamports: 10_000,
  baseSignatureFeeLamports: 5_000,
  maxPriceImpactPct: 1.5,
  minLiquidityUsd: 20_000,
  maxLiquidityUsd: 2_500_000,
  minVolumeM5Usd: 2_500,
  minAgeMinutes: 8,
  maxAgeHours: 24,
  minBuySellRatioM5: 0.9,
  minBuysM5: 8,
  candidateLimit: 18,
  discoveryMode: "latest-boosts",
  watchlist: [],
  restrictIntermediateTokens: true,
  dexscreenerBaseUrl: "https://api.dexscreener.com",
  jupiterQuoteUrl: "https://lite-api.jup.ag/swap/v1/quote",
};

const nowIso = () => new Date().toISOString();

export function createActivity(
  kind: ActivityEvent["kind"],
  message: string,
): ActivityEvent {
  return {
    id: crypto.randomUUID(),
    at: nowIso(),
    kind,
    message,
  };
}

export function createInitialState(config: Partial<BotConfig> = {}): BotState {
  const merged = normalizeConfig(config);
  const now = nowIso();

  return {
    initializedAt: now,
    updatedAt: now,
    cashSol: merged.startingCashSol,
    openPositions: [],
    closedTrades: [],
    activity: [
      createActivity(
        "state",
        `Paper account initialized with ${merged.startingCashSol.toFixed(4)} SOL.`,
      ),
    ],
    equityCurve: [
      {
        at: now,
        cashSol: merged.startingCashSol,
        equitySol: merged.startingCashSol,
      },
    ],
    cooldowns: {},
    tickCount: 0,
  };
}

export function normalizeConfig(input: Partial<BotConfig> = {}): BotConfig {
  const config = { ...DEFAULT_CONFIG, ...input };

  return {
    ...config,
    startingCashSol: clampNumber(config.startingCashSol, 0.01, 1_000_000),
    tradeSizeSol: clampNumber(config.tradeSizeSol, 0.001, 10_000),
    maxOpenPositions: Math.round(clampNumber(config.maxOpenPositions, 1, 50)),
    maxNewPositionsPerTick: Math.round(
      clampNumber(config.maxNewPositionsPerTick, 0, 20),
    ),
    takeProfitNetPct: clampNumber(config.takeProfitNetPct, 0.1, 10_000),
    stopLossNetPct: clampNumber(config.stopLossNetPct, -99, -0.1),
    trailingActivationPct: clampNumber(config.trailingActivationPct, 0, 500),
    trailingDrawdownPct: clampNumber(config.trailingDrawdownPct, 0.1, 100),
    maxHoldMinutes: clampNumber(config.maxHoldMinutes, 1, 10_080),
    cooldownMinutes: clampNumber(config.cooldownMinutes, 0, 10_080),
    tickIntervalSeconds: Math.round(
      clampNumber(config.tickIntervalSeconds, 10, 3_600),
    ),
    slippageBps: Math.round(clampNumber(config.slippageBps, 1, 5_000)),
    priorityFeeLamports: Math.round(
      clampNumber(config.priorityFeeLamports, 0, 50_000_000),
    ),
    baseSignatureFeeLamports: Math.round(
      clampNumber(config.baseSignatureFeeLamports, 5_000, 500_000),
    ),
    maxPriceImpactPct: clampNumber(config.maxPriceImpactPct, 0.01, 100),
    minLiquidityUsd: clampNumber(config.minLiquidityUsd, 0, 1_000_000_000),
    maxLiquidityUsd: clampNumber(
      config.maxLiquidityUsd,
      config.minLiquidityUsd,
      10_000_000_000,
    ),
    minVolumeM5Usd: clampNumber(config.minVolumeM5Usd, 0, 1_000_000_000),
    minAgeMinutes: clampNumber(config.minAgeMinutes, 0, 43_200),
    maxAgeHours: clampNumber(config.maxAgeHours, 0.1, 8_760),
    minBuySellRatioM5: clampNumber(config.minBuySellRatioM5, 0, 20),
    minBuysM5: Math.round(clampNumber(config.minBuysM5, 0, 100_000)),
    candidateLimit: Math.round(clampNumber(config.candidateLimit, 1, 100)),
    watchlist: Array.isArray(config.watchlist)
      ? config.watchlist.map((value) => value.trim()).filter(Boolean)
      : [],
    dexscreenerBaseUrl:
      config.dexscreenerBaseUrl || DEFAULT_CONFIG.dexscreenerBaseUrl,
    jupiterQuoteUrl: config.jupiterQuoteUrl || DEFAULT_CONFIG.jupiterQuoteUrl,
  };
}

export function estimatedTxFeeSol(config: BotConfig): number {
  return (
    (config.baseSignatureFeeLamports + config.priorityFeeLamports) /
    LAMPORTS_PER_SOL
  );
}

function clampNumber(value: unknown, min: number, max: number): number {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return min;
  }

  return Math.min(Math.max(numeric, min), max);
}

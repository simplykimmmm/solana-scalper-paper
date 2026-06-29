import type { ActivityEvent, BotConfig, BotState } from "./types";

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const LAMPORTS_PER_SOL = 1_000_000_000;

export const DEFAULT_CONFIG: BotConfig = {
  startingCashSol: 10,
  tradeSizeSol: 0.05,
  riskMode: "adaptive",
  minTradeSizeSol: 0.05,
  maxTradeSizeSol: 0.15,
  riskPerTradePct: 1,
  scaleUpAfterTrades: 50,
  scaleUpMinProfitFactor: 1.4,
  maxDailyDrawdownPct: 5,
  maxOpenPositions: 3,
  maxNewPositionsPerTick: 1,
  takeProfitNetPct: 4.5,
  stopLossNetPct: -3.5,
  trailingActivationPct: 2.5,
  trailingDrawdownPct: 1.25,
  emergencyMaxLossPct: -8,
  staleQuoteMaxSeconds: 30,
  maxHoldMinutes: 8,
  cooldownMinutes: 180,
  tickIntervalSeconds: 10,
  slippageBps: 100,
  priorityFeeLamports: 10_000,
  baseSignatureFeeLamports: 5_000,
  maxEntryPriceImpactPct: 0.75,
  maxPriceImpactPct: 0.75,
  minLiquidityUsd: 50_000,
  maxLiquidityUsd: 2_500_000,
  minVolumeM5Usd: 7_500,
  minPairAgeMinutes: 3,
  maxPairAgeHours: 6,
  minAgeMinutes: 3,
  maxAgeHours: 6,
  minBuySellRatioM5: 1.15,
  minBuysM5: 15,
  minScoreToEnter: 60,
  maxTradeLiquidityPct: 0.25,
  rejectEmojiOnlySymbols: true,
  rejectDuplicateRecentToken: true,
  candidateLimit: 50,
  discoveryMode: "combined",
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
    lastTickAt: undefined,
    lastTickSource: undefined,
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
    peakEquitySol: merged.startingCashSol,
    maxDrawdownPct: 0,
    dailyAnchorDate: dayKey(now),
    dailyStartEquitySol: merged.startingCashSol,
    dailyPeakEquitySol: merged.startingCashSol,
    dailyDrawdownPct: 0,
    drawdownLocked: false,
    tickCount: 0,
  };
}

export function normalizeConfig(input: Partial<BotConfig> = {}): BotConfig {
  const legacy = input as Partial<BotConfig> & {
    maxPriceImpactPct?: number;
    minAgeMinutes?: number;
    maxAgeHours?: number;
  };
  const config = { ...DEFAULT_CONFIG, ...input };
  const minTradeSizeSol = clampNumber(config.minTradeSizeSol, 0.001, 10);
  const maxTradeSizeSol = clampNumber(
    config.maxTradeSizeSol,
    minTradeSizeSol,
    10,
  );
  const maxEntryPriceImpactPct = clampNumber(
    config.maxEntryPriceImpactPct ?? legacy.maxPriceImpactPct,
    0.01,
    100,
  );
  const minPairAgeMinutes = clampNumber(
    config.minPairAgeMinutes ?? legacy.minAgeMinutes,
    0,
    43_200,
  );
  const maxPairAgeHours = clampNumber(
    config.maxPairAgeHours ?? legacy.maxAgeHours,
    0.1,
    8_760,
  );

  return {
    ...config,
    startingCashSol: clampNumber(config.startingCashSol, 0.01, 1_000_000),
    tradeSizeSol: clampNumber(config.tradeSizeSol, minTradeSizeSol, maxTradeSizeSol),
    riskMode: config.riskMode === "fixed" ? "fixed" : "adaptive",
    minTradeSizeSol,
    maxTradeSizeSol,
    riskPerTradePct: clampNumber(config.riskPerTradePct, 0.01, 25),
    scaleUpAfterTrades: Math.round(
      clampNumber(config.scaleUpAfterTrades, 1, 10_000),
    ),
    scaleUpMinProfitFactor: clampNumber(config.scaleUpMinProfitFactor, 0, 100),
    maxDailyDrawdownPct: clampNumber(config.maxDailyDrawdownPct, 0.1, 100),
    maxOpenPositions: Math.round(clampNumber(config.maxOpenPositions, 1, 50)),
    maxNewPositionsPerTick: Math.round(
      clampNumber(config.maxNewPositionsPerTick, 0, 20),
    ),
    takeProfitNetPct: clampNumber(config.takeProfitNetPct, 0.1, 10_000),
    stopLossNetPct: clampNumber(config.stopLossNetPct, -99, -0.1),
    trailingActivationPct: clampNumber(config.trailingActivationPct, 0, 500),
    trailingDrawdownPct: clampNumber(config.trailingDrawdownPct, 0.1, 100),
    emergencyMaxLossPct: clampNumber(config.emergencyMaxLossPct, -99, -0.1),
    staleQuoteMaxSeconds: Math.round(
      clampNumber(config.staleQuoteMaxSeconds, 5, 86_400),
    ),
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
    maxEntryPriceImpactPct,
    maxPriceImpactPct: maxEntryPriceImpactPct,
    minLiquidityUsd: clampNumber(config.minLiquidityUsd, 0, 1_000_000_000),
    maxLiquidityUsd: clampNumber(
      config.maxLiquidityUsd,
      config.minLiquidityUsd,
      10_000_000_000,
    ),
    minVolumeM5Usd: clampNumber(config.minVolumeM5Usd, 0, 1_000_000_000),
    minPairAgeMinutes,
    maxPairAgeHours,
    minAgeMinutes: minPairAgeMinutes,
    maxAgeHours: maxPairAgeHours,
    minBuySellRatioM5: clampNumber(config.minBuySellRatioM5, 0, 20),
    minBuysM5: Math.round(clampNumber(config.minBuysM5, 0, 100_000)),
    minScoreToEnter: clampNumber(config.minScoreToEnter, 0, 100),
    maxTradeLiquidityPct: clampNumber(config.maxTradeLiquidityPct, 0.001, 100),
    rejectEmojiOnlySymbols: Boolean(config.rejectEmojiOnlySymbols),
    rejectDuplicateRecentToken: Boolean(config.rejectDuplicateRecentToken),
    candidateLimit: Math.round(clampNumber(config.candidateLimit, 1, 250)),
    discoveryMode: [
      "latest-profiles",
      "latest-boosts",
      "top-boosts",
      "watchlist",
      "combined",
    ].includes(config.discoveryMode)
      ? config.discoveryMode
      : DEFAULT_CONFIG.discoveryMode,
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

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

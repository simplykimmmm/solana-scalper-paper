export type DiscoveryMode =
  | "latest-profiles"
  | "latest-boosts"
  | "top-boosts"
  | "watchlist"
  | "combined";

export type TradeExitReason =
  | "take-profit"
  | "stop-loss"
  | "trailing-stop"
  | "max-hold"
  | "stale-quote"
  | "no-route"
  | "emergency-stop"
  | "daily-drawdown-stop";

export type RiskMode = "fixed" | "adaptive";
export type TickSource = "browser" | "worker" | "scheduler";

export type ActivityKind =
  | "scan"
  | "entry"
  | "exit"
  | "skip"
  | "error"
  | "state";

export interface BotConfig {
  tradingEnabled: boolean;
  startingCashSol: number;
  tradeSizeSol: number;
  riskMode: RiskMode;
  minTradeSizeSol: number;
  maxTradeSizeSol: number;
  riskPerTradePct: number;
  scaleUpAfterTrades: number;
  scaleUpMinProfitFactor: number;
  maxDailyDrawdownPct: number;
  maxOpenPositions: number;
  maxNewPositionsPerTick: number;
  takeProfitNetPct: number;
  stopLossNetPct: number;
  trailingActivationPct: number;
  trailingDrawdownPct: number;
  emergencyMaxLossPct: number;
  staleQuoteMaxSeconds: number;
  maxHoldMinutes: number;
  cooldownMinutes: number;
  tickIntervalSeconds: number;
  slippageBps: number;
  priorityFeeLamports: number;
  baseSignatureFeeLamports: number;
  maxEntryPriceImpactPct: number;
  maxPriceImpactPct?: number;
  minLiquidityUsd: number;
  maxLiquidityUsd: number;
  minVolumeM5Usd: number;
  minPairAgeMinutes: number;
  maxPairAgeHours: number;
  minAgeMinutes?: number;
  maxAgeHours?: number;
  minBuySellRatioM5: number;
  minBuysM5: number;
  minScoreToEnter: number;
  maxTradeLiquidityPct: number;
  rejectEmojiOnlySymbols: boolean;
  rejectDuplicateRecentToken: boolean;
  candidateLimit: number;
  discoveryMode: DiscoveryMode;
  watchlist: string[];
  restrictIntermediateTokens: boolean;
  dexscreenerBaseUrl: string;
  jupiterQuoteUrl: string;
}

export interface MarketCandidate {
  id: string;
  tokenAddress: string;
  chainId: string;
  pairAddress?: string;
  dexId?: string;
  url?: string;
  symbol: string;
  name: string;
  quoteSymbol?: string;
  quoteAddress?: string;
  priceUsd: number;
  liquidityUsd: number;
  marketCapUsd: number;
  fdvUsd: number;
  volumeM5Usd: number;
  volumeH1Usd: number;
  volumeH24Usd: number;
  buysM5: number;
  sellsM5: number;
  priceChangeM5Pct: number;
  priceChangeH1Pct: number;
  pairAgeMinutes: number;
  source: string;
  score: number;
  reasons: string[];
  rejectionReasons: string[];
  accepted: boolean;
}

export interface ActivityEvent {
  id: string;
  at: string;
  kind: ActivityKind;
  message: string;
}

export interface PaperPosition {
  id: string;
  tokenAddress: string;
  pairAddress?: string;
  symbol: string;
  name: string;
  sourceUrl?: string;
  openedAt: string;
  entrySol: number;
  entryFeeSol: number;
  entryTotalCostSol: number;
  tokenRawAmount: string;
  entryPriceImpactPct: number;
  entryScore: number;
  currentExitSol: number;
  currentNetPnlSol: number;
  currentNetPnlPct: number;
  peakNetPnlPct: number;
  lastQuoteAt?: string;
  lastError?: string;
}

export interface ClosedTrade extends PaperPosition {
  closedAt: string;
  exitReason: TradeExitReason;
  exitSol: number;
  exitFeeSol: number;
  netPnlSol: number;
  netPnlPct: number;
  holdMinutes: number;
}

export type TrainingLogEventType = "scan" | "entry" | "exit" | "skip" | "error";
export type TradeOutcome = "win" | "loss" | "flat";

export interface CandidateTrainingSnapshot {
  id: string;
  tokenAddress: string;
  chainId: string;
  pairAddress?: string;
  dexId?: string;
  url?: string;
  symbol: string;
  name: string;
  quoteSymbol?: string;
  quoteAddress?: string;
  priceUsd: number;
  liquidityUsd: number;
  marketCapUsd: number;
  fdvUsd: number;
  volumeM5Usd: number;
  volumeH1Usd: number;
  volumeH24Usd: number;
  buysM5: number;
  sellsM5: number;
  priceChangeM5Pct: number;
  priceChangeH1Pct: number;
  pairAgeMinutes: number;
  source: string;
  score: number;
  reasons: string[];
  rejectionReasons: string[];
  accepted: boolean;
}

export interface TradeTrainingSnapshot {
  id: string;
  tokenAddress: string;
  pairAddress?: string;
  symbol: string;
  name: string;
  sourceUrl?: string;
  openedAt: string;
  closedAt?: string;
  entrySol: number;
  entryFeeSol: number;
  entryTotalCostSol: number;
  entryPriceImpactPct: number;
  entryScore: number;
  currentExitSol: number;
  currentNetPnlSol: number;
  currentNetPnlPct: number;
  peakNetPnlPct: number;
  exitReason?: TradeExitReason;
  exitSol?: number;
  exitFeeSol?: number;
  netPnlSol?: number;
  netPnlPct?: number;
  holdMinutes?: number;
}

export interface AccountTrainingSnapshot {
  cashSol: number;
  equitySol: number;
  openPositions: number;
  closedTrades: number;
  realizedPnlSol: number;
  openPnlSol: number;
}

export interface TrainingLogRow {
  id: string;
  at: string;
  tick: number;
  type: TrainingLogEventType;
  message?: string;
  outcome?: TradeOutcome;
  config: BotConfig;
  account: AccountTrainingSnapshot;
  scan?: {
    candidates: CandidateTrainingSnapshot[];
    count: number;
  };
  candidate?: CandidateTrainingSnapshot;
  trade?: TradeTrainingSnapshot;
  error?: string;
}

export interface EquityPoint {
  at: string;
  equitySol: number;
  cashSol: number;
}

export interface BotState {
  initializedAt: string;
  updatedAt: string;
  lastTickAt?: string;
  lastTickSource?: TickSource;
  cashSol: number;
  openPositions: PaperPosition[];
  closedTrades: ClosedTrade[];
  activity: ActivityEvent[];
  equityCurve: EquityPoint[];
  cooldowns: Record<string, string>;
  peakEquitySol: number;
  maxDrawdownPct: number;
  dailyAnchorDate: string;
  dailyStartEquitySol: number;
  dailyPeakEquitySol: number;
  dailyDrawdownPct: number;
  drawdownLocked: boolean;
  tickCount: number;
}

export interface TickResult {
  ok: boolean;
  storageConfigured: boolean;
  storageSaved: boolean;
  config: BotConfig;
  state: BotState;
  candidates: MarketCandidate[];
  trainingRows: TrainingLogRow[];
  summary: {
    scanned: number;
    opened: number;
    closed: number;
    skipped: number;
    errors: number;
    equitySol: number;
    realizedPnlSol: number;
    openPnlSol: number;
    markedOpenValueSol: number;
    computedTradeSizeSol: number;
    drawdownLocked: boolean;
  };
}

export interface StoredPayload {
  config: BotConfig;
  state: BotState;
}

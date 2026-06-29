import { estimatedTxFeeSol, normalizeConfig } from "./defaults";
import type {
  BotConfig,
  BotState,
  ClosedTrade,
  PaperPosition,
  TradeExitReason,
} from "./types";

const EARLY_ADAPTIVE_MAX_SOL = 0.1;

export function computeTradeSizeSol(
  configInput: Partial<BotConfig>,
  state: BotState,
): number {
  const config = normalizeConfig(configInput);
  const equitySol = calculateEquitySol(state);
  const baseFixedSize = clamp(
    config.tradeSizeSol,
    config.minTradeSizeSol,
    config.maxTradeSizeSol,
  );

  if (config.riskMode === "fixed") {
    return roundSol(baseFixedSize);
  }

  const earlyMax = Math.min(config.maxTradeSizeSol, EARLY_ADAPTIVE_MAX_SOL);

  if (state.closedTrades.length < config.scaleUpAfterTrades) {
    return roundSol(clamp(baseFixedSize, config.minTradeSizeSol, earlyMax));
  }

  const profitFactor = calculateProfitFactor(state.closedTrades);
  const drawdownAcceptable =
    (state.maxDrawdownPct || 0) <= config.maxDailyDrawdownPct;

  if (profitFactor < config.scaleUpMinProfitFactor || !drawdownAcceptable) {
    return roundSol(clamp(baseFixedSize, config.minTradeSizeSol, earlyMax));
  }

  const stopRiskPct = Math.max(Math.abs(config.stopLossNetPct), 0.1);
  const riskSized = equitySol * (config.riskPerTradePct / 100) / (stopRiskPct / 100);

  return roundSol(clamp(riskSized, config.minTradeSizeSol, config.maxTradeSizeSol));
}

export function getExitReason(
  position: PaperPosition,
  configInput: Partial<BotConfig>,
  now = new Date(),
): TradeExitReason | null {
  const config = normalizeConfig(configInput);
  const holdMinutes =
    (now.getTime() - new Date(position.openedAt).getTime()) / 60_000;

  if (position.currentNetPnlPct <= config.emergencyMaxLossPct) {
    return "emergency-stop";
  }

  if (position.currentNetPnlPct >= config.takeProfitNetPct) {
    return "take-profit";
  }

  if (position.currentNetPnlPct <= config.stopLossNetPct) {
    return "stop-loss";
  }

  if (
    position.peakNetPnlPct >= config.trailingActivationPct &&
    position.peakNetPnlPct - position.currentNetPnlPct >=
      config.trailingDrawdownPct
  ) {
    return "trailing-stop";
  }

  if (holdMinutes >= config.maxHoldMinutes) {
    return "max-hold";
  }

  return null;
}

export function getQuoteFailureExitReason(input: {
  position: PaperPosition;
  config: Partial<BotConfig>;
  error: unknown;
  now?: Date;
}): TradeExitReason | null {
  const config = normalizeConfig(input.config);
  const now = input.now || new Date();
  const lastQuoteAt = input.position.lastQuoteAt || input.position.openedAt;
  const staleSeconds =
    (now.getTime() - new Date(lastQuoteAt).getTime()) / 1_000;

  if (staleSeconds < config.staleQuoteMaxSeconds) {
    return null;
  }

  return isNoRouteError(input.error) ? "no-route" : "stale-quote";
}

export function applyQuoteFailureMark(
  position: PaperPosition,
  configInput: Partial<BotConfig>,
  reason: TradeExitReason,
  error: unknown,
): PaperPosition {
  const config = normalizeConfig(configInput);
  const currentExitSol =
    reason === "no-route"
      ? 0
      : Math.max(position.currentExitSol, estimateEmergencyExitSol(position, config));
  const currentNetPnlSol = currentExitSol - position.entryTotalCostSol;
  const currentNetPnlPct =
    position.entryTotalCostSol > 0
      ? (currentNetPnlSol / position.entryTotalCostSol) * 100
      : 0;

  return {
    ...position,
    currentExitSol,
    currentNetPnlSol,
    currentNetPnlPct,
    peakNetPnlPct: Math.max(position.peakNetPnlPct, currentNetPnlPct),
    lastError: getErrorMessage(error),
  };
}

export function closePosition(
  position: PaperPosition,
  configInput: Partial<BotConfig>,
  reason: TradeExitReason,
  now = new Date(),
): ClosedTrade {
  const config = normalizeConfig(configInput);
  const exitFeeSol = estimatedTxFeeSol(config);
  const exitSol = position.currentExitSol + exitFeeSol;
  const netPnlSol = position.currentExitSol - position.entryTotalCostSol;
  const netPnlPct =
    position.entryTotalCostSol > 0
      ? (netPnlSol / position.entryTotalCostSol) * 100
      : 0;

  return {
    ...position,
    closedAt: now.toISOString(),
    exitReason: reason,
    exitSol,
    exitFeeSol,
    netPnlSol,
    netPnlPct,
    holdMinutes:
      (now.getTime() - new Date(position.openedAt).getTime()) / 60_000,
  };
}

export function estimateInitialExitSol(input: {
  entrySol: number;
  entryFeeSol: number;
  entryPriceImpactPct: number;
  config: Partial<BotConfig>;
}): number {
  const config = normalizeConfig(input.config);
  const slippagePct = config.slippageBps / 100;
  const haircutPct = Math.min(
    40,
    Math.max(0, input.entryPriceImpactPct) + slippagePct,
  );

  return Math.max(
    0,
    input.entrySol * (1 - haircutPct / 100) - input.entryFeeSol,
  );
}

export function updatePositionMark(
  position: PaperPosition,
  currentExitSol: number,
  lastQuoteAt = new Date().toISOString(),
): PaperPosition {
  const currentNetPnlSol = currentExitSol - position.entryTotalCostSol;
  const currentNetPnlPct =
    position.entryTotalCostSol > 0
      ? (currentNetPnlSol / position.entryTotalCostSol) * 100
      : 0;

  return {
    ...position,
    currentExitSol,
    currentNetPnlSol,
    currentNetPnlPct,
    peakNetPnlPct: Math.max(position.peakNetPnlPct, currentNetPnlPct),
    lastQuoteAt,
    lastError: undefined,
  };
}

export function calculateMarkedOpenValueSol(state: BotState): number {
  return state.openPositions.reduce(
    (total, position) => total + Math.max(position.currentExitSol, 0),
    0,
  );
}

export function calculateEquitySol(state: BotState): number {
  return state.cashSol + calculateMarkedOpenValueSol(state);
}

export function calculateOpenPnlSol(state: BotState): number {
  return state.openPositions.reduce(
    (total, position) => total + position.currentNetPnlSol,
    0,
  );
}

export function calculateRealizedPnlSol(state: BotState): number {
  return state.closedTrades.reduce(
    (total, trade) => total + trade.netPnlSol,
    0,
  );
}

export function calculateProfitFactor(trades: ClosedTrade[]): number {
  const grossProfit = trades
    .filter((trade) => trade.netPnlSol > 0)
    .reduce((total, trade) => total + trade.netPnlSol, 0);
  const grossLoss = Math.abs(
    trades
      .filter((trade) => trade.netPnlSol < 0)
      .reduce((total, trade) => total + trade.netPnlSol, 0),
  );

  if (grossLoss === 0) {
    return grossProfit > 0 ? Number.POSITIVE_INFINITY : 0;
  }

  return grossProfit / grossLoss;
}

export function ensureRiskState(
  state: BotState,
  configInput: Partial<BotConfig>,
  now = new Date(),
): BotState {
  const config = normalizeConfig(configInput);
  const equitySol = calculateEquitySol(state);
  const day = dayKey(now);
  const dailyAnchorDate = state.dailyAnchorDate || day;
  const resetDaily = dailyAnchorDate !== day;
  const dailyStartEquitySol = resetDaily
    ? equitySol
    : state.dailyStartEquitySol || equitySol;
  const dailyPeakEquitySol = resetDaily
    ? equitySol
    : Math.max(state.dailyPeakEquitySol || equitySol, equitySol);
  const peakEquitySol = Math.max(state.peakEquitySol || equitySol, equitySol);
  const maxDrawdownPct = Math.max(
    state.maxDrawdownPct || 0,
    drawdownPct(equitySol, peakEquitySol),
  );
  const dailyDrawdownPct = Math.max(
    0,
    drawdownPct(equitySol, dailyPeakEquitySol),
    drawdownPct(equitySol, dailyStartEquitySol),
  );

  return {
    ...state,
    peakEquitySol,
    maxDrawdownPct,
    dailyAnchorDate: day,
    dailyStartEquitySol,
    dailyPeakEquitySol,
    dailyDrawdownPct,
    drawdownLocked: dailyDrawdownPct >= config.maxDailyDrawdownPct,
  };
}

export function isDailyDrawdownLocked(
  state: BotState,
  configInput: Partial<BotConfig>,
): boolean {
  const config = normalizeConfig(configInput);
  return Boolean(state.drawdownLocked || state.dailyDrawdownPct >= config.maxDailyDrawdownPct);
}

function estimateEmergencyExitSol(
  position: PaperPosition,
  config: BotConfig,
): number {
  return Math.max(
    0,
    position.entryTotalCostSol * (1 + config.emergencyMaxLossPct / 100),
  );
}

function isNoRouteError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return message.includes("no route") || message.includes("could not find");
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

function drawdownPct(equitySol: number, peakSol: number): number {
  if (peakSol <= 0) {
    return 0;
  }

  return Math.max(0, ((peakSol - equitySol) / peakSol) * 100);
}

function roundSol(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function dayKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

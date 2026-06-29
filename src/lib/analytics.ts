import {
  calculateEquitySol,
  calculateMarkedOpenValueSol,
  calculateOpenPnlSol,
  calculateProfitFactor,
  calculateRealizedPnlSol,
} from "./risk";
import type { BotState, ClosedTrade, TradeExitReason } from "./types";

export interface TradeStats {
  winRatePct: number;
  profitFactor: number;
  averageWinSol: number;
  averageLossSol: number;
  expectancySol: number;
  maxDrawdownPct: number;
  averageHoldMinutes: number;
  medianHoldMinutes: number;
  pnlByEntryScoreBucket: Record<string, number>;
  pnlByTradeSize: Record<string, number>;
  pnlByExitReason: Record<TradeExitReason, number>;
  markedOpenValueSol: number;
  openPnlSol: number;
  realizedPnlSol: number;
  equitySol: number;
}

export function computeTradeStats(state: BotState): TradeStats {
  const trades = state.closedTrades;
  const wins = trades.filter((trade) => trade.netPnlSol > 0);
  const losses = trades.filter((trade) => trade.netPnlSol < 0);
  const totalPnl = trades.reduce((total, trade) => total + trade.netPnlSol, 0);

  return {
    winRatePct: trades.length > 0 ? (wins.length / trades.length) * 100 : 0,
    profitFactor: calculateProfitFactor(trades),
    averageWinSol: average(wins.map((trade) => trade.netPnlSol)),
    averageLossSol: average(losses.map((trade) => trade.netPnlSol)),
    expectancySol: trades.length > 0 ? totalPnl / trades.length : 0,
    maxDrawdownPct: state.maxDrawdownPct || calculateMaxDrawdownPct(state),
    averageHoldMinutes: average(trades.map((trade) => trade.holdMinutes)),
    medianHoldMinutes: median(trades.map((trade) => trade.holdMinutes)),
    pnlByEntryScoreBucket: groupPnl(trades, scoreBucket),
    pnlByTradeSize: groupPnl(trades, tradeSizeBucket),
    pnlByExitReason: groupPnlByExitReason(trades),
    markedOpenValueSol: calculateMarkedOpenValueSol(state),
    openPnlSol: calculateOpenPnlSol(state),
    realizedPnlSol: calculateRealizedPnlSol(state),
    equitySol: calculateEquitySol(state),
  };
}

function calculateMaxDrawdownPct(state: BotState): number {
  let peak = 0;
  let maxDrawdown = 0;

  for (const point of [...state.equityCurve].reverse()) {
    peak = Math.max(peak, point.equitySol);

    if (peak > 0) {
      maxDrawdown = Math.max(
        maxDrawdown,
        ((peak - point.equitySol) / peak) * 100,
      );
    }
  }

  return maxDrawdown;
}

function groupPnl(
  trades: ClosedTrade[],
  getKey: (trade: ClosedTrade) => string,
): Record<string, number> {
  return trades.reduce<Record<string, number>>((groups, trade) => {
    const key = getKey(trade);
    groups[key] = (groups[key] || 0) + trade.netPnlSol;
    return groups;
  }, {});
}

function groupPnlByExitReason(
  trades: ClosedTrade[],
): Record<TradeExitReason, number> {
  return trades.reduce<Record<TradeExitReason, number>>((groups, trade) => {
    groups[trade.exitReason] = (groups[trade.exitReason] || 0) + trade.netPnlSol;
    return groups;
  }, {} as Record<TradeExitReason, number>);
}

function scoreBucket(trade: ClosedTrade): string {
  const floor = Math.floor(trade.entryScore / 10) * 10;
  return `${floor}-${floor + 9}`;
}

function tradeSizeBucket(trade: ClosedTrade): string {
  if (trade.entrySol < 0.1) {
    return "<0.10";
  }

  if (trade.entrySol < 0.25) {
    return "0.10-0.25";
  }

  if (trade.entrySol < 0.5) {
    return "0.25-0.50";
  }

  return ">=0.50";
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);

  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle];
}

import type {
  BotConfig,
  BotState,
  CandidateTrainingSnapshot,
  ClosedTrade,
  MarketCandidate,
  PaperPosition,
  TradeOutcome,
  TradeTrainingSnapshot,
  TrainingLogRow,
} from "./types";

export function createScanTrainingRow(input: {
  at?: string;
  tick: number;
  config: BotConfig;
  state: BotState;
  candidates: MarketCandidate[];
}): TrainingLogRow {
  const candidates = input.candidates.map(candidateSnapshot);

  return createBaseRow({
    ...input,
    type: "scan",
    message: `Scanner returned ${candidates.length} candidates.`,
    scan: {
      count: candidates.length,
      candidates,
    },
  });
}

export function createEntryTrainingRow(input: {
  at?: string;
  tick: number;
  config: BotConfig;
  state: BotState;
  candidate: MarketCandidate;
  position: PaperPosition;
}): TrainingLogRow {
  return createBaseRow({
    ...input,
    type: "entry",
    message: `${input.position.symbol} paper entry opened.`,
    candidate: candidateSnapshot(input.candidate),
    trade: tradeSnapshot(input.position),
  });
}

export function createExitTrainingRow(input: {
  at?: string;
  tick: number;
  config: BotConfig;
  state: BotState;
  trade: ClosedTrade;
}): TrainingLogRow {
  return createBaseRow({
    ...input,
    at: input.at || input.trade.closedAt,
    type: "exit",
    outcome: outcomeFromTrade(input.trade),
    message: `${input.trade.symbol} closed by ${input.trade.exitReason}.`,
    trade: tradeSnapshot(input.trade),
  });
}

export function createSkipTrainingRow(input: {
  at?: string;
  tick: number;
  config: BotConfig;
  state: BotState;
  message: string;
  candidate?: MarketCandidate;
}): TrainingLogRow {
  return createBaseRow({
    ...input,
    type: "skip",
    candidate: input.candidate ? candidateSnapshot(input.candidate) : undefined,
  });
}

export function createErrorTrainingRow(input: {
  at?: string;
  tick: number;
  config: BotConfig;
  state: BotState;
  message: string;
  error: string;
  candidate?: MarketCandidate;
}): TrainingLogRow {
  return createBaseRow({
    ...input,
    type: "error",
    candidate: input.candidate ? candidateSnapshot(input.candidate) : undefined,
  });
}

export function createTrainingRowsFromState(input: {
  config: BotConfig;
  state: BotState;
}): TrainingLogRow[] {
  return input.state.closedTrades
    .map((trade) =>
      createExitTrainingRow({
        at: trade.closedAt,
        tick: input.state.tickCount,
        config: input.config,
        state: input.state,
        trade,
      }),
    )
    .sort((left, right) => left.at.localeCompare(right.at));
}

export function trainingRowsToJsonl(rows: TrainingLogRow[]): string {
  if (rows.length === 0) {
    return "";
  }

  return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

function createBaseRow(
  input: Omit<TrainingLogRow, "id" | "at" | "config" | "account"> & {
    at?: string;
    config: BotConfig;
    state: BotState;
  },
): TrainingLogRow {
  return {
    id: crypto.randomUUID(),
    at: input.at || new Date().toISOString(),
    tick: input.tick,
    type: input.type,
    message: input.message,
    outcome: input.outcome,
    config: { ...input.config },
    account: accountSnapshot(input.state),
    scan: input.scan,
    candidate: input.candidate,
    trade: input.trade,
    error: input.error,
  };
}

function candidateSnapshot(
  candidate: MarketCandidate,
): CandidateTrainingSnapshot {
  return {
    id: candidate.id,
    tokenAddress: candidate.tokenAddress,
    chainId: candidate.chainId,
    pairAddress: candidate.pairAddress,
    dexId: candidate.dexId,
    url: candidate.url,
    symbol: candidate.symbol,
    name: candidate.name,
    quoteSymbol: candidate.quoteSymbol,
    quoteAddress: candidate.quoteAddress,
    priceUsd: candidate.priceUsd,
    liquidityUsd: candidate.liquidityUsd,
    marketCapUsd: candidate.marketCapUsd,
    fdvUsd: candidate.fdvUsd,
    volumeM5Usd: candidate.volumeM5Usd,
    volumeH1Usd: candidate.volumeH1Usd,
    volumeH24Usd: candidate.volumeH24Usd,
    buysM5: candidate.buysM5,
    sellsM5: candidate.sellsM5,
    priceChangeM5Pct: candidate.priceChangeM5Pct,
    priceChangeH1Pct: candidate.priceChangeH1Pct,
    pairAgeMinutes: candidate.pairAgeMinutes,
    source: candidate.source,
    score: candidate.score,
    reasons: [...candidate.reasons],
  };
}

function tradeSnapshot(
  trade: PaperPosition | ClosedTrade,
): TradeTrainingSnapshot {
  const closed = isClosedTrade(trade) ? trade : null;

  return {
    id: trade.id,
    tokenAddress: trade.tokenAddress,
    pairAddress: trade.pairAddress,
    symbol: trade.symbol,
    name: trade.name,
    sourceUrl: trade.sourceUrl,
    openedAt: trade.openedAt,
    closedAt: closed?.closedAt,
    entrySol: trade.entrySol,
    entryFeeSol: trade.entryFeeSol,
    entryTotalCostSol: trade.entryTotalCostSol,
    entryPriceImpactPct: trade.entryPriceImpactPct,
    entryScore: trade.entryScore,
    currentExitSol: trade.currentExitSol,
    currentNetPnlSol: trade.currentNetPnlSol,
    currentNetPnlPct: trade.currentNetPnlPct,
    peakNetPnlPct: trade.peakNetPnlPct,
    exitReason: closed?.exitReason,
    exitSol: closed?.exitSol,
    exitFeeSol: closed?.exitFeeSol,
    netPnlSol: closed?.netPnlSol,
    netPnlPct: closed?.netPnlPct,
    holdMinutes: closed?.holdMinutes,
  };
}

function accountSnapshot(state: BotState) {
  const openPnlSol = state.openPositions.reduce(
    (total, position) => total + position.currentNetPnlSol,
    0,
  );
  const realizedPnlSol = state.closedTrades.reduce(
    (total, trade) => total + trade.netPnlSol,
    0,
  );
  const equitySol =
    state.cashSol +
    state.openPositions.reduce(
      (total, position) => total + Math.max(position.currentExitSol, 0),
      0,
    );

  return {
    cashSol: state.cashSol,
    equitySol,
    openPositions: state.openPositions.length,
    closedTrades: state.closedTrades.length,
    realizedPnlSol,
    openPnlSol,
  };
}

function outcomeFromTrade(trade: ClosedTrade): TradeOutcome {
  if (trade.netPnlSol > 0) {
    return "win";
  }

  if (trade.netPnlSol < 0) {
    return "loss";
  }

  return "flat";
}

function isClosedTrade(
  trade: PaperPosition | ClosedTrade,
): trade is ClosedTrade {
  return "closedAt" in trade;
}

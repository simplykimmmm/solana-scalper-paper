import {
  createActivity,
  createInitialState,
  estimatedTxFeeSol,
  normalizeConfig,
} from "./defaults";
import { scanDexScreener } from "./dexscreener";
import {
  conservativeOutAmount,
  lamportsStringToSol,
  quoteExactIn,
  quotePriceImpactPct,
  solToLamportsString,
  SOL_MINT,
} from "./jupiter";
import {
  applyQuoteFailureMark,
  calculateEquitySol,
  calculateMarkedOpenValueSol,
  calculateOpenPnlSol,
  calculateRealizedPnlSol,
  closePosition,
  computeTradeSizeSol,
  ensureRiskState,
  estimateInitialExitSol,
  getExitReason,
  getQuoteFailureExitReason,
  isDailyDrawdownLocked,
  updatePositionMark,
} from "./risk";
import {
  createEntryTrainingRow,
  createErrorTrainingRow,
  createExitTrainingRow,
  createScanTrainingRow,
  createSkipTrainingRow,
} from "./training-log";
import type {
  BotConfig,
  BotState,
  ClosedTrade,
  MarketCandidate,
  PaperPosition,
  TickResult,
  TickSource,
  TrainingLogRow,
} from "./types";

const ESTIMATED_SOL_USD = 150;

export async function runPaperTick(input: {
  config?: Partial<BotConfig>;
  state?: BotState | null;
  storageConfigured?: boolean;
  storageSaved?: boolean;
  source?: TickSource;
  now?: Date;
}): Promise<TickResult> {
  const config = normalizeConfig(input.config);
  const now = input.now || new Date();
  let state = normalizeRuntimeState(
    input.state ? cloneState(input.state) : createInitialState(config),
    config,
    now,
  );
  const activity = [...state.activity];
  const candidates: MarketCandidate[] = [];
  const trainingRows: TrainingLogRow[] = [];
  const closedTradesThisTick: ClosedTrade[] = [];
  let opened = 0;
  let closed = 0;
  let skipped = 0;
  let errors = 0;

  state.updatedAt = now.toISOString();
  state.lastTickAt = now.toISOString();
  state.lastTickSource = input.source || "browser";
  state.tickCount += 1;

  activity.unshift(
    createActivity("scan", `Tick ${state.tickCount}: marking open positions.`),
  );

  const markedPositions: PaperPosition[] = [];

  for (const position of state.openPositions) {
    try {
      const marked = await markPosition(position, config, now);
      const reason = getExitReason(marked, config, now);

      if (reason) {
        const closedTrade = closePosition(marked, config, reason, now);
        state.closedTrades.unshift(closedTrade);
        closedTradesThisTick.push(closedTrade);
        state.cooldowns[marked.tokenAddress] = now.toISOString();
        state.cashSol += closedTrade.exitSol - closedTrade.exitFeeSol;
        closed += 1;
        activity.unshift(
          createActivity(
            "exit",
            `${marked.symbol} closed by ${reason}: ${formatSigned(
              closedTrade.netPnlSol,
            )} SOL (${formatSigned(closedTrade.netPnlPct)}%).`,
          ),
        );
      } else {
        markedPositions.push(marked);
      }
    } catch (error) {
      const forcedReason = getQuoteFailureExitReason({
        position,
        config,
        error,
        now,
      });

      if (forcedReason) {
        const riskMarked = applyQuoteFailureMark(
          position,
          config,
          forcedReason,
          error,
        );
        const closedTrade = closePosition(riskMarked, config, forcedReason, now);
        state.closedTrades.unshift(closedTrade);
        closedTradesThisTick.push(closedTrade);
        state.cooldowns[position.tokenAddress] = now.toISOString();
        state.cashSol += closedTrade.exitSol - closedTrade.exitFeeSol;
        closed += 1;
        errors += 1;
        activity.unshift(
          createActivity(
            "exit",
            `${position.symbol} closed by ${forcedReason}: ${getErrorMessage(
              error,
            )}`,
          ),
        );
      } else {
        errors += 1;
        markedPositions.push({
          ...position,
          lastError: getErrorMessage(error),
        });
        activity.unshift(
          createActivity(
            "error",
            `${position.symbol} exit quote failed: ${getErrorMessage(error)}`,
          ),
        );
        trainingRows.push(
          createErrorTrainingRow({
            tick: state.tickCount,
            config,
            state,
            message: `${position.symbol} exit quote failed.`,
            error: getErrorMessage(error),
          }),
        );
      }
    }
  }

  state.openPositions = markedPositions;
  state = ensureRiskState(state, config, now);

  for (const closedTrade of closedTradesThisTick) {
    trainingRows.push(
      createExitTrainingRow({
        tick: state.tickCount,
        config,
        state,
        trade: closedTrade,
      }),
    );
  }

  let computedTradeSizeSol = computeTradeSizeSol(config, state);
  const drawdownLocked = isDailyDrawdownLocked(state, config);
  const slots = Math.min(
    config.maxOpenPositions - state.openPositions.length,
    config.maxNewPositionsPerTick,
  );

  if (drawdownLocked) {
    activity.unshift(
      createActivity(
        "skip",
        `Daily drawdown lock active at ${state.dailyDrawdownPct.toFixed(2)}%.`,
      ),
    );
    trainingRows.push(
      createSkipTrainingRow({
        tick: state.tickCount,
        config,
        state,
        message: "Daily drawdown lock active.",
      }),
    );
  } else if (
    slots > 0 &&
    state.cashSol >= computedTradeSizeSol + estimatedTxFeeSol(config)
  ) {
    try {
      const scannedCandidates = await scanDexScreener(config);
      candidates.push(
        ...scannedCandidates.map((candidate) =>
          applyEntryRejections(candidate, config, state, computedTradeSizeSol, now),
        ),
      );
      activity.unshift(
        createActivity("scan", `Scanner returned ${candidates.length} candidates.`),
      );
      trainingRows.push(
        createScanTrainingRow({
          tick: state.tickCount,
          config,
          state,
          candidates,
        }),
      );

      for (const candidate of candidates) {
        if (opened >= slots) {
          break;
        }

        if (candidate.rejectionReasons.length > 0) {
          skipped += 1;
          trainingRows.push(
            createSkipTrainingRow({
              tick: state.tickCount,
              config,
              state,
              candidate,
              message: `${candidate.symbol} rejected: ${candidate.rejectionReasons.join(
                ", ",
              )}.`,
            }),
          );
          continue;
        }

        computedTradeSizeSol = computeTradeSizeSol(config, state);

        if (state.cashSol < computedTradeSizeSol + estimatedTxFeeSol(config)) {
          activity.unshift(
            createActivity("skip", "Cash is below the next paper trade size."),
          );
          trainingRows.push(
            createSkipTrainingRow({
              tick: state.tickCount,
              config,
              state,
              candidate,
              message: "Cash is below the next paper trade size.",
            }),
          );
          break;
        }

        try {
          const position = await openPosition(candidate, config, computedTradeSizeSol);
          state.cashSol -= position.entryTotalCostSol;
          state.openPositions.unshift(position);
          state = ensureRiskState(state, config, now);
          opened += 1;
          activity.unshift(
            createActivity(
              "entry",
              `${position.symbol} paper buy: ${position.entrySol.toFixed(
                4,
              )} SOL, impact ${position.entryPriceImpactPct.toFixed(2)}%.`,
            ),
          );
          trainingRows.push(
            createEntryTrainingRow({
              tick: state.tickCount,
              config,
              state,
              candidate: {
                ...candidate,
                accepted: true,
              },
              position,
            }),
          );
        } catch (error) {
          errors += 1;
          const reason = quoteErrorToRejection(error);
          candidate.accepted = false;
          candidate.rejectionReasons = dedupeStrings([
            ...candidate.rejectionReasons,
            reason,
          ]);
          activity.unshift(
            createActivity(
              "skip",
              `${candidate.symbol} skipped: ${getErrorMessage(error)}`,
            ),
          );
          trainingRows.push(
            createSkipTrainingRow({
              tick: state.tickCount,
              config,
              state,
              candidate,
              message: `${candidate.symbol} skipped: ${getErrorMessage(error)}`,
            }),
          );
        }
      }
    } catch (error) {
      errors += 1;
      activity.unshift(
        createActivity("error", `Scanner failed: ${getErrorMessage(error)}`),
      );
      trainingRows.push(
        createErrorTrainingRow({
          tick: state.tickCount,
          config,
          state,
          message: "Scanner failed.",
          error: getErrorMessage(error),
        }),
      );
    }
  } else {
    activity.unshift(createActivity("skip", "No entry slot or cash available."));
    trainingRows.push(
      createSkipTrainingRow({
        tick: state.tickCount,
        config,
        state,
        message: "No entry slot or cash available.",
      }),
    );
  }

  state = ensureRiskState(state, config, now);
  const equitySol = calculateEquitySol(state);
  const markedOpenValueSol = calculateMarkedOpenValueSol(state);
  state.equityCurve.unshift({
    at: state.updatedAt,
    cashSol: state.cashSol,
    equitySol,
  });
  state.activity = activity.slice(0, 250);
  state.closedTrades = state.closedTrades.slice(0, 200);
  state.equityCurve = state.equityCurve.slice(0, 500);

  return {
    ok: true,
    storageConfigured: Boolean(input.storageConfigured),
    storageSaved: Boolean(input.storageSaved),
    config,
    state,
    candidates,
    trainingRows,
    summary: {
      scanned: candidates.length,
      opened,
      closed,
      skipped,
      errors,
      equitySol,
      realizedPnlSol: calculateRealizedPnlSol(state),
      openPnlSol: calculateOpenPnlSol(state),
      markedOpenValueSol,
      computedTradeSizeSol: computeTradeSizeSol(config, state),
      drawdownLocked: state.drawdownLocked,
    },
  };
}

function cloneState(state: BotState): BotState {
  return JSON.parse(JSON.stringify(state)) as BotState;
}

function normalizeRuntimeState(
  input: BotState,
  config: BotConfig,
  now: Date,
): BotState {
  const fallback = createInitialState(config);
  const state = {
    ...fallback,
    ...input,
    openPositions: input.openPositions || [],
    closedTrades: input.closedTrades || [],
    activity: input.activity || [],
    equityCurve: input.equityCurve || [],
    cooldowns: input.cooldowns || {},
  };

  return ensureRiskState(state, config, now);
}

async function openPosition(
  candidate: MarketCandidate,
  config: BotConfig,
  tradeSizeSol: number,
): Promise<PaperPosition> {
  const quote = await quoteExactIn({
    config,
    inputMint: SOL_MINT,
    outputMint: candidate.tokenAddress,
    amount: solToLamportsString(tradeSizeSol),
  });
  const priceImpactPct = quotePriceImpactPct(quote);

  if (priceImpactPct > config.maxEntryPriceImpactPct) {
    throw new Error(
      `price impact ${priceImpactPct.toFixed(2)}% exceeds ${config.maxEntryPriceImpactPct}%`,
    );
  }

  const entryFeeSol = estimatedTxFeeSol(config);
  const tokenRawAmount = conservativeOutAmount(quote);
  const openedAt = new Date().toISOString();
  let currentExitSol = estimateInitialExitSol({
    entrySol: tradeSizeSol,
    entryFeeSol,
    entryPriceImpactPct: priceImpactPct,
    config,
  });

  try {
    const reverseQuote = await quoteExactIn({
      config,
      inputMint: candidate.tokenAddress,
      outputMint: SOL_MINT,
      amount: tokenRawAmount,
    });
    currentExitSol = Math.max(
      0,
      lamportsStringToSol(conservativeOutAmount(reverseQuote)) - entryFeeSol,
    );
  } catch {
    // Keep the deterministic conservative estimate when no immediate reverse quote is available.
  }

  const currentNetPnlSol = currentExitSol - (tradeSizeSol + entryFeeSol);
  const currentNetPnlPct =
    tradeSizeSol + entryFeeSol > 0
      ? (currentNetPnlSol / (tradeSizeSol + entryFeeSol)) * 100
      : 0;

  return {
    id: crypto.randomUUID(),
    tokenAddress: candidate.tokenAddress,
    pairAddress: candidate.pairAddress,
    symbol: candidate.symbol,
    name: candidate.name,
    sourceUrl: candidate.url,
    openedAt,
    entrySol: tradeSizeSol,
    entryFeeSol,
    entryTotalCostSol: tradeSizeSol + entryFeeSol,
    tokenRawAmount,
    entryPriceImpactPct: priceImpactPct,
    entryScore: candidate.score,
    currentExitSol,
    currentNetPnlSol,
    currentNetPnlPct,
    peakNetPnlPct: Math.max(0, currentNetPnlPct),
    lastQuoteAt: openedAt,
  };
}

async function markPosition(
  position: PaperPosition,
  config: BotConfig,
  now: Date,
): Promise<PaperPosition> {
  const quote = await quoteExactIn({
    config,
    inputMint: position.tokenAddress,
    outputMint: SOL_MINT,
    amount: position.tokenRawAmount,
  });
  const exitSol = lamportsStringToSol(conservativeOutAmount(quote));
  const exitFeeSol = estimatedTxFeeSol(config);
  const currentExitSol = Math.max(0, exitSol - exitFeeSol);

  return updatePositionMark(position, currentExitSol, now.toISOString());
}

function applyEntryRejections(
  candidate: MarketCandidate,
  config: BotConfig,
  state: BotState,
  tradeSizeSol: number,
  now: Date,
): MarketCandidate {
  const rejectionReasons = [...candidate.rejectionReasons];

  if (
    state.openPositions.some(
      (position) => position.tokenAddress === candidate.tokenAddress,
    )
  ) {
    rejectionReasons.push("already-open");
  }

  if (isCoolingDown(candidate.tokenAddress, state, config, now)) {
    rejectionReasons.push("recent-duplicate");
  }

  if (tradeLiquidityPct(tradeSizeSol, candidate.liquidityUsd) > config.maxTradeLiquidityPct) {
    rejectionReasons.push("trade-too-large-for-liquidity");
  }

  return {
    ...candidate,
    rejectionReasons: dedupeStrings(rejectionReasons),
    accepted: rejectionReasons.length === 0,
  };
}

function isCoolingDown(
  tokenAddress: string,
  state: BotState,
  config: BotConfig,
  now: Date,
): boolean {
  if (!config.rejectDuplicateRecentToken) {
    return false;
  }

  const lastClosedAt = state.cooldowns[tokenAddress];

  if (!lastClosedAt || config.cooldownMinutes <= 0) {
    return false;
  }

  return (
    now.getTime() - new Date(lastClosedAt).getTime() <
    config.cooldownMinutes * 60_000
  );
}

function tradeLiquidityPct(tradeSizeSol: number, liquidityUsd: number): number {
  if (liquidityUsd <= 0) {
    return Number.POSITIVE_INFINITY;
  }

  return ((tradeSizeSol * ESTIMATED_SOL_USD) / liquidityUsd) * 100;
}

function quoteErrorToRejection(error: unknown): string {
  const message = getErrorMessage(error).toLowerCase();

  if (message.includes("price impact")) {
    return "high-impact";
  }

  if (message.includes("no route") || message.includes("could not find")) {
    return "no-route";
  }

  return "quote-failed";
}

function formatSigned(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(4)}`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}

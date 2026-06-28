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
import type {
  BotConfig,
  BotState,
  ClosedTrade,
  MarketCandidate,
  PaperPosition,
  TickResult,
  TradeExitReason,
} from "./types";

export async function runPaperTick(input: {
  config?: Partial<BotConfig>;
  state?: BotState | null;
  storageConfigured?: boolean;
  storageSaved?: boolean;
}): Promise<TickResult> {
  const config = normalizeConfig(input.config);
  const state = input.state ? cloneState(input.state) : createInitialState(config);
  const activity = [...state.activity];
  const candidates: MarketCandidate[] = [];
  let opened = 0;
  let closed = 0;
  let skipped = 0;
  let errors = 0;

  state.updatedAt = new Date().toISOString();
  state.tickCount += 1;

  activity.unshift(
    createActivity("scan", `Tick ${state.tickCount}: marking open positions.`),
  );

  const markedPositions: PaperPosition[] = [];

  for (const position of state.openPositions) {
    try {
      const marked = await markPosition(position, config);
      const reason = getExitReason(marked, config);

      if (reason) {
        const closedTrade = closePosition(marked, config, reason);
        state.closedTrades.unshift(closedTrade);
        state.cooldowns[marked.tokenAddress] = new Date().toISOString();
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
    }
  }

  state.openPositions = markedPositions;

  const slots = Math.min(
    config.maxOpenPositions - state.openPositions.length,
    config.maxNewPositionsPerTick,
  );

  if (slots > 0 && state.cashSol >= config.tradeSizeSol + estimatedTxFeeSol(config)) {
    try {
      candidates.push(...(await scanDexScreener(config)));
      activity.unshift(
        createActivity("scan", `Scanner returned ${candidates.length} candidates.`),
      );

      for (const candidate of candidates) {
        if (opened >= slots) {
          break;
        }

        if (
          state.openPositions.some(
            (position) => position.tokenAddress === candidate.tokenAddress,
          )
        ) {
          skipped += 1;
          continue;
        }

        if (isCoolingDown(candidate.tokenAddress, state, config)) {
          skipped += 1;
          continue;
        }

        if (state.cashSol < config.tradeSizeSol + estimatedTxFeeSol(config)) {
          activity.unshift(
            createActivity("skip", "Cash is below the next paper trade size."),
          );
          break;
        }

        try {
          const position = await openPosition(candidate, config);
          state.cashSol -= position.entryTotalCostSol;
          state.openPositions.unshift(position);
          opened += 1;
          activity.unshift(
            createActivity(
              "entry",
              `${position.symbol} paper buy: ${position.entrySol.toFixed(
                4,
              )} SOL, impact ${position.entryPriceImpactPct.toFixed(2)}%.`,
            ),
          );
        } catch (error) {
          errors += 1;
          activity.unshift(
            createActivity(
              "skip",
              `${candidate.symbol} skipped: ${getErrorMessage(error)}`,
            ),
          );
        }
      }
    } catch (error) {
      errors += 1;
      activity.unshift(
        createActivity("error", `Scanner failed: ${getErrorMessage(error)}`),
      );
    }
  } else {
    activity.unshift(createActivity("skip", "No entry slot or cash available."));
  }

  const equitySol = calculateEquitySol(state);
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
    summary: {
      scanned: candidates.length,
      opened,
      closed,
      skipped,
      errors,
      equitySol,
      realizedPnlSol: calculateRealizedPnlSol(state),
      openPnlSol: calculateOpenPnlSol(state),
    },
  };
}

function cloneState(state: BotState): BotState {
  return JSON.parse(JSON.stringify(state)) as BotState;
}

async function openPosition(
  candidate: MarketCandidate,
  config: BotConfig,
): Promise<PaperPosition> {
  const quote = await quoteExactIn({
    config,
    inputMint: SOL_MINT,
    outputMint: candidate.tokenAddress,
    amount: solToLamportsString(config.tradeSizeSol),
  });
  const priceImpactPct = quotePriceImpactPct(quote);

  if (priceImpactPct > config.maxPriceImpactPct) {
    throw new Error(
      `price impact ${priceImpactPct.toFixed(2)}% exceeds ${config.maxPriceImpactPct}%`,
    );
  }

  const entryFeeSol = estimatedTxFeeSol(config);

  return {
    id: crypto.randomUUID(),
    tokenAddress: candidate.tokenAddress,
    pairAddress: candidate.pairAddress,
    symbol: candidate.symbol,
    name: candidate.name,
    sourceUrl: candidate.url,
    openedAt: new Date().toISOString(),
    entrySol: config.tradeSizeSol,
    entryFeeSol,
    entryTotalCostSol: config.tradeSizeSol + entryFeeSol,
    tokenRawAmount: conservativeOutAmount(quote),
    entryPriceImpactPct: priceImpactPct,
    entryScore: candidate.score,
    currentExitSol: 0,
    currentNetPnlSol: -entryFeeSol,
    currentNetPnlPct: (-entryFeeSol / (config.tradeSizeSol + entryFeeSol)) * 100,
    peakNetPnlPct: 0,
    lastQuoteAt: new Date().toISOString(),
  };
}

async function markPosition(
  position: PaperPosition,
  config: BotConfig,
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
    lastQuoteAt: new Date().toISOString(),
    lastError: undefined,
  };
}

function getExitReason(
  position: PaperPosition,
  config: BotConfig,
): TradeExitReason | null {
  const holdMinutes =
    (Date.now() - new Date(position.openedAt).getTime()) / 60_000;

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

function closePosition(
  position: PaperPosition,
  config: BotConfig,
  reason: TradeExitReason,
): ClosedTrade {
  const exitFeeSol = estimatedTxFeeSol(config);
  const exitSol = position.currentExitSol + exitFeeSol;
  const netPnlSol = position.currentExitSol - position.entryTotalCostSol;
  const netPnlPct =
    position.entryTotalCostSol > 0
      ? (netPnlSol / position.entryTotalCostSol) * 100
      : 0;

  return {
    ...position,
    closedAt: new Date().toISOString(),
    exitReason: reason,
    exitSol,
    exitFeeSol,
    netPnlSol,
    netPnlPct,
    holdMinutes:
      (Date.now() - new Date(position.openedAt).getTime()) / 60_000,
  };
}

function isCoolingDown(
  tokenAddress: string,
  state: BotState,
  config: BotConfig,
): boolean {
  const lastClosedAt = state.cooldowns[tokenAddress];

  if (!lastClosedAt || config.cooldownMinutes <= 0) {
    return false;
  }

  return (
    Date.now() - new Date(lastClosedAt).getTime() <
    config.cooldownMinutes * 60_000
  );
}

function calculateEquitySol(state: BotState): number {
  return (
    state.cashSol +
    state.openPositions.reduce(
      (total, position) => total + Math.max(position.currentExitSol, 0),
      0,
    )
  );
}

function calculateOpenPnlSol(state: BotState): number {
  return state.openPositions.reduce(
    (total, position) => total + position.currentNetPnlSol,
    0,
  );
}

function calculateRealizedPnlSol(state: BotState): number {
  return state.closedTrades.reduce(
    (total, trade) => total + trade.netPnlSol,
    0,
  );
}

function formatSigned(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(4)}`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState, normalizeConfig } from "./defaults";
import {
  calculateEquitySol,
  computeTradeSizeSol,
  ensureRiskState,
  estimateInitialExitSol,
  getExitReason,
  getQuoteFailureExitReason,
  isDailyDrawdownLocked,
} from "./risk";
import type { ClosedTrade, PaperPosition } from "./types";

test("adaptive position sizing never jumps to 1 SOL before 50 trades", () => {
  const state = createInitialState({ startingCashSol: 10 });
  state.closedTrades = Array.from({ length: 10 }, (_, index) =>
    makeClosedTrade({ id: `trade-${index}`, netPnlSol: 0.01 }),
  );

  const size = computeTradeSizeSol(
    {
      riskMode: "adaptive",
      tradeSizeSol: 1,
      minTradeSizeSol: 0.05,
      maxTradeSizeSol: 1,
    },
    state,
  );

  assert.equal(size, 0.1);
});

test("stop loss triggers at -3.5%", () => {
  const position = makePosition({ currentNetPnlPct: -3.6 });

  assert.equal(getExitReason(position, {}, new Date()), "stop-loss");
});

test("trailing stop triggers after activation and drawdown", () => {
  const position = makePosition({
    currentNetPnlPct: 1.1,
    peakNetPnlPct: 3,
  });

  assert.equal(getExitReason(position, {}, new Date()), "trailing-stop");
});

test("max hold triggers when hold time exceeds config", () => {
  const now = new Date("2026-06-29T12:00:00.000Z");
  const position = makePosition({
    openedAt: "2026-06-29T11:51:30.000Z",
    currentNetPnlPct: 0,
  });

  assert.equal(getExitReason(position, {}, now), "max-hold");
});

test("stale quote and no route produce correct exit reasons", () => {
  const now = new Date("2026-06-29T12:00:31.000Z");
  const position = makePosition({
    openedAt: "2026-06-29T12:00:00.000Z",
    lastQuoteAt: "2026-06-29T12:00:00.000Z",
  });

  assert.equal(
    getQuoteFailureExitReason({
      position,
      config: { staleQuoteMaxSeconds: 30 },
      error: new Error("Jupiter returned no route."),
      now,
    }),
    "no-route",
  );

  assert.equal(
    getQuoteFailureExitReason({
      position,
      config: { staleQuoteMaxSeconds: 30 },
      error: new Error("request timeout"),
      now,
    }),
    "stale-quote",
  );
});

test("equity does not drop by full position size immediately after entry", () => {
  const state = createInitialState({ startingCashSol: 10 });
  const entryFeeSol = 0.000015;
  const currentExitSol = estimateInitialExitSol({
    entrySol: 1,
    entryFeeSol,
    entryPriceImpactPct: 0.5,
    config: { slippageBps: 100 },
  });

  state.cashSol -= 1 + entryFeeSol;
  state.openPositions = [
    makePosition({
      entrySol: 1,
      entryTotalCostSol: 1 + entryFeeSol,
      currentExitSol,
      currentNetPnlSol: currentExitSol - (1 + entryFeeSol),
      currentNetPnlPct: ((currentExitSol - (1 + entryFeeSol)) / (1 + entryFeeSol)) * 100,
    }),
  ];

  assert.ok(calculateEquitySol(state) > 9.75);
});

test("daily drawdown prevents new entries but still allows exits", () => {
  const state = createInitialState({ startingCashSol: 10 });
  state.cashSol = 9.4;
  state.dailyAnchorDate = "2026-06-29";
  state.dailyStartEquitySol = 10;
  state.dailyPeakEquitySol = 10;
  const updated = ensureRiskState(
    state,
    { maxDailyDrawdownPct: 5 },
    new Date("2026-06-29T12:00:00.000Z"),
  );

  assert.equal(isDailyDrawdownLocked(updated, { maxDailyDrawdownPct: 5 }), true);
  assert.equal(
    getExitReason(makePosition({ currentNetPnlPct: -3.6 }), {}, new Date()),
    "stop-loss",
  );
});

test("trading enabled defaults on and preserves explicit pause", () => {
  assert.equal(normalizeConfig({}).tradingEnabled, true);
  assert.equal(normalizeConfig({ tradingEnabled: false }).tradingEnabled, false);
});

function makePosition(overrides: Partial<PaperPosition> = {}): PaperPosition {
  return {
    id: "position-1",
    tokenAddress: "So11111111111111111111111111111111111111112",
    pairAddress: "pair",
    symbol: "TEST",
    name: "Test Token",
    sourceUrl: "https://example.com",
    openedAt: "2026-06-29T11:59:00.000Z",
    entrySol: 0.1,
    entryFeeSol: 0.000015,
    entryTotalCostSol: 0.100015,
    tokenRawAmount: "1000000",
    entryPriceImpactPct: 0.1,
    entryScore: 75,
    currentExitSol: 0.1,
    currentNetPnlSol: -0.000015,
    currentNetPnlPct: -0.015,
    peakNetPnlPct: 0,
    lastQuoteAt: "2026-06-29T11:59:00.000Z",
    ...overrides,
  };
}

function makeClosedTrade(
  overrides: Partial<ClosedTrade> = {},
): ClosedTrade {
  const position = makePosition(overrides);

  return {
    ...position,
    closedAt: "2026-06-29T12:00:00.000Z",
    exitReason: "take-profit",
    exitSol: position.currentExitSol,
    exitFeeSol: 0.000015,
    netPnlSol: 0.01,
    netPnlPct: 10,
    holdMinutes: 1,
    ...overrides,
  };
}

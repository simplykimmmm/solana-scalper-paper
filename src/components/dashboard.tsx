"use client";

import {
  Activity,
  BarChart3,
  CircleDollarSign,
  Cloud,
  Database,
  Download,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Settings2,
  ShieldCheck,
  TimerReset,
  TrendingUp,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computeTradeStats } from "@/lib/analytics";
import { DEFAULT_CONFIG, createInitialState } from "@/lib/defaults";
import { computeTradeSizeSol } from "@/lib/risk";
import type {
  ActivityEvent,
  BotConfig,
  BotState,
  ClosedTrade,
  MarketCandidate,
  PaperPosition,
  TrainingLogRow,
  TickResult,
} from "@/lib/types";

type ApiStateResponse = {
  ok: boolean;
  storageConfigured: boolean;
  payload: {
    config: BotConfig;
    state: BotState;
  };
};

const LOCAL_KEY = "solana-scalper-paper:v1";
const RUNNING_KEY = "solana-scalper-paper:engine-running";
const TRAINING_LOG_LOCAL_KEY = "solana-scalper-paper:training-log";
const DASHBOARD_REFRESH_MS = 5_000;
const TRAINING_LOG_LOCAL_LIMIT = 20_000;

export function Dashboard() {
  const [config, setConfig] = useState<BotConfig>(DEFAULT_CONFIG);
  const [state, setState] = useState<BotState>(() => createHydrationState());
  const [candidates, setCandidates] = useState<MarketCandidate[]>([]);
  const [summary, setSummary] = useState<TickResult["summary"] | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isTicking, setIsTicking] = useState(false);
  const [hasLoadedPreferences, setHasLoadedPreferences] = useState(false);
  const [storageConfigured, setStorageConfigured] = useState(false);
  const [saveCloudState, setSaveCloudState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isRunningRef = useRef(isRunning);
  const isTickingRef = useRef(isTicking);

  const syncCloudState = useCallback(async () => {
    if (isTickingRef.current) {
      return;
    }

    try {
      const response = await fetch("/api/state", { cache: "no-store" });
      const data = (await response.json()) as ApiStateResponse;

      setStorageConfigured(data.storageConfigured);

      if (data.storageConfigured && data.payload) {
        setState(data.payload.state);
        setConfig((currentConfig) =>
          isRunningRef.current ? currentConfig : data.payload.config,
        );
        setSaveCloudState(true);
      }
    } catch {
      // Keep the current dashboard state when a refresh request is briefly unavailable.
    }
  }, []);

  useEffect(() => {
    isRunningRef.current = isRunning;
  }, [isRunning]);

  useEffect(() => {
    isTickingRef.current = isTicking;
  }, [isTicking]);

  useEffect(() => {
    const localLoad = window.setTimeout(() => {
      const localPayload = readLocalPayload();
      setConfig(localPayload.config);
      setState(localPayload.state);
      setIsRunning(readLocalRunningState());
      setHasLoadedPreferences(true);
    }, 0);

    const cloudLoad = window.setTimeout(() => {
      void syncCloudState();
    }, 0);

    return () => {
      window.clearTimeout(localLoad);
      window.clearTimeout(cloudLoad);
    };
  }, [syncCloudState]);

  useEffect(() => {
    window.localStorage.setItem(
      LOCAL_KEY,
      JSON.stringify({
        config,
        state,
      }),
    );
  }, [config, state]);

  useEffect(() => {
    if (!hasLoadedPreferences) {
      return;
    }

    window.localStorage.setItem(RUNNING_KEY, isRunning ? "1" : "0");
  }, [hasLoadedPreferences, isRunning]);

  const metrics = useMemo(() => {
    const stats = computeTradeStats(state);

    return {
      equitySol: summary?.equitySol ?? stats.equitySol,
      cashSol: state.cashSol,
      markedOpenValueSol:
        summary?.markedOpenValueSol ?? stats.markedOpenValueSol,
      openCount: state.openPositions.length,
      openPnlSol: summary?.openPnlSol ?? stats.openPnlSol,
      realizedPnlSol: summary?.realizedPnlSol ?? stats.realizedPnlSol,
      winRate: stats.winRatePct,
      trades: state.closedTrades.length,
      computedTradeSizeSol:
        summary?.computedTradeSizeSol ?? computeTradeSizeSol(config, state),
      stats,
    };
  }, [config, state, summary]);

  const tickHealth = useMemo(() => getTickHealth(state, config), [state, config]);

  const runTick = useCallback(async () => {
    if (isTicking) {
      return;
    }

    setIsTicking(true);
    setError(null);

    try {
      const response = await fetch("/api/tick", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          config,
          state,
          saveCloudState,
        }),
      });
      const result = (await response.json()) as TickResult & { error?: string };

      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Tick failed.");
      }

      setConfig(result.config);
      setState(result.state);
      setCandidates(result.candidates);
      setSummary(result.summary);
      setStorageConfigured(result.storageConfigured);
      appendLocalTrainingRows(result.trainingRows);
    } catch (tickError) {
      setError(tickError instanceof Error ? tickError.message : "Tick failed.");
      setIsRunning(false);
    } finally {
      setIsTicking(false);
    }
  }, [config, isTicking, saveCloudState, state]);

  useEffect(() => {
    if (!hasLoadedPreferences || !isRunning) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    intervalRef.current = setInterval(() => {
      void runTick();
    }, config.tickIntervalSeconds * 1_000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [config.tickIntervalSeconds, hasLoadedPreferences, isRunning, runTick]);

  useEffect(() => {
    if (!hasLoadedPreferences) {
      return;
    }

    refreshRef.current = setInterval(() => {
      void syncCloudState();
    }, DASHBOARD_REFRESH_MS);

    return () => {
      if (refreshRef.current) {
        clearInterval(refreshRef.current);
        refreshRef.current = null;
      }
    };
  }, [hasLoadedPreferences, syncCloudState]);

  function updateConfig<K extends keyof BotConfig>(key: K, value: BotConfig[K]) {
    setConfig((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function saveState() {
    setError(null);

    const response = await fetch("/api/state", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ config, state }),
    });
    const data = (await response.json()) as {
      storageConfigured: boolean;
      error?: string;
    };

    if (!response.ok) {
      setError(data.error || "Save failed.");
      return;
    }

    setStorageConfigured(data.storageConfigured);
    setSaveCloudState(data.storageConfigured);
  }

  function resetState() {
    const nextState = createInitialState(config);
    setState(nextState);
    setCandidates([]);
    setSummary(null);
    setIsRunning(false);
  }

  function exportState() {
    const blob = new Blob([JSON.stringify({ config, state }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `paper-scalper-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function exportTrainingLog() {
    if (storageConfigured) {
      try {
        const response = await fetch("/api/training-log", { cache: "no-store" });

        if (!response.ok) {
          throw new Error("Training log export failed.");
        }

        downloadBlob(
          await response.blob(),
          getDownloadFilename(response) || trainingLogFilename(),
        );
        return;
      } catch (exportError) {
        setError(
          exportError instanceof Error
            ? exportError.message
            : "Training log export failed.",
        );
      }
    }

    downloadBlob(
      new Blob([trainingRowsToJsonl(readLocalTrainingRows())], {
        type: "application/x-ndjson;charset=utf-8",
      }),
      trainingLogFilename(),
    );
  }

  return (
    <main className="min-h-screen bg-[#f4f6f1] text-[#151711]">
      <header className="border-b border-[#d7dccd] bg-[#fbfcf8]">
        <div className="mx-auto flex max-w-[1720px] flex-col gap-4 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-[8px] bg-[#1d7a50] text-white">
              <BarChart3 size={20} />
            </span>
            <div>
              <h1 className="text-xl font-semibold tracking-normal">
                Solana Paper Scalper
              </h1>
              <p className="text-sm text-[#5d6554]">
                Paper trading dashboard with free-market data and quote-aware PnL.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={storageConfigured ? "green" : "amber"}>
              <Cloud size={14} />
              {storageConfigured ? "Cloud state" : "Local state"}
            </Badge>
            <Badge tone="neutral">
              <ShieldCheck size={14} />
              Paper only
            </Badge>
            <Badge tone={tickHealth.tone}>{tickHealth.label}</Badge>
            <IconButton
              label={isRunning ? "Pause browser ticks" : "Start browser ticks"}
              onClick={() => setIsRunning((value) => !value)}
              tone={isRunning ? "amber" : "green"}
            >
              {isRunning ? <Pause size={18} /> : <Play size={18} />}
            </IconButton>
            <IconButton label="Run one tick" onClick={() => void runTick()}>
              <RefreshCw className={isTicking ? "animate-spin" : ""} size={18} />
            </IconButton>
            <IconButton label="Save state" onClick={() => void saveState()}>
              <Save size={18} />
            </IconButton>
            <IconButton label="Export JSON" onClick={exportState}>
              <Download size={18} />
            </IconButton>
            <IconButton
              label="Export AI training log"
              onClick={() => void exportTrainingLog()}
            >
              <Database size={18} />
            </IconButton>
            <IconButton label="Reset paper account" onClick={resetState} tone="red">
              <RotateCcw size={18} />
            </IconButton>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1720px] gap-4 px-4 py-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <Panel title="Settings" icon={<Settings2 size={18} />}>
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Start SOL"
                value={config.startingCashSol}
                min={0.01}
                step={0.1}
                onChange={(value) => updateConfig("startingCashSol", value)}
              />
              <NumberField
                label="Trade SOL"
                value={config.tradeSizeSol}
                min={0.001}
                step={0.01}
                onChange={(value) => updateConfig("tradeSizeSol", value)}
              />
              <NumberField
                label="Computed SOL"
                value={metrics.computedTradeSizeSol}
                min={0}
                step={0.01}
                onChange={() => undefined}
                disabled
              />
              <NumberField
                label="Min trade"
                value={config.minTradeSizeSol}
                min={0.001}
                step={0.01}
                onChange={(value) => updateConfig("minTradeSizeSol", value)}
              />
              <NumberField
                label="Max trade"
                value={config.maxTradeSizeSol}
                min={0.001}
                step={0.01}
                onChange={(value) => updateConfig("maxTradeSizeSol", value)}
              />
              <NumberField
                label="Risk %"
                value={config.riskPerTradePct}
                min={0.01}
                step={0.1}
                onChange={(value) => updateConfig("riskPerTradePct", value)}
              />
              <NumberField
                label="Scale trades"
                value={config.scaleUpAfterTrades}
                min={1}
                step={1}
                onChange={(value) => updateConfig("scaleUpAfterTrades", value)}
              />
              <NumberField
                label="Scale PF"
                value={config.scaleUpMinProfitFactor}
                min={0}
                step={0.1}
                onChange={(value) =>
                  updateConfig("scaleUpMinProfitFactor", value)
                }
              />
              <NumberField
                label="Daily DD %"
                value={config.maxDailyDrawdownPct}
                min={0.1}
                step={0.5}
                onChange={(value) => updateConfig("maxDailyDrawdownPct", value)}
              />
              <NumberField
                label="Max open"
                value={config.maxOpenPositions}
                min={1}
                step={1}
                onChange={(value) => updateConfig("maxOpenPositions", value)}
              />
              <NumberField
                label="New / tick"
                value={config.maxNewPositionsPerTick}
                min={0}
                step={1}
                onChange={(value) =>
                  updateConfig("maxNewPositionsPerTick", value)
                }
              />
              <NumberField
                label="Take %"
                value={config.takeProfitNetPct}
                min={0.1}
                step={0.5}
                onChange={(value) => updateConfig("takeProfitNetPct", value)}
              />
              <NumberField
                label="Stop %"
                value={config.stopLossNetPct}
                max={-0.1}
                step={0.5}
                onChange={(value) => updateConfig("stopLossNetPct", value)}
              />
              <NumberField
                label="Trail on %"
                value={config.trailingActivationPct}
                min={0}
                step={0.5}
                onChange={(value) =>
                  updateConfig("trailingActivationPct", value)
                }
              />
              <NumberField
                label="Trail drop %"
                value={config.trailingDrawdownPct}
                min={0.1}
                step={0.5}
                onChange={(value) => updateConfig("trailingDrawdownPct", value)}
              />
              <NumberField
                label="Emerg %"
                value={config.emergencyMaxLossPct}
                max={-0.1}
                step={0.5}
                onChange={(value) => updateConfig("emergencyMaxLossPct", value)}
              />
              <NumberField
                label="Stale sec"
                value={config.staleQuoteMaxSeconds}
                min={5}
                step={5}
                onChange={(value) => updateConfig("staleQuoteMaxSeconds", value)}
              />
              <NumberField
                label="Max hold min"
                value={config.maxHoldMinutes}
                min={1}
                step={1}
                onChange={(value) => updateConfig("maxHoldMinutes", value)}
              />
              <NumberField
                label="Cooldown min"
                value={config.cooldownMinutes}
                min={0}
                step={1}
                onChange={(value) => updateConfig("cooldownMinutes", value)}
              />
              <NumberField
                label="Tick sec"
                value={config.tickIntervalSeconds}
                min={10}
                step={5}
                onChange={(value) => updateConfig("tickIntervalSeconds", value)}
              />
              <NumberField
                label="Slip bps"
                value={config.slippageBps}
                min={1}
                step={10}
                onChange={(value) => updateConfig("slippageBps", value)}
              />
            </div>
            <label className="mt-3 block text-xs font-semibold uppercase text-[#687060]">
              Risk mode
              <select
                className="mt-1 h-10 w-full rounded-[6px] border border-[#cbd3bf] bg-white px-3 text-sm font-medium text-[#151711] outline-none focus:border-[#1d7a50]"
                value={config.riskMode}
                onChange={(event) =>
                  updateConfig(
                    "riskMode",
                    event.target.value as BotConfig["riskMode"],
                  )
                }
              >
                <option value="adaptive">Adaptive</option>
                <option value="fixed">Fixed</option>
              </select>
            </label>
          </Panel>

          <Panel title="Filters" icon={<TimerReset size={18} />}>
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Min liq $"
                value={config.minLiquidityUsd}
                min={0}
                step={1000}
                onChange={(value) => updateConfig("minLiquidityUsd", value)}
              />
              <NumberField
                label="Max liq $"
                value={config.maxLiquidityUsd}
                min={0}
                step={10000}
                onChange={(value) => updateConfig("maxLiquidityUsd", value)}
              />
              <NumberField
                label="M5 vol $"
                value={config.minVolumeM5Usd}
                min={0}
                step={500}
                onChange={(value) => updateConfig("minVolumeM5Usd", value)}
              />
              <NumberField
                label="Min age min"
                value={config.minPairAgeMinutes}
                min={0}
                step={1}
                onChange={(value) => updateConfig("minPairAgeMinutes", value)}
              />
              <NumberField
                label="Max age hr"
                value={config.maxPairAgeHours}
                min={0.1}
                step={1}
                onChange={(value) => updateConfig("maxPairAgeHours", value)}
              />
              <NumberField
                label="Buy/sell"
                value={config.minBuySellRatioM5}
                min={0}
                step={0.1}
                onChange={(value) => updateConfig("minBuySellRatioM5", value)}
              />
              <NumberField
                label="Min buys"
                value={config.minBuysM5}
                min={0}
                step={1}
                onChange={(value) => updateConfig("minBuysM5", value)}
              />
              <NumberField
                label="Min score"
                value={config.minScoreToEnter}
                min={0}
                step={1}
                onChange={(value) => updateConfig("minScoreToEnter", value)}
              />
              <NumberField
                label="Entry impact %"
                value={config.maxEntryPriceImpactPct}
                min={0.01}
                step={0.1}
                onChange={(value) => updateConfig("maxEntryPriceImpactPct", value)}
              />
              <NumberField
                label="Trade/liq %"
                value={config.maxTradeLiquidityPct}
                min={0.001}
                step={0.05}
                onChange={(value) => updateConfig("maxTradeLiquidityPct", value)}
              />
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 text-sm font-medium">
              <label className="flex items-center justify-between gap-3">
                Reject emoji-only symbols
                <input
                  className="size-5 accent-[#1d7a50]"
                  type="checkbox"
                  checked={config.rejectEmojiOnlySymbols}
                  onChange={(event) =>
                    updateConfig("rejectEmojiOnlySymbols", event.target.checked)
                  }
                />
              </label>
              <label className="flex items-center justify-between gap-3">
                Reject recent duplicate tokens
                <input
                  className="size-5 accent-[#1d7a50]"
                  type="checkbox"
                  checked={config.rejectDuplicateRecentToken}
                  onChange={(event) =>
                    updateConfig(
                      "rejectDuplicateRecentToken",
                      event.target.checked,
                    )
                  }
                />
              </label>
            </div>

            <label className="mt-3 block text-xs font-semibold uppercase text-[#687060]">
              Discovery
              <select
                className="mt-1 h-10 w-full rounded-[6px] border border-[#cbd3bf] bg-white px-3 text-sm font-medium text-[#151711] outline-none focus:border-[#1d7a50]"
                value={config.discoveryMode}
                onChange={(event) =>
                  updateConfig(
                    "discoveryMode",
                    event.target.value as BotConfig["discoveryMode"],
                  )
                }
              >
                <option value="latest-boosts">Latest boosts</option>
                <option value="top-boosts">Top boosts</option>
                <option value="latest-profiles">Latest profiles</option>
                <option value="watchlist">Watchlist</option>
                <option value="combined">Combined</option>
              </select>
            </label>

            <label className="mt-3 block text-xs font-semibold uppercase text-[#687060]">
              Watchlist mints
              <textarea
                className="mt-1 min-h-24 w-full resize-y rounded-[6px] border border-[#cbd3bf] bg-white p-3 font-mono text-xs text-[#151711] outline-none focus:border-[#1d7a50]"
                value={config.watchlist.join("\n")}
                onChange={(event) =>
                  updateConfig(
                    "watchlist",
                    event.target.value
                      .split(/\s|,|\n/)
                      .map((item) => item.trim())
                      .filter(Boolean),
                  )
                }
              />
            </label>
          </Panel>

          <Panel title="Cloud" icon={<Cloud size={18} />}>
            <label className="flex items-center justify-between gap-3 text-sm font-medium">
              Save ticks to cloud
              <input
                className="size-5 accent-[#1d7a50]"
                type="checkbox"
                checked={saveCloudState}
                onChange={(event) => setSaveCloudState(event.target.checked)}
                disabled={!storageConfigured}
              />
            </label>
            <p className="mt-3 text-sm leading-6 text-[#5d6554]">
              {storageConfigured
                ? "Upstash storage is active for server-side ticks."
                : "Add Upstash env vars on Vercel for server-side ticks."}
            </p>
            <p className="mt-2 text-sm leading-6 text-[#5d6554]">
              Browser ticks are manual/local and can stop when the tab is closed.
              Vercel Cron is a cloud fallback. Use the always-on worker for the
              10-second exit loop.
            </p>
            {tickHealth.isStale ? (
              <div className="mt-3 rounded-[6px] border border-[#e4a5a5] bg-[#fff4f1] px-3 py-2 text-sm text-[#8d2525]">
                Last tick is stale. Exits are not protected until a cloud worker,
                cron tick, or manual tick runs.
              </div>
            ) : null}
            {state.drawdownLocked ? (
              <div className="mt-3 rounded-[6px] border border-[#e6c76f] bg-[#fff6d8] px-3 py-2 text-sm text-[#7c5a05]">
                Daily drawdown lock active. New entries are blocked; exits still run.
              </div>
            ) : null}
            {error ? (
              <div className="mt-3 rounded-[6px] border border-[#e4a5a5] bg-[#fff4f1] px-3 py-2 text-sm text-[#8d2525]">
                {error}
              </div>
            ) : null}
          </Panel>
        </aside>

        <section className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
            <Metric
              icon={<CircleDollarSign size={18} />}
              label="Equity"
              value={`${metrics.equitySol.toFixed(4)} SOL`}
            />
            <Metric
              icon={<Activity size={18} />}
              label="Cash"
              value={`${metrics.cashSol.toFixed(4)} SOL`}
            />
            <Metric
              label="Open value"
              value={`${metrics.markedOpenValueSol.toFixed(4)} SOL`}
            />
            <Metric
              label="Open PnL"
              value={`${signed(metrics.openPnlSol)} SOL`}
              tone={metrics.openPnlSol >= 0 ? "green" : "red"}
            />
            <Metric
              icon={<TrendingUp size={18} />}
              label="Realized"
              value={`${signed(metrics.realizedPnlSol)} SOL`}
              tone={metrics.realizedPnlSol >= 0 ? "green" : "red"}
            />
            <Metric label="Open" value={String(metrics.openCount)} />
            <Metric label="Closed" value={String(metrics.trades)} />
            <Metric label="Win rate" value={`${metrics.winRate.toFixed(1)}%`} />
            <Metric
              label="Next size"
              value={`${metrics.computedTradeSizeSol.toFixed(4)} SOL`}
            />
          </div>

          <Panel title="Equity Curve" icon={<TrendingUp size={18} />}>
            <EquityChart points={state.equityCurve} />
          </Panel>

          <Panel title="Trade Analytics" icon={<Activity size={18} />}>
            <AnalyticsView stats={metrics.stats} />
          </Panel>

          <div className="grid gap-4 2xl:grid-cols-2">
            <Panel title="Open Positions">
              <PositionsTable positions={state.openPositions} />
            </Panel>
            <Panel title="Scanner">
              <CandidatesTable candidates={candidates} />
            </Panel>
          </div>

          <div className="grid gap-4 2xl:grid-cols-2">
            <Panel title="Closed Trades">
              <ClosedTradesTable trades={state.closedTrades} />
            </Panel>
            <Panel title="Activity">
              <ActivityList items={state.activity} />
            </Panel>
          </div>
        </section>
      </div>
    </main>
  );
}

function readLocalRunningState(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem(RUNNING_KEY) === "1";
}

function readLocalPayload(): ApiStateResponse["payload"] {
  const fallback = {
    config: DEFAULT_CONFIG,
    state: createInitialState(DEFAULT_CONFIG),
  };

  if (typeof window === "undefined") {
    return fallback;
  }

  const local = window.localStorage.getItem(LOCAL_KEY);

  if (!local) {
    return fallback;
  }

  try {
    return JSON.parse(local) as ApiStateResponse["payload"];
  } catch {
    window.localStorage.removeItem(LOCAL_KEY);
    return fallback;
  }
}

function appendLocalTrainingRows(rows: TrainingLogRow[]) {
  if (typeof window === "undefined" || rows.length === 0) {
    return;
  }

  const nextRows = [...readLocalTrainingRows(), ...rows].slice(
    -TRAINING_LOG_LOCAL_LIMIT,
  );
  window.localStorage.setItem(
    TRAINING_LOG_LOCAL_KEY,
    JSON.stringify(nextRows),
  );
}

function readLocalTrainingRows(): TrainingLogRow[] {
  if (typeof window === "undefined") {
    return [];
  }

  const local = window.localStorage.getItem(TRAINING_LOG_LOCAL_KEY);

  if (!local) {
    return [];
  }

  try {
    const rows = JSON.parse(local) as unknown;
    return Array.isArray(rows) ? (rows as TrainingLogRow[]) : [];
  } catch {
    window.localStorage.removeItem(TRAINING_LOG_LOCAL_KEY);
    return [];
  }
}

function trainingRowsToJsonl(rows: TrainingLogRow[]): string {
  if (rows.length === 0) {
    return "";
  }

  return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function getDownloadFilename(response: Response): string | null {
  const disposition = response.headers.get("content-disposition");

  if (!disposition) {
    return null;
  }

  const match = disposition.match(/filename="?([^"]+)"?/i);
  return match?.[1] || null;
}

function trainingLogFilename(): string {
  return `solana-scalper-training-${Date.now()}.jsonl`;
}

function createHydrationState(): BotState {
  const at = "2026-01-01T00:00:00.000Z";

  return {
    initializedAt: at,
    updatedAt: at,
    lastTickAt: undefined,
    lastTickSource: undefined,
    cashSol: DEFAULT_CONFIG.startingCashSol,
    openPositions: [],
    closedTrades: [],
    activity: [],
    equityCurve: [
      {
        at,
        cashSol: DEFAULT_CONFIG.startingCashSol,
        equitySol: DEFAULT_CONFIG.startingCashSol,
      },
    ],
    cooldowns: {},
    peakEquitySol: DEFAULT_CONFIG.startingCashSol,
    maxDrawdownPct: 0,
    dailyAnchorDate: at.slice(0, 10),
    dailyStartEquitySol: DEFAULT_CONFIG.startingCashSol,
    dailyPeakEquitySol: DEFAULT_CONFIG.startingCashSol,
    dailyDrawdownPct: 0,
    drawdownLocked: false,
    tickCount: 0,
  };
}

function Panel({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[8px] border border-[#d7dccd] bg-[#fbfcf8]">
      <div className="flex h-12 items-center gap-2 border-b border-[#e2e6da] px-4">
        {icon}
        <h2 className="text-sm font-semibold uppercase text-[#4b5444]">
          {title}
        </h2>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Badge({
  tone,
  children,
}: {
  tone: "green" | "amber" | "neutral" | "red";
  children: React.ReactNode;
}) {
  const classes = {
    green: "border-[#8fcaa6] bg-[#e5f5ea] text-[#14613d]",
    amber: "border-[#e6c76f] bg-[#fff6d8] text-[#7c5a05]",
    neutral: "border-[#ccd1c5] bg-white text-[#4b5444]",
    red: "border-[#e4a5a5] bg-[#fff4f1] text-[#8d2525]",
  };

  return (
    <span
      className={`inline-flex h-9 items-center gap-2 rounded-[6px] border px-3 text-sm font-semibold ${classes[tone]}`}
    >
      {children}
    </span>
  );
}

function IconButton({
  label,
  tone = "neutral",
  onClick,
  children,
}: {
  label: string;
  tone?: "neutral" | "green" | "amber" | "red";
  onClick: () => void;
  children: React.ReactNode;
}) {
  const classes = {
    neutral: "border-[#c8d0bd] bg-white text-[#151711] hover:bg-[#eef2e8]",
    green: "border-[#14613d] bg-[#1d7a50] text-white hover:bg-[#166441]",
    amber: "border-[#d7a321] bg-[#f3c54c] text-[#3b2a00] hover:bg-[#e8b736]",
    red: "border-[#c57171] bg-[#fff3f1] text-[#962b2b] hover:bg-[#ffe3df]",
  };

  return (
    <button
      aria-label={label}
      title={label}
      className={`grid size-9 place-items-center rounded-[6px] border transition ${classes[tone]}`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  disabled = false,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block text-xs font-semibold uppercase text-[#687060]">
      {label}
      <input
        className="mt-1 h-10 w-full rounded-[6px] border border-[#cbd3bf] bg-white px-3 font-mono text-sm text-[#151711] outline-none focus:border-[#1d7a50]"
        type="number"
        value={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function Metric({
  icon,
  label,
  value,
  tone = "neutral",
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  tone?: "neutral" | "green" | "red";
}) {
  const color =
    tone === "green" ? "text-[#147343]" : tone === "red" ? "text-[#a12c2c]" : "";

  return (
    <div className="rounded-[8px] border border-[#d7dccd] bg-[#fbfcf8] p-4">
      <div className="flex items-center gap-2 text-[#687060]">
        {icon}
        <span className="text-xs font-semibold uppercase">{label}</span>
      </div>
      <div className={`mt-2 font-mono text-2xl font-semibold ${color}`}>
        {value}
      </div>
    </div>
  );
}

function EquityChart({ points }: { points: BotState["equityCurve"] }) {
  const ordered = [...points].reverse().slice(-120);
  const values = ordered.map((point) => point.equitySol);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const range = Math.max(max - min, 0.000001);
  const polyline = ordered
    .map((point, index) => {
      const x = ordered.length <= 1 ? 0 : (index / (ordered.length - 1)) * 100;
      const y = 100 - ((point.equitySol - min) / range) * 100;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div className="h-56 w-full">
      <svg
        className="h-full w-full overflow-visible"
        preserveAspectRatio="none"
        role="img"
        viewBox="0 0 100 100"
      >
        <line x1="0" x2="100" y1="80" y2="80" stroke="#d7dccd" strokeWidth="0.4" />
        <line x1="0" x2="100" y1="50" y2="50" stroke="#e6eadf" strokeWidth="0.35" />
        <line x1="0" x2="100" y1="20" y2="20" stroke="#d7dccd" strokeWidth="0.4" />
        <polyline
          fill="none"
          points={polyline}
          stroke="#1d7a50"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

function AnalyticsView({ stats }: { stats: ReturnType<typeof computeTradeStats> }) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Table
        headers={["Metric", "Value"]}
        rows={[
          ["Profit factor", formatFactor(stats.profitFactor)],
          ["Expectancy", `${signed(stats.expectancySol)} SOL`],
          ["Avg win", `${stats.averageWinSol.toFixed(4)} SOL`],
          ["Avg loss", `${stats.averageLossSol.toFixed(4)} SOL`],
          ["Max drawdown", `${stats.maxDrawdownPct.toFixed(2)}%`],
          ["Avg hold", `${stats.averageHoldMinutes.toFixed(1)}m`],
          ["Median hold", `${stats.medianHoldMinutes.toFixed(1)}m`],
        ]}
      />
      <Table
        headers={["Exit reason", "PnL"]}
        rows={recordRows(stats.pnlByExitReason)}
      />
      <Table
        headers={["Score bucket", "PnL"]}
        rows={recordRows(stats.pnlByEntryScoreBucket)}
      />
      <Table headers={["Size", "PnL"]} rows={recordRows(stats.pnlByTradeSize)} />
    </div>
  );
}

function PositionsTable({ positions }: { positions: PaperPosition[] }) {
  if (positions.length === 0) {
    return <Empty label="No open positions" />;
  }

  return (
    <Table
      headers={["Token", "Cost", "Exit", "Net %", "Peak", "Age"]}
      rows={positions.map((position) => [
        tokenCell(position.symbol, position.tokenAddress, position.sourceUrl),
        `${position.entryTotalCostSol.toFixed(4)}`,
        `${position.currentExitSol.toFixed(4)}`,
        signed(position.currentNetPnlPct),
        `${position.peakNetPnlPct.toFixed(1)}%`,
        `${minutesSince(position.openedAt).toFixed(1)}m`,
      ])}
    />
  );
}

function CandidatesTable({ candidates }: { candidates: MarketCandidate[] }) {
  if (candidates.length === 0) {
    return <Empty label="Run a tick to scan" />;
  }

  return (
    <Table
      headers={["Token", "Score", "Liq", "M5 Vol", "M5", "Buys/Sells", "Decision"]}
      rows={candidates.map((candidate) => [
        tokenCell(candidate.symbol, candidate.tokenAddress, candidate.url),
        candidate.score.toFixed(1),
        dollars(candidate.liquidityUsd),
        dollars(candidate.volumeM5Usd),
        `${candidate.priceChangeM5Pct.toFixed(1)}%`,
        `${candidate.buysM5}/${candidate.sellsM5}`,
        candidate.rejectionReasons.length === 0
          ? "accepted"
          : candidate.rejectionReasons.join(", "),
      ])}
    />
  );
}

function ClosedTradesTable({ trades }: { trades: ClosedTrade[] }) {
  if (trades.length === 0) {
    return <Empty label="No closed trades" />;
  }

  return (
    <Table
      headers={["Token", "Reason", "PnL", "Net %", "Hold"]}
      rows={trades.slice(0, 12).map((trade) => [
        tokenCell(trade.symbol, trade.tokenAddress, trade.sourceUrl),
        trade.exitReason,
        `${signed(trade.netPnlSol)} SOL`,
        `${signed(trade.netPnlPct)}%`,
        `${trade.holdMinutes.toFixed(1)}m`,
      ])}
    />
  );
}

function ActivityList({ items }: { items: ActivityEvent[] }) {
  if (items.length === 0) {
    return <Empty label="No activity" />;
  }

  return (
    <div className="max-h-[390px] overflow-auto">
      <ol className="space-y-2">
        {items.slice(0, 25).map((item) => (
          <li
            className="grid grid-cols-[84px_minmax(0,1fr)] gap-3 rounded-[6px] border border-[#e2e6da] bg-white px-3 py-2 text-sm"
            key={item.id}
          >
            <span className="font-mono text-xs text-[#687060]">
              {new Date(item.at).toLocaleTimeString()}
            </span>
            <span className="truncate text-[#24281e]" title={item.message}>
              {item.message}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-auto">
      <table className="w-full min-w-[640px] border-collapse text-left text-sm">
        <thead>
          <tr>
            {headers.map((header) => (
              <th
                className="border-b border-[#d7dccd] px-3 py-2 text-xs font-semibold uppercase text-[#687060]"
                key={header}
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr className="border-b border-[#edf0e8]" key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td className="px-3 py-3 align-middle" key={cellIndex}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="grid h-28 place-items-center rounded-[6px] border border-dashed border-[#ccd3c1] bg-white text-sm font-medium text-[#687060]">
      {label}
    </div>
  );
}

function tokenCell(symbol: string, address: string, url?: string) {
  const content = (
    <span>
      <span className="block font-semibold">{symbol}</span>
      <span className="block font-mono text-xs text-[#687060]">
        {address.slice(0, 4)}...{address.slice(-4)}
      </span>
    </span>
  );

  if (!url) {
    return content;
  }

  return (
    <a className="hover:text-[#1d7a50]" href={url} target="_blank" rel="noreferrer">
      {content}
    </a>
  );
}

function getTickHealth(state: BotState, config: BotConfig) {
  if (!state.lastTickAt) {
    return {
      label: "browser/manual mode",
      tone: "neutral" as const,
      isStale: true,
    };
  }

  const ageSeconds = (Date.now() - new Date(state.lastTickAt).getTime()) / 1_000;
  const staleAfterSeconds =
    state.lastTickSource === "scheduler"
      ? Math.max(config.tickIntervalSeconds * 2, 150)
      : config.tickIntervalSeconds * 2;
  const isStale = ageSeconds > staleAfterSeconds;

  if (isStale) {
    return {
      label: "stale: exits not protected",
      tone: "red" as const,
      isStale,
    };
  }

  if (state.lastTickSource === "worker") {
    return {
      label: "live worker healthy",
      tone: "green" as const,
      isStale,
    };
  }

  if (state.lastTickSource === "scheduler") {
    return {
      label: "cloud cron healthy",
      tone: "green" as const,
      isStale,
    };
  }

  return {
    label: "browser/manual mode",
    tone: "amber" as const,
    isStale,
  };
}

function recordRows(record: Record<string, number>): React.ReactNode[][] {
  const entries = Object.entries(record);

  if (entries.length === 0) {
    return [["No data", "0.0000 SOL"]];
  }

  return entries
    .sort(([, left], [, right]) => Math.abs(right) - Math.abs(left))
    .map(([key, value]) => [key, `${signed(value)} SOL`]);
}

function formatFactor(value: number) {
  if (!Number.isFinite(value)) {
    return "inf";
  }

  return value.toFixed(2);
}

function dollars(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function signed(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function minutesSince(iso: string) {
  return (Date.now() - new Date(iso).getTime()) / 60_000;
}

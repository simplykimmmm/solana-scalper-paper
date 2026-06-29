import { createInitialState, normalizeConfig } from "../lib/defaults";
import { runPaperTick } from "../lib/engine";
import {
  acquireCloudTickLock,
  appendCloudTrainingRows,
  isCloudStorageConfigured,
  readCloudPayload,
  releaseCloudTickLock,
  writeCloudPayload,
} from "../lib/storage";

const DEFAULT_WORKER_INTERVAL_SECONDS = 10;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const dryRun = options.has("dry");
  const once = options.has("once");
  let stopping = false;

  process.on("SIGINT", () => {
    stopping = true;
  });
  process.on("SIGTERM", () => {
    stopping = true;
  });

  do {
    const startedAt = Date.now();
    await runWorkerTick(dryRun);

    if (once || stopping) {
      break;
    }

    const elapsedSeconds = (Date.now() - startedAt) / 1_000;
    const intervalSeconds = Number(process.env.PAPER_WORKER_INTERVAL_SECONDS);
    const sleepSeconds = Number.isFinite(intervalSeconds)
      ? intervalSeconds
      : DEFAULT_WORKER_INTERVAL_SECONDS;

    await sleep(Math.max(1, sleepSeconds - elapsedSeconds));
  } while (!stopping);
}

async function runWorkerTick(dryRun: boolean) {
  const storageConfigured = isCloudStorageConfigured();
  const lockToken =
    !dryRun && storageConfigured ? await acquireCloudTickLock() : null;

  if (!dryRun && storageConfigured && !lockToken) {
    console.log(
      "[paper] skipped tick because another cloud runner holds the lock.",
    );
    return;
  }

  try {
    const payload = storageConfigured ? await readCloudPayload() : null;
    const config = normalizeConfig(payload?.config);
    const state = payload?.state || createInitialState(config);
    const result = await runPaperTick({
      config,
      state,
      storageConfigured,
      storageSaved: false,
      source: "worker",
    });

    if (!dryRun && storageConfigured) {
      await writeCloudPayload({
        config: result.config,
        state: result.state,
      });
      await appendCloudTrainingRows(result.trainingRows);
      result.storageSaved = true;
    }

    const prefix = dryRun ? "[dry]" : "[paper]";
    console.log(
      `${prefix} tick=${result.state.tickCount} opened=${result.summary.opened} closed=${result.summary.closed} skipped=${result.summary.skipped} errors=${result.summary.errors} equity=${result.summary.equitySol.toFixed(4)} size=${result.summary.computedTradeSizeSol.toFixed(4)} saved=${result.storageSaved}`,
    );

    if (!storageConfigured) {
      console.warn(
        "[paper] cloud storage is not configured; worker state will not persist.",
      );
    }
  } finally {
    if (lockToken) {
      await releaseCloudTickLock(lockToken);
    }
  }
}

function parseArgs(args: string[]): Set<string> {
  return new Set(
    args
      .filter((arg) => arg.startsWith("--"))
      .map((arg) => arg.replace(/^--/, "")),
  );
}

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1_000));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

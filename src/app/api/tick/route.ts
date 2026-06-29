import { createInitialState, normalizeConfig } from "@/lib/defaults";
import { runPaperTick } from "@/lib/engine";
import {
  appendCloudTrainingRows,
  isCloudStorageConfigured,
  readCloudPayload,
  writeCloudPayload,
} from "@/lib/storage";
import type { BotConfig, BotState } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    config?: Partial<BotConfig>;
    state?: BotState;
    saveCloudState?: boolean;
  };
  const storageConfigured = isCloudStorageConfigured();
  const result = await runPaperTick({
    config: body.config,
    state: body.state,
    storageConfigured,
    source: "browser",
  });

  if (body.saveCloudState && storageConfigured) {
    await writeCloudPayload({
      config: result.config,
      state: result.state,
    });
    await appendCloudTrainingRows(result.trainingRows);
    result.storageSaved = true;
  }

  return Response.json(result);
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;

  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const storageConfigured = isCloudStorageConfigured();

  if (!storageConfigured) {
    return Response.json(
      {
        ok: false,
        error:
          "Cloud storage is not configured. POST /api/tick with state, or add Upstash Redis env vars.",
      },
      { status: 400 },
    );
  }

  const payload = await readCloudPayload();
  const config = normalizeConfig(payload?.config);
  const result = await runPaperTick({
    config,
    state: payload?.state || createInitialState(config),
    storageConfigured,
    source: "scheduler",
  });

  await writeCloudPayload({
    config: result.config,
    state: result.state,
  });
  await appendCloudTrainingRows(result.trainingRows);
  result.storageSaved = true;

  return Response.json(result);
}

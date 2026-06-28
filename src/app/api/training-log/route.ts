import { normalizeConfig } from "@/lib/defaults";
import {
  isCloudStorageConfigured,
  readCloudPayload,
  readCloudTrainingRows,
} from "@/lib/storage";
import {
  createTrainingRowsFromState,
  trainingRowsToJsonl,
} from "@/lib/training-log";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const format = url.searchParams.get("format");
  const limit = parseLimit(url.searchParams.get("limit"));
  const storageConfigured = isCloudStorageConfigured();
  let rows = storageConfigured ? await readCloudTrainingRows(limit) : [];

  if (rows.length === 0) {
    const payload = await readCloudPayload();

    if (payload) {
      rows = createTrainingRowsFromState({
        config: normalizeConfig(payload.config),
        state: payload.state,
      });
    }
  }

  if (format === "json") {
    return Response.json({
      ok: true,
      storageConfigured,
      rows,
    });
  }

  return new Response(trainingRowsToJsonl(rows), {
    headers: {
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="${trainingLogFilename()}"`,
      "content-type": "application/x-ndjson; charset=utf-8",
    },
  });
}

function parseLimit(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return Math.max(1, Math.min(Math.round(parsed), 100_000));
}

function trainingLogFilename(): string {
  return `solana-scalper-training-${new Date()
    .toISOString()
    .replaceAll(":", "-")}.jsonl`;
}

import { createInitialState, normalizeConfig } from "@/lib/defaults";
import {
  isCloudStorageConfigured,
  readCloudPayload,
  writeCloudPayload,
} from "@/lib/storage";
import type { StoredPayload } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const storageConfigured = isCloudStorageConfigured();
  const payload = await readCloudPayload();

  if (payload) {
    return Response.json({
      ok: true,
      storageConfigured,
      payload,
    });
  }

  const config = normalizeConfig();

  return Response.json({
    ok: true,
    storageConfigured,
    payload: {
      config,
      state: createInitialState(config),
    } satisfies StoredPayload,
  });
}

export async function POST(request: Request) {
  const payload = (await request.json()) as Partial<StoredPayload>;
  const config = normalizeConfig(payload.config);
  const state = payload.state || createInitialState(config);
  const storageConfigured = isCloudStorageConfigured();
  const normalizedPayload = { config, state };

  if (storageConfigured) {
    await writeCloudPayload(normalizedPayload);
  }

  return Response.json({
    ok: true,
    storageConfigured,
    saved: storageConfigured,
    payload: normalizedPayload,
  });
}

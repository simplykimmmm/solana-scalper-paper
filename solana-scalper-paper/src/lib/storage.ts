import type { StoredPayload } from "./types";

const STORAGE_KEY = process.env.UPSTASH_REDIS_KEY || "solana-scalper-paper:v1";

export function isCloudStorageConfigured(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
  );
}

export async function readCloudPayload(): Promise<StoredPayload | null> {
  if (!isCloudStorageConfigured()) {
    return null;
  }

  const raw = await upstashCommand<string | null>(["GET", STORAGE_KEY]);

  if (!raw) {
    return null;
  }

  return JSON.parse(raw) as StoredPayload;
}

export async function writeCloudPayload(payload: StoredPayload): Promise<void> {
  if (!isCloudStorageConfigured()) {
    return;
  }

  await upstashCommand<string>(["SET", STORAGE_KEY, JSON.stringify(payload)]);
}

async function upstashCommand<T>(command: unknown[]): Promise<T> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error("Upstash Redis REST env vars are not configured.");
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });

  const data = (await response.json()) as { result?: T; error?: string };

  if (!response.ok || data.error) {
    throw new Error(data.error || `Upstash ${response.status}`);
  }

  return data.result as T;
}

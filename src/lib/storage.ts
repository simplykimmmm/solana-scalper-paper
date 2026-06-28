import type { StoredPayload, TrainingLogRow } from "./types";

const STORAGE_KEY = process.env.UPSTASH_REDIS_KEY || "solana-scalper-paper:v1";
const TRAINING_LOG_KEY =
  process.env.UPSTASH_REDIS_TRAINING_LOG_KEY || `${STORAGE_KEY}:training-log`;
const DEFAULT_TRAINING_LOG_LIMIT = 20_000;

export function isCloudStorageConfigured(): boolean {
  return Boolean(getRedisRestUrl() && getRedisRestToken());
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

export async function appendCloudTrainingRows(
  rows: TrainingLogRow[],
): Promise<void> {
  if (!isCloudStorageConfigured() || rows.length === 0) {
    return;
  }

  await upstashCommand<number>([
    "RPUSH",
    TRAINING_LOG_KEY,
    ...rows.map((row) => JSON.stringify(row)),
  ]);
  await upstashCommand<string>([
    "LTRIM",
    TRAINING_LOG_KEY,
    -getTrainingLogLimit(),
    -1,
  ]);
}

export async function readCloudTrainingRows(
  limit = getTrainingLogLimit(),
): Promise<TrainingLogRow[]> {
  if (!isCloudStorageConfigured()) {
    return [];
  }

  const rows = await upstashCommand<string[]>([
    "LRANGE",
    TRAINING_LOG_KEY,
    -Math.max(1, Math.round(limit)),
    -1,
  ]);

  return rows.flatMap((row) => {
    try {
      return [JSON.parse(row) as TrainingLogRow];
    } catch {
      return [];
    }
  });
}

async function upstashCommand<T>(command: unknown[]): Promise<T> {
  const url = getRedisRestUrl();
  const token = getRedisRestToken();

  if (!url || !token) {
    throw new Error(
      "Upstash Redis REST env vars are not configured. Set UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN or KV_REST_API_URL/KV_REST_API_TOKEN.",
    );
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

function getRedisRestUrl(): string | undefined {
  return process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
}

function getRedisRestToken(): string | undefined {
  return process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
}

function getTrainingLogLimit(): number {
  const parsed = Number(process.env.TRAINING_LOG_MAX_ROWS);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_TRAINING_LOG_LIMIT;
  }

  return Math.max(100, Math.min(Math.round(parsed), 100_000));
}

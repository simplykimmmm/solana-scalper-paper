import type { BotConfig, MarketCandidate } from "./types";

type DexTokenSeed = {
  chainId?: string;
  tokenAddress?: string;
  url?: string;
  source?: string;
};

type DexPair = {
  chainId?: string;
  dexId?: string;
  url?: string;
  pairAddress?: string;
  baseToken?: {
    address?: string;
    name?: string;
    symbol?: string;
  };
  quoteToken?: {
    address?: string;
    symbol?: string;
  };
  priceUsd?: string;
  liquidity?: {
    usd?: number;
  };
  fdv?: number;
  marketCap?: number;
  volume?: {
    m5?: number;
    h1?: number;
    h24?: number;
  };
  txns?: {
    m5?: {
      buys?: number;
      sells?: number;
    };
  };
  priceChange?: {
    m5?: number;
    h1?: number;
  };
  pairCreatedAt?: number;
};

export async function scanDexScreener(
  config: BotConfig,
): Promise<MarketCandidate[]> {
  const seeds = await fetchSeeds(config);
  const uniqueSeeds = dedupeSeeds(seeds).slice(
    0,
    Math.max(config.candidateLimit, 1),
  );
  const pairs = await Promise.all(
    uniqueSeeds.map(async (seed) => {
      try {
        return await fetchPairsForSeed(config.dexscreenerBaseUrl, seed);
      } catch {
        return [];
      }
    }),
  );

  const candidates = pairs
    .flat()
    .map((pair) => normalizePair(pair))
    .filter((candidate): candidate is MarketCandidate => Boolean(candidate))
    .filter((candidate) => passesMarketFilters(candidate, config))
    .sort((a, b) => b.score - a.score);

  return dedupeCandidates(candidates).slice(0, config.candidateLimit);
}

function passesMarketFilters(
  candidate: MarketCandidate,
  config: BotConfig,
): boolean {
  const buySellRatio = candidate.buysM5 / Math.max(candidate.sellsM5, 1);

  return (
    candidate.chainId === "solana" &&
    candidate.tokenAddress.length > 30 &&
    candidate.liquidityUsd >= config.minLiquidityUsd &&
    candidate.liquidityUsd <= config.maxLiquidityUsd &&
    candidate.volumeM5Usd >= config.minVolumeM5Usd &&
    candidate.pairAgeMinutes >= config.minAgeMinutes &&
    candidate.pairAgeMinutes <= config.maxAgeHours * 60 &&
    candidate.buysM5 >= config.minBuysM5 &&
    buySellRatio >= config.minBuySellRatioM5
  );
}

async function fetchSeeds(config: BotConfig): Promise<DexTokenSeed[]> {
  if (config.discoveryMode === "watchlist") {
    return config.watchlist.map((tokenAddress) => ({
      chainId: "solana",
      tokenAddress,
      source: "watchlist",
    }));
  }

  const endpoint =
    config.discoveryMode === "top-boosts"
      ? "/token-boosts/top/v1"
      : config.discoveryMode === "latest-boosts"
        ? "/token-boosts/latest/v1"
        : "/token-profiles/latest/v1";
  const data = await fetchJson<DexTokenSeed[]>(
    `${trimSlash(config.dexscreenerBaseUrl)}${endpoint}`,
  );

  return Array.isArray(data)
    ? data
        .filter((item) => item.chainId === "solana" && item.tokenAddress)
        .map((item) => ({ ...item, source: config.discoveryMode }))
    : [];
}

async function fetchPairsForSeed(
  baseUrl: string,
  seed: DexTokenSeed,
): Promise<DexPair[]> {
  if (!seed.chainId || !seed.tokenAddress) {
    return [];
  }

  const url = `${trimSlash(baseUrl)}/token-pairs/v1/${encodeURIComponent(
    seed.chainId,
  )}/${encodeURIComponent(seed.tokenAddress)}`;
  const data = await fetchJson<DexPair[]>(url);

  return Array.isArray(data) ? data : [];
}

function normalizePair(pair: DexPair): MarketCandidate | null {
  const baseAddress = pair.baseToken?.address;

  if (!baseAddress || pair.chainId !== "solana") {
    return null;
  }

  const liquidityUsd = safeNumber(pair.liquidity?.usd);
  const volumeM5Usd = safeNumber(pair.volume?.m5);
  const volumeH1Usd = safeNumber(pair.volume?.h1);
  const volumeH24Usd = safeNumber(pair.volume?.h24);
  const buysM5 = safeNumber(pair.txns?.m5?.buys);
  const sellsM5 = safeNumber(pair.txns?.m5?.sells);
  const priceChangeM5Pct = safeNumber(pair.priceChange?.m5);
  const priceChangeH1Pct = safeNumber(pair.priceChange?.h1);
  const pairAgeMinutes = pair.pairCreatedAt
    ? Math.max(0, (Date.now() - pair.pairCreatedAt) / 60_000)
    : 999_999;
  const reasons: string[] = [];
  const buySellRatio = buysM5 / Math.max(sellsM5, 1);
  const volumeToLiquidity = liquidityUsd > 0 ? volumeM5Usd / liquidityUsd : 0;
  let score = 0;

  score += clamp(Math.log10(Math.max(liquidityUsd, 1)) * 8 - 20, 0, 25);
  score += clamp(volumeToLiquidity * 120, 0, 30);
  score += clamp((buySellRatio - 1) * 14, -18, 24);
  score += clamp(priceChangeM5Pct * 0.45, -22, 18);

  if (pairAgeMinutes >= 8 && pairAgeMinutes <= 180) {
    score += 12;
    reasons.push("fresh");
  } else if (pairAgeMinutes <= 1_440) {
    score += 5;
  }

  if (volumeToLiquidity >= 0.08) {
    reasons.push("active tape");
  }

  if (buySellRatio >= 1.2) {
    reasons.push("buy pressure");
  }

  if (priceChangeM5Pct > 75) {
    score -= 18;
    reasons.push("extended");
  }

  if (sellsM5 > buysM5 * 1.8) {
    score -= 25;
    reasons.push("sell pressure");
  }

  return {
    id: `${pair.chainId}:${baseAddress}`,
    tokenAddress: baseAddress,
    chainId: pair.chainId,
    pairAddress: pair.pairAddress,
    dexId: pair.dexId,
    url: pair.url,
    symbol: pair.baseToken?.symbol || shortAddress(baseAddress),
    name: pair.baseToken?.name || shortAddress(baseAddress),
    quoteSymbol: pair.quoteToken?.symbol,
    quoteAddress: pair.quoteToken?.address,
    priceUsd: safeNumber(pair.priceUsd),
    liquidityUsd,
    marketCapUsd: safeNumber(pair.marketCap),
    fdvUsd: safeNumber(pair.fdv),
    volumeM5Usd,
    volumeH1Usd,
    volumeH24Usd,
    buysM5,
    sellsM5,
    priceChangeM5Pct,
    priceChangeH1Pct,
    pairAgeMinutes,
    source: pair.dexId || "dexscreener",
    score: Math.round(score * 10) / 10,
    reasons,
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
      },
      next: {
        revalidate: 0,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`DexScreener ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

function dedupeSeeds(seeds: DexTokenSeed[]): DexTokenSeed[] {
  const seen = new Set<string>();
  const unique: DexTokenSeed[] = [];

  for (const seed of seeds) {
    const key = `${seed.chainId}:${seed.tokenAddress}`;

    if (!seed.tokenAddress || seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(seed);
  }

  return unique;
}

function dedupeCandidates(candidates: MarketCandidate[]): MarketCandidate[] {
  const seen = new Set<string>();
  const unique: MarketCandidate[] = [];

  for (const candidate of candidates) {
    if (seen.has(candidate.tokenAddress)) {
      continue;
    }

    seen.add(candidate.tokenAddress);
    unique.push(candidate);
  }

  return unique;
}

function trimSlash(value: string): string {
  return value.replace(/\/$/, "");
}

function safeNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function shortAddress(address: string): string {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

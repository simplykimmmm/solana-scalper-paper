import { LAMPORTS_PER_SOL, SOL_MINT } from "./defaults";
import type { BotConfig } from "./types";

export interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold?: string;
  priceImpactPct?: string;
  routePlan?: unknown[];
  contextSlot?: number;
  timeTaken?: number;
}

export async function quoteExactIn(params: {
  config: BotConfig;
  inputMint: string;
  outputMint: string;
  amount: string;
}): Promise<JupiterQuote> {
  const url = new URL(params.config.jupiterQuoteUrl);
  url.searchParams.set("inputMint", params.inputMint);
  url.searchParams.set("outputMint", params.outputMint);
  url.searchParams.set("amount", params.amount);
  url.searchParams.set("slippageBps", String(params.config.slippageBps));
  url.searchParams.set(
    "restrictIntermediateTokens",
    String(params.config.restrictIntermediateTokens),
  );

  const headers: HeadersInit = {
    accept: "application/json",
  };

  if (process.env.JUPITER_API_KEY) {
    headers["x-api-key"] = process.env.JUPITER_API_KEY;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch(url, {
      headers,
      next: {
        revalidate: 0,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Jupiter ${response.status}: ${body.slice(0, 180)}`);
    }

    const quote = (await response.json()) as JupiterQuote;

    if (!quote.outAmount || Number(quote.outAmount) <= 0) {
      throw new Error("Jupiter returned no route.");
    }

    return quote;
  } finally {
    clearTimeout(timeout);
  }
}

export function solToLamportsString(sol: number): string {
  return Math.round(sol * LAMPORTS_PER_SOL).toString();
}

export function lamportsStringToSol(lamports: string | undefined): number {
  if (!lamports) {
    return 0;
  }

  const numeric = Number(lamports);
  return Number.isFinite(numeric) ? numeric / LAMPORTS_PER_SOL : 0;
}

export function conservativeOutAmount(quote: JupiterQuote): string {
  return quote.otherAmountThreshold || quote.outAmount;
}

export function quotePriceImpactPct(quote: JupiterQuote): number {
  const priceImpact = Number(quote.priceImpactPct || 0);
  return Number.isFinite(priceImpact) ? priceImpact * 100 : 0;
}

export { SOL_MINT };

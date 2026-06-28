# Strategy Research Notes

This prototype is paper-only. It deliberately does not hold a private key, build signed transactions, or send real orders.

## Free data path

- Discovery: DexScreener token profiles and boosted-token endpoints.
- Pair facts: DexScreener token-pairs endpoint for liquidity, volume, pair age, transaction count, and recent price change.
- Execution pricing: Jupiter quote endpoint. The prototype uses the conservative `otherAmountThreshold` amount when present, so paper fills are worse than the optimistic quoted `outAmount`.
- Fee model: base signature fee plus configurable priority fee per transaction. Paper PnL subtracts buy and sell fees.

## Default entry filter

- Solana chain only.
- Liquidity between 20,000 and 2,500,000 USD.
- Pair age between 8 minutes and 24 hours.
- Five-minute volume above 2,500 USD.
- At least 8 five-minute buys.
- Five-minute buy/sell ratio at or above 0.9.
- Jupiter buy route must exist.
- Jupiter price impact must be under 1.5%.

## Default exit logic

- Take profit at +8% net PnL after modeled fees.
- Stop loss at -5% net PnL after modeled fees.
- Trailing stop activates after +6% and exits after a 3% pullback from the peak paper PnL.
- Max hold is 20 minutes.

## Upgrade path after paper testing

- Paid RPC: Helius, QuickNode, Triton, or equivalent low-latency Solana RPC.
- Paid quote/risk data: Jupiter Pro, Birdeye, Helius Enhanced Transactions, or dedicated indexer.
- Live execution: dedicated hot wallet only, hard daily loss limits, spend caps, revokeable key management, and manual kill switch.

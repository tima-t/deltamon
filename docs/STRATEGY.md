# Strategy: delta-neutral staked MON

## Position

For every $1 of USDC deployed (after the 5 % idle buffer):

| Leg   | Venue          | What                                     | Earns                   |
| ----- | -------------- | ---------------------------------------- | ----------------------- |
| Long  | Kuru → aPriori | $0.50 buys MON, staked into aprMON       | MON staking rewards     |
| Short | Perpl          | $0.50 collateral backs a $0.50 MON short | funding (when positive) |

Net MON exposure ≈ 0. If MON rises 10 %, the long leg gains $0.05 and the short loses $0.05.
The vault's USDC value changes only with staking rewards, funding, and costs.

## Where 15 % comes from

Target composition (assumptions, to be replaced by realized numbers once live):

| Source          | Annualized                           | Note                                                                 |
| --------------- | ------------------------------------ | -------------------------------------------------------------------- |
| Staking rewards | ~9 %                                 | on the long half → contributes on the full book via LST appreciation |
| Funding         | ~7 %                                 | Perpl funding is hourly (every 8 571 blocks), clamped to ±15 %/h max |
| Costs           | −0.7 %                               | Kuru taker fees, gas, rebalancing slippage                           |
| Performance fee | 10 % of profit above high-water mark |

Numbers are the design target, not a promise. Funding can go negative; staking yield can drop.

## Rebalancing

`DeltaNeutralStrategy.netDeltaBps()` = (long − short) / totalAssets, in bps.

The keeper calls `DeltaVault.rebalance()` when `|delta| ≥ 200 bps` (2 %):

1. `_allocateIdle` — swap USDC→MON on Kuru, stake to aprMON, top up hedge collateral.
2. `_hedgeToNeutral` — grow or shrink the short until `|long − short| ≤ 2 %`.

Withdrawals unwind both legs proportionally (`_unwind`), slightly over-unwinding to absorb rounding and slippage.

## Trust model

| Actor     | Can                                                    | Cannot                                      |
| --------- | ------------------------------------------------------ | ------------------------------------------- |
| Depositor | deposit, withdraw, redeem — any time, even when paused |                                             |
| Keeper    | invest, divest (to vault), rebalance, harvest          | move assets anywhere else                   |
| Guardian  | pause, emergencyExit (everything back to the vault)    | withdraw user funds                         |
| Admin     | set caps/fees, propose strategy (1-day timelock)       | activate a strategy for another vault/asset |

## Open items

- **Perpl execution**: orders go through Perpl's signed API. `PerplHedgeAdapter` records the target short on-chain; the keeper fills it and reports back. Confirm smart-contract-account / order-forwarding flow with Perpl to move execution fully on-chain.
- **aprMON redeem** is asynchronous (unbonding). The 5 % buffer plus hedge-collateral withdrawal cover normal exits; large exits may queue.
- **LST oracle**: compose Chainlink `APRMON/MON × MON/USD` (feeds exist on mainnet) instead of pricing aprMON at MON parity.
- **Fallback hedge**: borrow-and-sell MON on a lending market (Morpho / Euler on Monad) as a second `IHedgeVenue`, fully on-chain.

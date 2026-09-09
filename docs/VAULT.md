# DeltaMonVault

The vault depositors and the admin actually use. USDC in, **sdMON** out, one admin who allocates
and can never leave with anything but the fee.

## Roles

|                     | Can do                                                         | Cannot do                              |
| ------------------- | -------------------------------------------------------------- | -------------------------------------- |
| Depositor           | deposit, redeem, queue a redemption, cancel it, transfer sdMON | nothing else                           |
| Admin, the deployer | swap, stake, Perpl collateral, fee settings, pause             | move any asset out except accrued fees |

The admin surface is a fixed list of named functions. There is no generic call or delegatecall
anywhere in the contract, so no other protocol is reachable even if the admin wants one.

## What the admin can call

| Function                                                                    | Notes                                                   |
| --------------------------------------------------------------------------- | ------------------------------------------------------- |
| `swapUsdcForMon` / `swapMonForUsdc`                                         | Kuru only, floored against Chainlink MON/USD            |
| `swapUsdcForAusd` / `swapAusdForUsdc`                                       | Kuru only, floored against a parity band                |
| `stake` / `unstake`                                                         | Monad's staking precompile, validator commission capped |
| `claimUnstaked` / `claimStakingRewards`                                     | permissionless, funds can only land back in the vault   |
| `perplCreateAccount` / `perplDepositCollateral` / `perplWithdrawCollateral` | Perpl Exchange only                                     |
| `perplAllowOrderForwarding`                                                 | lets Perpl forward the admin's API-signed orders        |
| `reportPerplPnl`                                                            | marks the open position, bounded and time-limited       |
| `withdrawFees`                                                              | the only outbound transfer available to the admin       |

## The performance fee

Charged on profit only, measured against each holder's own entry, so a depositor never pays for
a gain that happened before they arrived. Cost basis is tracked per address and follows sdMON when
it is transferred.

On a deposit of `A` USDC the vault records `costBasis += A`. On an exit of `s` shares by a holder
with balance `B`:

```
basisPortion = costBasis * s / B
gross        = value of s shares, priced before the burn
profit       = max(gross - basisPortion, 0)
fee          = profit * performanceFeeBps / 10000
paid out     = gross - fee
```

The fee is capped at ten percent. Raising it waits one day; lowering it takes effect at once.

## Withdrawals

Redeem instantly whenever idle USDC covers it. Otherwise queue the request. The admin has 36 hours
to make the USDC available. Past that deadline every allocation function freezes, so the admin can
only unwind towards the queue until it clears. Cancelling a queued request returns the shares and
the cost basis untouched.

## How the vault is valued

```
totalAssets = idle USDC
            + all MON (wrapped, native, delegated, unbonding) x Chainlink MON/USD
            + AUSD held
            + Perpl collateral posted +/- reported result
```

Accrued fees are excluded, so the share price never counts money owed to the admin.

Staking rewards are counted only once claimed, which understates value slightly between claims.
That is the safe direction: nobody can mint shares cheaply against a number the vault has not
actually received.

## What was verified against Monad mainnet

Fork tests in `test/fork/DeltaMonMainnetFork.t.sol` drive live contracts.

- A 6,000 USDC swap fills on Kuru's real MON book. A full round trip costs about 0.13 percent.
- The vault delegates to a real validator through the staking precompile. Contracts can stake:
  Magma, aPriori and Kintsu all hold delegations the same way.
- The vault opens its own account on the real Perpl Exchange, turns on order forwarding, and takes
  collateral back out.

## Two live constraints worth knowing

**A fresh delegation only activates at the next epoch boundary.** Unstaking in the same epoch
reverts with `insufficient stake`. Worst case from stake to withdrawable is roughly one epoch to
activate plus one to unbond, so about eleven to seventeen hours. That fits inside the 36 hour
redemption deadline, but the admin should not stake money that is already spoken for.

**AUSD cannot be bought on Kuru today.** Perpl takes AUSD as collateral, and both the direct
AUSD/USDC book and the two hop route through MON revert at every size, down to 50 USDC. The Perpl
leg therefore needs another way to source AUSD before it can run unattended. The swap functions and
the Perpl rails are built and tested, so only the sourcing step is missing.

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

## Can the admin's own key drain the Perpl collateral?

No, and this is tested rather than argued. `test_adminKeyCannotTouchPerplCollateral` opens the
vault's Perpl account on a mainnet fork, turns order forwarding on so the admin is fully authorised
to trade, then has the admin sign a withdrawal straight to Perpl with their own key. It reverts. So
does the same attempt from an unrelated address. The vault then takes the full collateral back,
proving nothing moved.

The reason is structural. Perpl keys an account by `msg.sender`, and its only withdrawal function is
`withdrawCollateral(uint256)`, which takes an amount and no address. There is no source parameter and
no destination parameter, so no caller can name someone else's account. I probed the deployed
implementation for every delegated variant, `withdrawCollateralFor`, `withdrawTo`, `withdrawOnBehalf`,
`setOperator`, `setDelegate`, and none of them exist. The vault created the account, so the vault is
the account. The admin's address is simply a different, empty account.

Both doors are therefore closed:

| Route                                                | Outcome                                      |
| ---------------------------------------------------- | -------------------------------------------- |
| Admin signs a withdrawal on-chain with their own key | reverts, verified on a fork                  |
| Admin uses the Perpl API key                         | withdrawals are never permitted at any scope |

### The risk that does remain

The admin holds a trade-scoped key, so they can place bad orders. Someone acting in bad faith could
trade the vault's position against themselves on Perpl's book and move value out through losses
rather than through a withdrawal. That cannot be bounded on-chain the way swap slippage can, because
orders never touch the chain and the vault only learns the result from `reportPerplPnl`.

Two things limit it today. The reported result is capped against posted collateral, so a large
hidden loss cannot be reported at all and the vault freezes on staleness instead. And the exposure is
never larger than the collateral the admin moved to Perpl in the first place. Capping that collateral
as a fraction of the vault would bound the damage directly, and is worth adding before real money.

## Getting a Perpl API key that only the admin holds

The key is an Ed25519 pair generated on your own machine. Perpl only ever receives the public half,
and the token it hands back is shown once and cannot be re-derived. Nothing about it goes on-chain
or into this repo.

```bash
cp apps/be/.env.example apps/be/.env   # fill the enrolment block
pnpm --filter @deltamon/be perpl:enroll
```

The script generates the pair, asks Perpl for the EIP-712 payload, signs it twice, and enrols. The
first signature is your admin wallet proving it operates the account. The second is made by the new
key over the same digest, proving you hold it. It names the vault as `target_profile`, so the vault
stays the account owner and never has to sign anything.

Two prerequisites come from Perpl rather than from us. They must whitelist the origin you enrol
from, otherwise both endpoints reject the request. And they must accept a contract address as the
target profile, which is the open item noted above.

Enrol with scope 2, which is trade and implies read. Withdrawals are impossible at any scope. Set
`PERPL_IP_CIDRS` to your backend's address so a leaked key is useless from anywhere else, and delete
`PERPL_ENROLL_PRIVATE_KEY` from the environment once enrolment is done.

## Two live constraints worth knowing

**A fresh delegation only activates at the next epoch boundary.** Unstaking in the same epoch
reverts with `insufficient stake`. Worst case from stake to withdrawable is roughly one epoch to
activate plus one to unbond, so about eleven to seventeen hours. That fits inside the 36 hour
redemption deadline, but the admin should not stake money that is already spoken for.

**AUSD cannot be bought on Kuru today.** Perpl takes AUSD as collateral, and both the direct
AUSD/USDC book and the two hop route through MON revert at every size, down to 50 USDC. The Perpl
leg therefore needs another way to source AUSD before it can run unattended. The swap functions and
the Perpl rails are built and tested, so only the sourcing step is missing.

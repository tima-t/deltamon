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

## Perp managers

Because Perpl's on-chain order ABI is undocumented and contract-owned API keys are unconfirmed, the
short leg is run by a person or bot rather than by the contract. The vault no longer holds a Perpl
account of its own: the functions that opened one and moved its collateral were removed once this
route was chosen, since carrying two paths to the same exposure only widened the surface to audit.

| Function                                      | Who     | What it does                                     |
| --------------------------------------------- | ------- | ------------------------------------------------ |
| `controlPerpManagers(manager, allowed)`       | admin   | adds or removes an address from the manager list |
| `sendFundPerpManager(manager, token, amount)` | admin   | sends USDC or AUSD to a listed manager           |
| `perpManagerDeposit(token, amount)`           | manager | returns USDC or AUSD, minting no shares          |
| `setMaxPerpAllocation(bps)`                   | admin   | ceiling on the whole perp book                   |

**Read this part carefully, because it changes the trust model.** `sendFundPerpManager` is a real
transfer to an externally owned address. Once it lands, only that address can move it, and the vault
has no way to claw it back. Every other path in this vault is enforced by code. This one is not, and
rests on trusting the manager.

Four things bound it rather than eliminate it.

- The perp book cannot exceed `maxPerpAllocationBps` of the vault, fifty percent by default, and the
  ceiling is measured after the value leaves so it is never double counted.
- Only USDC and AUSD can be sent. Nothing else in the vault is reachable this way.
- Funding is frozen while the vault is paused and while a redemption request is past its deadline.
- What a manager holds stays on the books as `perpManagerOutstanding`, so the share price keeps
  counting it and the admin has to mark losses through `reportPerpPnl` for the number to fall.

Returns are a repayment of capital, not a subscription. No shares are minted, so anything returned
above what was sent is profit that lands with existing depositors. A manager removed from the list
can still return what they hold, so cutting off a bad actor never strands the funds they have.

## Where the Perpl trust boundary now sits

Worth being exact, because it moved. The vault used to own its Perpl account, and a fork test proved
that neither the admin's key nor a stranger's could withdraw that collateral, since Perpl keys an
account by `msg.sender` and its only withdrawal function takes an amount and no address.

That guarantee no longer applies, because the vault no longer holds Perpl collateral. The manager
does. What protects depositors now is the allocation ceiling, the reporting gate and the freeze rules
above, not the shape of Perpl's contract. That is a weaker guarantee and it should be read as one.

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

One prerequisite is settled and one is not.

Origin whitelisting turned out not to be a blocker. Probing Perpl's testnet endpoint shows that a
request carrying no `Origin` header is accepted and returns a valid payload, while an arbitrary
Origin is rejected with 400. So leave `PERPL_ORIGIN` empty unless Perpl has whitelisted one for you.

Whether Perpl accepts a contract as the `target_profile` is still unverified, and cannot be
determined from outside. The EIP-712 struct they return, `PerplRegisterApiKey`, contains no profile
field at all: it binds the signer, the public key, the scope, the label and the origin. Delegation is
therefore resolved entirely server-side at the enrol step. The only way to settle it is to enrol
against a real account, or to ask them.

### What the docs do and do not say about contract accounts

Perpl uses "Smart Contract Account" to mean the account that lives on the Exchange contract, as
opposed to API authentication. Their own table reads "Exchange Account | On-chain account exists on
Exchange contract with collateral". The phrase is about where the account lives, not who owns it.

Across all seven files in their API documentation there is no mention of EIP-1271, ERC-4337, account
abstraction or contract wallets. The owner is always called a wallet. So the documentation neither
grants nor refuses contract ownership; it simply does not address it.

### A better question to ask them: direct on-chain orders

The same page says twice that the API is not the only way to trade:

> "The flag gates only the forwarded path. An account can still trade by sending its own order
> transactions on-chain; that is out of scope for these docs"

> "It is **not** a prerequisite for trading itself. An account can always transact directly on-chain
> from its own wallet, submitting its own order transactions and paying its own gas, and that path is
> unaffected by the flag."

If the vault can place orders on-chain itself, the API key leaves the trading path completely and the
delegation question stops mattering. The obstacle is only that the ABI for it is undocumented. A scan
of 120 recent blocks found 564 calls to the Exchange using four selectors from ten senders, all of
which look like Perpl's own forwarders, and both public selector databases were unavailable when this
was written.

So the request to Perpl should be, in order of value:

1. The ABI for placing orders directly on-chain.
2. Failing that, confirmation that an EOA operator may enrol a key against a contract `target_profile`.
3. Failing that, whether signature verification goes through a checker that honours EIP-1271, in which
   case the vault can sign its own enrolment and stay the owner.

`getAccountByAddr(address)` is confirmed present on the Exchange and reverts with
`AccountDoesNotExist` for an unknown address, which gives the vault a way to assert its own account
on-chain.

Enrol with scope 2, which is trade and implies read. Withdrawals are impossible at any scope. Set
`PERPL_IP_CIDRS` to your backend's address so a leaked key is useless from anywhere else, and delete
`PERPL_ENROLL_PRIVATE_KEY` from the environment once enrolment is done.

## Pre-mainnet hardening

Four things were found and fixed while reviewing this for a real deployment.

**The venue and the oracle were a drain path.** Both are trusted by the swap code, so an admin who
pointed them at contracts they controlled could have taken the book. Changing either now goes through
`proposeVenue` and waits three days, which is deliberately longer than the redemption deadline so a
depositor who dislikes the proposal can leave first. `cancelVenueChange` withdraws a proposal.

**The vault believed the venue's own report of what it paid.** A swap now measures the balance before
and after and reverts with `VenueShortchanged` if less arrived than the oracle floor demanded. A test
points the vault at a venue that takes the input, delivers nothing and claims success.

**Accrued fees were subtracted from the idle USDC rather than from the whole book.** Once the idle
balance fell below the fee owed, the shortfall silently vanished and every remaining holder's share
price rose. It now comes off `grossAssets`, so deploying the USDC behind a fee changes nothing.

**Topping up a manager refreshed the reporting clock.** That let dust transfers keep a stale mark
alive while deposits and redemptions kept pricing against it. The clock now starts only when the book
goes from empty to funded, where a zero result is true by definition.

Three more came from an independent adversarial review of the same code.

**The reentrancy guard did not cover the swap path.** OpenZeppelin's guard is one shared flag, and it
only blocks reentry into a guarded function if the outer call engaged it. The swaps, staking and
manager funding were unguarded, so a venue that called back into `deposit` mid-swap would have minted
shares against a book that was transiently short the value that had left and had not yet received
what it bought. Not reachable through the current Kuru adapter, which has no callback, but it would
have become reachable the moment the venue changed. Every function that moves a balance around an
external call is now guarded, and a test drives a venue that reenters `deposit` mid-swap.

**A silent admin could trap every depositor.** Exits were gated on a fresh perp mark, so an admin who
simply stopped calling `reportPerpPnl` froze `redeem`, `withdraw` and `claimRedemption` after six
hours, no matter how much idle USDC sat in the vault. The overdue freeze did nothing about it,
because it never gated the exits. Deposits are still gated, since nobody is harmed by being unable to
buy in, but exits now always proceed and price against a conservative mark instead: once the report
goes stale an unconfirmed gain is dropped while a reported loss still counts, so whoever leaves
cannot take more than their share from those who stay.

**A fee cut left a queued rise armed.** Proposing a decrease applied at once but returned early
without clearing a pending increase, so a 10 % rise proposed earlier could still be applied later,
behind a lower headline number and with no fresh announcement. A decrease now cancels the queue.

Separately, the deploy script now sets the oracle staleness window to one hour rather than a day. The
MON/USD feed was measured updating every thirty seconds, so an hour is generous while still refusing
a price that has genuinely gone dark.

## Kuru's MON book is thin on the sell side

Measured on a fork by `test_probeMonRoundTripDepth`, which walks increasing sizes until the book
refuses. Buying MON absorbs more than selling it does.

| Round trip size | Result               | Cost         |
| --------------- | -------------------- | ------------ |
| 250 USDC        | fills                | about 0.07 % |
| 500 USDC        | fills                | about 0.13 % |
| 1000 USDC       | the sell leg reverts |              |

So the admin has to split a large unwind into pieces rather than sending one order, and the deposit
cap should stay in proportion to what the book can actually absorb. This is why the fork tests trade
in hundreds of USDC rather than thousands.

## Two live constraints worth knowing

**A fresh delegation only activates at the next epoch boundary.** Unstaking in the same epoch
reverts with `insufficient stake`. Worst case from stake to withdrawable is roughly one epoch to
activate plus one to unbond, so about eleven to seventeen hours. That fits inside the 36 hour
redemption deadline, but the admin should not stake money that is already spoken for.

**AUSD cannot be bought on Kuru today.** Perpl takes AUSD as collateral, and both the direct
AUSD/USDC book and the two hop route through MON revert at every size, down to 50 USDC. The Perpl
leg therefore needs another way to source AUSD before it can run unattended. The swap functions and
the Perpl rails are built and tested, so only the sourcing step is missing.

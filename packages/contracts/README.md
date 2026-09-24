# @deltamon/contracts

Foundry project. Solidity 0.8.28, OpenZeppelin 5.

| Contract                                  | Role                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| `src/DeltaMonVault.sol`                   | The live vault: USDC in, sdMON out, multisig admin, keeper. See docs/VAULT.md |
| `src/adapters/KuruSpotAdapter.sol`        | Spot swaps: Kuru `anyToAnySwap`, or a StableSwap pool per pair (AUSD)        |
| `src/oracles/ChainlinkOracle.sol`         | Chainlink adapter with LST/MON × MON/USD chaining                              |
| `src/SdMonVault.sol`                      | Earlier automatic 60/40 variant, kept for reference                            |
| `src/DeltaVault.sol`                      | Earlier ERC-4626 vault with a pluggable strategy, kept for reference           |
| `src/strategies/DeltaNeutralStrategy.sol` | Long staked MON + equal short; rebalances to neutral (DeltaVault's strategy)   |
| `src/adapters/AprioriStakingAdapter.sol`  | MON → aprMON (async redeem)                                                    |
| `src/adapters/PerplHedgeAdapter.sol`      | Short target on-chain, execution via Perpl API, keeper reports back            |
| `src/oracles/PythOracle.sol`              | Pyth pull-oracle adapter                                                       |

```bash
forge build
forge test -vvv                                                          # unit tests (mock venues)
RUN_FORK_TESTS=true forge test --match-contract DeltaMonMainnetFork -vv  # real Kuru, Chainlink, staking
forge fmt
cp .env.example .env   # then fill PRIVATE_KEY, VAULT_OWNER, KEEPER_ADDRESS
forge script script/DeployDeltaMon.s.sol:DeployDeltaMon --rpc-url monad --broadcast --private-key $PRIVATE_KEY
```

After deploying, have the multisig call `acceptOwnership()` on the vault. Then run `pnpm abi:sync` from the repo root
to refresh the ABIs in `@deltamon/shared`, and copy the addresses from `deployments/deltamon-<chainId>.json` into
`packages/shared/src/deployments.ts`.

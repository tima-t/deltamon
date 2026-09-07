# @deltamon/contracts

Foundry project. Solidity 0.8.28, OpenZeppelin 5.

| Contract                                  | Role                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| `src/DeltaVault.sol`                      | ERC-4626 vault. Roles: admin (timelocked strategy swap), keeper, guardian |
| `src/strategies/DeltaNeutralStrategy.sol` | Long staked MON + equal short; rebalances to neutral                      |
| `src/adapters/KuruSpotAdapter.sol`        | Spot swaps via Kuru router `anyToAnySwap`                                 |
| `src/adapters/AprioriStakingAdapter.sol`  | MON → aprMON (async redeem)                                               |
| `src/adapters/PerplHedgeAdapter.sol`      | Short target on-chain, execution via Perpl API, keeper reports back       |
| `src/oracles/PythOracle.sol`              | Pyth pull-oracle adapter                                                  |
| `src/oracles/ChainlinkOracle.sol`         | Chainlink adapter with LST/MON × MON/USD chaining                         |

```bash
forge build
forge test -vvv                                                     # unit tests (mock venues)
RUN_FORK_TESTS=true forge test --match-contract KuruMainnetFork -vv # real Kuru + Chainlink on a mainnet fork
forge fmt
cp .env.example .env   # then fill ADMIN / PRIVATE_KEY
forge script script/DeploySdMon.s.sol:DeploySdMon --rpc-url monad --broadcast --private-key $PRIVATE_KEY
```

After deploying, run `pnpm abi:sync` from the repo root to refresh the ABIs in `@deltamon/shared`, and copy the
addresses from `deployments/sdmon-<chainId>.json` into `packages/shared/src/deployments.ts`.

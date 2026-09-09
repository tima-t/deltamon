# DeltaMon

Automated, non-custodial delta-neutral vaults on [Monad](https://monad.xyz). Deposit USDC; the vault holds staked MON and an equal-sized short. Price moves cancel out, staking rewards and funding payments stay. Target 15 % net APY.

Built for [**Monad Metropolis**](https://hackathon.monad.xyz/) (1 Sep – 13 Oct 2026), track _Onchain Finance & Trading_.

## How it works

```
USDC ──▶ DeltaVault (ERC-4626) ──▶ DeltaNeutralStrategy
                                       ├─ long  : USDC → MON (Kuru) → aprMON (aPriori)   earns staking yield
                                       └─ short : USDC collateral → MON-PERP short (Perpl) earns funding
                                    keeper: rebalance() when |net delta| ≥ 2 %
```

- **Non-custodial.** Shares are ERC-4626; withdrawals work at any time, even when paused. The keeper can only invest, rebalance and harvest. Strategy changes are timelocked one day and unwind the old strategy first.
- **Delta-neutral.** `netDeltaBps()` is computed on-chain from oracle prices; the keeper re-hedges past a 2 % drift.
- **Transparent yield.** The UI shows staking, funding and cost components separately. Numbers are estimates until realized.

Details: [docs/STRATEGY.md](docs/STRATEGY.md) · Submission plan: [docs/SUBMISSION.md](docs/SUBMISSION.md)

## Repository

Turborepo + pnpm workspaces.

| Path                         | What                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| `apps/fe`                    | Next.js 16 + Tailwind 4 + wagmi 2 + RainbowKit. Vault dashboard and deposit flow      |
| `apps/be`                    | Node.js (Fastify 5). API for vault stats and a keeper that calls `rebalance()`        |
| `packages/contracts`         | Foundry. `DeltaVault`, `DeltaNeutralStrategy`, venue adapters, oracle adapters, tests |
| `packages/shared`            | Chains, third-party addresses, ABIs, zod schemas shared by FE and BE                  |
| `packages/typescript-config` | Base tsconfigs                                                                        |

## Stack

**On-chain (ours):** Solidity 0.8.28, Foundry, OpenZeppelin 5 (ERC-4626, AccessControl, Pausable, ReentrancyGuard).

**On-chain (third-party, Monad mainnet):**

| Protocol         | Used for                                    | Address                                      |
| ---------------- | ------------------------------------------- | -------------------------------------------- |
| Kuru             | Spot swaps via CLOB router (`anyToAnySwap`) | `0xd651346d7c789536ebf06dc72aE3C8502cd695CC` |
| aPriori          | Liquid staking (aprMON)                     | `0x0c65A0BC65a5D819235B71F554D210D3F80E0852` |
| Perpl            | MON perpetual short (AUSD collateral)       | `0x34B6552d57a35a1D042CcAe1951BD1C370112a6F` |
| Pyth             | MON/USD, USDC/USD pull oracle               | `0x2880aB155794e7179c9eE2e38200202908C17B43` |
| Chainlink        | aprMON/MON, sMON/MON rate feeds             | see `packages/shared/src/addresses.ts`       |
| Aave V3 / Morpho | candidate lending legs                      | see `packages/shared/src/addresses.ts`       |

Full address book for mainnet (143) and testnet (10143): [`packages/shared/src/addresses.ts`](packages/shared/src/addresses.ts).

**Off-chain:** TypeScript, viem, wagmi, RainbowKit, TanStack Query, Fastify, pino, zod, vitest, Turborepo.

## Getting started

Prerequisites: Node 22, pnpm 11 (`corepack enable`), [Foundry](https://getfoundry.sh) (`curl -L https://foundry.paradigm.xyz | bash && foundryup`).

```bash
git clone --recurse-submodules https://github.com/tima-t/deltamon
cd deltamon
pnpm install

# contracts
pnpm contracts:build
pnpm contracts:test
# real Kuru swap on a Monad mainnet fork
cd packages/contracts && RUN_FORK_TESTS=true forge test --match-contract KuruMainnetFork -vv

# apps (frontend :3000, backend :4000)
cp apps/be/.env.example apps/be/.env
cp apps/fe/.env.example apps/fe/.env.local
pnpm dev
```

Other commands: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm abi:sync` (after contract changes).

## Deploying

```bash
cd packages/contracts
cp .env.example .env            # ADMIN, PRIVATE_KEY (mainnet addresses are pre-filled)
forge script script/DeployDeltaMon.s.sol:DeployDeltaMon --rpc-url monad --broadcast --private-key $PRIVATE_KEY
```

Then copy the addresses from `packages/contracts/deployments/deltamon-<chainId>.json` into `packages/shared/src/deployments.ts`, run `pnpm abi:sync`, and set `VAULT_ADDRESS` (backend) / `NEXT_PUBLIC_VAULT_ADDRESS` (frontend).

The v1 vault targets **Monad mainnet** with a small deposit cap: the Monad testnet Kuru MON/USDC market has no liquidity and the testnet WMON address in the registry has no code, so a testnet deployment cannot swap.

Monad networks: mainnet chain id 143, RPC `https://rpc.monad.xyz`, explorer [monadvision.com](https://monadvision.com). Testnet chain id 10143, RPC `https://testnet-rpc.monad.xyz`, explorer [testnet.monadexplorer.com](https://testnet.monadexplorer.com), faucet [faucet.monad.xyz](https://faucet.monad.xyz).

## Status

- [x] Monorepo, CI, shared address book
- [x] **`DeltaMonVault`**: two roles, admin-directed Kuru swaps, native staking, Perpl collateral rails, redemption queue with a 36 h deadline, profit-only fee on a per-depositor basis — 33 unit tests + 5 mainnet fork tests
- [x] `SdMonVault`: earlier variant that split every deposit 60/40 automatically, kept for reference
- [x] `KuruSpotAdapter` (native-MON aware, direction derived from market params), Chainlink + Pyth oracle adapters
- [x] Backend API + keeper loop, frontend dashboard + deposit / redeem flow (demo data until deployed)
- [x] v2 `DeltaVault` + `DeltaNeutralStrategy` (hedged) with mock-venue tests, not wired yet
- [ ] Capped mainnet deployment of v1, addresses into `packages/shared`
- [ ] Perpl hedge leg (API-signed orders; confirm on-chain account flow with the Perpl team)
- [ ] Demo video and project profile

## Risks

sdMON moves with the MON price until the admin opens the offsetting short on Perpl. Kuru is a third-party venue (slippage-guarded). The oracle is Chainlink MON/USD (staleness-guarded). DeltaMon contracts are new and unaudited; deposit caps apply. See [docs/STRATEGY.md](docs/STRATEGY.md).

## License

MIT

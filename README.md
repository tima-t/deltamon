# DeltaMon

DeltaMon is a USDC vault on [Monad](https://monad.xyz) that holds MON and allocates capital to a manager-run MON short. It targets low net MON exposure while seeking staking and funding returns. Exposure, returns, and the short are not guaranteed: the short is controlled and reported by an external manager, and capital sent to that manager leaves the vault's direct custody.

Built for [**Monad Metropolis**](https://hackathon.monad.xyz/) (1 Sep – 13 Oct 2026), track _Onchain Finance & Trading_.

**Live on Monad mainnet** (chain id 143):

| Contract                    | Address                                                                                                                    |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `DeltaMonVault` (sdMON)     | [`0x9165D1698B7Bd11E702a36874c3047331B7fA213`](https://monadvision.com/address/0x9165D1698B7Bd11E702a36874c3047331B7fA213) |
| `KuruSpotAdapter`           | [`0xCedB2Fb595a748e19172aa8B7261F6976C49f170`](https://monadvision.com/address/0xCedB2Fb595a748e19172aa8B7261F6976C49f170) |
| `ChainlinkOracle` (MON/USD) | [`0xb606682137e747D8E79398870407E60A5C603611`](https://monadvision.com/address/0xb606682137e747D8E79398870407E60A5C603611) |

Deployed at block 107,645,440. The oracle and swap adapter renounced ownership at deploy, so their
feeds and markets are fixed for good; changing either means a new vault. Source of truth:
[`packages/shared/src/deployments.ts`](packages/shared/src/deployments.ts).

## How it works

```
USDC ──▶ DeltaMonVault (ERC-4626) ──▶ MON held and staked
                   │                 └─ idle USDC / AUSD
                   ├─ capital sent to a listed perp manager ──▶ manager-run MON short
                   └─ sdMON shares to the depositor
```

- **Measured exposure.** The public Balance Engine compares the vault's onchain MON value with a fresh, manager-reported short notional. It shows “within target” only inside a ±2% net exposure band. A missing or stale report is shown as unknown.
- **Visible trust boundary.** The vault cannot claw back capital sent to a perp manager. Allocation caps and delayed changes limit this risk; they do not remove it. See [docs/VAULT.md](docs/VAULT.md).
- **Exit path.** Holders can redeem from idle USDC or queue a redemption. If the admin has not funded a queued exit within 36 hours, vault allocation actions freeze until the queue clears.
- **Historical accounting.** A read-only backend collector backfills actual Perpl funding and fill fees, then records vault holdings and share value every five minutes. MON staking income is estimated from recorded stake and an explicitly configured APY. See [docs/ACCOUNTING.md](docs/ACCOUNTING.md) for setup and the `/api/vault/history` endpoint.

Details: [docs/STRATEGY.md](docs/STRATEGY.md) · Submission plan: [docs/SUBMISSION.md](docs/SUBMISSION.md)

## Repository

Turborepo + pnpm workspaces.

| Path                         | What                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| `apps/fe`                    | Next.js 16 + Tailwind 4 + wagmi 2 + RainbowKit. Vault dashboard and deposit flow   |
| `apps/be`                    | Fastify 5. Vault stats API, accounting collector, keeper and automation pipeline   |
| `packages/contracts`         | Foundry. `DeltaMonVault` (deployed), venue and oracle adapters, v2 strategy, tests |
| `packages/shared`            | Chains, third-party addresses, ABIs, zod schemas shared by FE and BE               |
| `packages/typescript-config` | Base tsconfigs                                                                     |

## Stack

**On-chain (ours):** Solidity 0.8.28, Foundry, OpenZeppelin 5 (ERC-4626, AccessControl, Pausable, ReentrancyGuard).

**Integrations:**

| Protocol         | Used for                                                       | Where                                                                                                                      |
| ---------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Kuru             | Spot USDC ⇄ MON swaps via CLOB router (`anyToAnySwap`)         | [`0xd651346d7c789536ebf06dc72aE3C8502cd695CC`](https://monadvision.com/address/0xd651346d7c789536ebf06dc72aE3C8502cd695CC) |
| Perpl            | Manager-run MON perpetual short, AUSD collateral               | [`0x34B6552d57a35a1D042CcAe1951BD1C370112a6F`](https://monadvision.com/address/0x34B6552d57a35a1D042CcAe1951BD1C370112a6F) |
| Chainlink        | MON/USD price feed behind the deployed oracle                  | [`0xBcD78f76005B7515837af6b50c7C52BCf73822fb`](https://monadvision.com/address/0xBcD78f76005B7515837af6b50c7C52BCf73822fb) |
| Monad staking    | Native MON delegation and rewards                              | precompile `0x0000000000000000000000000000000000001000`                                                                    |
| Mera             | Passkey wallets — onboard and recover without a seed phrase    | `@category-labs/mera`, `apps/fe/src/lib/meraConnector.ts`                                                                  |
| Aurora Intents   | Cross-chain USDC deposits from other EVM chains into the vault | server-side API, `apps/fe/src/app/api/crosschain/`                                                                         |
| Pyth             | MON/USD, USDC/USD pull oracle — adapter built, not wired in v1 | [`0x2880aB155794e7179c9eE2e38200202908C17B43`](https://monadvision.com/address/0x2880aB155794e7179c9eE2e38200202908C17B43) |
| aPriori          | Liquid staking (aprMON) — adapter built for v2, unused in v1   | `0x0c65A0BC65a5D819235B71F554D210D3F80E0852`                                                                               |
| Aave V3 / Morpho | Candidate lending legs, not wired                              | see `packages/shared/src/addresses.ts`                                                                                     |

Kuru, Perpl, Chainlink and Monad staking are wired into the deployed v1 vault. Mera and Aurora
Intents are frontend paths, each behind its own flag (`NEXT_PUBLIC_PASSKEY_ENABLED`,
`AURORA_CROSSCHAIN_ENABLED`), both off by default. Full address book for mainnet (143) and testnet
(10143): [`packages/shared/src/addresses.ts`](packages/shared/src/addresses.ts).

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

## Risks

sdMON moves with the MON price until the admin opens the offsetting short on Perpl. Kuru is a third-party venue (slippage-guarded). The oracle is Chainlink MON/USD (staleness-guarded). DeltaMon contracts are new and unaudited; deposit caps apply. See [docs/STRATEGY.md](docs/STRATEGY.md).

## License

MIT

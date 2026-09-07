# DeltaMon — working notes for agents

Turborepo + pnpm monorepo. Node 22, pnpm 11 (`corepack enable`), Foundry for Solidity.

- `apps/fe` — Next.js 16 App Router, Tailwind 4, wagmi 2 + RainbowKit. Read `apps/fe/AGENTS.md` before touching Next APIs.
- `apps/be` — Fastify 5 API + keeper (viem). ESM, NodeNext resolution: relative imports need `.js`.
- `packages/contracts` — Foundry (via-IR). `forge build && forge test`; fork tests need `RUN_FORK_TESTS=true`. Run `pnpm abi:sync` after changing contract interfaces. Never run prettier inside this package (it walks the vendored `lib/` submodules); use `forge fmt`.
- `packages/shared` — chains, addresses, zod schemas, ABIs. Both apps import from here; it must build first (`turbo` handles order).

Conventions: pnpm scripts through turbo (`pnpm build|lint|typecheck|test`), contracts via `pnpm contracts:build|contracts:test`.
Never commit `.env*` (only `.env.example`). Keep third-party addresses in `packages/shared/src/addresses.ts` only.

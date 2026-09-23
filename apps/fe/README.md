# @deltamon/fe

Next.js 16 (App Router) + Tailwind 4 + wagmi 2 + RainbowKit.

```bash
cp .env.example .env.local
pnpm dev   # http://localhost:3000
```

The page renders labelled demo data until `NEXT_PUBLIC_API_URL` points at a running backend and a vault
address is configured (`NEXT_PUBLIC_VAULT_ADDRESS` or `packages/shared/src/deployments.ts`).
Browser-injected wallets work without `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`. Set a valid
Reown project ID to also offer WalletConnect QR wallets; an empty ID disables that option.

## Cross-chain deposits

Add `AURORA_INTENTS_API_KEY` to `apps/fe/.env.local` or `apps/fe/.env`. The key is used only by the Next.js server. The feature is off by default. Run `node apps/fe/scripts/probe-aurora.mjs` from the repository root to dry-run Base USDC → Monad USDC with the fixed vault approval and deposit steps. This checks Aurora's live quote and step construction but sends no funds.

For a small local acceptance deposit, temporarily set `AURORA_CROSSCHAIN_ENABLED=true` and use a funded EOA. Keep the production flag off until the source transfer settles, the vault `Deposit` event appears, and sdMON reaches that same wallet. The panel shows supported EVM USDC balances, quotes, and settlement. A failed operation or residual USDC can be recovered to the same wallet on Monad with an Aurora steps-only transfer. The same source picker also offers a direct Monad deposit when that wallet holds Monad USDC.

Aurora's `quote.minAmountOut` is already net of its destination execution fee. The next routed deposit includes any USDC already in the wallet's Monad intermediary account in the fixed, signed vault call. The review shows that amount; it is rechecked before creating the execution. Positive slippage can still leave a new small remainder, which can join a later routed deposit or be withdrawn with a separate authorized transfer.

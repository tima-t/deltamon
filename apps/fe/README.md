# @deltamon/fe

Next.js 16 (App Router) + Tailwind 4 + wagmi 2 + RainbowKit.

```bash
cp .env.example .env.local
pnpm dev   # http://localhost:3000
```

The page renders labelled demo data when the backend has no vault address configured. If the backend
cannot be reached, the dashboard shows an unavailable state rather than substituting demo figures.
Set `NEXT_PUBLIC_API_URL` for the backend, and `NEXT_PUBLIC_SITE_URL` to the public production origin
so the 1200 × 630 social image resolves correctly. Wallet actions use `NEXT_PUBLIC_VAULT_ADDRESS` or
the shared deployment address.
Browser-injected wallets work without `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`. Set a valid
Reown project ID to also offer WalletConnect QR wallets; an empty ID disables that option.

## Passkey wallets

Set `NEXT_PUBLIC_PASSKEY_ENABLED=true` to show Mera passkey onboarding on `app.deltamon.xyz` or
`localhost`. Other hosts cannot create or access DeltaMon passkeys. Keep the public flag off until a
small funded passkey deposit and exit have been checked end to end. Mera currently requires a
PRF-capable passkey provider; the UI offers the existing wallet path when PRF is unavailable.

Each passkey derives its own EOA at `m/44'/60'/0'/0/0`. It does not unlock an existing wallet or move
an existing vault position. The browser stores only the passkey credential metadata and public
address. Signing requests reverify the passkey and release the in-memory key after each signature.
The account menu offers an optional 24-word recovery phrase export. Losing the passkey without a
synced copy or saved phrase can mean losing access to the wallet. Avoid changing the public passkey
hostname after users fund accounts.

A new passkey account needs USDC and native gas on Monad for a direct deposit, or USDC and source
chain gas for an enabled Aurora route. The deposit area shows the receiving address, QR code, USDC
contract, gas balance, and refresh control. Cross-chain deposits retain the existing
`AURORA_CROSSCHAIN_ENABLED` gate and must pass a separate funded acceptance run before activation.

## Cross-chain deposits

Add `AURORA_INTENTS_API_KEY` to `apps/fe/.env.local` or `apps/fe/.env`. The key is used only by the Next.js server. The feature is off by default. Run `node apps/fe/scripts/probe-aurora.mjs` from the repository root to dry-run Base USDC → Monad USDC with the fixed vault approval and deposit steps. This checks Aurora's live quote and step construction but sends no funds.

For a small local acceptance deposit, temporarily set `AURORA_CROSSCHAIN_ENABLED=true` and use a funded EOA. Keep the production flag off until the source transfer settles, the vault `Deposit` event appears, and sdMON reaches that same wallet. The panel shows supported EVM USDC balances, quotes, and settlement. A failed operation or residual USDC can be recovered to the same wallet on Monad with an Aurora steps-only transfer. The same source picker also offers a direct Monad deposit when that wallet holds Monad USDC.

Aurora's `quote.minAmountOut` is already net of its destination execution fee. The next routed deposit includes any USDC already in the wallet's Monad intermediary account in the fixed, signed vault call. The review shows that amount; it is rechecked before creating the execution. Positive slippage can still leave a new small remainder, which can join a later routed deposit or be withdrawn with a separate authorized transfer.

# @deltamon/fe

Next.js 16 (App Router) + Tailwind 4 + wagmi 2 + RainbowKit.

```bash
cp .env.example .env.local
pnpm dev   # http://localhost:3000
```

The page renders labelled demo data until `NEXT_PUBLIC_API_URL` points at a running backend and a vault
address is configured (`NEXT_PUBLIC_VAULT_ADDRESS` or `packages/shared/src/deployments.ts`).

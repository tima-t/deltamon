# Monad Metropolis — submission checklist

Hackathon: https://hackathon.monad.xyz/ · Build window 1 Sep – 13 Oct 2026 · Judging 14–27 Oct · Winners 3 Nov.

Track: **Onchain Finance & Trading**. Sponsor bounties worth targeting: **Kuru** (spot routing), **Privy / Dynamic** (embedded wallets for non-crypto users).

Required: "a working product with a public project profile: a demo, a short write-up, and a link to the code." Judges must be able to verify what was built during the six weeks.

- [ ] Contracts deployed on Monad (testnet first, mainnet with a deposit cap) — addresses in `packages/shared/src/deployments.ts`
- [ ] Contracts verified on MonadVision / Monadscan
- [ ] Frontend deployed (Vercel) and pointing at a hosted backend
- [ ] Keeper running against the deployed vault (dry-run log or tx history to show)
- [ ] 2–3 minute demo video: deposit → rebalance → price move → withdraw
- [ ] Short write-up (problem, mechanism, what's on-chain, what's next)
- [ ] Project profile on hackathon.monad.xyz with repo link
- [ ] README explains trust model and risks plainly

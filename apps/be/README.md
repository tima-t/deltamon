# @deltamon/be

Node.js backend for DeltaMon. Two responsibilities:

1. **API** (Fastify) — serves vault stats, APY breakdown, funding rates and oracle prices to the frontend.
2. **Keeper** — runs DeltaMonVault's upkeep. It marks the perp book from the managers' feed (`PERP_BOOK_URL`), claims staking rewards and matured unbonding MON, advances the redemption queue, and settles queued redemptions oldest first as the idle USDC allows. It holds the vault's keeper role, which can mark the book inside the band and claim rewards and nothing else. What only the admin can fix, such as an overdue queue, an oracle outage or a loss past the band, is raised as an alert on `GET /api/keeper`.

```bash
cp .env.example .env
pnpm dev            # API on :4000 (keeper off unless KEEPER_ENABLED=true)
pnpm keeper         # keeper only
pnpm test
```

| Route                      | Description                                      |
| -------------------------- | ------------------------------------------------ |
| `GET /health`              | RPC reachability, keeper status                  |
| `GET /api/vault`           | TVL, price per share, APY breakdown, delta, legs |
| `GET /api/vault/apy`       | APY breakdown only                               |
| `GET /api/keeper`          | Keeper status (last run, last action, alerts)    |
| `GET /api/markets/funding` | Perpl funding snapshots per market               |
| `GET /api/prices/:symbol`  | Pyth price via Hermes (`MON-USD`, `USDC-USD`, …) |

Without `VAULT_ADDRESS` the API returns clearly-labelled demo data (`source: "demo"`) so the frontend can be developed before contracts are deployed.

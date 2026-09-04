# @deltamon/be

Node.js backend for DeltaMon. Two responsibilities:

1. **API** (Fastify) — serves vault stats, APY breakdown, funding rates and oracle prices to the frontend.
2. **Keeper** — watches the vault's net delta and calls `rebalance()` when it drifts past the threshold. It holds `KEEPER_ROLE` only and can never withdraw user funds.

```bash
cp .env.example .env
pnpm dev            # API on :4000 (keeper off unless KEEPER_ENABLED=true)
pnpm keeper         # keeper only
pnpm test
```

| Route                      | Description                                         |
| -------------------------- | --------------------------------------------------- |
| `GET /health`              | RPC reachability, keeper status                     |
| `GET /api/vault`           | TVL, price per share, APY breakdown, delta, legs    |
| `GET /api/vault/apy`       | APY breakdown only                                  |
| `GET /api/keeper`          | Keeper status (last run, last action, dry-run flag) |
| `GET /api/markets/funding` | Perpl funding snapshots per market                  |
| `GET /api/prices/:symbol`  | Pyth price via Hermes (`MON-USD`, `USDC-USD`, …)    |

Without `VAULT_ADDRESS` the API returns clearly-labelled demo data (`source: "demo"`) so the frontend can be developed before contracts are deployed.

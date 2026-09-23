# @deltamon/be

Node.js backend for DeltaMon. Two responsibilities:

1. **API** (Fastify) — serves vault stats, APY breakdown, funding rates and oracle prices to the frontend.
2. **Keeper** — runs DeltaMonVault's upkeep. It marks the perp book from the managers' feed (`PERP_BOOK_URL`), claims staking rewards and matured unbonding MON, advances the redemption queue, and settles queued redemptions oldest first as the idle USDC allows. It holds the vault's keeper role, which can mark the book inside the band and claim rewards and nothing else. What only the admin can fix, such as an overdue queue, an oracle outage or a loss past the band, is raised as an alert on `GET /api/keeper`.

## Manager position report

The external manager bot publishes a JSON document at `PERP_BOOK_URL`. `equity` and `shortNotional` are unsigned decimal strings in six-decimal USDC units; `asOf` is a Unix timestamp in seconds. For example, `{"equity":"40000000000","shortNotional":"60000000000","asOf":1780000000}` describes $40,000 of book equity and a $60,000 MON short. The bot may omit `shortNotional` during migration; the keeper still uses `equity`, while the public Balance Engine shows hedge data unavailable.

`GET /api/vault` reads the vault's MON value onchain and the manager's short size from this feed. It computes `(MON value - short notional) / vault value` in basis points. The UI presents a measured neutral status only when the report is no more than five minutes old. The manager controls and reports the short offchain, so this status is a fresh manager report, not an onchain proof of the short.

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

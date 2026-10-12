# Historical vault accounting

The backend runs a read-only collector every five minutes. It backfills the configured Perpl
account's actual events and records current vault observations in MongoDB. It never trades,
claims staking rewards, or reads validator reward history. The main page's Field record uses
`/api/vault/history` for cumulative vault return in percent, capital composition,
and supporting daily staking/funding income in USD.

## Setup

Set `VAULT_ADDRESS`, `MONGO_CONNECTION_STRING`, and the existing `PERPL_API_KEY` /
`PERPL_API_KEY_SECRET`. The collector starts automatically with the backend; `ACCOUNTING_ENABLED=false`
disables it. No admin or keeper signing key is required.

- `ACCOUNTING_STAKING_APY_BPS=1200` means an assumed effective annual staking APY of **12%**.
  The rate is saved with each observation. Changing the setting affects future estimates only.
  An unset rate leaves the staking estimate unavailable.
- `ACCOUNTING_INTERVAL_MS=300000` controls cadence (one minute to one hour).
- `ACCOUNTING_PERPL_ACCOUNT_ID` selects a dedicated vault account when a profile has multiple
  accounts. A sole account is selected automatically. The enrolled profile must match the vault,
  `PERP_MANAGER_ADDRESS`, or a configured `PERPL_MANAGERS` address unless an explicit
  `ACCOUNTING_PERPL_PROFILE` is supplied.
- `ACCOUNTING_HISTORY_FROM` optionally excludes account activity before an ISO timestamp.
  Set it before the first collection. The persisted profile, account, instance, market, and
  history boundary prevent silently combining different accounts' histories.
- `ACCOUNTING_HISTORY_PAGES_PER_TICK=10` bounds work per stream per tick. Each page has up to
  100 records. An unfinished scan resumes on the next tick or after a restart.

Use a dedicated vault account: selecting MON events from a manager's personal account cannot
prove those events belong to the vault. The existing single-replica backend deployment applies.

One manual collection, without starting the automation runner:

```bash
pnpm --filter @deltamon/be accounting:sync
```

## Stored records

| Collection                        | Records                                                                                                                       |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `accounting_vault_snapshots`      | Pinned current block, holdings, gross/net assets, supply, share value, booked short equity and freshness, assumed staking APY |
| `accounting_perpl_events`         | Raw account/position/fill audit records and exact integer funding, fee and realised PnL amounts                               |
| `accounting_funding_observations` | Current open funding accrual, position inputs, market scales and short notional                                               |
| `accounting_state`                | Immutable account binding and durable pagination state for each history stream                                                |

Events are deduplicated by their immutable transaction/log/account/position/event identity.
A page's events must be stored before its cursor advances. Every completed sweep then starts
again at the newest page, stopping at the previous head. The coverage watermark is the sweep's
start, so a long backfill never claims coverage of events that arrived while it was running.
Individual streams and vault observations continue when another source fails.

## What the numbers mean

**Vault return** compares recorded contract `pricePerShare()` values within the requested window.
Deposits do not count as income. Zero supply starts a new return segment, and stale short-book
reports suppress the return reading. This is contract book value; it is not a depositor's
personal return after their redemption fee. Virtual staking income never modifies this NAV.

**Settled funding** comes from Perpl position-event `fnd` values and account funding movements
(`et=8`). Funding may settle when a position is increased or otherwise changed. Matching
account and position records for the same position/log are reconciled to avoid double counting.
Account `a` includes its fee, so `a + f` restores gross funding. Raw signed integer amounts are
preserved; negative funding remains negative. An unattributed funding event makes MON funding
unavailable for that day rather than silently treating it as zero.

**Observed funding** adds settlements between two observations to the change in unpaid position
funding. Unpaid funding uses each position's side, size and entry funding sum against the market
funding sum. This prevents a settlement reset from appearing as lost income. Future scheduled
market funding is excluded. This series begins with collection; settlements can be backfilled.
The measured delta belongs to the closing observation's UTC day, with covered seconds included.

**Trading fees** come only from fills, including builder fees and negative rebates. Account and
position fees are not added again. Realised price PnL is recorded separately from funding.

**Estimated staking** uses the previous observation's recorded staked MON and assumed APY:

```text
MON estimate = staked MON × ((1 + APY)^(elapsed seconds / (365 × 86400)) − 1)
USD estimate = MON estimate × recorded MON/USD price
```

The interval is split across UTC days. This is an approximation using the vault's staked-MON
bookkeeping, including any activation delay; it does not verify earned or claimable rewards.
It requires no staking reward or archive-state RPC reads. Historical stake and valuation data
begin when the collector starts, rather than being inferred from today's balances.

**Capital in use** is the time-weighted recorded MON holdings value plus booked short equity.
Idle USDC/AUSD and short notional are excluded. It is only available across fresh book reports.
`strategyIncomeEstimatedUsd` combines observed funding and estimated staking over available
intervals. It excludes price PnL and fees and is not a full-vault return. Do not divide incomplete
income by today's capital and label it cumulative return.

**Composition** is gross asset value: idle USDC, idle AUSD, total MON holdings, and booked short
equity. MON holdings include staked, idle and unstaking MON. Accrued fees are a separate liability;
short notional is exposure and must never be used as a pie slice of capital.

Venue field definitions: [Perpl REST endpoints](https://github.com/PerplFoundation/api-docs/blob/main/rest-endpoints.md)
and [Perpl data types](https://github.com/PerplFoundation/api-docs/blob/main/types.md).

## API and gaps

- `GET /api/vault/history?days=30` returns daily UTC projections, the latest snapshot,
  composition, source labels, and backfill/coverage metadata. `days` accepts 1–90.
- `GET /api/vault/history/status` returns collector configuration, last run, and generic source
  errors without credentials or raw upstream responses.

Unknown values are `null`. A confirmed, fully scanned day without settlement or fill records can
be zero. Each income series reports covered seconds; current days and incomplete observation
days are `partial`. Intervals longer than three collection periods are gaps, not interpolated
earnings. Storage failures return HTTP 503. Raw venue audit records stay server-side.

The UI offers 7D/30D periods and synchronized pointer/keyboard date inspection. The headline
and cumulative chart are labeled “Cumulative vault return,” measured by recorded change in
value per sdMON share in percent, using the first
valid observation within the selected window (or since the last empty-vault restart). Starting
and latest share values are shown. This is contract book-value performance, not a wallet's
personal return after its entry date and redemption fee. MON pricing and short-book reports
can update asynchronously: the UI discloses the short-book timestamp and the effect of re-marks,
and leaves stale-book return unavailable. Staking estimates never modify this series; actual
staking rewards enter the contract share value when claimed.

Daily income remains funding plus estimated staking, excluding price PnL and fees. Supporting
USD subtotals sum only days where observed funding and estimated staking are both available;
missing/unpaired records do not contribute and partial coverage is explicit. The Observed/Settled
switch changes daily funding, while earned-funding subtotals include unpaid accrual. The UI
preserves gaps and separate return segments, marks partial income, shows record timestamps
and coverage, and leaves examples without invented accounting history.

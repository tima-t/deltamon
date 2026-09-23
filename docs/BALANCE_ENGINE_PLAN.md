# The Balance Engine — DeltaMon UI/UX plan

Redesign the public app as a precision instrument for understanding the vault. Its live balance dial compares MON held with manager-reported MON short notional and shows net exposure at the center. A 60% MON asset allocation can still target delta neutrality when short collateral is used with leverage. The interface shows actual allocation and calls the position “within target” only when fresh data puts net exposure within ±2%.

The public landing page, dashboard, deposit, and withdrawal journeys come first. The console receives the shared visual theme afterward.

Ongoing interaction and theme standards: [UI_UX_GUIDELINES.md](UI_UX_GUIDELINES.md).

## Stages

### 1. Product truth and data contract

- [x] Replace outdated fixed 60/40 copy with the current manager-run hedge and adjustable allocation story.
- [x] Extend the external manager feed contract with optional `shortNotional` in six-decimal USDC units while preserving `equity` and `asOf`.
- [x] Add long exposure, short exposure, net delta, report time, and fresh/stale/unavailable status to `VaultStats` and `/api/vault`.
- [x] Treat reports older than 300 seconds, future dated or invalid reports, and missing notional as unavailable for neutrality claims.
- [x] Label manager-reported and illustrative demo values; never substitute demo figures for an offline deployed vault.

**Gate:** The API distinguishes measured balanced, exposed, and unknown positions without inventing short exposure.

### 2. Brand and visual foundation

- [x] Create an original split-ring DeltaMon SVG mark and wordmark, plus an SVG favicon.
- [x] Build the live Balance Engine as React-controlled SVG with two exposure arcs, a net exposure needle, and subtle vault teeth.
- [x] Create an illustrative static engine poster ($60 long, $60 short notional, $40 collateral), a deposit path SVG, and a 1200 × 630 social PNG.
- [x] Build dark graphite and light theme tokens, a theme switch, responsive typography and components.
- [x] Use Bricolage Grotesque for display, IBM Plex Sans for body, and IBM Plex Mono for measurements.

**Gate:** Both themes work at 375 px and 1440 px, and the dial is understandable without animation.

### 3. Public dashboard and live engine

- [x] Recompose the homepage around the live engine, vault value, share price, actual asset mix, collateral and short notional, report freshness, and risks.
- [x] Bind arcs and needle to real hedge data. Show “Within ±2% target” only for a fresh report with `abs(netDeltaBps) <= 200`.
- [x] Keep funding allocation visually separate from long versus short exposure. Add an expandable explanation of leverage.
- [x] Apply shared theme tokens to the console without changing operator actions.

**Gate:** A first-time visitor can identify what they own, how the hedge works, and whether its reported position is within target in about 15 seconds.

### 4. Deposit and withdrawal journeys

- [x] Present one coherent shell for direct Monad and conditionally enabled cross-chain deposits, preserving quote expiry, recovery, and resumed sessions.
- [x] Explain the path with the deposit SVG; animate progress only from real application or chain states. Keep approval and deposit distinct.
- [x] Add a public position and withdrawal panel supporting instant redemption and the existing queue, with deadline, cancellation, settlement, and transaction links.
- [x] Make pending, failed, stale, and completed states readable with keyboard and reduced motion.

**Gate:** A user can complete or recover a deposit and understand how to exit without the operator console.

### 5. Verification and presentation

- [ ] Test net delta, freshness, missing, future-dated, and demo states; direct approval/deposit and redemption states; cross-chain quote, resume, failure, and recovery.
- [ ] Run typecheck, lint, tests, and production build. Review dark/light at mobile/desktop widths, contrast, keyboard use, reduced motion, and loading.
- [x] Prepare a demo sequence: deposit → holdings and short → net exposure → drift and return within target → withdrawal. Label every simulation.

**Gate:** Visual motion matches real or explicitly simulated state, and no screen claims neutrality from missing or stale short data.

## Design and implementation rules

- Dark graphite by default, designed light mode and visible switch. Warm ivory text, Monad violet MON leg, muted amber short leg, green/coral for status.
- CSS for simple feedback; `motion` for the data-driven SVG and state changes. No continuously spinning gears. Opening animation within about 800 ms, data moves about 600 ms, and reduced-motion preference respected.
- The manager feed is produced by the existing external bot. Its short notional is self-reported; the UI must state that trust boundary.
- Current `DeltaMonVault` is the first release target. Allocation and leverage remain adjustable. ±2% is a UI target, not a guarantee of continuous neutrality.
- Native SVG is the main artwork; generated or 3D imagery is unnecessary for the first release.

## Integration and verification still required

- The external manager bot lives outside this repository. Its publisher must add `shortNotional` to the existing `equity` / `asOf` document before the live dial can measure short exposure. Until then, the live status is unavailable.
- Run direct deposit, instant redemption, queue claim/cancel and the feature-enabled cross-chain route with a funded test wallet. Do not describe these as transaction-tested from the visual review.
- Set `NEXT_PUBLIC_SITE_URL` to the production origin when deployment details are known, then verify the Open Graph image URL. Local builds use `http://localhost:3000`.
- The backend hedge unit tests and existing cross-chain tests pass. Typecheck, lint and production build pass; dark and light layouts were visually reviewed at 375 px and 1440 px. The full real-wallet stage 5 gate remains open.

# DeltaMon UI/UX guidelines

Read this before every UI, UX, copy, or frontend change. Keep it current when design decisions change. The product concept and staged implementation live in [BALANCE_ENGINE_PLAN.md](BALANCE_ENGINE_PLAN.md).

## Product promise

DeltaMon pairs an approachable counterweight character with a precision instrument for understanding a vault. Help a first-time visitor answer: What do I own? What is the vault doing? How current is the hedge measurement? What happens when I act?

- Show actual holdings and manager-reported short notional as separate measurements. Capital backing a short is not the short's size.
- Never claim measured balance from missing, stale, future-dated, or illustrative data. The ±2% target is a measured UI band, not a guarantee.
- Label examples as illustrative. State the manager-report trust boundary near the relevant data.
- Explain risk and exit paths in plain language.

## Current visual language: The Counterweight

- Warm cream is the default for brand storytelling, with a fully designed dark mode through the visible theme switch. A dark plum chapter separates measured vault data from the illustrative character world.
- Use the CSS tokens in `apps/fe/src/app/globals.css`: ink plum, warm cream, MON violet, muted amber for the short leg, and green or coral only for status. Keep contrast strong on both themes.
- Bricolage Grotesque is the bold display face; IBM Plex Sans is body copy; IBM Plex Mono is for measurements and small labels. Use tabular figures for live numbers.
- **Tippet**, the little counterweight, is a **brand guide**, not the keeper, a guarantee of balance, or a transaction status indicator. Tippet's recurring question is “What's on the other side?” and its follow-up is “When was it measured?” Its silhouette and personality must remain useful when future strategies involve other assets and hedge methods. Today's MON vault is labeled Strategy 01; do not imply other strategies exist until they do.
- Tippet's origin and the DeltaMon Field Book are clearly brand fiction. Do not present them as the founder story, product history, or evidence of any live position. See [counterweight-system.md](design-explorations/deltamon-2026/counterweight-system.md) for the character bible and chapter rules.
- Keep Tippet's name, origin, personality copy, and Field Book off the public site by default. `NEXT_PUBLIC_TIPPET_LORE_ENABLED=true` is an explicit build-time preview switch; leave it unset or `false` for end users. The counterweight illustration and strategy explanation remain visible without the lore.
- Use the character for introductions, explanations, and optional verified success moments. Never make it celebrate a pending transaction, an unverified hedge, or a yield estimate. Keep operational copy direct and serious.
- The live Balance Engine remains React-controlled SVG. Keep long and short arcs, net exposure readout, and status legible without animation. Missing or stale data must not appear balanced.
- The real-position chapter uses an **Exposure Plate**: two equal-scale arcs start at the same pivot, with the vault's onchain MON on one side and the manager-reported short notional on the other. Put source and report age before the net reading; render a net value only when current report data supports it. Label illustrative values as examples even at the source labels; treat future-dated report times as invalid. Keep manager capital in a separate audit compartment and yield in a subordinate strip. The graphic is a comparison, not evidence that the vault directly holds the short. See [position-section-research.md](design-explorations/deltamon-2026/position-section-research.md).
- The 60/40 FAQ uses a compact Exposure Plate with the same arc geometry and explicit example labels. Its $60 long and $60 short illustrate equal notional exposure; $40 appears in a separate backing-capital compartment. Never show the legacy circular dial for this explanation.
- Prefer graphic print textures, irregular illustration edges, and bold typography in storytelling. Keep wallet actions and financial data in calm, stable surfaces with visible focus and minimal decorative motion.
- The deposit chapter uses the **Entry Ticket** system: one focused editorial docket and a three-node USDC → vault → sdMON route. On wide screens, the ticket fills the chapter width, with the explanation and route beside the active step to reduce scrolling; smaller screens use one column. The route briefly explains what a share represents; the detailed asset ledger is an optional disclosure in the real-position chapter, where vault composition has context. The graphic language comes from Strategy 01; amounts, reviews, and transaction states stay literal. The route's source name must follow the selected chain. The route illustration is an explanation, not a claim that allocation or hedging has already occurred. See [deposit-flow-research.md](design-explorations/deltamon-2026/deposit-flow-research.md).
- The Entry Ticket is a **one-face-at-a-time sequence**, not an expanding form. Keep the route diagram and indexed progress rail fixed while access, source (when multiple chains are available), amount, review, and transaction tracking replace one another in the same area. Selecting a source advances immediately. Back and retry actions preserve the source and amount whenever they remain valid; an irreversible wallet action begins only from review.
- Cross-chain tracking uses a **printed transfer map** within the Entry Ticket. Source, Monad, vault, and shares are fixed stations; a segment draws only after its destination is verified. A moving signal marks only the active leg, and failure stops the signal at the affected station. Show the literal status and recovery text beside the map; never turn an unknown duration into a percentage or imply that routed funds are already minted shares. Reduced-motion mode keeps the map and all state labels without travel animation. The development-only lab exposes manual simulated Aurora states for design review; see [deposit-flow-research.md](design-explorations/deltamon-2026/deposit-flow-research.md).
- The nearby exit panel is the visual return route, with the same hard rules and index language. Keep redeemable liquidity and exit feedback more prominent than the decoration.
- After a fresh deposit is confirmed by a vault receipt or share mint, refresh the position and guide the visitor to **The return route**. Keep the deposit receipt available above. Do not advance or scroll on approval, submission, a pending route, or a restored historical session.

## Interaction rules

1. **Minimize end-user clicks.** Put the next sensible action in context, preserve entered values when recoverable, and avoid extra confirmation screens that add no understanding. Keep required wallet approval and transaction signatures distinct. Provide review when it helps users understand amounts, fees, destination, or risk.
2. **Every action has a feedback loop.** Show an immediate response to the click, then distinguish preparing, wallet confirmation, submitted transaction, onchain confirmation, failure, and recoverable next steps where applicable. Never use a generic “done” state for an unconfirmed transaction.
3. **Place feedback beside the action.** A persistent, readable result card is better than a distant line or a toast that disappears. Name the completed action, give the outcome in the user's units, and keep the transaction link available. Keep error text and retry path near the control.
4. **Motion reinforces state.** Use a brief entrance or check animation after a real success and modest transitions for pending stages. Never animate a balance, payout, or hedge through a misleading intermediate value. Respect `prefers-reduced-motion`; text, color, and shape must still communicate the state.
5. **No false certainty.** Show `—` or an unavailable explanation for failed reads. A button must not be enabled from a guessed allowance, balance, quote, or redemption limit. If a receipt reverts, show failure, never success.
6. **Make recovery obvious.** Preserve the entered amount after a failed wallet or chain action. After success, update position data and reset only the completed input. The current vault has no redemption queue; show available idle-USDC liquidity and explain when an admin unwind is needed for the remainder.
7. **Keep accessibility native.** Use semantic buttons, labels, `role="status"` for progress and success, `role="alert"` for failure, keyboard-visible focus, sufficient hit areas, and readable results with reduced motion.

## Wallet entry and funding

- Use **Get started** before an account is selected. Present **Continue with passkey** and **Connect existing wallet** as equal, clearly named choices. A new passkey opens a new EOA address and does not move an existing position.
- Label the active address **Passkey wallet** or **Connected wallet**. Ask for passkey verification when an approval, deposit, authorization, or exit requires a signature; keep approval and deposit as separate onchain states.
- For an empty passkey wallet, show the receiving address and QR code with the selected chain, exact USDC token contract, and required native gas. Keep the funding instructions next to the deposit action, and refresh balances without losing the selected route.
- Offer recovery phrase export from the account menu only after a fresh passkey check. Explain that the phrase controls the funds, keep it visible only while requested, and never store it in app persistence.
- Keep the deposit action focused on the Entry Ticket. Put detailed vault composition with the real-position measurements, available on demand rather than beside the deposit form.
- Keep `/deposit-lab` development-only. It is a fully labeled simulation for walking the experience, never a source of real wallet, quote, or transaction state. Never use its sample numbers in the public flow.

## Review checklist for any user action

- Can the user tell immediately that the click registered?
- Can they distinguish wallet approval from onchain confirmation?
- Is success tied to a verified receipt or application state?
- Is the result prominent, specific, persistent, and close to the control?
- Are failure and recovery clear without losing useful input?
- Does the path use the fewest meaningful steps?
- Are dark/light, mobile/desktop, keyboard, and reduced-motion states readable?

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
- Prefer graphic print textures, irregular illustration edges, and bold typography in storytelling. Keep wallet actions and financial data in calm, stable surfaces with visible focus and minimal decorative motion.

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
- Place the deposit flow before vault composition in the dashboard reading order: left then right on desktop, first then second on mobile.

## Review checklist for any user action

- Can the user tell immediately that the click registered?
- Can they distinguish wallet approval from onchain confirmation?
- Is success tied to a verified receipt or application state?
- Is the result prominent, specific, persistent, and close to the control?
- Are failure and recovery clear without losing useful input?
- Does the path use the fewest meaningful steps?
- Are dark/light, mobile/desktop, keyboard, and reduced-motion states readable?

# Deposit flow: The Entry Ticket

Research and design notes, 29 September 2026. This is a product design record, not public copy.

## What I studied

| Reference                                                                                            | Useful pattern                                                                                                              | DeltaMon decision                                                                                                     |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| [Cash App Brand Guidelines](https://design.cash.app/)                                                | A coherent graphic system extends across typography, color, motion, and UI, rather than relying on one hero illustration.   | Reuse Strategy 01's print rules, color blocks, index labels, and counterweight geometry in the action chapter.        |
| [Up](https://up.com.au/)                                                                             | Character-led financial storytelling can be bold and warm.                                                                  | Keep the character in the brand world; make amounts, status, and risk calm and literal.                               |
| [Cleo](https://web.meetcleo.com/)                                                                    | A distinct verbal personality runs through the public product story.                                                        | Give DeltaMon a recognizable voice in chapter headings while keeping wallet and transaction instructions exact.       |
| [Stripe checkout screen practices](https://stripe.com/resources/more/checkout-screen-best-practices) | Visible summary, explicit action, local errors, preserved input, and a clear result help users complete a high-stakes flow. | Show USDC in and estimated sdMON out in one place. Keep review beside the amount and keep receipts beside the action. |
| [Phantom swaps](https://phantom.com/learn/blog/swapping-tokens-in-phantom)                           | Source, destination, network cost, and progress need distinct treatment when a route crosses chains.                        | Show the source chain before quoting; keep authorization, source transfer, route progress, and share mint distinct.   |

Cash App, Cleo, and Up were all recognized in the [2026 Webby financial services website category](https://winners.webbyawards.com/winners/websites-and-mobile-sites/general-desktop-mobile-sites/financial-services-banking). The award list was used to find current visual references, not as proof that any one interaction pattern is suitable for an onchain deposit.

## Existing flow audit

The former deposit panel was a generic bordered card with a separate static route image. The disconnected cross-chain state said “Choose a source” before any source was visible, and the direct button said “Review deposit” while it actually opened wallet entry. Review, pending, success, and failure were visually small relative to the amount control. The nearby composition card looked like a dashboard widget from another design system.

The live wallet path was inspected in the browser. A new development-only simulation at `/deposit-lab` was then walked through from connection to source, amount, review, wallet authorization, submitted transfer, and confirmed shares. I also simulated approval failure and verified that the amount remained and the failed step could be retried. The simulation never connects a wallet or submits a transaction. It returns 404 outside development.

## Design decision

The deposit chapter is an **entry ticket**: an editorial title, a three-node route diagram, and a stable amount/review surface. The adjacent composition ledger was removed because it competed with the deposit task and repeated the route's share explanation. The ticket now uses the full available chapter width on desktop: explanation and route sit beside the current action, reducing its height. Smaller screens keep the linear sequence. The detailed asset mix remains available as a disclosure in the real-position chapter. A print-like visual language makes the site distinctive; operational status stays explicit. No character art is used as a transaction indicator.

The real flow retains its existing chain and vault checks. The route diagram updates to the selected source chain. Review names both input and estimated shares, and success requires an onchain receipt. Cross-chain progress remains a separate sequence with recovery actions. The mock is labeled as a simulation at every level and is development-only.

## Follow-up boundary

The simulation validates the UI sequence and recovery copy. It does not prove a live deposit succeeds. A real funded wallet and deployed vault are required for a full integration test. Never substitute mock amounts for production balance, allowance, quote, or receipt data.

## Cross-chain motion study, 30 September 2026

The transfer tracker now treats the Entry Ticket as a printed transit map. Four fixed stations are connected by curved lines. Confirmed legs draw in sage, the active leg carries a slow violet signal, and a failure stops the signal. The adjacent status cards retain exact operational language. The signal is indeterminate: elapsed time and final share quantity are not inferred from its position.

The visual reference was [Codrops' survey of SVG motion paths](https://tympanus.net/codrops/2019/12/03/motion-paths-past-present-and-future/); [Motion's SVG path animation](https://motion.dev/docs/animate) supports drawing a leg at a state change. [Adobe's progress bar guidance](https://react-spectrum.adobe.com/v3/ProgressBar.html) informed the choice to avoid an invented completion percentage when duration is unknown. [Stripe's asynchronous payment state discussion](https://stripe.com/blog/payment-api-design) reinforced that a submitted route and a final result are separate states. The reduced-motion version follows [MDN's `prefers-reduced-motion` reference](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/prefers-reduced-motion): all stations, labels, and completed paths remain visible with travel animation disabled.

`/deposit-lab` now has manual source-sent, routing, arrival, vault-call, mint-check, confirmed, failed, and expired positions. These use the same tracker as the live panel, but their status and amount are explicitly fictional and never call a wallet, Aurora, or a chain. A reviewer can jump between positions or advance through the happy path to compare motion and copy.

## Source constellation, 30 September 2026

The source chooser is now a small observatory plate within the Entry Ticket. Its stellar cores are proportional in area to the known, positive USDC balances; source names, formatted balances, and approximate shares remain printed alongside. The concept borrows the tactile response of [Unseen Studio's organic particle experiment](https://tympanus.net/codrops/2025/09/11/when-cells-collide-the-making-of-an-organic-particle-experiment-with-rapier-three-js/) and the depth of [ExoSky's interactive starfield](https://brennenhill.com/projects/exosky/) without making transaction controls chase moving points. [Observable Plot's radius-scale guidance](https://observablehq.com/plot/features/scales) informed the square-root sizing so circle area reflects value. The one-click source handoff uses [Motion shared layout](https://motion.dev/docs/react-layout-animations); [W3C motion guidance](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions) informed the pause and reduced-motion behavior.

The visual is a selector, not a transfer or balance guarantee. Unreadable balances get a literal unavailable row, not a sized star. A fundable zero-balance Monad wallet gets a hollow marker. The development-only lab uses fictional 2.24 / 2.42 / 0.31 USDC balances to inspect sizing and the amount-step transition.

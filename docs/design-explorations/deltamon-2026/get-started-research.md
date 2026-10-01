# Get started: three art directions

Working exploration, 1 October 2026. [Open the interactive comparison](get-started-concepts.html). Direction 01 was selected for the live wallet flow, including account and recovery states.

## The problem

The current 440 px dialog is legible but visually generic. It asks a meaningful question: which wallet address will represent the person? The two top-level choices must remain equally prominent and plainly named. The passkey step must make clear that a newly created passkey opens a **new address**, while the same passkey returns to an existing position. The account and recovery controls remain operational, rather than becoming part of a theatrical opening sequence.

The art can make the moment of opening the popup memorable. It cannot resemble a current balance measurement, wallet verification, completed connection, or a guarantee about funds. The actual wallet controls should settle into stable, readable surfaces before a person acts.

## Research translated into design

| Reference                                                                                                                                                   | What it demonstrates                                                                                                          | DeltaMon application                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| [Editorial New, Locomotive](https://locomotive.ca/en/work/editorial-new)                                                                                    | A type-led, retro editorial identity gains energy from variable typography and focused micro-interactions.                    | Make the words and registration marks themselves the art in Direction 03.                                          |
| [Air Space Intelligence, Studio Freight](https://studiofreight.com/work/air-space-intelligence)                                                             | An invented but precise visual world can convey the _idea_ of a product without presenting invented operational data as real. | Use a decorative counterweight or aperture, with no balance reading or connection state encoded in it.             |
| [Argus Labs, Studio Freight](https://studiofreight.com/work/argus-labs)                                                                                     | A single symbolic object feels precious when used sparingly, within a repeatable graphic system.                              | Give the popup one hero object, not a field of unrelated crypto effects.                                           |
| [Material motion choreography](https://m1.material.io/motion/choreography.html) and [duration guidance](https://m1.material.io/motion/duration-easing.html) | Motion should establish a clear focal path and avoid making users wait for the interface.                                     | One short entrance, then stable actions. Keep the next step anchored to the same modal.                            |
| [Google Design on adaptive motion and contrast](https://design.google/library/youtube-new-red-color)                                                        | Motion and color should adapt to the device and accessibility needs.                                                          | Honor reduced motion, maintain strong text contrast, and keep ornamental movement independent of target positions. |

## Directions

### 01 — The Counterweight

**Feeling:** a miniature kinetic sculpture inside a cream instrument case. The slightly tilted beam moves into place as the popup enters. The violet and amber weights are deliberately unequal. The two actions are printed as equal, calm cards beside the artwork.

**Why it fits:** this is the most direct continuation of the current Counterweight identity. It can become a signature DeltaMon moment without any new illustration dependency.

**Art bill:** bespoke SVG sculpture with irregular edges; paper grain; a short beam entrance; light and dark surface variants. The decorative object is not a live Balance Engine reading.

**Risk:** if rendered as a real gauge, people may misread it as measured portfolio balance. Keep it visibly illustrative and label it as such in internal review.

### 02 — The Aperture

**Feeling:** a violet-black, etched iris around a warm point of light. The opening suggests entering an instrument, with two clear route cards below. The art becomes still or extremely slow after its entrance.

**Why it fits:** it is the most transportive option and can make “Get started” feel like a threshold. It expands the brand beyond the current cream ticket without adopting a generic glass or neon wallet motif.

**Art bill:** native SVG or CSS rings and linework; light bloom; entrance choreography; reduced-motion still; carefully calibrated dark and light versions.

**Risk:** it asks for the most careful performance and contrast work. The aperture must not be mistaken for transaction progress or identity verification.

### 03 — The Entry Folio

**Feeling:** an oversized typographic access folio, with a registration stripe and bespoke seal. The title slides into alignment like an inked sheet entering a press. The two routes read as equal panels on the same printed page.

**Why it fits:** strongest link to the existing Entry Ticket and simplest to produce responsively. A premium typographic object can feel special even with little motion.

**Art bill:** custom title composition, vector seal, registration stripe, subtle paper texture, quick type entrance. Existing Bricolage Grotesque, Plex Sans, and Plex Mono cover the production typography.

**Risk:** it could feel too close to the deposit ticket unless the large type and seal have their own proportions and movement.

## Shared interaction contract for the selected direction

1. The popup opens with both **Continue with passkey** and **Connect existing wallet** visible. Neither route is given a misleading default.
2. The passkey choice leads to **Use existing passkey** and **Create passkey wallet**, with explicit address consequences. Preserve the current “Choose a different passkey” path where a local passkey record exists.
3. The background art does not respond to authentication, wallet connection, signature, or transaction state. Pending and errors stay next to the actual control in plain text.
4. Keyboard focus, Escape and close behavior, 40 px or larger targets, mobile layout, dark and light themes, and reduced motion are part of the final implementation.
5. The account menu and recovery phrase export can inherit the selected visual shell, but the phrase and security warning remain calm and highly legible.

## Selection

**Direction 01** was selected for its DeltaMon identity and signature interaction. Directions 02 and 03 remain archived explorations. The interactive comparison is an art-direction prototype; the live implementation is in `apps/fe/src/components/WalletEntry.tsx`, `WalletEntryArt.tsx`, and `apps/fe/src/app/globals.css`.

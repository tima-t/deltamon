# DeltaMon: five design directions

Research and concept study, 29 September 2026. [Open the visual comparisons](index.html).

**Selected direction:** 02 — Little Counterweight. The public app now uses a refined original character illustration, a matching small mark, a warm cream story world, and a distinct dark chapter for actual measurements. The character is designed as a strategy-neutral DeltaMon guide; “Strategy 01 / the MON counterweight” identifies the current vault without inventing future products. The live app implementation and current design rules supersede the rough SVG character in the five-way comparison page.

**Selected art asset:** [`apps/fe/public/art/counterweight-mascot.png`](../../../apps/fe/public/art/counterweight-mascot.png) was made with the built-in image generation tool. Prompt: “An original counterweight mascot for DeltaMon: an asymmetric purple delta-like creature with ink-black arms balancing a lavender stone and mustard brass block, witty expression, imperfect dynamic pose; sophisticated hand-painted 2D screenprint/gouache with tactile grain and cut-paper edges, readable silhouette, isolated on a transparent background; no 3D, glossy gradients, crypto coin, robot, stock mascot, text, or watermark.” The small brand mark is a separate native SVG so it stays sharp and editable.

## 1. Product and name audit

The repository presents DeltaMon as a USDC vault on Monad. A depositor receives **sdMON shares**. The vault holds MON and can stake it; a separate, custodial perp manager can run a MON short. The public Balance Engine compares the vault's onchain MON exposure with manager-reported short notional when the report is valid and fresh. It must distinguish the _capital backing a short_ from the _short's notional size_. See the [current app](../../../apps/fe/src/components/VaultDashboard.tsx), [risk copy](../../../apps/fe/src/components/Risks.tsx), [contract](../../../packages/contracts/src/DeltaMonVault.sol), and [UI/UX rules](../../UI_UX_GUIDELINES.md).

**Name reading:** “Delta” is the net price exposure of the MON position after the short; “MON” is Monad's native token. The name makes the product mechanism the brand. The repo contains no documented founder story or pre-existing mascot lore, so the river delta and creature ideas below are _proposed creative interpretations_, not claims about why the founders chose the name.

**Important current-state correction:** The top-level README and older Balance Engine plan still mention a redemption queue and 36-hour deadline. The current `DeltaMonVault.sol` explicitly has **no redemption queue**. Normal exits use idle USDC; an in-kind path exists, and when cash is insufficient users may need to wait for an admin unwind. The [current risk component](../../../apps/fe/src/components/Risks.tsx) reflects that. Any selected design needs copy based on the current contract, not the older README. The uncommitted frontend work in the checkout was not changed for this exploration.

### Non-negotiable content in every direction

1. Show what sdMON represents and what the vault actually holds.
2. Keep onchain MON value and externally reported short notional separate, with report time and freshness.
3. “Within ±2% target” only when a valid fresh report supports it; never imply continuous neutrality or guaranteed yield.
4. State near the relevant measurement that the short is manager controlled and manager reported, and funds sent to that manager leave direct vault custody.
5. Put the actual exit liquidity and path within easy reach of a deposit decision.
6. Keep wallet actions, approvals, submitted transactions, confirmed receipts, errors, and recovery legible on mobile and with reduced motion.

## 2. Visual research, filtered for DeltaMon

I looked for current work that has a point of view and a usable mechanism, not simply a trendy finish. These are **references to study**, not layouts or images to copy. Several are from September 2026, while older case studies are included for a durable specific lesson.

| Reference                                                                                                                                                 | Observed lesson                                                                                                    | DeltaMon translation                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| [HAOQI©2026](https://haoqi.design/) and its [September 2026 capture](https://swipefile.design/ref/awwwards-haoqi-design/)                                 | A forceful typographic statement can coexist with small technical metadata and a sculptural field.                 | Use graphical precision and original shapes, but turn metadata into meaningful vault facts.                                     |
| [TIGRIS, CSS Winner, 28 Sep 2026](https://www.csswinner.com/)                                                                                             | The award listing describes a responsive, cinematic WebGL experience with optional sound.                          | A full art scene is possible for the public story, while a static mobile fallback and a fast instrument remain essential.       |
| [L.I.S.A. by Locomotive, Sep 2026](https://lisa.locomotive.ca/en)                                                                                         | Kinetic repeated type, rhythm, and digital agency confidence create a strong visual voice.                         | Adapt the typographic energy to an editorial headline and section transitions, without making financial data move theatrically. |
| [NKORA by monopo, 2025](https://monopo.london/work/nkora-coffee/)                                                                                         | A bespoke lino-printed character, custom type, and illustration system preserve personality beyond one hero image. | A DeltaMon mascot is viable only as a complete 2D character system with jobs across explanation, empty states, and community.   |
| [Presight Partners by monopo](https://monopo.london/work/presight-partners-website-branding/)                                                             | A finance brand gained originality from editorial typography and symbolic commissioned illustrations.              | Finance can be art directed and credible, provided the product explanation is just as considered.                               |
| [We Are Third by monopo](https://monopo.london/work/we-are-third-website/)                                                                                | The agency made a finance site feel personal through an interaction and a custom material language.                | One memorable mechanism, such as exposing the two sides of a position, beats a collection of unrelated effects.                 |
| [Active Theory: Mastered from Chaos](https://v4.activetheory.net/work/mastered-from-chaos)                                                                | An immersive point-cloud narrative is structured into chapters rather than visual noise.                           | A cinematic DeltaMon could explain the strategy as chapters, with a skippable path straight to the facts.                       |
| [2026 Webby finance finalists](https://winners.webbyawards.com/winners/websites-and-mobile-sites/general-desktop-mobile-sites/financial-services-banking) | The category includes a brand guidelines site and character-led finance work.                                      | Financial trust and a strong brand personality are compatible; the risk is hiding product truth behind the performance.         |
| [Monad media kit](https://skilly.notion.site/Monad-Media-Kit-0554df533a10449d8dbbf960fd0c52a7)                                                            | Monad has its own symbol, purple family, and usage constraints.                                                    | DeltaMon can nod to the chain through a violet MON leg, but should have an independent mark and not repurpose the Monad symbol. |

### What feels current in September 2026

The strongest examples above use **specific concepts**: a graphical field, a character world, a material object, an editorial voice, or chaptered motion. Their standout feature is not a universal “2026 style.” For DeltaMon, I would reject generic purple glows, a floating coin, interchangeable glass cards, charts used as wallpaper, and looping motion on live financial values. The contrast with ordinary DeFi dashboards will come from a coherent identity _and_ unusually candid product data.

## 3. Sort and decision structure

Scores are editorial judgment, not usability test results. “Build effort” includes the custom art and responsive implementation needed to reach the pictured quality.

| Direction                   | First impression                        | Brand distinctiveness | Product clarity | Art / build effort | Best use                                              |
| --------------------------- | --------------------------------------- | --------------------: | --------------: | -----------------: | ----------------------------------------------------- |
| **01 Signal Room**          | Public observatory / Swiss instrument   |                   4/5 |             5/5 |             Medium | Best foundation if the measurement is the proof.      |
| **02 Little Counterweight** | Mischievous illustrated character world |                   5/5 |             3/5 |               High | Best for a community brand that teaches the strategy. |
| **03 Equilibrium Object**   | Cinematic material sculpture            |                   4/5 |             3/5 |               High | Best launch moment and premium art identity.          |
| **04 Open Ledger**          | Loud financial zine                     |                   4/5 |             4/5 |             Medium | Best for a blunt transparency stance.                 |
| **05 Countercurrent**       | Quiet fine-art landscape                |                   4/5 |             3/5 |               High | Best for a mature, emotional brand.                   |

### Recommendation

**Signal Room** is the strongest single direction for the product as it exists now: the actual data has a chance to become the memorable thing. I would borrow **one** supporting trait from another concept after selection, such as the mascot's explainer role or the sculpture's hero object. I would not blend all five visual languages.

## 4. The five directions, beyond their first screens

### 01 — Signal Room

**Thesis:** DeltaMon is a public observatory of a moving financial position. A calibrated grid, exquisite measurement typography, and a custom exposure instrument make honesty beautiful.

**Desktop narrative:** “Know the position” → live long/short/difference with freshness → what the vault owns → how the short is run and who controls it → deposit → exits and risks.

**Mobile:** Headline and clear primary action first. The live instrument becomes one wide vertical module; status, timestamp, and sources are readable at 375 px without tooltips. No multi-column data tables.

**Art production:** Custom variable numerals or carefully licensed type; instrument SVG; linework and calibration motifs; one dark and one light palette. No generated bitmap required.

**Interaction:** A trace can settle when valid new data arrives. Stale or unavailable data freezes the visual and changes the written state; no spinning or imputed values.

### 02 — Little Counterweight

**Thesis:** Make an unexpectedly lovable brand around the act of keeping two forces in view. The mascot is a guide to the mechanics, not a symbol of safety. The visual study includes a rough original SVG character; its final form would require a real character sheet and motion tests.

**Desktop narrative:** Character introduces “big MON energy, small delta” → illustrated two-sided strategy explainer → actual instrument and manager boundary → deposit → risk and exit chapter.

**Mobile:** Short copy and action first, then character; compact illustrated panels below. Keep the measured state in sober typography distinct from the character's speech.

**Art production:** Character model sheet, 8–12 expressions/poses, hand-drawn transitions, sticker/social set, favicon and tiny-scale tests, possibly a physical plush or merch study. This is the direction where dedicated illustration matters most.

**Interaction:** The character may point to an explanation or celebrate a verified share receipt. It must never cheer a pending transaction, a high APR, or an unverified hedge.

### 03 — Equilibrium Object

**Thesis:** Make a unique physical artifact the signature of DeltaMon: two visibly different forms suspended around an open center. The included image is an original generated **concept**, not final brand art.

**Desktop narrative:** Sculptural hero → plain-language “two forces” diagram → live measurements → vault anatomy → action and exits. The art could become a short controlled film, but the site works as stills.

**Mobile:** Use a deliberate portrait crop/still. Text and first product status are never laid over a busy part of the artwork.

**Art production:** Art director + 3D/material artist to rebuild the form; three lighting compositions; responsive crops; reduced motion still; custom icon family using the open center. The current generated sample is a direction test only.

**Interaction:** One reveal as the object rotates enough to show both surfaces, then stop. The live data module is flat and stable.

### 04 — Open Ledger

**Thesis:** A finance site with the confidence of a printed publication. Oversized type, aggressive section rules, numbered disclosures, and diagrammatic red ink make transparency the personality.

**Desktop narrative:** “Show both sides” → the public position in two facing columns → annotated manager and vault custody map → real balances → deposit and exit. A “read the position” route stays visible in the navigation.

**Mobile:** Each spread collapses into numbered vertical chapters. All text remains selectable, accessible HTML.

**Art production:** Custom headline lettering, ink stamp and line system, carefully art-directed editorial diagrams. Little or no image generation.

**Interaction:** A few printed-sheet transitions in the story; no page-turn delay before using the vault.

### 05 — Countercurrent

**Thesis:** “Delta” first means exposure difference; a river delta becomes an optional emotional metaphor for two currents meeting. The included aerial image is an original generated **concept**.

**Desktop narrative:** Landscape hero → line-art map of the two financial legs → live measured difference → strategy and custody → deposit and exit. Editorial copy must state the finance meaning directly.

**Mobile:** Hero art becomes a controlled crop and immediately gives way to a solid, high-contrast product panel. No data or controls float over water.

**Art production:** Commission/licence aerial imagery or develop the concept into original 3D matte art; custom topographic illustration; restrained serif type; color-managed dark and light variants.

**Interaction:** Very slow, optional atmospheric movement on the landing story only. All financial status stays still and text based.

## 5. If one direction is chosen

1. Lock one visual system, not just its hero: logo/wordmark, type licensing, colors, illustration/asset rules, data visualization, components, dark/light behavior, and motion rules.
2. Make desktop and 375 px mobile page comps for the full landing page, connected position, deposit, pending, success, stale report, unavailable report, and exit states.
3. Commission or generate the art assets appropriate to the chosen concept, then refine them into owned reusable assets. The two generated samples here were made with the built-in image generation tool using the prompts below; the mascot study is native SVG in the HTML preview.
4. Implement the selected direction in the app and update `docs/UI_UX_GUIDELINES.md` for the chosen product design decision. Validate keyboard, reduced motion, contrast, responsive layout, and transaction feedback.

### Original art prompts used in this study

- **Equilibrium Object:** A premium editorial still life of two interlocking crescent forms, one violet translucent carved stone and one brushed champagne metal, suspended around a dark central void; wide frame, left negative space, dramatic softbox, tactile material grain; no text, money, charts, coin or crypto orb. Built-in image generation, saved as [`assets/equilibrium-sculpture.png`](assets/equilibrium-sculpture.png).
- **Countercurrent:** A fine-art aerial landscape of a river delta in volcanic black sand at dawn, two pale water channels curving around a still island, muted lavender shadows and copper highlights; wide left negative space; no text, logo, people, chart or coin. Built-in image generation, saved as [`assets/countercurrent-delta.png`](assets/countercurrent-delta.png).

These prompts and images are exploratory inputs, not evidence that the final artwork is production ready or uniquely protectable.

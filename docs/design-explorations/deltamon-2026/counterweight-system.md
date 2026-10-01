# The Counterweight: brand system

Selected 29 September 2026. This extends [direction 02](index.html#creature) into a DeltaMon identity that can support more than one delta-neutral strategy.

## Core idea

**DeltaMon** is the brand. **Tippet**, the little counterweight, is its recurring character and a shorthand for asking, “What sits on the other side of this exposure?” It is not a claim that the position is perfectly neutral. Today's product is **Strategy 01 / MON**. Later strategies can reuse the character, typography, measurement grammar, and layout without pretending they have the same asset, hedge, risk, or contract.

**Release state:** This lore is an internal design tool. The public site hides Tippet's name, origin, personality section, and Field Book unless `NEXT_PUBLIC_TIPPET_LORE_ENABLED=true` is set when building the frontend. The flag defaults to off; the existing counterweight art and clear strategy explanation stay public.

The character is pictured holding visibly unequal shapes in a moving pose. The lesson is that balance is measured and revisited. A perfectly level scale, a permanent green status, or copy like “always balanced” would contradict the product.

## Tippet: character bible

**One-line introduction:** A curious little counterweight who cannot leave a one-sided chart alone.

**Brand fiction, not product history:** Tippet appeared beside a chart that showed only one side of a position. It went looking for the other side. When it found a second reading, it asked when each one was measured. That small mystery became the first page of the **DeltaMon Field Book**. This is a fictional framing for how we explain exposure; it is not the origin of the company, the vault, or the name DeltaMon.

**Want:** to make every position legible as a whole, including what is unknown. **Habit:** asks a second question after receiving the first answer. **Flaw:** labels everything, including its lunch. **Telltale objects:** a pocket notebook of dates and measurements, two different objects to compare, and a few crumbs. **Line people can remember:** “Wait. What's on the other side?” **Word Tippet dislikes:** “always.”

Tippet is small, stubborn, warm, and observant. It does not act cleverer than the reader. It can be delighted by a clear label or puzzled by a missing timestamp; it is never gleeful about risk or someone's loss. Its body may tilt. Its eyes should remain open and attentive. Even in a celebratory pose it does not turn the scale into a permanent horizontal guarantee.

### The field book

The Field Book is a **storytelling device** for explaining a strategy, not a live source of truth. Chapter 01 is the MON vault and its manager-run short. A future chapter may use different assets and hedge methods, but it must earn its own exposure diagram, manager/trust explanation, data freshness rule, exit path, and risk language. Until launched, other chapters are only a conditional possibility. Never show blank numbered chapters in the product as though strategies exist.

The recurring three-beat story is: **see one side → ask for the other → check the time.** Tippet can appear in a chapter opening or educational panel. The actual measured position is always shown by the Balance Engine and source labels, never by Tippet's pose.

### Voice examples

| Context           | Tippet can say                    | Product UI must say                                                       |
| ----------------- | --------------------------------- | ------------------------------------------------------------------------- |
| Introduction      | “Wait. What's on the other side?” | “MON holdings and manager-reported short notional are separate readings.” |
| Missing report    | “I don't know yet.”               | “Manager position report unavailable. Net exposure cannot be verified.”   |
| Older report      | “When was that measured?”         | Show the report's actual timestamp and stale status.                      |
| Confirmed deposit | A small, quiet smile is fine.     | “Deposit confirmed. You received X sdMON shares.”                         |

No Tippet dialogue should imply it trades, controls the manager, protects capital, verifies the hedge, predicts yield, or confirms a wallet action. Keep Tippet out of signing, pending, error, and failure controls; those states require direct human-readable copy.

### Name and usage

When the lore flag is enabled for a preview, introduce it as **“Tippet, the little counterweight”** on first mention. Use **Tippet** thereafter. Do not turn the name into a token, ticker, yield product, or separate company brand. A September 2026 web scan found no obvious crypto mascot using “Tippet,” but that is a creative collision check, not trademark clearance. Review rights before a broad merchandise or paid campaign rollout.

### Character references

- [Duolingo's official Duo voice guide](https://design.duolingo.com/writing/duo) shows the value of giving a mascot repeatable voice rules, not just an illustration. Tippet's questions, flaw, and boundaries serve that purpose in a finance setting.
- [Tillo's official Arnie page](https://www.tillo.com/arnie-armatillo-tillo-mascot) shows how a mascot can carry a simple origin and recurring appearances. Tippet's field book is our own strategy-neutral story device, not a copy of that character.

## Identity layers

| Layer      | Stable across strategies                                                     | Changes per strategy                                                          |
| ---------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Character  | Silhouette, face, hand-painted grain, ink outline, personality               | The objects it weighs and contextual educational poses                        |
| Logo       | DeltaMon name and small counterweight mark                                   | No strategy-specific logo unless a real product family requires it            |
| Color      | Cream, plum ink, violet brand presence                                       | A restrained accent for each strategy's assets; status colors remain semantic |
| Product UI | Data freshness, two-sided exposure layout, risk disclosures, action feedback | Asset units, hedge method, manager/trust boundary, target band, exit path     |
| Naming     | DeltaMon / Strategy NN                                                       | Descriptive asset or mechanism name, never a promised outcome                 |

## Character jobs

- **Hero:** invite someone to learn. One large illustration is enough; keep the primary action visible without scrolling on common phone sizes.
- **Education:** point to the two exposures and the difference. Use distinct shapes rather than suggesting equal collateral and notional.
- **Empty/unavailable states:** the character can ask a question in marketing copy, but the actual interface must plainly state “unavailable” or “stale.” Avoid a cheerful expression beside missing data.
- **Success:** a restrained celebration is permissible only after a confirmed vault share issue. The transaction receipt and actual units lead.
- **Community:** stickers, merchandise, and social assets may be more playful than the transaction interface.

## Voice

Short, curious, candid. Headlines can be lively (“MON moves. We show both sides.”); operational text names the asset, controller, timestamp, and consequence. The mascot never speaks as if it controls the manager's short or guarantees an outcome.

## Required character sheet before broad rollout

1. Neutral standing pose and small-size silhouette.
2. Pointing to two separate measurements.
3. Curious/questioning pose for explainers.
4. Reserved verified-success pose.
5. Error/recovery pose that does not trivialize financial loss.
6. Dark-background and light-background color variants.
7. 32, 64, 128, and 512 px tests; reduced-motion stills.

The [first generated hero illustration](../../../apps/fe/public/art/counterweight-mascot.png) establishes the medium and silhouette. The [native SVG mark](../../../apps/fe/public/brand/deltamon-mark.svg) remains editable at small sizes. A commissioned illustrator should refine the character sheet before it is repeated throughout transaction flows or a multi-strategy catalog.

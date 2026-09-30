# The Real Position — design research, September 2026

## The information problem

The visitor must distinguish three different things: MON owned by the vault (onchain), MON short notional reported by a separate manager (offchain), and capital sent to that manager (neither the short size nor direct vault custody). Net MON exposure is a derived reading that should appear only with a current, usable manager report. Yield and share price are related context, not proof of a hedge.

## References reviewed

| Reference                                                                                                                                                   | Useful idea                                                                                                                                   | DeltaMon decision                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| [Searching for Birds](https://www.visualcinnamon.com/portfolio/searching-for-birds/) (Visual Cinnamon, 2026)                                                | Its bespoke nest and egg metaphors are integral to the data rather than decoration; direct labels and methodology keep the art interpretable. | Let the counterweight's two arms encode the two exposures. Keep actual dollar amounts and source labels outside the illustration. |
| [Capacity](https://www.pentagram.com/work/capacity?discipline=1&rel=combined&sector=7) (Pentagram)                                                          | A brand identity extends into a repeatable chart grammar rather than placing generic charts inside branded cards.                             | Give the instrument and supporting ledger the same indexed, print-like graphic language as Strategy 01.                           |
| [DSN Now](https://eyes.nasa.gov/apps/dsn-now/) (NASA/JPL)                                                                                                   | A live instrument separates current status from the details of an individual reading.                                                         | Put source status and report age at the top of the plate; distinguish observed, reported, illustrative, stale, and unavailable.   |
| [Data journalism design guidance](https://old.observablehq.com/blog/what-data-teams-can-learn-from-journalists-about-data-visualization) (Observable, 2026) | A chart should stand alone with refresh time, comparison, and context, including on small screens.                                            | Keep the long and short values visible beside the graphic. Make the report age, ±2% target, and trust boundary explicit.          |

## Directions considered

1. **3D trading room:** cinematic, but hard to read on phones and too easy to imply precision from visual effects.
2. **Oversized circular speedometer:** familiar, but generic and it hides the fact that the long and short have different sources.
3. **Exposure plate:** a wide, code-native instrument with two equal-scale arcs, a central net reading, source labels, and an integrated audit strip. This keeps the counterweight metaphor legible and the provenance visible. **Selected.**

## Rules for the exposure plate

- Match arc scales exactly. Their lengths encode comparable USD notional, starting at the same pivot.
- Do not show a balanced-looking short arc or net value when the report is stale or unavailable. An illustrative reading must be visibly labeled as an example.
- Make the MON value, manager-reported short notional, and manager capital three visibly separate numbers.
- Put report time and status ahead of yield. Yield stays secondary and retains its trailing-window explanation.
- Render the arcs in responsive SVG; render labels and values as HTML so phone typography remains readable and accessible.

---
date: 2026-09-15
category: bug
issue: none
plan: docs/plans/2026-09-15-airport-airline-code-normalization.md
tags: [ai, travel, prompt, telemetry, observability]
---

# Airport and airline codes from AI extraction

## Prompts

**2026-09-15 (after the 0.21.1 deploy)**

> Previously I recall we had a bug where sometimes the AI would return an airport name instead of
> an airport code. Can you confirm that this bug is fixed now?

Answer: no. No resolver existed, the prompt never asked for a code, and `airportCode`'s
first-word fallback titled a JFK flight "John".

**2026-09-15**

> Yes please go ahead and fix with /beanies-plan then proceed to /beanies-build-auto

**2026-09-15**

> no keep them together, they're the same lines. also, any travel itinerary should have the full
> airport name, so AI should be able to read that and return a proper 3 letter airport code as
> well as airline code.

**2026-09-15**

> just pass 4 is fine, go ahead and you cna also include the lambda redeploy with terraform if
> needed to update the lambda /beanies-build-auto

**2026-09-15 — the pivot**

> I find it strange that the AI model would not be able to associate an airport name with a 3
> letter code, given that this information is readily available on the internet - where exactly
> is this process failing?

The question that turned the work around. Measured answer: the model path was never the problem.
The code path resolved 4,159/4,159 airports and 135/135 airlines; every dangerous finding lived in
the local name→code matcher built as a "safety net", working from an OurAirports export whose
`city` column is inconsistent across co-located airports.

**2026-09-15**

> Yes - we should be askng the model to translate city or airport names to codes, as well as
> airlines names to airline codes, and not be writing logic to do it ourselves in our code - this
> is what we shyould be using AI for and it should be miuch more accurate and simpler. in the case
> the AI returns an answer with low confidence, we can fallback to the information in the original
> document or itinerary ratehr than try to solve it in code, as this case should be rate. please
> remove any unnecessary code written or city to airport code translation tables and go back to
> what would be the simplest possible approach here, which is to use the AI model. if any
> questions or concerns let me know

## Outcome

The prompt does the translation; there is no local translation table. `PROMPT_VERSION`
`2026-09-15.3`, applied to the `ai-extract` Lambda by hand (terraform) and verified live.

Shipped: `carriedCode()` as the single code extractor shared by the title builder, the carrier
label and the extraction telemetry; `airportCode`'s first-word fallback replaced with the whole
string; `flightCodeLabel` printing the carrier once and no longer dropping a flight number that
has no airline; and the `segment_count`/`target_kind` telemetry keys — never allowlisted, so
dropped by `redactContext` since #30 — remapped to the allowlisted `kind`/`count` plus an
`inferred_count` integer.

Deleted before shipping: a 4,159-row local resolver (`src/utils/travelCodes.ts`), built to the
approved plan, then measured and found to write confidently wrong airports into the CRDT at its
highest-confidence outcomes. Three `/code-review max` rounds; the full record, including the
regression my own fixes introduced (`LOS ANGELES (LAX)` → Lagos) and the items carried forward,
is in the plan file's superseded section.

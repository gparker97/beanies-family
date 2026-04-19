# ADR-022: The Pod — Family Data Architecture

- **Status:** Accepted
- **Date:** 2026-04-19

## Context

The Family area of beanies.family was a functional member list — add / edit / remove beanies, tag a role. It captured none of the personal, memorable, or safety-critical content families actually want to track about each other.

**The Pod** replaces it with a six-capability hub built on top of the existing MVO + Automerge + photo foundations:

1. **Meet the Beans** — redesigned member roster with live highlights
2. **Bean Detail** — per-member detail page with 6 content tabs (Overview / Favorites / Sayings / Allergies / Medications / Notes)
3. **Care & Safety** — cross-family health view aggregating allergies + medications
4. **Family Cookbook** — recipes, ingredients, cooking notes, 5-star cook log
5. **Emergency Contacts** — family phonebook for sitters, grandparents, doctors
6. **Family Scrapbook** — merged feed of favorites + sayings + notes across every bean

The Pod ships **8 new Automerge collections**, **6 new pages**, **7 new form modals**, **9 shared extractions**, a sidebar sub-nav refactor, and first-consumer photo integrations for recipes, medications, cook logs, and family-member avatars. It was built in 6 phases (P1 foundation → P6 scrapbook) over ~2 weeks.

This ADR captures the architectural decisions taken during that build so the rationale survives rewrites.

## Decisions

### 1. Per-type Automerge collections, not one unified `scrapbookItems` map

Favorites, sayings, notes, allergies, medications, recipes, cook logs, and emergency contacts each live in their own top-level collection on `FamilyDocument`. An earlier design considered a single `scrapbookItems` collection with a `type` discriminator.

**Why per-type:**

- **Strong types end-to-end.** A `Favorite` has `category`, `recipeId`; an `Allergy` has `severity`, `avoidList`. A union type would have forced every consumer to type-narrow before reading.
- **Independent evolution.** When we add species info to pets (#170), medication reminders, or recipe nutrition, only the affected collection changes. A unified map would force every consumer to re-check their type discriminator.
- **Photo cascade clarity.** `photoStore.registerPhotoCollection(name)` is called per collection. Per-type makes the GC graph obvious.
- **Merge semantics.** Automerge merges happen at the collection level. Separating collections by type means a concurrent-edit conflict on a cook log never risks touching an unrelated allergy entry.

Cost: 8 near-identical repositories. Mitigated by `createAutomergeRepository<Entity, ...>('name')` — each store is ~30 lines of boilerplate wrapping the factory.

### 2. No encryption — inherited from ADR-021

Pod content (recipe text, sayings, allergies, medications, notes) lives inside the same `.beanpod` Automerge document that's already AES-GCM encrypted under the family key. Photos on recipes / medications / cook logs / avatars follow the ADR-021 pattern: bytes in the user's shared Drive folder, metadata in the encrypted document. No new crypto surface.

### 3. Caveat font as a third brand-sanctioned accent

[beanies CIG v2](../brand/beanies-cig-v2.html) defined two fonts: **Outfit** (headings / values) and **Inter** (body). The Pod adds **Caveat** as an accent-only handwritten font.

Scope (enforced in `.claude/skills/beanies-theme/SKILL.md`):

- Saying quotes, polaroid captions, recipe notes, informal taglines, "shhh…" asides
- **Never** for UI labels, form fields, navigation, body text, amounts, or chrome

~14kB gzipped latin subset. CSS fallback to Outfit italic so a webfont failure degrades gracefully.

**i18n:** Caveat is latin-only. Chinese sayings fall back to Outfit italic via `font-family: 'Caveat', 'Outfit', cursive`. Acceptable v1. Future: `Ma Shan Zheng` (Google Fonts, free) as the zh handwritten accent — the extension path is this same CSS fallback chain.

### 4. `navigator.share({ files })` with download fallback — not a reuse of `ShareInviteModal`

Emergency Contacts' share-as-image flow (scheduled but deferred past v1) uses the Web Share API with files. We verified at plan time that `ShareInviteModal` is **link-only** — it composes WhatsApp / Telegram / Email URLs from a share link — so it can't accept a Blob.

Two paths, no middle ground:

- `navigator.share({ files })` when `navigator.canShare({ files: [...] })` is available (mobile + modern browsers)
- Download-link fallback (`<a download>`) for desktop and older browsers

Error distinction: `AbortError` (user canceled) is silent; `NotAllowedError` (blocked by iframe / browser policy) surfaces a specific "sharing is blocked, try downloading" toast; other errors get a generic toast + `console.warn('[shareAsImage] ...', err)`.

Clipboard-copy was considered and dropped — adds a third path with marginal value.

### 5. Two-level sidebar nesting via `AppSidebarSubNav`

The pre-Pod sidebar was one-level: section headers + flat items. The Pod needs sub-items (Meet the Beans / Scrapbook / Cookbook / Care & Safety / Emergency Contacts) under a single "The Pod" parent.

`AppSidebarSubNav.vue` is extracted and shared between `AppSidebar` (desktop) and `MobileHamburgerMenu` (mobile). Expand/collapse state is module-scoped in `useSidebarAccordion` and persisted to `localStorage`, so it stays synced across viewports. Clicking the parent item navigates to its `path` **and** expands; clicking the chevron toggles expansion only (`event.stopPropagation()`).

Sub-nav active state mirrors the parent's orange-gradient + left-stripe pattern, at an indented scale. "The Pod" stays highlighted while any `/pod/*` descendant is active.

### 6. DRY cadence — extract shared components in the phase of first appearance

An early proposal called for a generic `ContentCard.vue` shell backing all 7 content cards (favorites / sayings / notes / allergies / medications / recipes / contacts). Dropped: cards vary too much (sticky-note vs photo-first vs multi-section) and a shell would force every card into a branch-on-type spaghetti.

Instead, 9 targeted extractions, each lifted in the phase of first appearance (not at the end):

| Component            | First phase | Why shared                                                                        |
| -------------------- | ----------- | --------------------------------------------------------------------------------- |
| `StickyNote`         | P2          | Sayings tab · Meet-the-Beans rail · Scrapbook item · Overview module (4 surfaces) |
| `MemberAvatarDot`    | P1          | Highlights strip · Scrapbook filters · Care & Safety rows · Contacts headers (4+) |
| `MemberPill`         | P4          | Recipe cards · Recipe detail · Favorites bean indicators (3)                      |
| `PolaroidImage`      | P4          | Recipe hero · Cook log dish snap · Scrapbook photo item (3)                       |
| `OverviewModule`     | P2          | 6 Bean Overview dashboard modules                                                 |
| `StatStrip`          | P2          | Cookbook hero · Care & Safety · Cook Log stats · Bean Overview (4)                |
| `AddTile`            | P2          | 6 grid surfaces                                                                   |
| `AppSidebarSubNav`   | P1          | Pod sub-nav desktop + mobile                                                      |
| `ShareAsImageButton` | P5          | Emergency Contacts (scheduled, deferred)                                          |

### 7. No-silent-catches policy + `[moduleName]` log prefix

Every new async path uses `wrapAsync()` (from `useStoreActions`), which auto-toasts on error and resets `isLoading`. Raw `try/catch` without handling is forbidden.

Every `console.warn` / `console.error` in new code includes:

1. `[moduleName]` prefix
2. What operation failed
3. The error object
4. Optionally a hint comment when the fix is non-obvious

Example: `console.warn('[photoStore] replacePhotoFile failed for', photoId, err)`.

Enforced in phase-end PR review via grep:

```bash
grep -r "catch\s*{}\|\.catch(\s*()\s*=>\s*{})" src/   # no silent catches
grep -r "console\.\(warn\|error\)" src/<new-files>     # all must be prefixed
```

### 8. Presentation-free data types

Entity types describe **what** the data is, not **how** it's displayed. We did NOT add `MemberNote.accent?` — the component picks an accent by index or content category. Same for stat cards, cook-log rating rendering, etc.

Prevents data migrations when we restyle. Review every new optional field with "is this information about the world, or about the UI?" — if the latter, it belongs in the component, not the entity.

### 9. Page composition over god-pages

Every page that aggregates across multiple domains **composes** — it imports zero entity stores directly. Instead, each sub-module (e.g. `OverviewFavoritesModule`, `OverviewSayingsModule`, `OverviewAllergiesModule`) imports its own store.

Applied on:

- `BeanOverviewTab` — 6 overview modules, each imports its own store
- `MeetTheBeansPage` right sidebar — heads-up-allergies imports `allergiesStore`; today's-care imports `medicationsStore`; events imports `activityStore`

The page itself only imports `familyStore` (for the roster) and routing state.

No barrel files that re-export domain stores. Keeps import paths explicit so a refactor can grep-find every touch point.

### 10. Pet Beans as an `isPet` flag, not a separate entity

Pets live as `FamilyMember` records with `isPet: true` (additive, non-breaking). They keep `role: 'member'` internally — the role is never surfaced for pets — and `requiresPassword: false`, `canViewFinances/Edit/ManagePod: false` are forced off on save as defense-in-depth.

**Why same entity:**

- Pets have names, genders, birthdays, colors, favorites, allergies, and medications — the exact `FamilyMember` shape.
- A separate `pets` collection would mean duplicating the content-store `byMember` getters for each of 5+ types (favorites, sayings, notes, allergies, medications).
- Pod surfaces that should hide pets from human-only pickers (invite counts, activity assignees — see #171) filter via `!m.isPet` on the already-unified member list.

Pets always render the `pet-dog` avatar variant regardless of gender/age, via `getMemberAvatarVariant({ ..., isPet })`. Callers must pass the flag — cherry-picking only `{ gender, ageGroup }` is the bug class we watch for.

Future: pet species variants (#169), pet-specific fields (#170), audit non-family surfaces (#171).

## Consequences

**Positive:**

- Adding a new per-type collection (e.g. pet-specific vet visits) follows a known template: entity type → repository → store → form modal → card. No cross-cutting changes.
- Photo integrations reuse the ADR-021 foundation end-to-end. Each new photo-owning collection calls `registerPhotoCollection(name)` and inherits GC.
- The sidebar + `AppSidebarSubNav` pattern can carry future nested nav (e.g. The Treehouse → Activities → calendar/list views).
- Error-handling and logging conventions are explicit and auditable.

**Negative / to monitor:**

- 8 near-identical stores/repositories is some boilerplate. The plan prototyped `createMemberScopedStore<T>` as a potential consolidation — deferred. Revisit if the count keeps growing.
- `isPet` filtering at call sites (vs a typed discriminator) is easy to forget; #171 captures the audit.
- `html-to-image` dep decision for P5 share-as-image still pending.

## Related

- [ADR-017](017-record-level-merge-sync.md) — Automerge record-level merge
- [ADR-018](018-automerge-crdt-migration.md) — CRDT migration baseline
- [ADR-021](021-photo-storage.md) — Photo storage (foundation for Pod photos)
- Plan: `docs/plans/2026-04-19-the-pod-scrapbook-cookbook.md`
- Mockup: `docs/mockups/family-pod-scrapbook.html`
- Pet follow-ups: #169 (species variants), #170 (pet fields), #171 (visibility audit)

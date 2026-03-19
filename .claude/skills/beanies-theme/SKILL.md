# beanies.family Brand Theme Skill

Use this skill whenever writing UI copy, designing components, choosing colors, writing code comments or error messages, or generating any content for the beanies.family app. All output must be consistent with the Corporate Identity Guidelines v2 (`docs/brand/beanies-cig-v2.html`).

---

## Identity

- **App name:** `beanies.family` (always lowercase, always with the `.family` TLD — never "Beanies", "beanies", or "Beanies Family")
- **Tagline:** *every bean counts* (lower case, no period)
- **Origin story:** A parent lovingly called their child "beanie." That nickname became the heart of a product built to help families grow together — financially and emotionally.
- **Core promise:** "We don't just count beans; we grow them."
- **Brand intersection:** The brand exists where the serious responsibility of financial planning meets the gentle, joyful chaos of family life. Warmth, clarity, and playful confidence.

---

## Colors — The Five-Colour Palette

| Name | Hex | Role | Use for |
|------|-----|------|---------|
| Deep Slate | `#2C3E50` | Anchor · Trust | Sidebar, headings, parent bean, nav backgrounds, body text |
| Heritage Orange | `#F15D22` | Energy · Action | CTAs, alerts, active states, growth arrow, celebrations |
| Sky Silk | `#AED6F1` | Calm · Safety | Backgrounds, child hat, secondary accents, data visualisation |
| Terracotta | `#E67E22` | Humanity · Warmth | Gradient partner to Orange, milestones, personal touches |
| Cloud White | `#F8F9FA` | Space · Clarity | Page backgrounds, cards, breathing room, content areas |

### Critical Color Rules

- **Heritage Orange is the alert colour — never use Alert Red.** Financial apps commonly use red for warnings, but beanies.family deliberately avoids this. Red creates anxiety. Heritage Orange delivers the same visual prominence with warmth instead of alarm. Budget overruns, missed targets, and notifications all use Heritage Orange.
- **Negative financial values** use Heritage Orange (never red)
- **Positive financial values** use soft green (`#27AE60`)
- **Neutral financial values** use slate grey
- Heritage Orange replaces all primary `blue-*` usage throughout the UI
- Keep `red-*` only for destructive actions (delete buttons) and hard form validation errors
- Keep `green-*` for income indicators
- **To-Do purple accent:** `#9B59B6` — used for to-do elements, task badges, and Family To-Do page accents

### Dark mode

- Background: Deep Slate `#2C3E50` and darker variants (`#1a252f`, `#243342`)
- Surfaces: `#34495E` (lighter slate)
- Accent: Heritage Orange `#F15D22` (slightly muted: `#E0551F` on dark surfaces)
- Text: `#ECF0F1` (light), `#BDC3C7` (muted)
- Borders: `#4A6274`
- Keep existing Tailwind `dark:` prefix pattern, swap in brand colors

### Tinted Backgrounds

Icon containers use colour-tinted backgrounds at 8–20% opacity rather than solid fills. This creates depth without heaviness.

| Tint | CSS Variable | Value |
|------|-------------|-------|
| Orange 8% | `--tint-orange-8` | `rgba(241, 93, 34, 0.08)` |
| Orange 15% | `--tint-orange-15` | `rgba(241, 93, 34, 0.15)` |
| Silk 10% | `--tint-silk-10` | `rgba(174, 214, 241, 0.1)` |
| Silk 20% | `--tint-silk-20` | `rgba(174, 214, 241, 0.2)` |
| Slate 5% | `--tint-slate-5` | `rgba(44, 62, 80, 0.05)` |
| Slate 10% | `--tint-slate-10` | `rgba(44, 62, 80, 0.1)` |
| Success 10% | `--tint-success-10` | `rgba(39, 174, 96, 0.1)` |

---

## Typography

### Six-Level Typography Scale

All text in the app must use one of these six standard levels. **No custom `text-[X.Xrem]` sizes — only standard Tailwind classes.** Minimum font size is `text-xs` (12px / 0.75rem).

| Level | Class | Size | Font | Weight | Use |
|-------|-------|------|------|--------|-----|
| Display | `text-3xl` / `text-4xl` | 30–36px | Outfit | 800 | Hero numbers (net worth, budget spent, large emoji accents) |
| Page Title | `text-2xl` | 24px | Outfit | 700 | Page headers ("Transactions", "Family To-Do") |
| Section Title | `text-lg` | 18px | Outfit | 600 | Section headers, modal titles, BeanieFormModal title |
| Item Title | `text-base` | 16px | Outfit | 600 | List items, card titles, form select values |
| Body | `text-sm` | 14px | Inter | 400 | Descriptions, body text, form labels, activity details, save button text |
| Caption | `text-xs` | 12px | Inter/Outfit | varies | Badges, timestamps, meta text, chips, pill labels, table headers |

### Rules

- **Minimum size:** `text-xs` (0.75rem / 12px) — no text smaller than this
- **Standard classes only:** Use `text-xs`, `text-sm`, `text-base`, `text-lg`, `text-xl`, `text-2xl`, `text-3xl`, `text-4xl`. Never use custom `text-[X.Xrem]` for font sizes
- **Font families:** Outfit = headings, values, emphasis, navigation, amounts. Inter = body text, data tables, form descriptions, prose
- **Financial figures** always use Outfit — they must be clear and easy to read
- **UI labels** (form field headers, section labels): Outfit, `text-xs`, weight 600, uppercase, tracking 0.08em, 35–45% opacity
- **Financial amounts:** Outfit, `text-3xl`+, weight 800

### Exceptions

These specific elements may use custom sizes for decorative purposes:
- Dropdown arrows (`▼`) at `text-[0.5rem]` — purely decorative
- Brand tagline "every bean counts" — intentionally small italic
- "NEW" sidebar badges — decorative indicator
- Background decorative emoji (e.g., large watermark emoji)

### Font Loading

```html
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
```

### Financial Value Styling

- Negative values: Heritage Orange (never red)
- Positive values: soft green (`#27AE60`)
- Neutral values: slate grey

---

## Text Casing Standard

`uiStrings.ts` uses a dual-value system — every entry has an `en` value (standard English) and a `beanie` value (cosmetic overlay):

| Layer | Rule | Example |
|-------|------|---------|
| **`en` (English)** | Title Case for labels/headers, Sentence case for sentences | `en: 'Family Planner'`, `en: 'No transactions yet.'` |
| **`beanie` (Beanie mode)** | All lowercase — the casual personality layer | `beanie: 'our plans 📅'`, `beanie: 'no transactions yet.'` |

### Rules by category

| Category | `en` value | `beanie` value |
|----------|-----------|----------------|
| **Page headers** (AppHeader) | Title Case | all lowercase |
| **Nav items** | Title Case | lowercase + emoji |
| **Section titles, form labels** | Title Case (CSS `uppercase` for display) | all lowercase |
| **Non-sentence text** (buttons, chips, labels) | Title Case | all lowercase |
| **Full sentences** | Sentence case | all lowercase |

- Every entry in `uiStrings.ts` must have both `en` and `beanie` values
- Brand constants (`app.name`, `app.tagline`, `app.version`) are exceptions — no beanie value needed
- Greeting strings: `en: 'Good evening,'` / `beanie: 'good evening,'`
- CSS `uppercase` handles visual uppercasing for section headers and form labels

---

## Logo & Mascot Rules

- **Wordmark:** "beanies.family" in Outfit 700 — "beanies" in white/Deep Slate, ".family" in Heritage Orange
- **Tagline lockup:** "every bean counts." in italic below the wordmark (0.5rem, 25% opacity, tracking 0.06em)
- **Symbol:** A parent bean in Deep Slate blue wearing a Heritage Orange beanie hat, holding hands with a smaller child bean in Heritage Orange wearing a Sky Silk hat. An upward-trending Heritage Orange arrow rises behind them.
- **The Golden Rule:** The beanies hold hands to show they are together as a family. **Never separate them. Never rotate the arrow.**
- **Clear space:** 2× hat height on all sides
- **Min size:** 48px height (digital)
- **Format:** SVG preferred, PNG at 2×
- **On Cloud White backgrounds:** Full colour
- **On Deep Slate backgrounds:** Wordmark inverts to white
- **On Heritage Orange backgrounds:** Arrow becomes white, parent bean retains Deep Slate
- **Never** place the logo on busy imagery without a solid backing shape

---

## Visual Assets

All assets in `public/brand/`.

| Asset | File | Usage |
|-------|------|-------|
| Logo (full, transparent) | `beanies_logo_transparent_*.png` | Sidebar, header, overlays, dark mode |
| Favicon | `beanies_favicon_transparent_*.png` | Browser tab icon |
| Apple Touch Icon | `beanies_apple_touch_icon_transparent_180x180.png` | iOS home screen |
| Spinner | `beanies_spinner_transparent_192x192.png` | Loading animations |
| Celebrating (circle) | `beanies_celebrating_circle_transparent_*.png` | Toast celebrations (auto-dismiss) |
| Celebrating (line) | `beanies_celebrating_line_transparent_600x600.png` | Modal celebrations (with dismiss) |
| Covering eyes | `beanies_covering_eyes_transparent_512x512.png` | Privacy/hidden state, encrypted data |
| Open eyes | `beanies_open_eyes_transparent_512x512.png` | Visible/exposed state, unencrypted data |
| Impact bullet | `beanies_impact_bullet_transparent_192x192.png` | Bullet points, alerts, flair, watermark |
| Plus sign | `beanies_plus_sign_512x512.png` | Add/create actions |
| Father icon | `beanies_father_icon_transparent_360x360.png` | Adult male family member avatar |
| Mother icon | `beanies_mother_icon_transparent_350x350.png` | Adult female family member avatar |
| Baby boy icon | `beanies_baby_boy_icon_transparent_300x300.png` | Child male family member avatar |
| Baby girl icon | `beanies_baby_girl_icon_transparent_300x300.png` | Child female family member avatar |
| Neutral icon | `beanies_neutral_icon_transparent_350x350.png` | Gender-neutral family member avatar |
| Family icon | `beanies_family_icon_transparent_384x384.png` | Family group avatar (filter "all") |

### Icon usage guide

| Situation | Asset to use |
|-----------|-------------|
| Privacy mode active (figures hidden) | `beanies_covering_eyes_transparent_512x512.png` |
| Privacy mode off (figures visible) | `beanies_open_eyes_transparent_512x512.png` |
| Data encrypted | `beanies_covering_eyes_transparent_512x512.png` |
| Data not encrypted / exposed | `beanies_open_eyes_transparent_512x512.png` |
| Feature bullet point | `beanies_impact_bullet_transparent_192x192.png` |
| Warning / alert / attention needed | `beanies_impact_bullet_transparent_192x192.png` |
| Watermark / background flair | `beanies_impact_bullet_transparent_192x192.png` at low opacity |
| Adult male family member | `beanies_father_icon_transparent_360x360.png` |
| Adult female family member | `beanies_mother_icon_transparent_350x350.png` |
| Child male family member | `beanies_baby_boy_icon_transparent_300x300.png` |
| Child female family member | `beanies_baby_girl_icon_transparent_300x300.png` |
| Gender-neutral member (adult or child) | `beanies_neutral_icon_transparent_350x350.png` |
| Family group / "all members" filter | `beanies_family_icon_transparent_384x384.png` |

### Transparent vs Opaque selection

- **Transparent:** Use wherever the image overlays content, colored backgrounds, or dark mode surfaces (sidebar logo, header branding, celebration overlays, watermarks, dark mode)
- **Opaque:** Use for standalone display on white/light backgrounds (login hero, favicon source)

---

## The Pod

Four organic bean shapes representing the brand's four colour pillars. They must always appear in order: **Slate, Terracotta, Orange, Sky Silk**.

**Usage:** Loading bars, footer accents, watermarks, celebration states, progress indicators, section dividers.

**Golden Rule:** The Pod must never be recolored, reordered, or separated. The beanies must always hold hands.

---

## The Pod Spinner

- Use `beanies_spinner_transparent_192x192.png` as the animated loading spinner
- Color order of the bean sequence: **Slate, Terracotta, Orange, Sky Silk** (always)
- The beans spin; the loading text stays stationary
- Loading text: **"counting beans..."** (never "Loading...", never "Please wait")

---

## UI Design System — The Nook UI

A comprehensive component system built from the brand's DNA. Every element uses squircle corners (24px+ radius), soft shadows only, and the five-colour palette.

### Shape Language

All cards, buttons, modals, and containers use 24px+ border radius (squircle corners). **Never use sharp corners.** This creates the soft, approachable feel that distinguishes beanies from typical finance apps.

| Component | Radius |
|-----------|--------|
| Buttons | `rounded-2xl` (1rem) |
| Cards | `rounded-3xl` (1.5rem) / `rounded-[var(--sq)]` (24px) |
| Inputs, Selects | `rounded-xl` (0.75rem) |
| Modals | `rounded-3xl` (1.5rem) |
| Badges/chips/pills | `rounded-full` or `border-radius: 20px` |
| Nav items | `rounded-2xl` |
| Icon containers | `rounded-[14px]` (squircle) |

### Shadows

Shadows are always diffused and subtle. No hard drop shadows, no dark borders. Elevation is implied, never harsh.

| Shadow | Value | CSS Variable |
|--------|-------|-------------|
| Card shadow | `0 4px 20px rgba(44, 62, 80, 0.05)` | `--card-shadow` |
| Card hover | `0 8px 32px rgba(44, 62, 80, 0.1)` | `--card-hover-shadow` |
| Soft shadow | `0 8px 40px rgba(44, 62, 80, 0.08)` | `--soft-shadow` |

### Card Styling

```
Cards: rounded-3xl (24px), shadow var(--card-shadow)
Hover: translateY(-2px) + shadow var(--card-hover-shadow)
Transition: transform,box-shadow 200ms
```

### Pill Tags

Status indicators, role labels, and category tags use pill-shaped elements (border-radius: 20px) in brand tints. Examples: "On Track" in orange-10, "Feb 2026" in silk-20.

### Progress Bars

All progress uses rounded bars (10px radius) with Heritage Orange → Terracotta gradient fills. Alternative: Sky Silk gradient for secondary goals. Always on a slate-05 track.

### Celebration States

Completed goals transform into Heritage Orange → Terracotta gradient cards. Toast notifications slide in with the brand gradient and a party emoji. Celebratory, never mechanical.

### Chart System

- Net worth charts use a Heritage Orange line with gradient fill beneath (orange at 30% → transparent)
- Subtle grid lines at 4% white opacity
- A glowing dot marks the current value
- Time period selector (1W / 1M / 3M / 1Y / All) uses pill-style buttons
- Active state: Heritage Orange at 40% opacity with soft glow
- Inactive states: white at 35% opacity

### Focus Rings

```css
/* Primary inputs/buttons */
ring-2 ring-[#AED6F1] ring-offset-2  /* Sky Silk ring */

/* Destructive buttons only */
ring-2 ring-red-300 ring-offset-2
```

### Component Styling Quick Reference

```
BaseButton (primary):  bg-[#F15D22] hover:bg-[#D14D1A] text-white rounded-2xl
BaseButton (secondary): bg-[#2C3E50] hover:bg-[#1a252f] text-white rounded-2xl
BaseCard:              bg-white dark:bg-slate-800 rounded-3xl shadow-[var(--card-shadow)]
BaseInput:             rounded-xl focus:ring-[#AED6F1]
BaseSelect:            rounded-xl focus:ring-[#AED6F1]
BaseModal:             rounded-3xl
Active nav item:       orange gradient bg + 4px Heritage Orange left bar
Progress bars:         Heritage Orange → Terracotta gradient, 10px radius
```

### Modal System — Three-Tier Architecture

The app uses a three-tier modal system. **Always use the appropriate tier** — never build modals from scratch.

#### Tier 1: `BaseModal.vue` — Foundation

The raw modal shell. Use directly only for non-form content (view-only displays, confirmations, custom layouts).

| Prop | Type | Default | Purpose |
|------|------|---------|---------|
| `open` | boolean | required | Show/hide |
| `title` | string | — | Header text |
| `size` | `'sm'`\|`'md'`\|`'lg'`\|`'xl'`\|`'2xl'` | `'md'` | Max width |
| `closable` | boolean | `true` | Show X button, allow Escape key |
| `fullscreenMobile` | boolean | `false` | Full viewport on mobile |

**Slots:** `default` (body), `#header` (custom header), `#footer` (action area)

**Built-in behavior:** Teleport to body, backdrop click to close, Escape key, body scroll lock, fade+scale transitions (200ms).

```
Backdrop:  bg-black/50
Shape:     rounded-3xl (desktop), rounded-none (fullscreen mobile)
Header:    px-6 py-4, border-b
Body:      p-6, overflow-y-auto
Footer:    px-6 py-4, border-t, bg-gray-50 dark:bg-slate-900, rounded-b-3xl
```

#### Tier 2: `BeanieFormModal.vue` — Branded Form Wrapper

Extends BaseModal with the standard form layout. **Use this for ALL create/edit forms.**

| Prop | Type | Default | Purpose |
|------|------|---------|---------|
| `open` | boolean | required | Show/hide |
| `title` | string | required | Header text (Outfit `text-lg` bold) |
| `icon` | string | — | Emoji displayed in icon box |
| `iconBg` | string | `var(--tint-orange-8)` | Icon box background |
| `size` | `'default'`\|`'narrow'` | `'default'` | Maps to BaseModal `xl`/`lg` |
| `saveLabel` | string | `t('action.save')` | Save button text |
| `saveGradient` | `'orange'`\|`'purple'` | `'orange'` | Save button gradient |
| `saveDisabled` | boolean | `false` | Disable save button |
| `isSubmitting` | boolean | `false` | Show spinner in save button |
| `showDelete` | boolean | `false` | Show 🗑️ delete button |

**Emits:** `@close`, `@save`, `@delete`

**Layout anatomy:**
```
┌─────────────────────────────────────┐
│  Header: [Icon Box 44×44] Title     │  px-6 py-4, border-b
├─────────────────────────────────────┤
│  Body: Cloud White bg (#F8F9FA)     │  -mx-6 -my-6, px-6 py-5
│  (negative margin extends to edges) │  dark: bg-slate-800/50
│  └─ space-y-5 for form fields      │
├─────────────────────────────────────┤
│  Footer: [🗑️ Delete] [Gradient Save]│  gap-3
└─────────────────────────────────────┘
```

**Icon box:** 44×44px, rounded-[14px] (squircle), tinted background. Use `var(--tint-orange-8)` for finance forms, `var(--tint-purple-12)` for to-do forms, `var(--tint-silk-20)` for family forms.

**Save button:** Full-width flex-1, rounded-[16px], py-3.5, Outfit `text-sm` bold. Gradient: `from-primary-500 to-terracotta-400` (orange) or `from-purple-500 to-purple-400` (purple). Spinner on submit.

**Delete button:** 48×48px, rounded-[14px], red tint bg (8%), 🗑️ emoji.

#### Tier 3: `ConfirmModal.vue` — Confirmation Dialogs

Triggered via `useConfirm()` composable. Never instantiate directly — use the composable pattern.

**Variants:** `danger` (red icon, for destructive actions) and `info` (orange icon, for informational confirms).

```typescript
const { confirm } = useConfirm();
const ok = await confirm({
  title: 'confirm.deleteTitle',
  message: 'confirm.deleteMessage',
  variant: 'danger',
});
```

### Modal Conventions — Rules

1. **Always use `fullscreenMobile`** on form modals (BeanieFormModal enables this automatically)
2. **View/Edit dual-mode pattern:** Read-only content uses BaseModal (Tier 1), edit mode uses BeanieFormModal (Tier 2). See `TodoViewEditModal.vue` as reference
3. **Form field spacing:** `space-y-5` inside modal body, `space-y-4` for grouped sub-sections
4. **Form grid:** `grid grid-cols-1 gap-4 sm:grid-cols-2` for side-by-side fields on desktop
5. **Form field labels:** Use `FormFieldGroup` component (label + optional badge + input wrapper)
6. **Conditional sections:** Use `ConditionalSection` component for show/hide sections
7. **Save button label:** Computed based on context (e.g., "Add to calendar", "Save changes", "Create task")
8. **Delete confirmation:** Always use `useConfirm()` with `variant: 'danger'` before deletion
9. **Sound effects:** Play `useSounds().playWhoosh()` on successful delete
10. **Watch for prop changes:** Reset form state when the edit target changes (watch `props.item` or similar)
11. **Emoji pickers:** Use `EmojiPicker` component for icon/type selection in forms
12. **Expandable details:** Use a "More details" toggle for advanced/optional fields

### Shared Form Components

These components are used inside BeanieFormModal forms. **Prefer these over building custom inputs.**

| Component | Purpose |
|-----------|---------|
| `FormFieldGroup` | Label + optional badge + input wrapper |
| `FamilyChipPicker` | Multi/single member select with avatars |
| `EmojiPicker` | Grid of emoji options for type/icon |
| `FrequencyChips` | Chip selector for recurring patterns |
| `DayOfWeekSelector` | Day-of-week multi-select |
| `TimePresetPicker` | Time input with common presets |
| `AmountInput` | Currency-aware number input |
| `TogglePillGroup` | Toggle between 2-3 options |
| `ConditionalSection` | Animated show/hide wrapper |

---

## Navigation

### Desktop Sidebar

The Deep Slate sidebar is the app's anchor. It houses the brand logo (actual logo image in squircle + wordmark with Heritage Orange ".family" + italic tagline), primary navigation organised into collapsible accordion sections, and user profile. At the bottom, subtle security indicators show the save filename and encryption status. Settings is pinned below the accordions.

**Accordion sections:**

| Section | Icon | Color | Items |
|---------|------|-------|-------|
| The Piggy Bank 🐷 | 🐷 | Heritage Orange tint | Overview, Accounts, Budgets, Transactions |
| The Treehouse 🌳 | 🌳 | Green (#6EE7B7) tint | Family Nook, Family Planner, Family To-Do, Family Hub |

**Settings** — pinned at sidebar bottom, outside both accordions.

**Active nav item:** Orange gradient background + 4px Heritage Orange left bar indicator. Nav items use `rounded-2xl`.

**Accordion behaviour:** Each section can expand/collapse independently. Navigating to a page auto-expands its parent accordion. Collapse arrows rotate on toggle.

### Desktop Header Toolbar

The header uses **visual icons instead of text labels**. All controls are image-based:

| Control | Implementation |
|---------|---------------|
| Family Filter | Stacked circular avatars (overlapping by 8px). Dropdown to filter by individual bean. Default: "All" |
| Currency | Currency code badge with dropdown arrow |
| Language | Country flag image (never text). Squircle button container |
| Privacy Mode | Eye icon with green dot when figures visible. Toggles all figures to "..." |
| Notifications | Bell icon with Heritage Orange dot for unread count |

**Critical Rule:** All header items must be visual/icon-based, never cold text. A flag, not "English". Avatars, not "All members". This maintains warmth and international accessibility.

### Mobile Navigation

**Mobile Header:** Only three elements — hamburger button, greeting ("Hi, [Name]"), and notification bell. Everything else lives in the hamburger menu.

**Hamburger Button Spec:** Three horizontal lines inside a squircle container. Top two lines are equal width in Deep Slate at 50% opacity. Bottom line is shorter and in Heritage Orange — a deliberate brand signature.

**Hamburger Menu Overlay:** Full-screen Deep Slate overlay with:
- Logo (actual logo image + wordmark with Heritage Orange ".family" + italic tagline)
- User profile card
- Controls: Family filter (stacked avatars), privacy toggle, language flag, currency selector
- Main nav: The Nook, Accounts, Budgets, Goals, Calendar
- Family & More: Family Hub, Documents, Settings
- Footer: Security indicators (save file + AES-256 encryption)

**Bottom Tab Bar:** Five tabs — 🏡 Nook, 📅 Planner, 🐷 Piggy Bank, 📋 Budget, 👨‍👩‍👦 Pod. Active tab uses Heritage Orange tint (orange-10 background). Icons are emoji-style for warmth.

---

## Dashboard Layout — "The Nook"

**Note:** In v7, the financial dashboard is now "The Piggy Bank — Finance Overview" and lives under The Piggy Bank 🐷 accordion. The Family Nook 🏡 is the new home screen after login (see Brand Vocabulary below). The Piggy Bank dashboard follows a strict layout hierarchy:

| Order | Element | Notes |
|-------|---------|-------|
| 1 | Greeting & Header | "Good morning, [Name]" + icon toolbar |
| 2 | Celebration Toast | Orange gradient banner for goal completions |
| 3 | Net Worth Hero Card | Deep Slate gradient + line chart + time period selector |
| 4 | 3× Summary Cards | Income (green) · Expenses (orange) · Cash Flow (Deep Slate gradient) |
| 5 | Family Beans Row | Circular gradient avatars with online indicators |
| 6 | Savings & Budget Cards | 2-column grid with progress bars |
| 7 | Goals + Upcoming Transactions | 2-column: goal progress bars + scheduled payments |

### Key Design Decisions

- **Upcoming, Not Recent:** The transaction panel shows upcoming scheduled payments rather than recent history. Families benefit more from knowing what's coming. It reduces financial anxiety by eliminating surprises.
- **Cash Flow as Hero Metric:** The third summary card uses a Deep Slate gradient to visually distinguish Cash Flow. A "Healthy" label and savings rate percentage makes it feel like progress.
- **Time Period Selector:** Pill-style buttons (1W / 1M / 3M / 1Y / All). Active: Heritage Orange at 40% opacity. Inactive: white at 35% opacity.

---

## Security & Privacy UI

Security is foundational but should feel safe, never scary. Security UI communicates protection through quiet confidence, not alarming padlocks.

| Indicator | Spec |
|-----------|------|
| Save Indicator | Filename (e.g. "bean_pod_greg.enc") + save icon at 30% opacity. Bottom of sidebar. |
| Encryption Badge | "AES-256 encrypted" + padlock icon in soft green (#6EE7B7 at 30% opacity) |
| Privacy Mode | Eye icon with green dot when visible. Toggles all figures to "..." |

**Design Principle:** Security indicators should be felt, not seen. They sit at low opacity (30%), use soft SVG icons, and blend into the sidebar. Users shouldn't actively notice them — but when they glance down, they feel quiet reassurance. Like a seatbelt indicator: always there, never screaming.

---

## Celebration Triggers

| Trigger | Asset | Mode | Message |
|---------|-------|------|---------|
| Create new pod | `beanies-celebrating-line.png` | Modal | "Pod created — ready to start counting your beanies!" |
| First bank account | `beanies-celebrating-circle.png` | Toast | "Your first bean is planted!" |
| First transaction | `beanies-celebrating-circle.png` | Toast | "Every beanie counts!" |
| Goal reached 100% | `beanies-celebrating-line.png` | Modal | "Goal complete! The beanies are proud!" |
| First file save | `beanies-celebrating-circle.png` | Toast | "Your beanies are safe and encrypted!" |
| Debt goal paid off | `beanies-celebrating-line.png` | Modal | "Debt-free! The beanies are celebrating!" |

**Implementation:** Toast: bottom-center, auto-dismiss 4s, subtle bounce-in. Modal: centered overlay with image, message, dismiss button. Track "first time" events in localStorage.

---

## Brand Voice & Writing Style

### The Five Principles

1. **Simple** — Plain language over jargon. Say "Beans" not "Liquid Assets"
2. **Friendly** — Warm and informal. Speak directly ("your beans", "your family")
3. **Comforting** — Warm greetings, celebrate milestones, acknowledge effort
4. **Secure** — Warmth backed by the promise of bank-grade local privacy
5. **Familiar** — Use names. Treat every activity as an investment in the family

### Brand Vocabulary

| Term | Meaning |
|------|---------|
| The Nook | Main dashboard |
| The Bean Pod | Family hub |
| Parent Bean | Adult family member |
| Little Bean | Child family member |
| Add Bean | Invite/add family member |
| Growing | Progress/savings state |
| The Piggy Bank 🐷 | Finance section (sidebar accordion) |
| The Treehouse 🌳 | Family section (sidebar accordion) |
| The Family Nook 🏡 | Home screen after login (family-first overview) |
| Family Planner 📅 | Calendar and scheduling hub |
| Family To-Do ✅ | Shared family task management |

### Preferred Phrasing

| Instead of | Say |
|-----------|-----|
| Loading... | counting beans... |
| Syncing... | Saving... |
| Sync File | Family Data File |
| File Sync | Family Data Options |
| Last Sync | Last Saved |
| Liquid Assets | Beans |
| Net Worth | Your bean count |
| Error saving | Hmm, we couldn't save your beans |

### Voice Examples

| Say | Not |
|-----|-----|
| "You're $360 away from your savings goal — almost there!" | "Warning: savings target not met this month." |
| "Goal Reached! Emergency Fund hit $10,000 — amazing work, family!" | "Savings goal #3 completed." |
| "Let beanies sort your spending automatically" | "Enable auto-categorisation of transactions" |

### Writing UI copy — checklist

- Does it feel warm and human?
- Does it use the user's name or family name where possible?
- Does it avoid "Alert Red" language (doom, error, fail) in favour of constructive framing?
- Does it celebrate progress, not just report it?
- Is it shorter than it needs to be?

### Drawing images and illustrations

- **The beanies characters** are round, simple, friendly bean shapes with hands
- The **parent bean** is blue/Deep Slate; the **child bean** is orange/Terracotta
- They always hold hands — never depicted separately
- Expressions are warm and celebratory — never stressed, never alarmed
- Background: warm whites (`#F8F9FA`), soft gradients in the brand palette
- **Never** depict the beanies with sharp angles, dark surroundings, or anxious expressions

---

## Do's and Don'ts

### Always Do

- Use Heritage Orange for all alerts — never Alert Red
- Maintain squircle corners (24px+) on all containers
- Use soft, diffused shadows only
- Keep the beanies together — parent and child always hold hands
- Use visual icons in the header (flags, avatars, badges) not text
- Show upcoming transactions, not just recent history
- Include security indicators (save file + encryption) in every sidebar
- Use warm, encouraging language in all notifications
- Celebrate goal completions with gradient toasts
- Keep the mobile header minimal: hamburger + greeting + bell only

### Never Do

- Use Alert Red for any purpose — budget overruns, errors, or warnings
- Use sharp corners or hard-edged shadows
- Separate the parent and child beanies in the logo
- Rotate, flip, stretch, or distort the logo
- Use cold, corporate language ("Transaction failed", "Error 403")
- Use text-only labels in the header instead of visual icons
- Crowd the mobile header with controls (move them to hamburger)
- Show security indicators at full opacity (always 30% max)
- Add the logo on busy imagery without a solid backing shape
- Recreate or redraw the bean characters

---

## Terminology (Enforced)

| Correct | Incorrect |
|---------|-----------|
| beanies.family | Beanies, beanies, Beanies Family, GP Family Planner, GP Family Finance |
| Every bean counts | Every Bean Counts, every bean counts. |
| Family Data File | Sync File |
| Family Data Options | File Sync |
| My Family's Data | Sync File (configured state) |
| Last Saved | Last Sync |
| Saving... | Syncing... |
| counting beans... | Loading... |

---

## v4 Component Reference

Dashboard and shared components implementing the Nook UI design system. Use these as patterns when building new views.

### Dashboard Components (`src/components/dashboard/`)

| Component | Purpose | Key Patterns |
|-----------|---------|-------------|
| `NetWorthHeroCard.vue` | Deep Slate gradient hero with Chart.js sparkline, time period pills, change indicators | Gradient bg, Outfit typography, privacy blur on chart, count-up animation |
| `SummaryStatCard.vue` | Income/Expenses/Cash Flow stat cards with tinted icon containers | Tinted squircle icons (38px), hover lift, count-up animation, privacy masking |
| `GoalProgressItem.vue` | Goal with progress bar, deadline, and percentage | Heritage Orange → Terracotta gradient bar, Outfit percentages |
| `FamilyBeanRow.vue` | Horizontal scroll of family member avatars with role labels | BeanieAvatar with colored ring, "Add Bean" button |
| `RecurringSummaryWidget.vue` | Monthly recurring income/expenses summary | BaseCard with stat rows, privacy masking |
| `ActivityItem.vue` | Single activity/transaction row | Icon + description + amount + time |

### UI Components (`src/components/ui/`)

| Component | Purpose |
|-----------|---------|
| `BaseButton.vue` | Primary/secondary/danger/ghost/outline variants, rounded-2xl |
| `BaseCard.vue` | Rounded-3xl card with optional title and shadow |
| `BaseInput.vue` | Rounded-xl input with label, error, hint |
| `BaseSelect.vue` | Rounded-xl select with grouped options support |
| `BaseCombobox.vue` | Searchable single-select with "Other" custom entry |
| `BaseModal.vue` | Rounded-3xl modal with teleport, escape key, backdrop |
| `BaseMultiSelect/` | Multi-select dropdown with scoped slots |
| `BeanieIcon.vue` | Universal icon component (stroke-width 1.75, round joins) |
| `BeanieAvatar.vue` | PNG avatar with colored ring + pastel background |
| `BeanieSpinner.vue` | Brand spinner ("counting beans...") |
| `ConfirmModal.vue` | Branded confirmation dialog (danger/info variants) |
| `CelebrationOverlay.vue` | Toast and modal celebrations |
| `EmptyStateIllustration.vue` | Beanie character empty state illustrations |

### Shared Constants

| File | Purpose |
|------|---------|
| `src/constants/icons.ts` | ~72 beanie-styled SVG icon definitions |
| `src/constants/navigation.ts` | Shared `NavItemDef[]` for sidebar + future mobile nav |
| `src/constants/avatars.ts` | Avatar variant → PNG path mappings |
| `src/constants/institutions.ts` | 22 predefined global banks for combobox |

---

## Onboarding / Create Pod Flow

The Create Pod flow (`src/components/login/CreatePodView.vue`) is a 3-step wizard accessed from the login page:

| Step | Title | Content |
|------|-------|---------|
| 1 | You | Pod name, your name/role, sign-in password |
| 2 | Save & Secure | Choose storage location, set pod encryption password |
| 3 | Family | Add family members (optional, can skip) |

### Design Patterns

- **Step indicator:** Horizontal steps with Heritage Orange active state
- **Navigation:** Back/Next buttons, disabled until validation passes
- **Brand voice:** Warm CTAs ("Grow a brand-new pod"), security reassurance
- **Storage options:** Local file (`.beanpod`), with cloud connectors coming soon
- **Celebration:** On completion, navigates to the dashboard with the new pod loaded

---

## Login & Authentication Flow — The Pod Journey

The UI framework introduces a **six-screen authentication flow** built around the Pod concept (an encrypted `.beanpod` data file). All screens are defined in `docs/brand/beanies-ui-framework-proposal-v7.html`.

### Screen Flow

| Step | Screen | Route | Purpose |
|------|--------|-------|---------|
| 0A | Welcome Gate | `/` | Three clear paths: sign in, create pod, join pod |
| 0B | Load Your Pod | `/load` | File picker + drag-drop zone + cloud storage connectors |
| 0B-2 | Unlock Your Pod | `/unlock` | Decrypt the loaded file with pod password |
| 0B-3 | Pick Your Bean | `/who` | Select family member from avatar grid |
| 0C | Create a New Pod | `/new-pod` | 3-step wizard: name/password → storage → invite |
| 0D | Join an Existing Pod | `/join` | Enter family code or paste magic link |

### Welcome Gate (0A)

Three horizontal cards: "Sign in to your pod" (white), "Create a new pod!" (Heritage Orange gradient, primary CTA), "Join an existing pod" (white, Sky Silk icon). Footer trust badges: "End-to-End Encrypted", "Bank-Grade Security", "Built with Love".

### Load Your Pod (0B)

"The most philosophically important screen" — replaces traditional login with file loading. Large dashed-border file drop zone with Heritage Orange upload icon. Accepts `.beanpod` files. Cloud storage connectors: Google Drive, Dropbox, iCloud. Three security messaging cards at bottom with tinted backgrounds.

### Unlock Your Pod (0B-2)

Compact centered card (400px). Deep Slate lock icon. Green checkmark showing loaded filename. Single password field. CTA: "Unlock Pod". Footer: "This password decrypts your local data. We don't store or recover it."

### Pick Your Bean (0B-3)

Wide card (520px) showing pod name and all family members. **Large 88px circular avatars** with gradient backgrounds. Green dot = onboarded/ready (password or passkey/biometric). Heritage Orange "+" = setup needed. Auth hint: "Onboarded beans can sign in with their password or passkey."

### Create New Pod (0C)

3-step wizard: (1) Pod Name + Your Name/Role + Pod Password, (2) Choose Storage (Google Drive, Dropbox, iCloud, Local — branded icons with Heritage Orange selected border), (3) Add Beans (invite family members). CTA: "Create My Pod".

### Join Pod (0D)

Single input accepting `BEAN-XXXX` code or `beanies.family/join/...` link. Dark "What happens next?" info card with numbered steps. CTA: "Join My Family's Pod". After verification → unlock → pick bean.

### Key Design Decisions

- **File format:** `.beanpod` encrypted files (not `.json`)
- **Encryption:** Always mandatory, AES-256 — no option to skip
- **Member auth:** Per-member password or passkey/biometric (passkeys are future phase)
- **No server accounts:** The file IS the auth database
- **Password recovery:** Explicitly unrecoverable — "We don't store or recover it"
- **Invite flow:** Users arriving via invite link skip the Welcome Gate entirely

---

## Reference

- Full CIG v2: `docs/brand/beanies-cig-v2.html`
- UI framework (v7): [beanies-ui-framework-proposal-v7.html](../../docs/brand/beanies-ui-framework-proposal-v7.html) — current UI framework defining page layouts, navigation, component patterns, and interaction design
- Modals framework (v1): [beanies-modals-framework-proposal-v1.html](../../docs/brand/beanies-modals-framework-proposal-v1.html) — modal system design and conventions
- Brand assets: `public/brand/`
- Issue #22: Full rebranding task tracking

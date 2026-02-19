# beanies.family Brand Theme Skill

Use this skill whenever writing UI copy, designing components, choosing colors, writing code comments or error messages, or generating any content for the beanies.family app. All output must be consistent with the Corporate Identity Guidelines (`docs/brand/beanies-cig.html`).

---

## Identity

- **App name:** `beanies.family` (always lowercase, always with the `.family` TLD — never "Beanies", "beanies", or "Beanies Family")
- **Tagline:** *Every bean counts* (sentence case, no period)
- **Origin story:** Born from a father's nickname for his son. The app is the focal point where piano lessons meet financial planning — a family legacy tool, not a spreadsheet.
- **Core promise:** "We don't just count beans; we grow them."

---

## Colors — The Sunrise Security Set

| Name | Hex | Role | Use for |
|------|-----|------|---------|
| Deep Slate | `#2C3E50` | The Foundation | Primary text, security, dark backgrounds |
| Heritage Orange | `#F15D22` | The Energy | Primary actions, CTA buttons, growth indicators |
| Sky Silk | `#AED6F1` | The Calm | Parent elements, backgrounds, light shadows |
| Terracotta | `#E67E22` | The Human | Children, personal milestones, warnings |

### Dark mode
- Background: Deep Slate `#2C3E50` and darker variants (`#1a252f`)
- Surfaces: `#34495E`
- Accent: Heritage Orange (slightly muted on dark surfaces)
- Text: `#ECF0F1` (light), `#BDC3C7` (muted)

### Rules
- **Never use "Alert Red"** for notifications or important messages — use Heritage Orange to keep the mood positive and secure
- Keep `green-*` for income indicators
- Keep `red-*` only for destructive actions and hard form validation errors
- Heritage Orange replaces all primary `blue-*` usage throughout the UI

---

## Typography

| Font | Weight | Use for |
|------|--------|---------|
| Outfit | 700 | Headings (h1, h2, h3) |
| Outfit | 500 | App name wordmark, subheadings |
| Outfit | 400 | Financial values and large numbers |
| Inter | 600 | Labels, column headers, strong body |
| Inter | 400 | Body text, data, table content |

- Financial figures always use Outfit — they must be clear and easy to read
- Numbers should emphasise the "Every bean counts" value proposition
- Google Fonts import: `Outfit:wght@400;500;700` and `Inter:wght@400;600`

---

## Logo & Mascot Rules

- **Wordmark:** "beanies.family" in Outfit Medium, Deep Slate `#2C3E50`
- **Tagline lockup:** Inter Regular, centered below wordmark
- **Symbol:** Blue parent + orange child holding hands, with an upward arrow — togetherness and financial momentum
- **The Golden Rule:** The beanies hold hands to show they are together as a family. **Never separate them. Never rotate the arrow.**
- **On light backgrounds:** Full color
- **On Deep Slate backgrounds:** Knockout white (all elements white)
- **On Heritage Orange backgrounds:** Knockout white

### Transparent brand asset files (in `public/brand/`)
- Logo: `beanies-logo-transparent.png`
- Spinner: `beanies-spinner-no-text-transparent.png`
- Watermark: `beanies-watermark-transparent.png`
- Celebration (line): `beanies-celebrating-line.png`
- Celebration (circle): `beanies-celebrating-circle.png`

---

## The Pod Spinner

- Use `beanies-spinner-no-text-transparent.png` as the animated loading spinner
- Color order of the bean sequence: **Blue → Terracotta → Orange → Slate** (always)
- The beans spin; the loading text stays stationary
- Loading text: **"counting beans..."** (never "Loading...", never "Please wait")
- Footer watermark: `beanies-watermark-transparent.png` at low opacity

---

## UI Design — The Nook

- **Shape language:** Squircles — use high corner radius (`rounded-2xl`, `rounded-3xl`) on all buttons and cards. Never use sharp corners.
- **Shadows:** Soft Sky Silk `#AED6F1` tinted shadows to make the UI feel lightweight
- **Border radius reference:**
  - Buttons: `rounded-2xl`
  - Cards: `rounded-2xl` or `rounded-3xl`
  - Inputs: `rounded-xl`
  - Modals: `rounded-3xl`
- **Celebrations:** Punctuate happy moments with celebratory images or animations from `public/brand/`

### Celebration triggers
| Trigger | Asset | Mode | Message |
|---------|-------|------|---------|
| Complete setup wizard | `beanies-celebrating-line.png` | Modal | Welcome message - "Setup complete - ready to start counting your beanies!" |
| First bank account | `beanies-celebrating-circle.png` | Toast | "Your first bean is planted!" |
| First transaction | `beanies-celebrating-circle.png` | Toast | "Every beanie counts!" |
| Goal reached 100% | `beanies-celebrating-line.png` | Modal | "Goal complete! The beanies are proud!" |
| First file save | `beanies-celebrating-circle.png` | Toast | "Your beanies are safe and encrypted!" |
| Debt goal paid off | `beanies-celebrating-line.png` | Modal | "Debt-free! The beanies are celebrating!" |

Toast: bottom-center, auto-dismiss 4s, bounce-in animation. Modal: centered overlay with dismiss button.

---

## Brand Voice & Writing Style

### The five principles
1. **Simple** — Plain language over jargon. Say "Beans" not "Liquid Assets." Say "Money in" not "Net positive cash inflow."
2. **Friendly** — Warm and informal. Speak directly to the user ("your beans", "your family"). Avoid cold, clinical phrasing.
3. **Comforting** — Use warm greetings, celebrate milestones, acknowledge effort.
4. **Secure** — Warmth is backed by the promise of bank-grade local privacy. Never make the user feel exposed.
5. **Familiar** — Use names. Treat every activity as an investment in the family.

### Preferred phrasing
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

### Writing UI copy — checklist
- Does it feel warm and human?
- Does it use the user's name or family name where possible?
- Does it avoid "Alert Red" language (doom, error, fail) in favour of constructive framing?
- Does it celebrate progress, not just report it?
- Is it shorter than it needs to be? (Remove every word that doesn't add warmth or clarity.)

### Drawing images and illustrations
When generating or describing brand images:
- **The beanies characters** are round, simple, friendly bean shapes with hands
- The **parent bean** is blue/Sky Silk; the **child bean** is orange/Terracotta
- They always hold hands — never depicted separately
- Expressions are warm and celebratory — never stressed, never alarmed
- Background style: warm whites (`#FDFBF9`), soft gradients in the Sunrise Security palette
- **Never** depict the beanies with sharp angles, dark surroundings, or anxious expressions
- The upward arrow (momentum) should feel optimistic — a gentle curve upward, not a steep or aggressive spike

---

## Terminology (Enforced)

| Correct | Incorrect |
|---------|-----------|
| beanies.family | Beanies, beanies, Beanies Family, GP Family Planner, GP Family Finance |
| Every bean counts | Every Bean Counts, every bean counts. |
| Family Data File | Sync File |
| Family Data Options | File Sync |
| Last Saved | Last Sync |
| Saving... | Syncing... |
| counting beans... | Loading... |

---

## Reference

- Full CIG: `docs/brand/beanies-cig.html`
- Brand assets: `public/brand/`
- Issue #22: Full rebranding task tracking

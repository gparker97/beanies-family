# ADR-012: Responsive Mobile Layout

> **Date:** 2026-02-22
> **Status:** Accepted (decisions made; implementation pending in Issue #63)

## Context

beanies.family is a PWA-enabled app that needs responsive mobile and tablet support. The desktop layout uses a permanent Deep Slate sidebar for navigation. This sidebar is too wide for mobile viewports (< 768px) and must be replaced with mobile-appropriate navigation patterns.

The v5 UI framework proposal (`docs/brand/beanies-ui-framework-proposal-v5.html`) defines the target mobile experience.

## Decisions

### 1. Hamburger menu for mobile navigation (not collapsible sidebar)

A collapsible sidebar was considered but rejected. On mobile, it either takes too much space when open or provides poor touch targets when collapsed to icons. A full-screen hamburger overlay provides:

- Complete navigation without viewport constraints
- Space for controls that don't fit in the mobile header (family filter, privacy toggle, language/currency selectors)
- Brand logo and security indicators in a natural location

### 2. Four-tab bottom navigation bar

Bottom tabs provide persistent one-tap access to the most-used screens:

| Tab      | Screen     | Rationale                          |
| -------- | ---------- | ---------------------------------- |
| Nook     | Dashboard  | Primary landing page               |
| Accounts | Accounts   | Most frequently accessed data      |
| Goals    | Goals      | Core motivational feature          |
| Pod      | Family Hub | Family-centric identity of the app |

Four tabs were chosen over five to maintain comfortable touch targets (minimum 48px) across all phone widths. Reports, Transactions, Forecast, and Settings are accessed via the hamburger menu.

### 3. Controls in hamburger menu, not mobile header

The mobile header contains only three elements: hamburger button, greeting text, and notification bell. All other controls (family filter, privacy toggle, language selector, currency selector) move into the hamburger overlay. This keeps the mobile header clean and avoids cramped touch targets.

### 4. Shared navigation constants

Navigation items are defined once in `src/constants/navigation.ts` as a `NavItemDef[]` array with `labelKey`, `path`, `emoji`, and `section` fields. Both the desktop sidebar and future mobile components consume the same constant, preventing drift between navigation structures.

### 5. Breakpoint strategy

| Breakpoint     | Layout                                                                      |
| -------------- | --------------------------------------------------------------------------- |
| < 768px        | Mobile: bottom tab bar + hamburger menu, single-column content              |
| 768px - 1023px | Tablet: hamburger menu (no bottom tabs), 2-column content where appropriate |
| >= 1024px      | Desktop: permanent sidebar, multi-column dashboard grid                     |

Tailwind CSS responsive prefixes (`sm:`, `md:`, `lg:`) handle layout shifts. Mobile-first approach: base styles target mobile, breakpoint prefixes add desktop complexity.

## Alternatives Considered

- **Collapsible sidebar**: Poor mobile UX, awkward icon-only collapsed state
- **Five-tab bottom nav**: Touch targets too small on narrow phones
- **Floating action menu (FAB)**: Considered for quick-add actions (Issue #37) but not for primary navigation

## Implementation Status

- Navigation constants extracted and consumed by desktop sidebar
- Mobile components (MobileBottomNav, MobileHamburgerMenu) not yet implemented
- Tracked in Issue #63

## References

- Issue #63: Mobile responsive bottom tab navigation, hamburger menu, and responsive layouts
- v5 UI proposal: `docs/brand/beanies-ui-framework-proposal-v5.html` (Mobile section)
- `src/constants/navigation.ts`: Shared navigation definitions

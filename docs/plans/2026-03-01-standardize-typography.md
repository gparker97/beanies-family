# Plan: Standardize Typography Across the App

> Date: 2026-03-01

## Context

Fonts across the app were inconsistently sized and often too small to read comfortably. The redesigned pages (Nook, Transactions, Budget, Dashboard) used many custom `text-[X.Xrem]` sizes as small as 0.55rem (8.8px). There was no standard typography scale — each page did its own thing.

## Approach

Established a six-level typography standard using only standard Tailwind classes with a 12px minimum:

| Level         | Class                   | Size    | Font         | Weight | Use                           |
| ------------- | ----------------------- | ------- | ------------ | ------ | ----------------------------- |
| Display       | `text-3xl` / `text-4xl` | 30–36px | Outfit       | 800    | Hero numbers                  |
| Page Title    | `text-2xl`              | 24px    | Outfit       | 700    | Page headers                  |
| Section Title | `text-lg`               | 18px    | Outfit       | 600    | Section headers, modal titles |
| Item Title    | `text-base`             | 16px    | Outfit       | 600    | List items, card titles       |
| Body          | `text-sm`               | 14px    | Inter        | 400    | Descriptions, body text       |
| Caption       | `text-xs`               | 12px    | Inter/Outfit | varies | Badges, timestamps, meta      |

Worked through 11 batches covering ~54 code files + 2 doc files, replacing all custom `text-[X.Xrem]` sizes with the nearest standard Tailwind class. Documented exceptions for decorative elements (dropdown arrows, brand tagline, "NEW" badges).

## Files affected

~54 Vue component files across all feature areas (UI, Dashboard, Todo, Nook, Transactions, Budget, Planner, Navigation, Modals, Login) plus `.claude/skills/beanies-theme.md` and `CLAUDE.md`.

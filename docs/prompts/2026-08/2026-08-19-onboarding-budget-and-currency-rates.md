---
date: 2026-08-19
category: bug-fix
issue: none — reported directly by greg from a new-family setup
plan: none — direct investigation and fix
tags: [onboarding, budget, exchange-rates, currency, settings, regression]
---

# 2026-08-19 — Onboarding: savings goal discarded + exchange rates never re-based

## Prompt 1

> There are a couple unrelated issues I hit while setting up a new family a couple days ago:
>
> 1. Even after setting the budget amount in the onboarding wizard (i.e. 20%), the budget wasn't set when i went into the app, and required me to set it again. I believe i left the slider in the onboarding wizard at 20% without moving it. Not sure if that is the reason it didn't get set, or if there are other bugs there, please do a check
> 2. As part of the onboarding wizard I added accounts in several currencies, but currency rates were not fetched, so all accounts showed the default currency, even though the amounts were in different currencies. I was able to fix this by going to settings and manually clicking the button to fetch latest rates, and after that everything was ok. A typical user would not know to do this though, this should always happen automatically.
>
> can you pls check and fix both issues

## Prompt 2

> commit these changes

## Outcome

**Issue 1 — not the slider.** `OnboardingWizard.handleFinish()` only called `setOnboardingCompleted(true)` and synced; `savingsPercent` was never persisted anywhere. It was threaded into the Savings step and rendered on the Complete summary ("20%"), which is why it appeared to have been set. Moving the slider or leaving it made no difference.

Fixed by creating an active percentage budget on finish (same shape `BudgetSettingsModal` writes), guarded by an early return when the family already has an active budget so re-running setup cannot clobber a real one. Failure reports to the new `onboarding-finish-budget` surface rather than trapping the user in the wizard.

Judgment call flagged to greg: the Savings step's "fixed amount" mode was equally broken but differently — the amount never left the component, so choosing it would have persisted whatever the slider last showed. Rather than ship a branch that writes an unasked-for budget, `savingsPercent` was made the single source of truth (fixed mode derives the equivalent percentage from income; with no income the slider default stands, which is the number the summary already displays). Whether fixed mode should instead write a fixed-mode budget is a genuine design question — the app's "fixed" budget means a SPENDING CAP, not a savings amount — and was left for greg.

**Issue 2 — two independent causes.**

(a) `settingsStore.setBaseCurrency` never re-fetched rates, so every stored rate stayed `from: <previous base>`. `getRate` then finds no direct/inverse/USD-EUR-GBP path and returns `undefined`, at which point `convertToBaseCurrency` and `convertAmount` both `return amount` unchanged — which the UI labels with the NEW base. A €100 account renders as "$100": silently wrong, not visibly missing. Survived because path-finding rescues it whenever the OLD base was USD/EUR/GBP, and USD is the default. Also corrects `SettingsPage`'s fetch-and-switch flow, which fetched BEFORE switching and so wrote the old basis too.

(b) `loadFamilyData()` is called exactly once, from App init, so a pod CREATED or JOINED during the session never reached the init-time rate bootstrap. Extracted `refreshExchangeRatesIfNeeded()` and added an `activeFamilyId` watcher; idempotent, since `updateRatesIfStale` short-circuits when rates are fresh.

**Verification.** 9 new tests (`OnboardingWizard.test.ts` + new `settingsStore.baseCurrencyRebase.test.ts`), all confirmed RED against the pre-fix code (7 failures across both suites). The currency test asserts the base currency held at the moment the fetch was issued, because asserting the call alone passes for both orderings; the budget test uses 35% so persisting the 20 default fails. Full suite 4465 green, type-check + lint 0 errors.

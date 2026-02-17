# ADR-004: Multi-Currency Support with On-Demand Conversion

**Status:** Accepted
**Date:** See commit "Add automatic exchange rate fetching from free API"

## Context

The application serves families who may have accounts and assets in multiple currencies (e.g., a family with accounts in both USD and SGD). Dashboard summaries and reports need to display totals in a single currency.

## Decision

Store all amounts in their **original currency** and convert **on-demand** for display purposes using a configurable display currency and cached exchange rates.

### Implementation Details

- **Settings**: Two currency settings in the Settings model:
  - `baseCurrency` — the currency rates are fetched relative to
  - `displayCurrency` — the currency used for displaying all values
- **Exchange rates**: Fetched from a free API (`@fawazahmed0/currency-api`) with CDN primary and Pages fallback
- **Staleness**: Rates refreshed when older than 24 hours, checked on app startup
- **Conversion composable**: `src/composables/useCurrencyDisplay.ts` handles all conversion logic
- **Multi-hop conversion**: If a direct rate isn't available, tries converting through USD, EUR, or GBP as intermediate currencies
- **Rate storage**: Exchange rates stored in the `settings.exchangeRates` array in IndexedDB

### Display Format

Currency values are displayed with the ISO currency code prefix and appropriate symbol:

- `USD $1,234.56`
- `SGD $1,234.56`
- `EUR €1,234.56`

### Supported Currencies

Defined in `src/constants/currencies.ts` — includes major world currencies with metadata (symbol, name, decimal places).

## Consequences

### Positive

- Each amount retains its true currency — no data loss from premature conversion
- Users can switch display currency at any time without modifying stored data
- Free API with CDN delivery — no API key or costs
- Fallback API endpoint for reliability

### Negative

- Conversion accuracy depends on API availability and rate freshness
- Multi-hop conversion introduces compounding rounding differences
- No historical rates — all conversions use latest rates

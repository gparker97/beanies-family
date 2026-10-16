# ADR-043: Weather from a device-called provider

- **Status:** Accepted
- **Date:** 2026-10-16
- **Related:** Notion tracker #134; ADR-011, ADR-018, ADR-042
- **Plan:** `~/projects/beanies-ops/docs/plans/2026-10-16-weather-glance-surfaces.md`
- **Implementation:** `src/services/weather/`, `src/stores/weatherStore.ts`, `src/utils/timing.ts` (`timeoutSignal`), the Region & Holidays Weather group in `SettingsPage.vue`, the wall weather card, the Nook caption and pill

## Context

The beanie wall, its night screen and the Nook are glance surfaces, and a family asked for weather on them. Weather needs a third-party forecast, and the app is local-first with no server that sees family content (ADR-011). The location has to come from somewhere without reading device location services, and the forecast must never block paint or blank a surface when the provider is slow.

## Decision

1. **The device calls the provider directly.** Open-Meteo's geocoding and forecast APIs are called over HTTPS from the device. No beanies server sits in the path, so nothing about a family reaches us. Every request has a 10 s timeout through the shared `timeoutSignal` helper, which feature-detects the abort-signal combinators that iOS 15 and 16 lack.
2. **Provider: Open-Meteo, not MET Norway.** Open-Meteo allows browser calls (CORS), needs no key on its free tier, and has a geocoder, so one provider covers the town search and the forecast. MET Norway has a better pedigree for Nordic data and a stricter, free licence, but it requires an identifying `User-Agent` that a browser cannot set, which forces a proxy. Choosing it would mean running our own endpoint for a glance feature. The trade-off accepted: a single commercial-licence question instead of an infrastructure one.
3. **Free tier now, Standard plan deferred.** The free endpoints are non-commercial only, and beanies.family has subscriptions, so the free tier is a development and test-period footing, not a permanent one. The owner deferred the Standard-plan decision on 2026-10-16. Revisit triggers: (a) before the feature is announced to paying families, (b) any quota event in the `weather` diagnostic surface, (c) Open-Meteo making contact.
4. **The switch to Standard is configuration.** `VITE_OPEN_METEO_API_KEY` set means the `customer-*` endpoints with `&apikey=`; unset means the free endpoints. No code change. The key ships in the client once one exists, so the worst case is quota exhaustion; rotation is a secret change and a release. The key and the full URL are never logged.
5. **Coordinates are rounded to 2 decimals** (about a kilometre) before they are stored or sent, and are stored once at pick time. A geocoder outage never blanks a wall that already has a town. The typed query and the place name are never logged.
6. **A reading is a device cache, not CRDT data.** The forecast is derived, disposable and per-device, so it is not written into the Automerge document (it would only create merge noise). Only the family's choices (the home town, Show Weather, the unit) live in the pod. The reading is one device key, cleared on every sign-out tier beside `clearWidgetSnapshot`.
7. **Staleness ladder.** Fresh, then aged (shown with "As of 3h ago"), then old (older than 12 hours: the current temperature is hidden), then unavailable (no usable reading). The stage is judged in one place and the widgets receive the thresholds in the snapshot, so they are defined once, in TypeScript. A failed fetch keeps the cached reading on screen with its age and backs off.
8. **429 is observed, not documented.** Open-Meteo's documentation describes only a 400 with `{error: true, reason}`. The app treats HTTP 429 as `rate_limited` and backs off for an hour because that is what the free tier does in practice, but this is observed behaviour that could change, so unknown statuses fall into the generic http_4xx and http_5xx classes rather than being assumed.
9. **No proxy for this issue.** "No own API" was this issue's out-of-scope line, not a project rule. A weather proxy Lambda in the content-fetch pattern is the named path if a revisit needs one.

## Consequences

- Open-Meteo sees the typed town and rounded coordinates of each lookup, plus the device IP, and deletes its request logs after 90 days. This is declared as Coarse Location (Apple) and Approximate location (Google), optional and user provided, in `native-store-submission.md` section 1 and in `PrivacyInfo.xcprivacy` and `privacy.astro`. The device's location services are never used.
- One new diagnostic key, `weather_age_min`, joins the allowlist and the store declarations.
- Widgets have no network (ADR-042), so widget weather is only as fresh as the app's last foreground run.
- Self-hosters on the free endpoint are bound by its non-commercial licence (`docs/SELF_HOSTING.md`).
- Turning Show Weather off stops every lookup for the whole family but keeps the town.

## Revisit when

- Quota abuse or repeated `rate_limited` events appear on the `weather` surface.
- The Standard-plan decision is taken (the triggers in decision 3).
- A provider that requires a proxy, such as MET Norway, becomes attractive; the answer is then a weather proxy Lambda, not a different client design.

## Alternatives considered

- **MET Norway.** Rejected for now: needs a proxy to set its `User-Agent` (decision 2).
- **A beanies weather proxy from day one.** Rejected: it adds a server, an operating cost and a quota to protect for a feature the direct call already serves.
- **Device GPS.** Rejected: it needs a permission prompt, reads a location the family did not choose, and a wall tablet is not where the family necessarily is.
- **Storing the reading in the CRDT.** Rejected (decision 6).

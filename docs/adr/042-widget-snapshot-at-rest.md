# ADR-042: Widget snapshot at rest

- **Status:** Accepted
- **Date:** 2026-10-12
- **Related:** Notion tracker #130; ADR-011, ADR-018, ADR-029, ADR-034
- **Plan:** `~/projects/beanies-ops/docs/plans/2026-10-12-home-screen-widgets.md`
- **Implementation:** `src/types/widgetSnapshot.ts`, `src/utils/widgetSnapshot.ts`, `src/composables/useWidgetSnapshot.ts`, `src/services/native/widgetBridgePlugin.ts`, `ios/App/BeaniesWidgets/`, `android/app/src/main/java/family/beanies/app/widget/`

## Context

A home-screen widget has to show today's digest while the app is not running. Everything the app knows lives in an Automerge document that only the WebView can decrypt (ADR-018, ADR-034), so a widget process cannot read the pod, and a server round trip would contradict the local-first model (ADR-011). ADR-029 named widgets as the native phase 2+ goal. The widget therefore needs a copy of the day that is readable without the family key.

## Decision

1. **The app publishes a plain JSON snapshot.** It holds a two-day digest (today and tomorrow), each with a "my day" and an "our day" view, so a widget's audience switch needs no app round trip. It is built in JS with the same rules as the Nook briefing and the beanie wall; native code only paints it.
2. **Where it lives.** iOS: the App Group container `group.family.beanies.app`, written atomically with first-unlock file protection (`.completeUntilFirstUserAuthentication`). Android: the app-private files directory, written through `AtomicFile`.
3. **When it is written.** On data change, on foreground and after a merge, through one 1 s debounce (the lock-screen reminders pattern). Never polled.
4. **When it is removed.** The `clearWidgetSnapshot` sign-out step deletes the file and reloads the widgets, which then show "open beanies".
5. **What it never contains.** Finance data, private lists, surprise hints, and anything `classifyAudience` hides from the viewer. A child session publishes only its own day.
6. **Exposure class.** Event titles and times at rest in the app's container are the same class as the lock-screen reminders already shipped, whose titles sit in OS notification storage. The encrypted IndexedDB cache (ADR-018) and the family key model (ADR-034) are untouched. The snapshot never leaves the device, so the data-collection table is unchanged. A per-device setting, "Show event titles on the lock screen", limits the lock-screen widgets to times and first names.
7. **Native strings are narrow.** Native string tables carry only the no-snapshot states ("open beanies", "sign in to see your day", "open beanies to refresh") and the picker labels, because those must render with no readable snapshot. They follow the device locale; all other content follows the app language. The two can mix when they differ.
8. **Platform choices.** The iOS widget extension targets iOS 17 (`AppIntentConfiguration`) while the app stays at iOS 15, so iOS 15 and 16 users see no widget. Android uses Java `RemoteViews`, with no Kotlin or Compose (the project is Java-only).
9. **Paging is deferred** (greg, 2026-10-12). "later ›" opens the app at the Nook on both platforms; in-widget paging is a follow-up if placements show demand.

## Consequences

- A person with physical access to an unlocked device, or a rooted or jailbroken one, can read today's and tomorrow's titles from the container. On iOS the file is unreadable before first unlock after a reboot, and the widget treats that as "unreadable", never as signed out.
- The snapshot schema is a cross-platform contract (TypeScript, Swift `Codable`, Java). `widget-snapshot.v2.json` is the committed fixture (v2, 2026-10-12: seven days, a calendar section and a to-dos section per day); a reader that meets an unknown version shows "open beanies to refresh".
- **v3 (2026-10, #134 weather and the lock-screen circle).** The app writes version 3; the readers accept **2 and 3** (Swift `supportedVersions = 2...3`, Java `MIN_VERSION = 2` / `MAX_VERSION = 3`, TypeScript `WIDGET_SNAPSHOT_READABLE_VERSIONS`). v3 is v2 plus optional fields only: a top-level `weather` (the home town's reading, pre-formatted, with the staleness thresholds carried as the instants `ageFrom` and `currentUntil` so native holds no copy of the rules), the `labels.weatherAsOf` and `labels.circle*` strings, `WidgetDay.handoffs` (the viewer's own drop-offs and pick-ups), `WidgetTasks.doneToday`, and `WidgetRow.shortTitle` / `whoFirst`. A v3 reader therefore paints a v2 file with those absent, and the bump makes an older v2-only reader show "open beanies to refresh" rather than a widget silently missing its weather. `widget-snapshot.v3.json` is now the committed fixture; `widget-snapshot.v2.json` is kept frozen for the reader tests, and the builder test proves v3 only added fields to it. The snapshot carries no location: only temperatures, glyph kinds and the reading's time.
- Sign-out is the only wipe. Switching member or family republishes within the debounce, so stale content is replaced rather than deleted.
- Native code cannot log, so read failures are written as a short token and relayed by the next publish into the `home-widget` diagnostic surface.
- Mixed languages are possible on the no-snapshot and picker surfaces when the device and app languages differ. Accepted.
- A third signed bundle id (`family.beanies.app.BeaniesWidgets`) joins the app and the share extension in Fastlane and the entitlement check.

## Alternatives considered

- **Encrypted snapshot.** Rejected for phase 1: the widget process would need access to a key (a keychain or keystore item shared with the app), which is a larger exposure than the few titles it would protect. A keystore-encrypted variant is deferred as hardening.
- **Widget reads the pod directly.** Impossible: decryption lives in the WebView, and a native Automerge and crypto stack would duplicate the data layer.
- **Server-pushed widget data.** Contradicts local-first and would put family content on a server.
- **Android Jetpack Glance.** Rejected: it needs Kotlin and Compose in a Java-only project. `RemoteViews` with a `ListView` scrolls and covers the design.

# Changelog

All notable changes to beanies.family are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Entries are grouped by date, with the most recent at the top. Each entry is a brief, human-readable summary — not a commit message.

> **Note:** This changelog was introduced on 2026-03-25. Entries before this date were backfilled from git history.

---

## 2026-08-26

### Removed

- Removed the five Core Web Vitals (`CWV *`) analytics events from the marketing site. Plausible can't average or percentile custom properties, so they only ever showed how many visitors fired each event — not whether the site was fast. Lighthouse and Search Console cover this properly.

### Fixed

- **Link previews now show the beanies family on the brand background.** Sharing beanies.family on Bluesky, Facebook or anywhere else showed a black box with the jumping beans cropped through the middle — the old preview was a transparent square that those platforms flatten to black and crop to a letterbox. The new card is a proper wide preview that matches the landing page.
- The `/download` short link now has a social preview at all — previously it shared as a bare URL.
- **Overnight flights now record the right arrival date.** "Arrives next day" was silently doing nothing for anyone outside the Americas, so the arrival showed on the departure day — and the night you were in the air was reported as a missing hotel booking.
- **A stay with no check-out date is no longer shown as finished.** An open-ended booking appeared greyed out with a "done" tick from the day after check-in, even while you were still there.
- **Typing two trip ideas quickly no longer loses the first.** The second one overwrote it, and the box cleared either way so it looked saved.
- **Filing a document against a past trip no longer creates a duplicate trip.** Past trips weren't offered as somewhere to file to, so the app made a second copy instead.
- Two rooms booked at the same hotel for the same night are now kept as two bookings. The second one used to absorb the first and one confirmation number was lost.
- Bookings on the same day are now listed in time order — the airport transfer no longer appears below the hotel it takes you to.
- A coach or bus booking now sets the trip's dates, instead of leaving the trip dateless and putting it on today's calendar.
- Two different people with the same first name on one booking are no longer both matched to the same family member.
- A recipe or travel document naming nobody no longer leaves every booking assigned to nobody permanently.
- Trip dates now extend correctly for bookings whose date came back with a time attached — previously the trip silently refused to grow and kept warning that the booking was outside it.
- Editing a recipe or trip field no longer overwrites a change someone else made to a different field at the same time.

### Changed

- **Trip cards, bookings and forms are now reachable with a keyboard**, and every form field announces its own name to a screen reader. Previously the trip cards could only be opened with a mouse, which put the whole travel section out of reach.
- Bookings with no date yet now show their documents, links and booking references like any other booking — they were quietly missing those.
- Family members with view-only access can no longer rename or delete trips and bookings.
- Trip cards render faster on families with many trips.

## 2026-08-25

### Added

- Read a recipe straight into the family cookbook — from a photo, a screenshot, a PDF, a recipe website link, or a YouTube video. Point magic beans at whatever you have and it fills in the ingredients, steps, times and servings for you to check before saving. Where a recipe site publishes structured data, the quantities are read exactly as written rather than interpreted.
- Recipes now keep a cook time alongside prep time, and remember the link they came from.
- Anything beanies filled in itself is listed under the ingredients and steps so you can check it against the original before you save.

### Changed

- **Adding a recipe now offers the fast way first.** The Add Recipe form opens with a "Start from a link" band at the top — paste a recipe page or a YouTube link and everything below fills itself in, or read a photo or PDF instead. It appears only on a blank new recipe, and steps aside as soon as you start typing. It works everywhere the form opens, including the meal planner's recipe rail and the meal editor.
- **YouTube recipe links now work.** Pasting a video link reads the video's description, follows the recipe link most cooking channels put there, and reads the exact ingredients from the cook's own website. Where the site publishes structured data, the quantities are read as written rather than interpreted.
- Reading a recipe now opens straight to the link field, ready to paste. Reading from a photo or a PDF is still one tap away, just below it — the link is the everyday way in, so it no longer costs an extra tap and a second screen to reach.

### Fixed

- Recipes from Turkish and Azerbaijani sites (or any page containing an `İ`) now keep their exact ingredient amounts. They were silently falling back to an interpreted reading.
- A roundup page ("25 best pasta recipes") no longer picks one dish at random and presents it as exact. It reads the page normally instead.
- A recipe time the author left blank no longer shows as `PT0M`.
- Editing a recipe no longer overwrites changes another family member made to a field you didn't touch.
- Long pages with an unclosed comment or tag no longer lose everything after it — usually the method.
- Recipe photos now show a spinner in the picture's own frame while they arrive — the same indicator as any other photo upload — on both the recipe card and the recipe page. The recipe saved immediately and its photo appeared several seconds later with nothing on screen to explain the gap.
- While reviewing a recipe read from a link, the photo box says beanies already found a picture and will add it on save — and still lets you add your own alongside it.
- Recipes with more than one photo now show a count on the photo, so it's clear there are others behind it. Tapping opens all of them with arrows to move between — that worked before, but nothing said so.
- Recipes now show the link they came from on its own line, and it can be edited or removed from the edit form like any other field. A recipe read from a YouTube video keeps the video link, not the blog page beanies followed to get the ingredients.
- Emptying a recipe's subtitle, times, servings, notes or link now actually clears it. Clearing one of these fields and saving silently kept the old value.
- A recipe page that only yields a dish name — common on roundup and category pages — now says so plainly instead of opening an otherwise empty form.
- A video whose description has neither a recipe nor a link to one now says so and suggests where to look, instead of reporting a dead link.
- Very long recipe pages no longer time out. Reading a large page took over 30 seconds and gave up; it now takes milliseconds.
- Links saved anywhere in the app (activities, travel, bank details, trip ideas) are now checked before they become clickable. A malformed or unsafe link is shown as plain text instead of a working link.
- Clearer messages when a recipe can't be read: a dead link, a site that doesn't allow apps to read it, and a video with no captions each now say what actually happened instead of "something went wrong".

### Removed

- Reading a recipe from a video's **captions** has been withdrawn. It never worked: YouTube requires a token we don't have on the captions endpoint, and every request returned an empty result — including from an ordinary home connection. Videos are now read from their description and the recipe link in it, which gives exact quantities where captions would only ever have given a rough transcript.

### Security

- The dish-photo fetch is bounded correctly under multi-label domains. The old rule treated every `.co.uk` (and `.com.au`, `.co.jp`, …) site as the same domain, so a hostile recipe page could point that fetch at any other site under the same suffix.
- The Add Recipe form now asks permission before sending a photo or PDF to be read. It was possible to reach the reader from the meal planner without the permission step appearing.
- Recipe alerts can no longer write the Slack webhook into diagnostic logs if it is misconfigured.

- Every link the app opens is screened for its scheme before navigation, closing a stored cross-site-scripting vector where a `javascript:` link saved by one family member could run in another member's session.
- AI responses are now size-bounded before they are stored, so a hostile document cannot bloat the family data file.
- The new recipe fetcher runs in its own isolated service with no network access to anything private, a capped request rate, and alerting if it is ever used more than a family plausibly would.

---

## 2026-08-24

### Fixed

- **"Refresh All Data" now always tells you what happened.** Tapping refresh when your Google sign-in had expired did nothing visible at all — no confirmation, no error — so it looked like a dead button while you carried on reading data that hadn't been updated. It now confirms when your data really was refreshed, and says so plainly when it couldn't be. Tapping while a sync is already running no longer claims success for a refresh that didn't run.
- Diagnostics no longer flood when a Google token expires with the app left open. The sync change-check re-probes every 10 seconds, and each failure was recorded separately — hundreds of identical entries a day for one family, enough to hit an internal rate limit and silently drop some, so the real number of failures could not be counted. It is now recorded once when the problem starts and once when it clears, with the number of attempts in between. No change to syncing, saving, or anything on screen.
- **Repeating activity costs are now counted at their real frequency.** Paid activities that repeat less often than weekly (every two weeks, monthly, yearly) were added up as if they happened every week, so their cost showed too high; daily ones showed too low. Amounts self-correct the next time the activity is saved. Weekly activities were already correct and are unchanged.
- **Monthly repeats on the 29th–31st now land on the last day of shorter months.** Editing one of these repeating items makes it include a payment in months like February (on the 28th/29th) that it may have skipped before.
- **Update notes are easier to close.** The what's-new / announcement panel now leads its footer with a clear "Done" button that closes it; "see all updates" is now a quiet secondary link. Previously the only close control was the small icon in the top corner, and the prominent footer button took you out to the help site.
- Analytics now reports from the iOS and Android apps, not just the web — native builds had been shipping with analytics silently switched off, so every app signup and every feature used in an app was invisible.
- Engagement stats for the app are measurable again. Four events the app fires by itself (install and community nudges being shown, a stale-app check, a storage-permission refusal) were counted as though the visitor had interacted, so anyone merely shown a nudge looked engaged.

### Added

- Signups are now split by platform — web, iOS, Android — on the founder metrics dashboard, with a single web-only conversion headline instead of two competing rates.
- Feature adoption now covers all 16 features rather than the original four.

### Changed

- The founder metrics dashboard now leads with a single web-only conversion rate and shows the platform split as a volume figure beside it, replacing two competing percentages that were computed over different populations.

> Note: these analytics changes are not yet deployed. The registry service must be updated before the app is, or the earliest app signups lose their platform permanently.

## 2026-08-23

### Fixed

- **Paid activities that don't happen weekly were costing too much on paper.** The monthly estimate for an activity charged per session assumed it happened every week, so a fortnightly class showed double its real monthly cost, a monthly one over four times, and a yearly one far more again. Each now reflects how often the activity actually happens. The figure updates the next time you save the activity. (Weekly activities are unchanged.)
- **A monthly schedule on the 29th, 30th or 31st no longer skips the short months.** It now falls on the last day of any month that doesn't have that date — so a bill on the 31st lands on 28 February rather than disappearing from February altogether. This holds in your linked Google Calendar too. The schedule picker says so plainly when you pick one of those days.
- **Moving a repeating plan's start date now moves the days it repeats on.** Changing the start from a Monday to a Tuesday used to leave the schedule on Mondays.
- **Dates written as `YYYY-MM-DD` no longer read a day early in timezones west of UTC.** A couple of shared date formatters parsed a bare date as UTC midnight, so someone in the Americas could see "22 Aug" for a 23 Aug date in some places. They now parse in your local timezone.

### Changed

- **The same repeat control now appears everywhere — money, the planner, and beanie lists.** Activities and lists have adopted the schedule picker that recurring money already uses: the common cadences are one tap, "custom" covers every N days/weeks/months/years, specific weekdays, "the last day of the month" or "the 4th Sunday", and an end that can be never, a date, or after a set number of times. Lists say "resets" rather than "repeats" and have no end, because a list resets rather than being scheduled. Existing plans and lists keep their exact behaviour until you deliberately change them — a weekly list still resets on the same day it always did.

### Added

- **Recurring money can now repeat any way your life does.** Setting up a recurring income or expense used to offer only daily, monthly or yearly. Now there's a single, friendly schedule picker: the common cadences (daily, weekly, every 2 weeks, monthly, yearly) are one tap, and a "custom" option covers the rest — every N weeks or months, specific weekdays, "the last day of the month" or "the 4th Sunday", and an end that can be never, a date, or after a set number of times. It shows only the options that apply to what you picked, with a plain-language summary of the schedule as you build it. (This is the first surface of a shared recurrence control that now also covers the planner and beanie lists, so repeating anything works the same way everywhere.) Your existing recurring items are untouched and keep working exactly as before.

## 2026-08-22

### Added

- **Download buttons for the phone apps, right on the homepage.** Below "start counting beans" there are now official App Store and Google Play badges so visitors can grab the native app in a tap. They point at new stable short links — `beanies.family/ios`, `beanies.family/android`, and a `beanies.family/download` that sends each visitor to the right store for their phone — so the same links can go on pins, flyers and a QR code, and the destinations can be updated without an app release.

### Changed

- **A fresh, interactive homepage app preview.** The above-the-fold preview now shows beanies on a laptop and two phones together on desktop, and a swipe-through carousel on mobile. You can browse the app's screens — the family nook, calendar, travel plans, to-dos, meal planner, budgets, assets, goals and the family scrapbook — and the set you see changes on every visit. It's drawn entirely in code (no images), so it adds nothing to page-load time, and a subtle "or get the app" now sits beside the download badges so it's clear the free browser app and the phone apps are both options.

## 2026-08-21

### Changed

- **The native apps caught up to the latest build.** Rolled out build 0.9.12 to Android on Google Play (production) and submitted it to the Apple App Store, bringing the recent startup-speed, cross-device syncing, and meal-planner sharing improvements to the phone apps. (The iOS update is with Apple for review; Android reaches everyone once Google's review clears.)

---

## 2026-08-20

### Fixed

- **No more false "data missing" screen when your data is actually on the screen.** On a fast open, beanies shows your data instantly from a local snapshot while it rebuilds the full data model in the background. On slower devices that rebuild occasionally lagged, and a health check would wrongly conclude "no data" and flash a recovery screen (and page our error monitor) even though your data was right there. It now recognises the snapshot is showing and treats this as a harmless, self-healing lag instead of an emergency. (A genuinely blank open with no data still surfaces recovery, as before.)
- **Renaming your family now sticks.** Changing your family's name from the Meet the Beans page updated it on screen and on the device you were using, but the new name wasn't written into your family's data file - so opening beanies on another device, or after clearing the app's cache, brought back the old name. The rename is now saved into the family data file itself (the thing that travels with you), so your chosen name follows you everywhere and survives signing out and back in.

### Added

- **A guide for families leaving Maple.** Maple announced it's shutting down on 31 December 2026 and deleting all user data, so there's a new post covering what to export before the deadline and how beanies compares — including a one-page infographic you can take in at a glance. The existing "best cozi & maple alternatives" post now carries a prominent notice pointing there.

- **A demo family for app store reviewers.** App Store and Play reviewers can now open a fully-populated sample family from an access code on the welcome screen, with no Google sign-in at all. Google's security checks challenge every sign-in from an unfamiliar device and location — which is exactly what a reviewer's machine looks like — and there is no way to switch that off, so review kept getting blocked at the front door. The sample data is entirely made up, stays on the device for that one session, and is clearly marked with a banner throughout. The access code is only present in official mobile store builds, is useless without the secret code itself, and stops working on a set date.
- **Richer reviewer demo data.** The sample family now also carries recurring money items (salary, rent, bills, savings), a family budget with a 20% target and per-category line items, a planned seaside trip with flights and a hotel, an ongoing medication, a scrapbook saying and milestone, and a weekly beanie list — so a reviewer can see the planning, travel, care and scrapbook features populated, not just accounts and the calendar.

### Changed

- **Beanie mode now follows your family across devices.** The playful "beanie mode" overlay was remembered only on the device you set it on, so a new phone or a cleared cache reset it to on. Your choice is now saved with your family's data too, so it carries over to your other devices. (The sound on/off setting stays per-device on purpose - you might want sound on your phone but not your laptop.)
- **Tables in blog posts are readable now.** Comparison tables were rendering with no styling at all — no borders, no header treatment, rows running together. They now have a tinted header row, a shaded first column so you can track a feature across, light rules and stripes, and proper spacing. On a phone a wide table scrolls inside its own box instead of dragging the whole page sideways.

---

## 2026-08-19

### Added

- **Share your meal plan as a picture or a PDF.** The meal planner now has two actions: **Share** turns the whole week into a friendly one-page picture and hands it to your phone's share sheet (WhatsApp, Messages, email), and **Export as PDF** downloads the same page for printing and sticking on the fridge. Both always cover the whole week, and both are made on your device — nothing about your plan is uploaded to create them. (This replaces the earlier plain-text day/week share.)
- **The family meal board.** Plan the week's meals on a days-across board, with a cookbook rail you can drag from (or tap, if you'd rather). Add a meal by name alone, or pick a recipe with its photo; note who's cooking, who's eating (guests included), the serve time and anything else worth remembering. Nights out, leftovers and skipped meals have their own card types. Mark a meal cooked, copy a whole week forward, clear a day or a week, and share a day or week as text. Today's meals also appear on the family nook.
- **Add allergies, medications and key contacts straight from Care & Safety.** Each section on the Care & Safety page now has its own "+ Add" button — pick the family member (just like the quick-add button) and the right form opens, without hunting for the person's profile first.

### Changed

- **The Meal Planner is temporarily tucked away while we finish polishing it.** It's now behind a feature flag and hidden from the app for the moment — your saved meal plans are safe and untouched, and it'll be back. (The Cookbook and your recipes are unaffected.)
- **Clearer medication schedule.** The medication form's plain "ongoing" switch is now an explicit choice — "Ongoing" or "Has an end date" — shown before the date, so it's obvious why the end date is or isn't there. Choosing "Has an end date" reveals the date field and now requires a date before saving, so a medication can't be marked as ending with no end date recorded.

### Fixed

- **No more "couldn't update your beans" message on a hard refresh.** A change from earlier today could try to refresh your currency exchange rates a fraction too early during start-up — before your family's data had finished loading — which showed a scary error even though nothing was wrong and none of your beans were affected. The rate refresh now waits until your data is ready. Your accounts and everything in them were always safe; the message was a false alarm.
- **The savings goal you set during setup is now actually saved.** The setup wizard asked for a savings goal, showed it back on the "you're all set" summary, and then threw it away — so the app had no budget and you had to enter the same number again on the Budget page. The goal you pick is now written as your family's budget when setup finishes. An existing budget is never overwritten, so re-running setup or a second family member finishing their own can't disturb it.
- **Accounts in other currencies now convert straight away after setup.** Picking your family's currency during setup left the app holding exchange rates measured against the _previous_ currency, which it couldn't use — so accounts in other currencies displayed their raw amount labelled with your currency (a €100 account showing as "$100"). Rates are now refreshed whenever the family currency changes, and a family created or joined part-way through a session fetches them too instead of waiting for the next app restart. Previously the only way out was Settings → update rates by hand.

### Performance

- **Opening beanies is fast again.** A change shipped on 18 August accidentally switched off the "nothing has changed, so don't re-download it" shortcut introduced the day before — so every open went back to fetching and rebuilding the whole family file even when nothing had moved. Opens are back to reusing what the device already has, and the shortcut now survives an ordinary sign-in instead of being cleared by it. Nothing was ever lost or shown incorrectly; opens were simply slower and used more data than intended.

## 2026-08-18

### Added

- **Plan the family's meals for the week.** A new Meal Planner lays the week out day-by-day with a slot for breakfast, lunch, dinner and a snack. Drag a recipe from your cookbook onto any slot (drop it anywhere in the day's box, not just on an existing card), or tap to pick one — and if it's not in the cookbook yet, just type the name to add it on the spot, or add a full recipe (photo, ingredients, steps) straight from the cookbook panel. Each meal can note who's cooking, who's eating (family and guests), a serve time and a quick note; nights you're eating out, having leftovers, or skipping get their own tags. Remove a meal by dragging it back onto the cookbook panel. Copy a whole week forward when the rhythm repeats, mark a meal cooked straight from the planner (and open its cook log later to view, edit or delete the entry), edit the underlying recipe without leaving the planner, and share the day or the week with the family as a friendly one-page summary. Today's meals also show up on the family nook.

### Fixed

- **An edit made just before the app closes now reaches your family straight away.** If beanies was force-closed or crashed in the second or two after an edit — before that change had finished saving to your family's file — the next time you opened the app it could decide nothing had changed and skip the check, leaving the edit sitting on that device. Nothing was ever lost, and it caught up on its own within the hour or as soon as you made another change, but until then your partner's phone showed the older version. beanies now notices that the device is holding something the file hasn't got yet, and sends it on the spot. Opening the app when there's nothing waiting is still just as fast as before.

## 2026-08-17

### Performance

- **Opening beanies is faster and uses less data** (app `0.9.10R9`). When your family's data hasn't changed since you last looked, the app now shows what you already have instead of re-downloading the whole file and rebuilding it a second time. On an unchanged open this skips the full download plus a multi-second reconstruction; on a real 2.5MB file the redundant work drops away entirely, self-healing within an hour if anything is ever uncertain (#61 open-cycle redundancy).

### Changed

- **Homepage links now go where you'd expect.** The "beanies" mentions in the story now open the create-your-beanpod screen directly, the "reach me" line and footer both point to the beanies.family Discord (in a new tab), and technical terms (CRDTs, encryption, local-first) link into the matching guides and glossary entries. Added a plain-English PBKDF2 entry to the glossary, and tidied the family library so guides and blog posts reliably link back to each other.

## 2026-08-15

### Changed

- **Clashing events no longer hide their own title.** When an activity overlapped something on one of your other calendars, beanies showed a badge naming that calendar right next to the title — which on a phone took most of the row and cut "Softball batting cage" down to "Softball ba…". The calendar name now appears only when you open the activity, where it already sat alongside "This is OK" and "Reschedule…". The calendar itself keeps a small orange overlap mark, fainter once you've marked a clash as fine.

### Fixed

- **Editing one session of a repeating activity no longer moves or hides it.** Changing anything on a single occurrence of a repeating activity — the pickup person, the category, who's going — and choosing "just this item" could move that session to the date the series started, where it overlapped an earlier session, or make it disappear from the calendar altogether. The edit form was quietly holding the series' start date instead of the date you actually tapped. It now shows and keeps the session you're editing, and only the fields you actually change are saved.
- **A moved session no longer vanishes when the series has an end date.** Rescheduling one session of a repeating activity that ends on a set date could push the moved session past that end date and hide it from every day at once. Repeating rules no longer apply to a single moved session, so sessions hidden this way in the past reappear on their own — nothing to restore by hand.
- **Editing or cancelling one session of a paid activity no longer breaks its recurring payment.** Changing a single session of an activity with a linked fee could rewrite the family's monthly payment into a one-off charge on that date, silently stopping the rest of the payments. Single sessions are never treated as the fee owner now, and any payment link left on one from before is cleaned up automatically.
- **Moving an already-moved session now moves it instead of duplicating it.** Rescheduling a session that had already been edited or moved once left the original day's session behind, so it showed up twice.
- **Deleting or shortening a repeating activity now clears its edited sessions.** Sessions you had previously edited or moved used to survive a "delete all" or "delete this and all future", lingering on the calendar and never syncing to Google Calendar again.
- **Splitting a repeating activity with "this & all future" keeps its edited sessions on the right series** — they used to be left behind on the old series and show up twice.
- **"Delete this and all future" on a recurring bill now actually stops it.** The end date was being written to a field that doesn't exist on recurring payments, so the bill regenerated every deleted instalment and came back. Editing a recurring bill with "this & all future" also no longer resets the new series back to the original start date.
- **A Google Calendar session whose event was removed at Google's end now recovers on its own** instead of retrying the same failing update on every sync forever.
- **Recurring actions that quietly did nothing now tell you.** Several save, reschedule and delete paths for repeating activities and bills failed without any message when the underlying record couldn't be found. They now surface a clear error instead of appearing to work.
- **Splitting a paid repeating activity keeps a single fee.** "This & all future" on an activity with a linked payment now hands the existing payment to the new series rather than leaving two running side by side.
- **A duty you already ticked stays ticked when the session is edited.** Marking a drop-off or pick-up done and then editing that same session no longer re-lists it as outstanding or re-sends its reminder — and if the session is moved, the completed duty moves with it.
- **Moving a session for a whole series is now blocked when it can't be applied cleanly.** For an activity that repeats on more than one day each week, changing one session's date and choosing "all occurrences" used to silently drop the change and hide the first session. beanies now explains why and points you at the right option.
- **Editing a repeating activity's "ends on" date clears the sessions past the new end**, instead of leaving them stranded on the calendar.
- **Changing a repeating bill's end date while splitting it now applies**, rather than being silently discarded.
- **Adding or removing a payment on one session no longer moves the whole series** to that session's date.
- **A photo-scanned update to an existing activity saves again.** Reviewing an extracted update without changing anything by hand no longer discards it.
- **Multi-day all-day activities keep their start date** when opened from any day in their range.

## 2026-08-14

### Changed

- **Reconnecting Google is now one prompt and one sign-in, not two.** If both your family data file (Drive) and your calendar lose their Google connection at the same time — which normally happens together — beanies used to show two separate "reconnect" messages and make you sign in to Google twice. It now shows a single prompt that names what's disconnected and reconnects everything in one sign-in when they share the same Google account. Drive-only families are unaffected (they're never asked for calendar access), and if your Drive and a calendar are on different Google accounts each is still handled on its own.

### Fixed

- **Setting up a new family on iPhone no longer shows a false "couldn't save your pod" error.** When creating a family with Google Drive on iPhone, the very first save right after signing in could momentarily fail on a fresh sign-in token and wrongly tell you it couldn't save — even though your family file had already been created. beanies now quietly re-establishes the connection and retries the save once before ever showing that message, so setup completes in one go.
- **The iPhone app no longer gets stuck zoomed-in when you tap a form field.** Text fields across the app (setup, onboarding, and every modal/form) could render just under iPhone's threshold for auto-zooming into a tapped field — and iOS didn't reliably zoom back out, leaving the whole app stuck zoomed until you force-quit it. Every text field, dropdown, and note box is now sized so the auto-zoom never triggers, app-wide. Pinch-to-zoom still works everywhere, and Large reading mode is unaffected.
- **Finishing family setup no longer shows a spurious "couldn't save" message.** The final save at the end of the setup wizard could hit a momentary Google token hiccup and show an error even though your data was fine. It now quietly re-establishes the connection and retries that save, so setup finishes cleanly.
- **Switching Google accounts now starts genuinely clean.** If you signed out and then signed in with a _different_ Google account, beanies could hold on to the previous account's connection behind the scenes — which on a device you'd marked as trusted led to the wrong account being used, "reconnect" prompts, and a session that dropped roughly every hour. A different-account sign-in now fully retires the account you left (its connection is disconnected and its saved sign-in cleared) before the new one takes over, so the new session is clean. Signing back in with the same account is unchanged — it still reconnects silently.
- **The "wrong Google account" warning no longer appears when your data is actually loading fine.** If the account you signed in with differed from the one a family file was originally linked to — but you could still open the file — beanies showed a "Wrong Google account… reconnect required" message (and named the wrong account) on every refresh, even though everything worked. beanies now treats being able to open the file as the real test: it stays quiet when access is fine, quietly corrects which account it has on record the moment your data loads, and shows the reconnect prompt only when an account genuinely cannot reach the file. Settings now shows the account you are actually signed in with.

### Security

- **Signing out now fully disconnects your Google authorization in an edge case where a leftover could remain.** If your Google session had already lapsed in a particular way, signing out could clear beanies' stored copy of the authorization without formally retiring it at Google — leaving one behind that counted against Google's per-account limit. Sign-out now retires that stored authorization first. Trusted-device sign-out, which deliberately keeps you connected, is unchanged.

## 2026-08-13

### Fixed

- **The iPhone app now shows the Google account you're actually signed in with.** On iOS the app could get stuck displaying (and checking against) a different Google account than the one you signed in with - even after signing out and back in - which triggered a repeated "wrong Google account" message. The app now always confirms your account against your live session, so it tracks the right one.
- **Your Google sign-in stays connected instead of asking you to reconnect over and over.** Heavy users across several devices could find themselves pushed through a full Google sign-in on almost every open — sometimes a Drive prompt _and_ a separate Calendar prompt. The cause was that every reconnect quietly created a brand-new Google authorisation without ever retiring the old one, until Google's own per-account limit kicked in and started cancelling the working one. beanies now retires the old authorisation before creating its replacement, so the count stays flat and the loop stops. If your session ever does break, the app now tries to heal itself silently — quietly picking up a fresh connection another of your devices already has — before it ever shows you a reconnect prompt, and an account-mismatch no longer silently churns through authorisations. (Unifying the two separate reconnect prompts into a single one is a follow-up.)

### Performance

- **Opening the app no longer redoes work it has already done.** Opening beanies was rebuilding your family's data more than once, re-reading every part of the app several times over, and — even when you had changed nothing at all — uploading your whole data file back to Google Drive. On a 2-3MB family file that upload alone is the slowest thing an ordinary open does, and it happened every single time. It now happens only when there is genuinely something new to save. Backgrounding the app also stopped re-encrypting your entire data set on every switch away when nothing had changed. Nothing about what is stored, or how it is encrypted, has changed — the app simply stops repeating itself. Groundwork for a further change that will skip the download entirely when your file has not changed since you last opened it.

## 2026-08-12

### Performance

- **The app now opens to your data almost instantly.** Opening a larger family file used to mean watching the loading animation for several seconds (5-10s, longer on older phones) while your encrypted data was rebuilt before anything appeared. beanies now shows your data straight away from a fast local snapshot, then quietly refreshes to the very latest in the background — the same orange bar across the top tells you when a refresh is in progress. Your data is unchanged, and the snapshot is stored encrypted on your device just like the rest of your local cache.
- **Large family data files load and sync noticeably faster.** The app's underlying data engine was upgraded to a rewritten storage engine — the biggest gains are on large files, where opening and saving are meaningfully quicker. Your files are untouched and fully compatible: the upgrade rolls out safely even while some of your family's devices are still on the previous version.

### Fixed

- **The fast-open really shows instantly now.** The instant-open change above was preparing your data in a fraction of a second, but the loading screen wasn't stepping aside to reveal it until the full background refresh had finished — so on a large file you still watched the placeholder for several seconds. The screen now lifts the moment your data is ready, with the refresh continuing quietly behind it.
- **Closed a latent data-integrity bug in the data engine.** The previous engine carried a rare defect that could, in edge cases, corrupt saved data without any visible error. The upgraded engine fixes it. No known files were affected — this closes the possibility going forward.

## 2026-08-11

### Changed

- **Dependency maintenance (developer tooling — no user-facing change).** Routine dependency updates, including a major bump of the app's state-management library (Pinia 3 → 4) after confirming none of its breaking changes touch our code, plus the usual patch/minor bumps and the monthly airport/holiday dataset refresh. Verified via the full build and test suite; no behavior change.

## 2026-08-10

### Fixed

- **Your family now always works on the same data file — a member could previously end up on a private copy without knowing.** If you joined a family by invite, the family's data file lives in the Drive of whoever set the family up, and is shared with you. The app used to treat "this file isn't mine" as "make me my own copy", so on a later sign-in a member could be moved onto a duplicate — seeded with the same data, so everything looked completely normal — while their changes quietly stopped reaching the rest of the family. beanies no longer creates a second copy of a family's file under any circumstance. If it can't reach or save to your family's file, it now tells you exactly why (you're offline, your Google connection expired, the file was moved or binned, or sharing was turned off) and gives you a way back to the original file. And if you are already on a copy, a banner now says so and offers to switch you back in one tap — bringing your changes with you.

- **Feedback sent from the Android and iPhone apps now actually reaches the team.** Feedback submitted from the app was being discarded before it left the device — the thank-you screen appeared as normal, but nothing was delivered and nothing was stored, so those messages are gone. Feedback sent from the website and the installed web app was never affected. Anything sent from the app between 9 July and today did not arrive; if you took the time to write something, please do send it again — it will land this time.

### Changed

- **Translation updates no longer overwrite the live app with a partly-configured build (developer tooling — no user-facing change).** The job that keeps translations up to date was also deploying the app to production on its own, using a reduced configuration — so every translation change quietly replaced the live version with one that had error reporting, team notifications, feedback delivery and analytics switched off, undoing whatever the previous proper release had shipped. That auto-deploy has been removed: translations are now committed and ship with the next normal release, like every other change.
- **A misbuilt release now raises an alarm instead of failing quietly (developer tooling — no user-facing change).** The app has always been able to detect when a build reaches production without its proper configuration — a state in which alerting, error reporting and analytics are all silently switched off. Until now it only wrote a note to the browser console, which nobody sees, so this went unnoticed for hours when it happened today. The check now reports through the diagnostics pipeline, and the server raises it to the team channel — deliberately from the server, because the very thing missing in that state is the app's ability to send alerts at all.
- **Feedback delivery is now monitored end to end (no user-facing change).** Every submission records whether it was delivered, and a failure to deliver now raises an immediate alert rather than passing silently. A build that is missing its feedback configuration now fails to build at all, and a check keeps the app builds in step with the website build so this class of gap cannot reopen unnoticed.

## 2026-08-07

### Fixed

- **iPhone and iPad: Google sign-in now completes.** After the earlier fix let the app catch the sign-in handoff, sign-in still looped back to the "load your family data" screen (sometimes with a "Google sign-in failed" message) on the native iOS app. The iOS app runs under a different internal origin than the web and Android apps, and it was the first build to actually reach the token-exchange step — which the server rejected because that origin wasn't on its allowed list. The allowlist now includes the iOS app, so sign-in finishes and loads your family data. iOS only; the web app and Android were never affected.
- **iPhone and iPad: buttons at the top of the screen are tappable again.** On the iOS app, the back arrows and the "X" to close panels (like the What's New drawer) sat under the phone's status bar and wouldn't respond to touch, so some screens couldn't be closed. They now sit clear of the status bar and work normally. iOS only.

## 2026-08-06

### Fixed

- **iPhone and iPad: signing in now takes you straight into the app.** On the iOS app, finishing Google sign-in used to land on a "page not found" screen, bounce back to the welcome screen, and make you sign in a second time — after which the rest of the session was quietly running inside a Safari window rather than the app itself. Sign-in now hands you back to the app the first time. iOS only; the web app and Android were never affected.

### Added

- **See at a glance that your data is saved — everyone, not just the owner.** A quiet save indicator now sits at the bottom of the sidebar (and inside the mobile menu), alongside your data file name and encryption badge. It shows "Saved · <time>" at rest, "Saving…" during a save, and warms to orange (never alarming red) as "Having trouble saving" if a save keeps failing — your changes are held safely on your device until the next save lands. Tapping it shows your connection and last-saved time; family owners also get a shortcut to reconnect or switch the data file, while other members see the status without a dead-end button. Previously only owners could see any positive save status (buried in Settings), and the only always-on signal was a failure banner that waited for three strikes. A new Help Center article, "Knowing Your Data Is Saved," explains it.

### Changed

- **Trip plans now lead with the date and time.** Opening any travel plan (a flight, stay, cruise, car, or activity) now shows its when — departure → arrival, or check-in → check-out — as a clear band at the top, before the flight number, terminal, and other details. Whatever you're scanning for while travelling is now first, not last.
- **Past trip days are easier to read.** A day that's already happened now reads as done via a subtle grey ✓ and a small "done" tag, instead of fading the whole day to a hard-to-read grey. You can still open past plans for terminals, confirmation numbers, and addresses at full clarity while on the go.

### Fixed

- **An ongoing hotel stay no longer looks finished.** A stay, cruise, or rental car you're currently in is now shown as active with a "staying now" marker (until its check-out / drop-off date) instead of being greyed out as "past" the moment it started. Whether something is past is now judged by when it ends, not when it began.

## 2026-08-05

### Fixed

- **Account-details review fixes.** A code review of the new account-details feature caught several issues, now fixed: a savings account converted to a loan could carry its old interest rate onto the loan (savings now uses its own rate field, fully separate from loans); switching an account's type now clears the previous type's detail fields instead of leaving them stored; the Save button no longer looks enabled while silently doing nothing when a detail field is invalid; a savings account whose only detail is its rate now shows it; account and activity links entered as a bare domain that starts with "http" now open correctly; and negative savings rates now save.

### Added

- **Accounts can now note joint owners and who they're for.** An account can optionally record additional (joint) owners — a subtle "add joint owner" option that stays out of the way unless you use it — and, for savings, investment, education, and retirement accounts, who the account is for (e.g. a child's college fund or a spouse's retirement pot). Both are descriptive and shown on the account; the primary owner still drives balances and totals.
- **Accounts can now store reference details.** Under "More Details" on any account you can keep the info you always dig for — account number, online-banking link + user ID, customer-service phone, and notes — plus type-specific fields: routing/sort code, IBAN and SWIFT/BIC for bank accounts; card network, last 4, expiry, credit limit and statement/due days for credit cards; and a list of labelled public wallet addresses for crypto. Everything is optional and shows in a clean read-only panel on the account. For safety, beanies never stores your CVV, PINs, full card number, online-banking password, or crypto seed phrase.
- **Activities can now include a link.** Add a URL (a booking page, class info, event page, etc.) to any activity — it appears as a clickable link in the activity, and syncs into the description of the matching Google Calendar event when calendar sync is on.

### Changed

- **Calendar clash marker no longer looks like the "today" indicator.** In the month view, an activity that clashes with a synced external calendar was outlined with a thin orange ring that was easily confused with the orange marker for the current day. The clash is now shown only by its overlap glyph — the same signal already used in the day, week, agenda, and activity views — so orange outlines are reserved for the selected and current day.
- **Terraform deploys now run through a checked environment file (developer tooling — no user-facing change).** Infrastructure changes are applied by hand, and all five sensitive Terraform inputs have no defaults, so a correct apply relied on remembering to export each key against the right AWS account. There's now a template at `infrastructure/.beanies-tf.env.example` documenting where every key comes from, plus a preflight check that refuses to proceed if the shell is authenticated to the wrong AWS account or any key is missing. Nothing about the running app changed.

## 2026-07-31

### Fixed

- **New-joiner Slack alerts were silently missed from the native app.** The pod-creation notification is a fire-and-forget request that, on the Android/iOS app, was aborted when the app navigated onward right after signup — so app-based new families never pinged the team channel (browser and PWA sign-ups were unaffected). The request now uses `keepalive` so it survives the transition. At least two real families (The Leland Family, The Skog Family) were affected.

### Added

- **New-joiner Slack alerts now show platform and device.** Each "family pod started/created" ping now includes the surface (app / pwa / web) and a device label (e.g. `android app`, `iphone app`, `chrome desktop`, `chrome android pwa`) so it's clear at a glance where a new family signed up from.

### Changed

- **Android app updated to 0.9.8R3 (Play Store production).** The new build carries the new-joiner notification fix and is submitted to Google review for rollout to all Play Store users.

## 2026-07-30

### Changed

- **Dependency maintenance.** Merged a batch of safe dependency updates (web-vitals, a group of dev-tooling bumps, and several patch-level libraries). No user-facing behaviour change. Two larger updates (pinia 4, Automerge 3.3.2) are intentionally held for a dedicated migration with testing.

## 2026-07-24

### Added

- **Helpful Hints (in development, behind a dev flag).** beanies can now auto-generate gentle prep to-dos ahead of upcoming birthdays, parties, anniversaries, and trips — buy a present, start packing, check passports — each carrying a notification via the reminders framework. Hints are clearly marked, dismissible in one tap or keepable as your own to-do, and controllable in Settings → Reminders (a family master switch plus per-device, per-type notification toggles). The birthday person never sees their own present hint. Not yet enabled for anyone — ships behind the `helpfulHints` flag.

### Changed

- **The month calendar now shows what's on in the greyed edge days.** The first and last rows of the month view spill over into the neighbouring months, and those days were drawn but always empty — so the last few days of last month looked free even when they weren't. They now show their activities, all-day events, flights and trips like any other day.
- **Transactions now list newest first.** The transactions list was showing the oldest day of the month at the top and the newest at the bottom. It now reads newest-first, matching every other place beanies lists transactions (account and goal activity logs, dashboard recents). Sorting by column is coming later.

### Fixed

- **Tapping a reminder now opens the thing it is about.** On the app, tapping a reminder notification used to just bring beanies to whatever screen you were last on. It now takes you straight to the activity, to-do, trip, or hint the reminder was for, and opens it - including when the app was fully closed, where it waits for your family data to load before jumping in.
- **Blog posts show their category badge again.** Posts categorised as a feature announcement, founder story, or memoir were rendering with no category badge on the post page. All categories now display a badge, and the category vocabulary is validated at build time so a mistyped or new category can't slip through unbadged again.
- **Reminders now buzz and chime.** Android reminders were posting silently — no sound and no vibration — because the notification channel was created without vibration enabled (the plugin turns it off unless explicitly asked) and, once created, a channel's sound and vibration can never be changed. Reminders now use a freshly-configured channel with vibration on and the default notification sound, and the old silent channel is retired automatically. On devices that already had reminders, the new settings take effect after this update.

## 2026-07-23

### Added

- **Reminders that reach you before things start.** On the Android app (iPhone to follow), beanies can now notify you _ahead_ of an activity, a travel departure, or a timed to-do — so you leave and prepare on time, even when the app is closed. A new **Settings → Reminders** section lets you turn reminders on or off per device and choose how much notice each kind gets: activities use the reminder time set on each one, flights and cruises default to two hours, trains and ferries to one hour (all adjustable), and timed to-dos get a default lead you can change.
- **Reminders go only to the people they concern.** A to-do someone assigned privately to themselves stays on their phone, and a flight reminder reaches only the family members actually on that flight — not everyone's lock screen.
- **Both halves of a school run.** If you are down for drop-off _and_ pick-up, you get a reminder before each one — the pick-up timed off the end of the activity, not the start. Tick a run off and its reminder stops.
- **All-day items remind you in the morning.** All-day activities and to-dos with a date but no time now nudge you at 9am on the day, instead of quietly never reminding you at all.
- **"None" means none.** Setting an activity's reminder to "None" now genuinely turns its phone reminder off. New activities start at 30 minutes' notice so they still remind you by default.
- **A friendlier notification bell.** The header bell is now a little beanie wearing its hat, and unread items show warm orange ring-lines beside it (never a red dot). When a new reminder arrives the bell gives a single gentle ring — and stays still if you prefer reduced motion. The empty notifications drawer now greets you with the beanie-bell.

### Changed

- **Reminders now live in their own Settings section.** They've moved out of the main settings page into a **Reminders** card of their own, alongside the other categories — with a new setting for the default reminder time on new activities (30 minutes, adjustable, and you can still change it on any individual activity). The reminder picker also moved out of "add more details" in the activity editor, so it's visible when you create something.
- **Your existing activities now have reminders.** Every activity created before this update was stored with no reminder time, so none of them would have notified you. They've all been set to 30 minutes' notice. If you had deliberately set one to "None", it will have been reset too — we couldn't tell the two apart, since they were stored the same way. You can set any of them back to "None" and it will stick.
- **Synced calendar events no longer carry their own reminder.** If you sync to Google Calendar, beanies used to be able to add a popup reminder to the exported event — which meant two alerts for the same thing, one from each app. Reminders are now beanies' job alone. You may notice your calendar re-syncing once after this update.
- **Joining our Discord is now an invitation at the bottom of Settings** rather than a settings card, and the notification bell in Settings is the beanie-bell rather than a generic icon.
- **Reminders now arrive on time, and early.** Previously a "time to drop off" reminder could land a few minutes _after_ the event: it fired at the event itself, and Android's battery-saving was free to hold it back further. Reminders now fire ahead of the event and the app asks Android for precise alarm delivery, so they are no longer batched up and delivered late. The header search and bell icons are also a touch larger and cleaner.
- **Chinese reminders show the right title.** Notification titles in Chinese displayed the literal word "标题" instead of the activity or to-do's name.
- **Screen readers announce unread notifications.** The bell's unread state was invisible to assistive technology; it is now part of the button's spoken label.
- **Reminders survive opening the app on the lock screen.** Opening beanies without unlocking your family data could silently delete every reminder you had set — you'd simply never hear from them again. They're now left alone until your data is ready, and cleared deliberately when you sign out rather than by accident.
- **"Time to pick up" now arrives near the pickup.** For an activity with a start time but no end time it was firing at 9am, hours early. It now fires before the activity instead, and ticking a school run off no longer starts a second, different reminder for it.
- **Android notifications show the beanie-bell.** They'd been showing Android's generic "i" icon — no notification icon had ever been set.
- **Reminders no longer vanish when you open the app on the lock screen.** Opening beanies before unlocking your family data could silently delete every reminder you'd set. They're now left alone until your data is ready, and cleared deliberately when you sign out instead of by accident.
- **"Time to pick up" arrives near the pickup.** For an activity with a start time but no end time it was firing at 9am, hours early. Ticking a school run off also no longer starts a different reminder for the same thing.
- **Reminders you set to "None" stay off.** The reminder options for an activity now read the same in Settings as they do on the activity itself, so choosing "None" can't quietly mean something else.
- **Activities created during first-time setup get reminders too.** They were being saved with no reminder time at all.
- **If a reminder can't be set, you're told.** When the phone refuses to schedule reminders the app now says so once, and makes clear the in-app reminders still show everything — instead of failing quietly.

## 2026-07-22

### Fixed

- **The homepage no longer shifts under your eyes while it loads.** The hero's headline, buttons and link used to jump sideways the moment the brand font finished downloading — the stand-in font the browser shows first is noticeably wider, and because the hero is centred, every line slid across as it was swapped out. The stand-in is now width-matched to the real font, so the text lands in the same place from the first paint. The decorative blobs behind the hero were riding the same movement and have been pinned too. Measured layout shift dropped from 0.19 to 0.008, comfortably inside Google's "good" threshold, with no cost to how fast the page paints.

### Changed

- **New app icon.** The home-screen icon is now the father-and-son beanies on a soft sunrise background, replacing the family-hugging illustration. The old one packed five characters into a 48px tile, so almost none of it survived at notification and launcher sizes — the two-bean mark keeps its shape all the way down, and the lighter ground lets the orange arrow read clearly instead of blending into the background it sat on. Live now on the web app; the Android build carrying it is with Google for review.
- **Installed Android web app gets a proper masked icon.** Android crops home-screen icons to the launcher's shape, which was clipping the arrow. A dedicated maskable icon now keeps the whole mark inside the safe area whatever shape the launcher uses.

## 2026-07-21

### Added

- **A warm welcome screen when you create a new family**, previewing the three quick setup steps and reassuring you that your data stays private (with a link to how zero-knowledge privacy works) — shown in place of the old "invite only" screen.
- **An optional "how did you hear about us?" question during family setup.** Fully skippable — it never blocks creating your family.

### Changed

- **Creating a family no longer requires an invite code.** beanies.family is live, so the "we're still building — invite only" gate has been retired.
- **The Android app is now live on Google Play** for everyone, and a fresh build carrying the open sign-up flow was submitted to the production track.

### Performance

- **The homepage loads noticeably faster on phones.** The two soft colour washes behind the hero were being blurred by the browser on every load before anything could appear on screen; they are now pre-rendered gradients that look the same and cost nothing. The "three worlds" beanstalk section — which sits well below the fold and only animates once you scroll to it — no longer holds up that first paint either. Largest Contentful Paint improved from 3.2s to 2.7s, with the beanstalk unchanged visually.
- **Every page except the homepage stopped downloading a font it never used.** The handwritten Caveat face is now loaded only by the one section that uses it, instead of by all 91 pages.

## 2026-07-20

### Changed

- **Refreshed the airport and public-holiday reference data.** The built-in airport list (used by travel & vacation planning) and the country public-holiday calendars (used by the Family Planner) were regenerated from their latest upstream sources — a few airports that stopped scheduled service dropped off, and holiday dates rolled forward. _(Data update; reaches users on the next app release.)_

## 2026-07-19

### Changed

- **Updated the native app framework** (Capacitor 8.3.4 → 8.4.1 across core/Android/iOS) — bug-fix release, no visible changes; reaches installed apps with the next store build.

### Fixed

- **No more false "We couldn't update your data" errors after backgrounding the app.** Returning to the app after it had been in the background (or waking a laptop overnight) could show a scary error toast — and page our on-call channel — even though nothing was wrong: the app was counting time spent asleep against its internal "is the data engine stuck?" timers. The app now knows the difference between "asleep" and "stuck": time in the background doesn't count, briefly-busy states retry silently, and background housekeeping failures self-heal without bothering you. You'll only see an error when something genuinely needs your attention — a failed edit, or the existing "your data isn't saving" banner with its reconnect options.

## 2026-07-17

### Added

- **New beanstalk post: "vibe coding has killed my sanity."** greg on six months of building at the speed of thought, and what it quietly costs you. [Read it](https://beanies.family/blog/vibe-coding-has-killed-my-sanity).

### Changed

- **The homepage now points you to the features section.** The new "what's inside" section that shows what beanies.family actually does was only reachable by scrolling past it — there was no way to link to it. It now has a spot in the top menu, in the mobile menu, and in the footer, and the button under the headline reads "see what's inside" instead of "why I built this" (my story is still one tap away in the menu).
- **Closed the empty gap between the homepage hero and the features section**, so scrolling down lands you on "check out these magic beans" straight away instead of passing through a blank stretch of page.

### Fixed

- **The site menu no longer crowds the beanies.family logo.** On narrower windows the menu links could run right up against the logo and spill past the edge of the screen; the menu now gives the logo proper room and switches to the drop-down menu before things get tight.

## 2026-07-16

### Security

- **Changing or resetting a family member's password now saves to your cloud file before it says "done" — or changes nothing at all.** Previously, if the save was slow or offline, the new password was applied locally and left to catch up in the background, which could lose the change or leave the old password still working on another device. Now the app waits for the save to finish (showing "saving your new password…") and, if it can't confirm, fully undoes the change and asks you to try again — your current password keeps working the whole time. If you're offline (or not connected to your family file), it tells you right away that you'll need a connection, instead of making you wait. No more half-applied password changes.

## 2026-07-15

### Performance

- **Loading your family data is fast again — no more 30-second spins after signing in or hard-refreshing.** A recent change had the app replaying a growing pile of small update files every time it opened your data, which got slower and slower as the pile built up. The app now keeps a single, fully-compacted copy of your data and refreshes it in place, so opening the app is quick no matter how long you've used it or how much history you have. Nothing is lost — the compacted copy contains everything.

### Fixed

- **Hardened the self-healing data-connection and reconnect logic** shipped earlier today. Follow-up review closed several edge cases: the reconnect flow can no longer briefly attach to the wrong family's file, a quietly-expiring session no longer flashes a false "data missing" screen while reconnecting, and clearing the local connection record now always keeps its backup copy consistent. No change to everyday behavior — these make the recovery paths more reliable.
- **Resetting or changing a family member's password no longer gets stuck on a spinner.** If the cloud save was slow, offline, or your session had gone quiet, the button could spin forever even though the new password was already applied. The password change now saves locally right away and the cloud copy catches up in the background.
- **After a while away, the app now asks you to reconnect instead of falsely warning your data is missing.** When your Google session quietly expires (common on iPhone after the app's been in the background a long time), your cloud file can briefly look "not found." The app was misreading that as lost data and showing a scary recovery screen; it now recognizes it as an expired session and offers to reconnect your Google account. Your data was never actually gone.
- **Connecting Google Calendar now works on the installed Android app.** Reconnecting failed with a "Token exchange failed: Bad Request" error because the app asked Google for the sign-in and the token using two slightly different return addresses. They now always match, so the calendar connects and reconnects normally. If a connection attempt is interrupted, you now get a clear "please tap Connect and try again" message instead of a raw error.
- **The app now re-establishes your data-file connection by itself instead of stranding you on a "set up your data file" screen.** On phones, the operating system sometimes clears the app's local record of where your family file lives. Previously that dropped established owners onto the new-user setup screen with no working way back. Now the app quietly restores the connection from your account (keeping a local backup copy of it too), and only asks you to reconnect if it genuinely can't — never treating a cleared local record as lost data. Your family file on Google Drive is always the safe copy.

## 2026-07-14

### Changed

- **Biometric unlock on the installed Android and iOS apps now uses your device's own Face ID / fingerprint and secure hardware key store**, instead of a passkey. It works offline, unlocks with a single gesture, and never leaves your device. Because it's tied to this device, a new device asks for your family password once and then you turn biometric back on there; changing your device's fingerprints/face turns it off until you re-enable it. Your family password always still works, and web/PWA biometric is unchanged. _(Reaches the installed apps with the next mobile build; iOS ships once the app is on the App Store.)_

### Fixed

- **Biometric unlock is now offered on sign-in when you've set it up.** If you'd registered a biometric on a device, a leftover cached key could silently decrypt your file and drop you straight on the member-password screen — so biometric was never offered even though it was enabled. Sign-in now prefers your biometric when one is registered. _(web/PWA)_
- **Registering a biometric no longer leaves the button stuck on "verifying."** Saving the new biometric to your cloud file is now time-bounded, so a slow or unavailable sync can't hang the button. _(web/PWA)_
- **The biometric list now shows the correct unlock type** ("Full unlock" for passwordless biometric vs "Cached password"), instead of always showing "Cached password." _(web/PWA)_
- **Biometric (Face ID / fingerprint) unlock on native now fails gracefully instead of showing a raw error.** If a device can't complete biometric setup, the app falls back to password sign-in with a friendly message instead of a confusing error.
- **Android: the black band across the top status-bar area is gone** — the app background now fills the screen edge-to-edge, in both light and dark mode, matching the web app. _(Reaches installed apps with the next mobile build.)_
- **Signing in with biometrics no longer gets stuck on "verifying."** After a successful fingerprint/Face unlock, a slow or unavailable cloud save could leave the button spinning indefinitely. The save is now time-bounded, so you're taken straight into the app and it finishes saving in the background. The same guard now covers biometric sign-in, password sign-in, and cross-device setup. _(Reaches the installed Android/iOS apps with the next mobile build.)_

## 2026-07-13

### Added

- **You can now open your family file from any account or device — including a restored backup.** The sign-in screen has a new "Load a saved family file" option that opens a `.beanpod` even if it was created by a different Google account, and it works on the web, Android, and iOS (previously the local-file option silently failed everywhere except desktop Chrome/Edge). Opening a restored backup makes your currently signed-in Google Drive its new home. Your file is still encrypted, so it always asks for your family password.
- **A clear warning now appears across the top of the app if your device can't save your data locally.** Previously this durability warning was tucked inside Settings, where you might never notice it. It links to an explanation and clears itself automatically once saving recovers. (Your data on Google Drive is always the safe copy.)

### Changed

- **Internal:** the background incremental-sync path now reports structured diagnostics to our monitoring (previously invisible) — no user-facing change, but it lets us catch and fix sync issues without needing to reproduce them. Also stamps each saved family-data file with the app version that wrote it.
- **Internal:** a failed local-save (cache-persist) now reports to our monitoring with which write failed and why, so we can detect and diagnose durability issues without needing to reproduce them.

### Fixed

- **The app now recovers on its own if your data ever stops loading.** On some devices — especially phones after the app has been in the background — the behind-the-scenes engine that loads your family data could go quiet and leave the app stuck, so the only fix was to force-quit and reopen. It now detects that situation, restarts the engine automatically, and retries loading your data, so opening the app just works.
- **Reliability hardening for loading and saving your data.** A batch of behind-the-scenes fixes to how the app recovers a stalled data engine and to where it saves after you open a saved family file. Opening a file from another account or a restored backup now always re-homes to your own Google Drive (it never writes back into someone else's file), and a single-member file opened via the device picker now reliably gets a proper save location. The "Load a saved family file" option also now stays visible with clear guidance even on browsers that can't open local files, instead of quietly disappearing.

### Changed

- **The Android and iOS apps now show the beanies.family icon and splash screen.** The native builds were still shipping the default placeholder logo on the home screen and during launch — both are now the beanie family artwork on a Cloud White background (with a dark-mode splash variant).

---

## 2026-07-12

### Fixed

- **Changing a single session of a repeating activity now syncs to your Google Calendar.** Rescheduling, editing, or deleting just one occurrence of a recurring activity previously did nothing on your connected calendar (it kept showing the original) — now that one event moves, updates, or is removed, while the rest of the series stays put.
- **Deleting a single session now deletes it — for good.** Removing a rescheduled or edited occurrence used to quietly bring the original back. It no longer does: delete means the session is gone.
- **Lists can now link to activities further in the future.** The list link picker only reached activities in the current few weeks, so you couldn't attach a list to a next-month (or later) activity. It now finds any upcoming activity, however far ahead it is.

### Added

- **"Reset to series" for a single session.** When you've moved or edited one occurrence of a repeating activity, opening it now shows where it came from and a "Reset to series" button — a clear, deliberate way to put just that session back to its original recurring time.

## 2026-07-11

### Added

- When your Google Calendar connection drops and needs re-authorising, beanies now tells you right away — a reconnect prompt appears (and a notification in the bell) instead of sync silently stopping. Both clear themselves the moment the connection recovers.
- **Connect and reconnect Google Calendar from any device.** Setting up or re-approving a calendar now works on your phone and the installed app, not just a desktop browser — it's the same one-tap flow everywhere, and syncing resumes on its own when you come back.

### Fixed

- Identical notification toasts no longer stack up when an action is retried.

### Changed

- New beanstalk post published: "I, for one, welcome our new AI overlords" — how beanies chose its privacy-preserving AI provider and what the first "magic beans" features do.

## 2026-07-10

### Changed

- **Clearer wording about what happens to a document you send to the AI reader.** The consent note and the help article now say plainly that the document passes through a beanies server on its way to the AI service, and that the server stores nothing. Nothing about the app's behaviour changed - only how honestly it is described.

### Fixed

- **A trip you're currently on no longer says it's finished.** The travel plans page marked any trip "completed" the moment it started, so a family halfway through a holiday was told it was over. It now shows how far along you are ("day 3 of 7"), just like the nook does.
- **The net worth card no longer shows an absurd percentage in your first month.** If every account was opened inside the period you're viewing, the card could report something like "+5222708551936642048.0% this month". There's no meaningful percentage to show when a period starts from nothing, so it now shows just the amount your beans grew by.
- **Fewer "Google session expired" prompts when you come back to a tab.** Returning to a beanies tab moments after signing in with Google could ask you to reconnect a session that was, in fact, seconds from being ready. The app now waits for sign-in to finish before deciding your session has lapsed.
- **Reconnecting Google Calendar takes effect straight away.** After reconnecting a calendar whose access had lapsed, syncing resumes immediately instead of waiting for the next page load.

### Performance

- **A lapsed Google connection no longer retries in a loop.** When Google ends a connection, the app used to ask it to renew the connection once per pending calendar change — hundreds of times on a busy calendar. It now asks once, then waits for you to reconnect.

## 2026-07-09

### Added

- **Share feedback from inside the app.** A new "Share feedback" entry (sidebar + menu) opens a quick ~10-second form: rate how likely you'd recommend beanies.family (0–10), and the form then invites an optional comment and, if you'd like a reply, your contact details. You can also tick "send anonymously" to leave your family name off. Every so often the same short prompt appears on its own — answer it or just close it, and you can switch the occasional prompt off any time in Settings. No financial data is ever included.
- **Lightweight, privacy-respecting usage signals.** The family registry now records a last-login date and an approximate data size (the size of your already-encrypted data file, rounded to the nearest KB) so we can gauge overall app usage and growth. Both are metadata only — never the contents of your data — and no automatic deletion window was added.

### Changed

- **No more stacked pop-ups.** Only one attention pop-up (what's-new, install prompt, a security prompt, the new feedback prompt, etc.) can appear per visit now — they take turns instead of layering on top of each other.

### Fixed

- **The tagline now reads the same everywhere.** "every bean counts" in the mobile menu was hard-coded in English, so it never translated; it now uses the same wording as the rest of the app. The stray full stop after it (mobile menu and website footer) is gone.

## 2026-07-08

### Added

- **Transfers — move money between your accounts.** Add a transaction, choose the new **Transfer** type, pick where the money leaves and where it lands, and both balances update at once. Paying a credit card is simply a transfer to the card (it lowers what you owe). Transfers between accounts in different currencies convert automatically at today's rate, and there's a Transfers filter on the Transactions page.
- **New "delete your data" page.** A public page at `/delete-account` explains exactly how to remove all of your beanies.family data — from inside the app, by clearing device storage, or by deleting the file from your own Google Drive.

### Changed

- **Clearer, more honest privacy policy.** The policy now transparently describes the small amount of technical diagnostic and error information the app sends us to stay reliable (never your family content) — including that a critical-error report may include the account owner's email so we can reach you. The diagnostic stream itself carries no personal information.
- **Groundwork for the iOS App Store and Google Play launch.** Behind-the-scenes preparation so beanies.family can ship as a real installable app on both stores — no change to how the web app works today.
- **beanstalk blog masthead polish.** The blog header's "not written by AI" line is now "not written by AI (usually)", and the title/subtitle spacing was tightened into a cleaner, more even rhythm.

### Fixed

- **Credit-card and loan balances now move in the right direction.** Recording a purchase on a credit card (or loan) now correctly increases what you owe, and a payment or refund decreases it — previously the amount moved the wrong way. Everyday accounts (checking, savings, cash) are unchanged. If you'd been tracking a card by logging spending directly on it, give that balance a quick check.
- **Google Calendar now prompts you to reconnect when your authorization actually expires.** Previously, if your Google sign-in for calendar sync was revoked or expired, the app kept silently retrying in the background forever — it never told you to reconnect, so your activities quietly stopped reaching your calendar. Now that state correctly surfaces the "reconnect" prompt in Settings, and stops the pointless retrying. (Single-account testing artifact on our side; no user was affected, but the same path would have hit anyone whose Google grant lapsed.)
- **Fewer false alarms in our error monitoring.** A harmless browser layout notification (`ResizeObserver loop…`) was being reported as a critical error. It's now filtered out so real issues stand out. No user-facing behavior change.

## 2026-07-07

### Changed

- **The off-main-thread data engine is now live for everyone** (app v0.9.4). The background Web Worker that shipped switched off is now enabled in production, so the screen stays responsive while large families load — the app no longer feels frozen when you open it after being away. Incremental cross-device sync (appending just what changed instead of re-uploading the whole file) turns on with it. Rollback is a single flag flip if needed.

### Fixed

- **iPhone sign-in: signing in to an existing family now works on the first try.** After completing the Google consent screen on iOS, the app could show a "your sign-in information is incorrect" error even though sign-in had actually succeeded (tapping "sign in" a second time worked, with no repeat of the consent screen). It was a timing race — the app checked your Google token a moment before it finished being saved. Now every sign-in step waits for that to fully settle first.
- **The cross-family data-mixing fix is now live in production** (app v0.9.2R4). The safeguards logged on 2026-07-06 — fully clearing one family from memory before another loads, and never merging one family's data on top of a leftover one — have shipped to everyone. Single-family users were never affected.

### Performance

- **Your most recent edit is safer when you background the app.** The app now saves changes to its local cache incrementally (just what changed) instead of rewriting the whole file each time, closing a small window where the very last edit could be lost if the app was backgrounded or closed at the wrong moment. (Also groundwork for faster cross-device sync, which ships switched off for now.)

## 2026-07-06

### Fixed

- **Creating a new family while already signed in no longer mixes in your old family's data — or loses what you just added.** Starting a fresh family from an active session now wipes every trace of the previous family from the screen before the new one loads, and the last thing you enter in the setup wizard (like your first activity) is now saved to your file before you sign out, so it's still there when you sign back in.
- **Switching between families can no longer mix one family's data into another's file.** If you belong to more than one family and sign out of one and into another (especially on a device where you'd chosen "trust this device"), the app now fully clears the first family from memory before loading the second, and never merges the second family's data on top of a leftover one. Previously, in that specific sequence, the two families' data could combine and get saved into the second family's file. Single-family users were never affected.

### Changed

- **Internal groundwork: the family-data engine can now run off the main thread.** A large behind-the-scenes migration moves the app's data document (Automerge) into a background Web Worker so the screen stays responsive while big families load. It ships switched **off** in production for now (the app runs exactly as before), and will be turned on gradually once validated on real devices. No change to your data, your file, or how you sign in.

### Performance

- **Internal (worker, still flag-off): large-doc loads on iOS no longer time out.** When the background Web Worker is enabled, loading a large family file on iPhone no longer errors out at the sign-in step: whole-doc load/merge operations now get a generous, bounded timeout, a redundant document copy on every sync was removed, and syncing now updates only the entries that changed instead of rebuilding the whole projection. Groundwork for turning the worker on. (The durable large-doc fix — history compaction / incremental sync — is a tracked follow-up.)

## 2026-07-05

### Changed

- **Homepage "why I built this" now reflects the Google Calendar integration.** The line that said beanies "doesn't pull in stuff from google calendar (yet)" now notes that while it still doesn't pull _in_, it does **push** your family activities _out_ to your calendars — linking to the new blog post on how it works. (It still won't sync with banks.)
- **The To-Do member filter is clearer.** On the To-Do page, the row of family-member pills that filters the list has moved up next to Sort and is now labelled "Showing" — so it reads as a way to _view_ whose to-dos you're looking at, not a way to assign the task you're adding. Assigning is still done with the person picker on the add bar, unchanged.
- **The To-Do add bar looks like one piece.** On tablet and desktop, the entry field, due-date, and assignee controls now share the same height, rounded corners, and resting colour, so the row reads left-to-right as "what needs doing → when → who". The due-date and assignee buttons are now clearly labelled ("Due date", "Assign") and fill with colour once you set them.
- **Internal:** added load-path performance timing (no user-facing change) to measure where the app can stall while family data loads — timing the Automerge load/merge/save, base64, and store-projection steps, and surfacing genuinely slow ones to diagnostics. Groundwork for making the app fully usable while data loads in the background.

## 2026-07-03

### Added

- **New beanstalk blog post announcing the Google Calendar integration.** "keeping your calendars in sync" walks through why beanies pushes (rather than two-way syncs) your family activities to your calendars, how the privacy scopes work, and what happens when there's a conflict. Now published.
- **A nudge to connect Google Calendar.** On the activities page (month view), members who haven't linked a calendar yet see a quiet, dismissible banner below the calendar inviting them to connect — it disappears once a calendar is connected or you dismiss it.
- **A clearer privacy promise — on the homepage and when you add your first account.** The homepage hero now says plainly that your data never leaves your hands: _privacy, guaranteed_ — tap it to jump straight to the data-security section. And right when you're first asked to add an account, a calm "Your data stays with you. Privacy, guaranteed." line sits above the form with a one-tap **How?** explainer — your data lives in a file only you hold, it's locked to your key even in the cloud, and we can't read it, ever — linking to the full zero-knowledge explainer in the help center.

### Changed

- **Google Calendar sync is now an official feature.** With Google's verification approved, syncing your family's activities to Google Calendar has graduated out of The Beanie Lab — it now has its own **Calendar** card in Settings (right after Country & Holidays), so you can connect it without turning on experimental features. The connected-calendar view (and its clash-warnings toggle) is unchanged; only its home has moved. The help-center article on how it works is now published.
- **Clearer permission wording.** When editing a family member, the permissions now read "Can edit family activities and plans" (which covers activities, travel plans, and to-dos) and "Can view and edit finances" — the labels now match what each permission actually grants.
- **A tidier add button.** The global quick-add button no longer appears for members who can't add anything (previously it opened an empty menu). Members who can add activities or finances still see it.

### Fixed

- **Calendar "Sync now" and "Disconnect" now report what actually happened.** Previously these always showed a success message even if the sync or disconnect ran into trouble; they now show a clear error (or a "reconnect needed" / "partly disconnected" note) so you're never told something worked when it didn't.
- **The "Add Activity" button showed two plus signs.** Fixed — it now reads a single "＋ Add Activity".

## 2026-07-02

### Changed

- **Newsletter sign-up on the blog is now a simple, private form.** The "follow me on substack" box on the blog used to embed Substack's own widget, which set third-party tracking cookies and slowed the page down. It's now a plain email box that sends your address straight to Substack when you subscribe — same result, but nothing loads (and no cookie is set) unless you actually sign up.
- **Routine dependency maintenance.** Updated the blog/marketing-site build tooling (Astro, the OG share-image generator, Tailwind) to their latest releases. No change to how the app looks or works.

## 2026-07-01

### Added

- **The AI reader now reads multi-page PDFs, not just the first page.** When you scan a PDF invitation or travel itinerary with "magic beans", beanies now reads its first few pages — so a return flight on page two, or a second day's schedule, gets picked up too. Very long PDFs read the first several pages, and the full original document stays attached to whatever it creates, so nothing is lost. Photos are still read as a single image.

### Fixed

- **Reading a photo or document with AI works again.** The "magic beans" reader (scan a flyer, invitation, or itinerary to fill in an activity or trip) had started failing because our privacy-preserving AI provider retired the vision model it was using. Switched to their current model, so photo and document reading is back to normal — nothing changes about how you use it.

### Changed

- **beanstalk (the blog) intro tightened.** The hero line now reads "not written by AI." — dropped the trailing "usually" and gave the "not" a bit more emphasis.
- **The app now shows its real version and build.** The sidebar shows a proper product version (v0.9.0) and the Settings screen shows the version plus the exact build and date, instead of the old fixed "v1.0.0 MVP" that never changed. Handy if you ever need to tell us which build you're on.

## 2026-06-30

### Changed

- **Routine dependency maintenance.** Updated Vue, Tailwind, and several build/test tooling packages to their latest patch releases. No change to how the app looks or works — these are behind-the-scenes upkeep to stay current and secure.

## 2026-06-28

### Fixed

- **Links from your synced Google Calendar now open the specific item, not just the page.** Tapping a beanies.family event in Google Calendar opens the app straight to that activity. Previously it landed on the calendar/planner page but didn't open the item, because the app read the link before your family's data had finished loading and then gave up. The same fix applies to every deep link in the app — opening a specific account, transaction, goal, asset, to-do, trip, or family member from a link now waits for your data to load and opens reliably, even on a cold start.

## 2026-06-26

### Changed

- **Creating a family now asks for your password once — after you connect storage — and always lets you add your family members.** Setup is now: your details → connect Google Drive (or a local file) → set your password → add your family. Previously, on iPhone the password step could repeat itself and the add-members step was skipped entirely (you'd land in the app with nobody to assign to accounts and activities). Now everyone — iPhone, Android, and desktop — gets the same clean flow with a single password and the add-members step. Your password is still never stored, and it's the key that encrypts your family's data.

### Fixed

- **The welcome guide now appears right after you create your family.** Previously, on a brand-new family the home page (the Nook) could load without the money/savings onboarding guide, which only showed up once you navigated to another page and back. It now appears immediately.
- **Family member colors picked during setup now match the palette you edit later.** A member added during setup could be given a color that wasn't in the member-edit color picker — so opening that member later showed "no color selected" and a single tap could overwrite it. Setup now uses the same palette throughout.
- **Clearer, more specific messages if family-file setup ever fails**, and a failed member-removal during setup no longer silently leaves the person on screen. Internal hardening of the new create flow (sign-in token recovery, guarding the add-members step) so it stays smooth on iPhone too.

## 2026-06-20

### Added

- **New beanstalk post: "getting your beans in a row."** A walkthrough of beanie lists — dedicated trip checklists, self-resetting recurring grocery lists, and Fair Play-inspired categories — sparked by an early adopter's feature request, now live on the blog.
- **Beanie Lists: rename a list, edit items, and drag to reorder.** Open any list and tap its name to rename it, or tap an item's text to fix it — Enter or tap-away saves, Esc cancels. Drag the new grip handle (⠿) on a row to reorder items into the sequence your family actually works through them. Editing an item never unticks it, and emptying an item's text keeps the previous wording (use ✕ to delete). Order syncs to the whole family.

### Fixed

- **Fixed creating or joining a family on iPhone (Safari and the installed app).** Signing in with Google could bounce you to a recovery screen, ask for your password twice, pop the "what's new" panel mid-setup, and then freeze on "counting beans…". The cause was Safari's privacy protection wiping the page's temporary data during the trip to Google and back, so the app lost track of where it was. Sign-in now carries what it needs through the sign-in link itself instead of relying on that temporary storage, so onboarding completes cleanly with a single password entry. If setup ever does stall, you now get a clear "reload to try again" instead of an endless spinner.
- **Stopped a crash that could hit the screen right after the Google sign-in step.** The page you bounce through on the way back from Google was doing far more work than it needed to — and on some phones (notably iPhone) that work could fail mid-redirect and throw up the "oh no, the beans spilled" error. That bounce page now does only its one job (hand you back to the app), so the crash can't happen there.

### Changed

- **Better behind-the-scenes diagnostics for sign-in and onboarding problems.** When something goes wrong setting up or signing in, the app now records whether your browser's local storage is actually working (a common, hard-to-see cause of iPhone onboarding failures) and includes a short trail of what it was doing — so genuine blockers get flagged to the team instead of failing silently. No change to anything you see or do; this only improves how we catch and fix real issues.
- **Travel plans header restyled to match the rest of the app.** The travel page now uses the same warm handwritten welcome line as Beanie Lists and To-Dos, instead of the older bold title bar.

## 2026-06-19

### Fixed

- **Creating a family on iPhone now finishes in one go.** After the Google permission screen, setup used to flash, drop you on a recovery screen, and ask you to create a password a second time. It now resumes the setup wizard you were already in and finishes without re-asking — your details carry across.
- **No more "what's new" pop-up right after signing up.** A brand-new family was being shown the what's-new announcement drawer the moment setup finished, which made no sense for someone brand new. New families now start with a clean slate; you'll only see what's-new when there's genuinely something new since your last visit.
- **Signing back in on iPhone is more reliable.** After logging out (while keeping your data) and tapping "Welcome back," the app now reconnects to Google Drive silently using your saved access instead of needlessly asking you to reconnect — and when a reconnect is needed, returning from the Google screen now loads your family on the first try instead of bouncing you back to the reconnect screen.
- **Onboarding no longer gets stuck in a loop on iPhone.** If a first sign-up attempt was interrupted (a flaky network, an app glitch), it could leave a half-created family file behind in your Google Drive — and every retry then failed with "a file with this name already exists," with no way forward. Setup now recognizes your own leftover file and picks up where it left off: an empty leftover is reused automatically, and if you genuinely already have a family file with that name, it offers to open it instead. (A file owned by someone else still asks you to pick a different name.)
- **Clearer message when Google file access is declined.** If you uncheck the file-access box on Google's permission screen, onboarding now explains that beanies needs that permission and prompts you to reconnect — instead of silently bouncing you back with no explanation.
- **iPhone saves are no longer lost on a flaky connection.** A Safari-specific network error wasn't being recognized, so a failed save to Google Drive could be dropped instead of queued. Those saves now retry when you're back online, matching every other browser.
- **Joining a family is more reliable for non-English users.** The "grant access to this file" recovery step keyed off English error text, so it could fail to offer the file picker in other languages. It now uses the actual response code, so it works regardless of app language.
- **Steadier Google reconnection.** Hardened a few edge cases in how Drive access is re-established (signing out on another tab mid-reconnect; the app and the signed-in Google account briefly disagreeing) so they resolve cleanly instead of surfacing a spurious "reconnect" prompt.

### Changed

- **Better error visibility on iPhone (internal).** Errors thrown inside Google's sign-in/file-picker scripts were being reported as an opaque "Script error." with no detail; they now surface the real cause, so genuine iPhone onboarding issues can be diagnosed and fixed faster.

### Added

- **Build version on the welcome screen.** A small version marker now appears at the bottom of the welcome screen (the deployed revision + date). It's mainly a support aid — it confirms which version your device is actually running, which helps when an old copy is cached (especially on iPhone after an update).

## 2026-06-18

### Added

- **Beanie Lists are here.** A new Treehouse page for shared family checklists, sorted into categories (Home & Household, Out & Errands, Kids & School, and more). Start a list from a template — groceries, before-school, vacation packing, kids' chores, honey-do, party prep — or from blank, then tick items off together. Each list is either **one-off** (give it a due date; it moves to a Completed area when everything's checked) or **repeating** (daily / weekly / monthly), which auto-unchecks itself each cycle so you start fresh. Lists have a single owner, surface in your Daily Briefing when they're due, show an at-a-glance count on the menu, and can be linked to a trip or activity so the checklist appears right there. A full guide is in the Help Center.

### Changed

- **The Travel Plans menu badge now counts what still needs booking.** The little orange number next to Travel Plans used to count undecided trip "ideas" — which aren't urgent. It now counts the unbooked items (flights, stays, transport still marked _pending_) across your upcoming trips, matching the "needs booking" indicator on each trip card. It clears to zero once everything's booked, so the badge only nudges you when there's real booking work left.
- **Consistent "add" buttons across the app.** The various "＋ Add" buttons (new activity, add contact, add recipe, add bean, new list) now share one component, so they all look and behave the same — including showing the ＋ on the planner's "Add activity" button on desktop.

## 2026-06-17

### Fixed

- **Trusted devices no longer ask you to reconnect to Google after every sign-out.** When you mark a device as trusted, signing out now keeps your Google connection (just like it already keeps your local family-data cache), so your next sign-in reconnects to Drive silently instead of prompting you to reconnect. Shared (untrusted) devices still fully disconnect on sign-out, as before.

### Changed

- **"Family To-Do" is now just "To-Dos."** The planner tab and page were renamed to sharpen the distinction between a single task and a whole checklist (the latter is coming as Beanie Lists). Nothing about your tasks changed — same page, same link.
- **The empty-state beanie illustrations got a glow-up.** Every "nothing here yet" screen (accounts, transactions, recurring, assets, goals, reports, dashboard, budgets) now shows the proper beanie mascot — a hand-drawn, shaded little bean in its knitted pom-pom hat, with arms and a cheerful face — instead of the old flat blue blob. The dashboard pair holds hands, as beanies do.

### Added

- **Beanie Lists is in development** behind a feature flag (not yet visible). A new Treehouse page for categorized family checklists — one-off or auto-resetting/recurring, one owner each, seeded from templates (groceries, packing, chores, before-school, party prep), with due lists surfacing in your daily briefing and a celebration when a list is finished. It is committed behind the `familyLists` flag (off in production), so there is no visible change yet.

## 2026-06-16

### Changed

- **The Beanie Lab section now hides itself when it's empty.** The experimental-features area at the bottom of Settings only appears when there's at least one feature to try — if every Lab feature is ever retired, the section (and its spacing) disappears cleanly instead of leaving an empty header behind. The Lab stays a permanent part of the app; this is just a tidiness guard, and it has no visible effect today while features are present.

## 2026-06-15

### Fixed

- **Translated the travel-timeline hint messages.** The amber planning hints on travel segments (e.g. "Departs at 01:30 - just after midnight, double-check the date", plus overlap and out-of-range warnings) were still rendering in English for Chinese users - they were built as plain strings in a helper the translation checks couldn't see. All nine now translate.
- **Cleaned up garbled Chinese translations — including a spam link and a dictionary dump.** The auto-translation service had quietly returned junk for a batch of strings: the cruise "Embark" label rendered a gambling-spam web link, "Crypto" showed a dictionary definition, and travel-segment labels like "Terminal", "To", "Cabin", "Port", and "Ship" were either left in English or mistranslated (e.g. "Port" had been translated as the _computer_ kind of port). Corrected ~70 Chinese strings across travel plans, account types, the planner, and onboarding, and **added a safeguard that rejects this kind of garbage going forward** — injected markup, spam links, dictionary dumps, and control characters now fall back to English instead of shipping.

- **Fixed a serious bug that could freeze family creation on an endless "counting beans" spinner.** After entering your details on the first step of creating a family, the app could intermittently flash the sidebar and hang on a spinner instead of moving on to the storage step — leaving new families stuck. The cause was an internal screen-reload race triggered the moment your account was created; the app now keeps the sign-in screen stable until your family file actually exists, and the create screen rescues itself if it ever lands in that in-between state. It also stops a harmless-but-noisy internal alert from firing on every normal sign-up.
- **Onboarding is more reliable and harder to break — especially on iPhone.** A pass over the whole create / join / recovery flow fixed several edge cases: going back a step and re-submitting can no longer create a duplicate empty family; the recovery screen will never re-create over (and orphan) a family pod it just couldn't reach — it offers a safe "Try again" instead; people who join a family always land straight in the app instead of occasionally being bounced to the wrong "set up your pod" screen; and an iPhone whose browser quietly cleared its data (Safari's 7-day rule) now restores your session instead of treating you as brand new.
- **Chinese (and beanie mode) now cover the whole app — no more half-translated screens.** A holistic i18n sweep moved ~190 hardcoded English strings (across travel plans, exchange-rate settings, global search, the dashboard, family cards, the planner, onboarding, and more — including button labels, placeholders, tooltips, and screen-reader text) into the translation system, so non-English users no longer hit pockets of untranslated UI. A new build check now blocks any future hardcoded UI text from shipping.
- **Translated the last few English-only labels that lived in data files, not screens.** Transaction category and group names (Groceries, Dining Out, Housing, Travel…), account-type labels (Checking, Credit Card, Roth IRA…), and the onboarding quick-pick activity/expense presets (Piano, Tennis, Rent, Utilities…) were rendering in English even in Chinese — they came from data definitions the screen-level check couldn't see. All now translate, and a second build check guards these data-file labels going forward so the gap can't reopen. (Also fixed a couple of long-standing typos/casing in account-type names, e.g. "kida ira" → "Kids IRA".)
- **Clearer guidance when a browser can't do something.** On iPhone (and other browsers without local-file support) the "save to a local file" option is now hidden instead of failing after you pick it, and the messaging points you to Google Drive rather than browsers that won't work on your device. Private Browsing now shows a clear "your browser is blocking storage" message during sign-up instead of a generic error, and a sign-in that gets interrupted by blocked storage no longer fails silently. On phones, the keyboard no longer hides the buttons in the create form, and tapping the family-role dropdown no longer zooms the page on iPhone.

## 2026-06-14

### Security

- **Signing out now reliably throws away any Google token still mid-flight.** Closed a rare timing window where a sign-in or token-refresh that was still completing in the background when you signed out could write that "zombie" credential back into the just-cleared (or next) session. A session-epoch guard now discards — and best-effort revokes — any Google token that resolves after sign-out, on every acquisition path, so a signed-out (or different) account never inherits a prior session's token. No change to normal sign-in.
- **Closed the last few timing sub-windows in that same sign-out path.** A follow-up hardening pass routes every token commit through one guarded checkpoint that re-checks right after writing to storage, and applies the same guard to the encrypted family-file copy of the token — so a credential can't linger on disk or sync to your other devices after you've signed out.

### Added

- **A much richer set of activity categories.** "Entertainment" is now **Fun** — and it covers more of family life: beach, pool/swim, playground, zoo/aquarium, bowling, and arcade. Four new groups join the planner: **Work** (work dinner, work drinks, team building, conference, office party, networking), **Pets** (vet, grooming), **Social** (date night, playdate, family visit), and **Religious** (worship/service, religious class). Plus basketball, chess, coding/robotics, singing/voice, drama, graduation, baby shower, anniversary, therapy, and swimming/track/gymnastics competitions. The photo/document AI can auto-assign all of them, and any activity with a cost still maps to the right expense category. Every category and group name is now translated for Chinese (previously category names always showed in English).

### Changed

- **Clearer family-member invites — and no more confusing Google Drive email.** Sharing the family file no longer triggers Google's automatic "shared a file with you" email (it linked to Drive, not beanies, and tripped people up); invitees now join purely via the invite link. The wizard sets expectations up front ("next, you'll get a link + QR to send them"), the link screen makes it clear to send _that_ link, and on the join screen, opening a valid invite greets you ("You've been invited to join {family}") instead of the stale "you need a magic joining link", reframes the Google Drive step as the clear final step ("Open your family file"), and names the exact `.beanpod` file to pick.
- **Asking for an invite now points to Discord first.** On the invite-only gate, the primary "request an invite" action is now joining the Discord community and asking there — no email required. Leaving your email for a personal reply is still available as a secondary option, now with a clear note that your email only ever goes to the beanies team. (We also added private analytics to see how many people start creating a family vs. ask for an invite at the gate.)
- **Tightened the beanies AI privacy line in Settings to match what's shipped.** The managed-tier note now reads "encrypted in transit, data-minimized, and nothing is retained" — dropping the "your beanies never hold the key" clause, which describes the not-yet-shipped end-to-end-to-enclave encryption. The wording is now consistent with the Help Center and accurate today (en, beanie, and zh).
- **Internal: consolidated the notification-nudge plumbing (no user-facing change).** The three bell nudges (install, community/Discord, daily tips) now share one per-member storage helper and one card layout instead of three near-identical copies, so they behave identically and are easier to maintain.
- **Renamed the sidebar "Community on Discord" item to "Discord Beanies."**

### Fixed

- **Muting tips or updating a community prompt now tells you if it couldn't be saved.** If your device can't write the change (for example, private-browsing mode or full storage), beanies now shows an error and keeps the previous state, instead of looking like it saved when it didn't.
- **Screen-reader labels on the month calendar now match your language.** The spoken category name for a calendar activity (e.g. in Chinese or beanie mode) was still announced in English; it now matches every other screen.

## 2026-06-13

### Changed

- **The "vibe coding the wrong way" blog post got a same-week revision.** The piece now flows as one continuous argument (the 20%-coding/80%-everything-else thread), picked up two new illustrations — a Pitfall-style retro game animation and Beethoven composing at a laptop — and its stats now all link to sources that actually contain the numbers.

## 2026-06-12

### Added

- **New blog post: "we've all been vibe coding the wrong way."** A founder piece on the endless ocean of cookie-cutter vibe-coded apps — and why the old data-harvesting playbook no longer makes sense now that building software is no longer the constraint. With an original illustration of the beanies rowing their own way through a sea of identical sign-up screens.

- **The Beanie Lab.** A quiet, opt-in corner at the bottom of Settings for trying features that are still in the works. It's off by default; switch it on (just on this device) to take early features for a spin while we finish polishing them.
- **A gentle tip to install the app on iPhone.** On iPhone (Safari, not yet installed), a one-time, dismissible tip now appears in the notifications bell suggesting you add beanies to your home screen — the installed app stays connected far more reliably. It never nags: dismiss it once and it's gone.

### Changed

- **Sharper behind-the-scenes error reporting.** Only genuinely disruptive problems (a failed save, a pod that couldn't be created, a broken screen) now raise an alert to our team — everything else is still captured for review but no longer pages us. No change to how the app works for you.
- **The connection to your family data file is now more reliable.** You'll be asked to reconnect and sign in far less often — the data-file connection now recovers itself and reconnects quietly in the background where it used to need you to sign in to Google again. Most noticeable on iPhone.

### Fixed

- **Blog image captions now sit centered under their photos.** The little italic caption lines beneath blog images were rendering as ordinary left-aligned paragraphs; they now display as proper captions — centered, smaller, and tucked under the image — across every post.
- **The app now stays in portrait and won't flip when your phone's rotation is locked.** On Android, the installed app could rotate even with your screen rotation locked, which was distracting. It's now locked to portrait so it stays put. (The same portrait lock is set for the installed app on phones across platforms.)

## 2026-06-09

### Fixed

- **The "today" highlight on the monthly calendar now always lands on the real today.** If you left the calendar open across midnight, the orange highlight could linger on yesterday (or appear on the wrong day). It now follows the actual current day automatically — including when you switch back to the app after a while.

## 2026-06-08

### Fixed

- **The camera now actually opens in the installed app.** On the Android app, tapping "Take a photo" in Magic beans was opening a file picker instead of the camera. Fixed so it launches the camera as expected. (Also prepared the installed iOS app for the same camera flow.)
- **Take a photo with Magic beans on mobile.** On phones, after you agree to the privacy prompt, beanies now asks whether to **take a photo** or **choose a file** - so you can snap a paper notice or invite on the spot, not just pick an existing file. (On the installed app the camera option was missing.)

### Added

- **Fresh tips of the day.** Added 18 new tips covering the newer features - magic beans (reading invites and bookings), taking a photo, the family scrapbook and cookbook, milestones, medications, allergies, emergency contacts, and more - and tidied up the existing ones.
- **No more duplicate activities from re-uploads.** If you scan a photo or PDF for an activity you already have on the calendar (same day, similar name), beanies now asks whether to update the existing one — folding in any new details and attaching the document to it — instead of quietly creating a duplicate. Choose "Add anyway" and it behaves exactly as before.

### Changed

- **Magic-read activities now capture the "what to bring" details.** When beanies reads a school notice or invitation, it now pulls preparation details that don't have their own field — what to bring, what to wear, RSVP, fees, drop-off/pick-up notes — into the activity's Notes, one item per line, and opens the details section so you see them right away.
- **Smarter activity categories from photos.** beanies now picks the activity category from the full list (so a "school learning journey" lands as a Field Trip, not uncategorized), and falls back to keyword matching when needed.

> Both improvements take effect once the AI reader's backend is redeployed alongside the app.

## 2026-06-07

### Added

- **Join the beanies community on Discord.** A friendly invite to our Discord now appears at the end of setup, as an occasional gentle nudge in your notifications (with a "not now" and an "I'm already there!" so it never nags), and as always-there links in Settings, the menu, and the website footer. Come swap tips, hear what's next, and help shape what we build.
- **beanies can do magic (beta).** Snap a photo or PDF of a party invite or a travel booking, and beanies pulls out the details and builds the activity or trip for you to check and save - add several documents to one trip, or start new ones. It is an early beta, you choose every time before anything is sent, and a new "Magic Beans" help article explains exactly how your data is kept secure (processed in attested confidential-compute hardware, encrypted in transit, nothing kept). Find it on the FAB, the calendar bar, the new-activity and new-trip screens, all labelled Beta.
- **New help center content for AI.** A "Magic Beans: How beanies Reads Your Photos & Documents" privacy article, a "how beanies uses AI" card on the help home, and the Security category renamed to "Security, Privacy, and AI".
- **Magic on a specific trip.** Open a trip and tap the magic button to read a booking straight into that trip — it defaults to the trip you're looking at, and you can still send it to a new trip instead.
- **Activities back in the Planning menu.** On mobile, Activities now appears in the Planning menu as well as the centre calendar button. Tapping either opens the calendar and jumps to today — even if you're already on the calendar.

### Changed

- **One consistent magic button everywhere.** The "Perform magic" AI button now looks and behaves the same across the calendar and travel screens — the full "✨ Perform magic" label on larger screens, a compact ✨ on phones — so the AI capability is easy to spot wherever you are.

### Fixed

- **View attached PDFs inside the app.** Booking documents that are PDFs now render page-by-page right in the document viewer, instead of a blank box that wouldn't open. The "Open in new tab" and download options are still there if you'd rather use another app.
- **Remove a booking document from a trip.** Opening an attached photo or PDF from the trip timeline now offers a delete option, so you can remove an attachment you no longer want.
- **"How your data is kept secure" links now open.** The privacy links in the AI consent prompt (the inline "secure, private" link and the "learn more" link) opened a not-found page when tapped from the installed app; they now open the help article correctly.

## 2026-06-06

### Added

- **Who's travelling on each segment.** Each trip leg — flights, hotels, rental cars — can now record exactly who's on it, defaulting to everyone on the trip and editable per segment (one parent flies in early, the kids share a different room). When a leg isn't the whole family, a small avatar appears on the timeline; open it to see the full list.
- **Terminal field for flights and cruises.** Travel segments can now capture the departure terminal (e.g. "Terminal 1", "Cruise Terminal A") when adding or editing a flight or cruise.

### Changed

- **Trip timeline shows the terminal, with a tidier flight summary.** The departure terminal now appears on each flight and cruise segment — both the collapsed summary line and the expanded details — so it's visible at a glance. The summary line now shows just the departure time (not the full departure–arrival range) to keep it compact.

### Fixed

- **Family Nook travel card now reflects a trip that's actually happening.** A vacation that's currently underway (or starting today) used to show "Upcoming Vacations" with no countdown. It now reads "Happening Now" with a clear status — "Day X of N" while you're away, or "Starts today!" on departure day.

## 2026-06-05

### Added

- **New blog post: "a family scrapbook that lasts forever."** A personal post on the beanies scrapbook and the milestones timeline — capturing your family's photos, funny quotes, and little milestones in a beanpod file you own, forever.

### Changed

- **Travel booking-document attachments are now live** — the feature to attach images and PDFs of your bookings to each trip segment (built earlier) ships to everyone with this release.

## 2026-06-04

### Added

- **Attach booking documents to travel plans.** Every travel segment, stay, and transport item can now hold images and PDFs of the original booking or itinerary — your airline e-ticket, hotel confirmation, rental agreement. Add them from the trip wizard or a segment's edit drawer, see a 📎 count on the card, and tap to view (images in a lightbox, PDFs open for reading). Stored in your family's encrypted Drive like photos. _(Reaches users on the next app release.)_

### Changed

- **Minor reliability and settings improvements** under the hood — groundwork for upcoming features, with no visible change yet.

## 2026-06-01

### Changed

- **Refreshed the public-holiday and airport reference data.** The built-in public-holiday calendars (used by the Family Planner) were regenerated from the latest upstream dataset — more accurate coverage across many countries, with corrected primary languages for a few (e.g. Kazakhstan, Pakistan). One new airport was added to the travel airport list. _(Data update; reaches users on the next app release.)_

## 2026-05-30

### Changed

- **"My dog's ear infection" blog now leads with the family photo.** Replaced the post's cover with a shot of two of the original beanies hugging Soda, our happy and fully healed poodle, and embedded the same photo near the top of the post with its caption.

## 2026-05-29

### Added

- **New blog post: "my dog's ear infection."** A use-case story about the new family medications feature - track meds for yourself, your kids, and your pets (in this case, a toy poodle with an ear infection and 5 boxes of medications). Also announces the [beanies.family Discord community](https://discord.com/invite/NE4grWzjxV).

### Changed

- **Tip of the day lives in the bell now.** Every day a small 💡 tip from the beanies shows up in your notification bell. Tap it to read the full tip and try the feature it points to. The big tip card has left the Nook page (more room for family signals), and "got it" no longer means "lose this tip forever." Tips stay in the bell so you can scroll back to one you liked. Mute new ones in **Settings → Appearance → Daily Tips**; the ones already in your bell stay readable.
- **Mobile header has room to breathe.** Removed the peek-a-boo beanie eyes from the mobile header — the greeting no longer truncates when you add up the notification bell, privacy toggle, search, and avatar on a small phone. The beanie eyes are still in the hamburger drawer (and every figure on screen blurs/reveals there), so nothing's lost.

## 2026-05-28

### Added

- **Announcements - a friendly way to hear about important news.** A new kind of in-app notification for occasional announcements (the first one: an invite to join the beanies Discord community). It appears in the notification bell and gently opens once on your next visit - never more than one pop-up per visit, and each one only the first time. Read it on one device and it clears on your others.

### Changed

- **What's-new updates now read like a tidy list of headlines.** Each new thing in an update gets a short bold headline with a one-line explanation of what it is and why it helps - and when a single update ships more than one new thing, they're laid out as a clean list instead of one long paragraph.
- **The update confirmation can now show you what changed.** When a new version brings a notable new feature, the "you're on the latest version" toast now offers a "what changed?" link that opens the release note - shown only for real updates, not routine bug-fix releases.
- **Opening a notification now glides instead of flashing.** Tapping a notification slides smoothly into its details (and back), like moving through a drawer, rather than snapping open.
- **Announcements stand out in the bell list.** Like the celebratory cards for what's-new updates, announcements now get their own warmer card treatment with a slim Heritage Orange ribbon down the left edge - a calmer, more contemplative cousin of the what's-new card, so a note from greg reads as "a message worth a moment."

## 2026-05-27

### Added

- **Notifications — a bell that keeps track of what needs you.** A new notification bell joins the header (and the calendar's top bar on phones) with a soft Heritage Orange dot when something's unread. It gathers, in one place: **tasks coming due** (morning-of for all-day tasks, ~30 min before for timed ones, gently flagged when overdue), **tasks a family member assigns you**, **events you're part of** (going, dropping off, or picking up), and **What's new** updates (which now live in the bell instead of popping up over your screen). Each row is useful at a glance — the thing in bold, who · where with a chip for your drop-off / pick-up duty, and the real date and time. Tap a row to open it (and mark it read); tap the dot to toggle read/unread without opening; "Mark all read" clears everything. Your read-state syncs across your own devices via your family file. (In-app for now — push notifications are a later update.)
- **Every update now leaves a note in the bell.** When the app updates ("fresh beans loaded"), a ✨ note tells you what we just shipped and why it helps — written in plain language, not a changelog dump. Big improvements gently open the bell so you don't miss them; small fixes just wait quietly with a dot.

### Changed

- **More room for your events on the calendar.** The calendar now sits flush at the top of the page — the dead gap that used to appear above it (where events briefly scrolled through a too-small, unusable band) is gone, on both desktop and phones. The bar showing the month/week/day and the controls is now solid, so events scroll cleanly _underneath_ it instead of faintly showing through. On phones, the separate app header is folded into that calendar bar as two tidy rows: the day/month/week you're viewing (always shown in full — never cut off to "May…") with a menu button and search on top, and the Month/Week/Day switch, family filter, and Add below. The family filter stays visible at all times — compact when you're viewing everyone, and showing the name when you've filtered to one person — so it's always clear whose plans you're looking at.
- **Less clutter on the month view.** Removed the small non-interactive strip of family-member avatars at the top of the month calendar — it duplicated the family filter that's already in the bar, and dropping it gives your days more room. Each event still shows whose it is via its colour and avatar.
- **What's-new updates now feel like a little celebration.** A big update stands out in the bell as a warm gradient "gift card" with a ✨ mark, and opening it unwraps into a full celebration — the beanies cheering, your update written plainly, and a hand-signed note from greg. (Routine fixes stay a quiet line, so the bell never gets noisy.)

### Fixed

- **"Today" now always jumps to today.** Tapping **Today** while you were already looking at the current month did nothing; it now reliably scrolls to today's date (it already worked from other months).
- **Switching to the month view lands on today.** Coming from the week or day view, the month now focuses today's date instead of sometimes opening scrolled to a different day — matching what the calendar tab in the bottom bar already does.
- **Calendar arrows are correctly labelled for screen readers.** The previous/next arrows in the calendar bar were both announced as "Today"; they now read "Previous period" / "Next period".

## 2026-05-26

### Changed

- **The family calendar is now the star of the Activities page.** A bar pinned to the top always shows which month, week, or day you're viewing — with the date, prev/next arrows, a Today button, the Month/Week/Day switch, the family filter, and Add, all in one place that stays put as you scroll. The calendar fills the full width and is the first thing you see. The weekday columns (week view) and the per-person columns (day view) now stay pinned under that bar too, so you never lose track of which day or person a column belongs to.
- **Upcoming trips no longer crowd out the calendar.** The big vacation cards are gone; trips now show as a slim "coming up" countdown ribbon in the top bar (tap one to open it) and as a coloured band on their real dates in the calendar. On phones the trips fold into a single tappable "trips" pill, and countdowns read sensibly for trips that start today ("today") or are already underway ("now").
- **The month view on phones is easier to scan.** Days are a clean day-by-day agenda, and days with nothing on them fold down to a thin "nothing planned" line so the busy days stand out.
- **The weekly view on phones gives your day more room.** The date strip now shows just the current week by default (pinned in place as you scroll), with a "Peek next week" toggle to glance at the fortnight when you want it.

## 2026-05-25

### Changed

- **Your to-do list now sorts by due date by default — and remembers how you like it sorted.** Tasks with the nearest due dates appear first (undated tasks sit at the bottom), so the most time-sensitive things are always on top. The sort control is now a clear **Sort: …** button instead of an easy-to-miss dropdown, and whichever order you pick — Due date, Newest, or Oldest — is remembered the next time you open the page (per device).

### Fixed

- **Weekly activities now repeat on the day you actually picked.** When you opened "Add Activity" and then chose a start date on a different weekday than today, the weekly repeat stayed stuck on today's weekday — so the activity could land on the wrong day and even vanish from the current month's calendar. The repeating day now follows your chosen start date (while still respecting any specific days you tick yourself).

## 2026-05-24

### Changed

- **The medication dose log now groups by day, so you can see how many doses were given each day at a glance.** Instead of one long list, doses are bucketed under day headers (Today / Yesterday / dates), each showing a count (e.g. "3 doses"). If a day went over the medication's recommended doses-per-day, that day is gently flagged in orange with a short note (e.g. "1 more than the recommended 3 a day"). "As needed" medications show counts but are never flagged.
- **A friendly heads-up when you log more than the recommended doses in a day.** When the dose you're about to record would push that day over the medication's recommended daily count, the "Log a dose" dialog shows a calm, informative note — it never blocks you, and you can dismiss it and log the dose anyway.
- **To-do and activity drawers now show when an item was created.** Opening a to-do or activity shows a subtle footer line with who created it and the exact date and time (e.g. "Created by Greg · 21 Apr 2026 at 8:30am") — a consistent convention across both.

## 2026-05-23

### Fixed

- **No more clickable buttons during the "finding your pod" moment after Google sign-in.** When you return from the Google consent screen, beanies.family takes a second or two to fetch your Drive files before showing them. Previously the "Google Drive" and "local file" buttons stayed visible and tappable during that gap, which was confusing. Now you see the "counting beans…" spinner for that whole moment — on every device — until your pod files appear.

## 2026-05-22

### Fixed

- **Google Drive sign-in now works in the native app and installed PWAs.** Loading an existing pod from Google Drive used a popup-based sign-in that can't complete inside the native Android app (or an installed PWA) — it opened a blank browser tab and then hung for two minutes before timing out. Sign-in now uses the same system-browser/redirect flow the rest of the app already uses on those surfaces: after you pick your Google account and consent, the app re-opens your Drive file list automatically and loads your pod — no second prompt. Desktop sign-in (popup) is unchanged. (See ADR-029.)

### Added

- **New blog post: "my 10-year-old outclassed me."** A founder story about taking my train-obsessed son to Japan for cherry blossom season — a sold-out museum, a Mt. Fuji we never quite saw, and a 10-year-old who handled disappointment better than his dad did.

## 2026-05-21

### Changed

- **Signing back in is faster — no more picking your provider and file twice.** When you sign in and your saved Google session has expired, beanies.family now knows your family's pod is on Google Drive and offers a single **Reconnect** step that loads that exact file directly — instead of asking you to choose "Google Drive or local file" and then re-select the same `.beanpod` from a list. If your session is still valid you go straight to your password/biometric unlock with no Google prompt at all. The Reconnect button stays disabled with a spinner through the whole reconnect-and-load so there's never an ambiguous "tap again?" moment, and if the known file has since been moved or deleted it falls back gracefully to the file picker. (Behind the scenes, the load screen's overlapping mode flags were consolidated into a single state machine.)
- **Family-shared settings are now admin-only.** Base currency, preferred currencies, the exchange-rate auto-update preference, home country, the public-holidays toggle, and week-start day all affect the whole pod — so only family admins (members with "manage family" permission, plus the owner) can change them now. Everyone else can still _see_ the current values (the controls show as read-only with a short "only a family admin can change this" note) but can't alter them. Manually refreshing exchange rates stays open to everyone — it just pulls current rates and isn't a config change. Personal, device-only preferences — theme, text size, language, trusted-device — stay changeable by everyone, and viewing/editing your own account is unaffected.

### Fixed

- **Creating a family with a local file in Firefox now explains itself instead of failing silently.** Firefox (and Safari) don't support the browser API local files require, so the setup wizard's "use a local file" option could only ever show "Failed to create file. Please try again." — and trying again gave the same result. It now shows a clear, actionable message: this browser can't save local files, so use Google Drive (it works here and syncs to your family) or open beanies.family in Chrome or Edge. Applies to both the create-family wizard and the resume-setup recovery screen. The same guidance now appears when _loading_ an existing local file in those browsers, instead of opening a file that could never save changes back. Also corrected the local-file setup warning, which wrongly implied local files work-but-degraded ("re-pick the file every time") in Safari and Firefox — they're simply not supported there.
- **Assignee dropdowns no longer get cut off near the bottom of a section.** On the Nook and To-do pages, the "who" (assignee) picker is clipped when the quick-add row sits near the bottom of its card. The popover now renders above everything and tracks its button (flipping upward when there's no room below) — the same overflow-safe behaviour the date picker already had.
- **Opening Help from the installed app no longer traps you in a redirect loop.** On the installed PWA (home-screen app), tapping **Help** in the sidebar or the account menu used to ping-pong the app between the marketing site and the app forever. Help now opens the Help Center in a normal browser tab — exactly as it always has in a regular browser. (The app hands external links to the system browser instead of opening them in-place, and the marketing site no longer re-redirects a standalone visitor that has already been bounced once.)

## 2026-05-20

### Changed

- **The family calendar is now one tap away on mobile.** The bottom nav gains a prominent, raised **Calendar** button in the centre — a round Heritage-Orange shortcut straight to the Family Planner. Previously the calendar lived two taps deep inside the Planning popout (which now holds Travel + To-do). The bar keeps five even slots: Nook · Planning · Calendar · Money · Pod.
- **App updates now apply automatically — no more "update available" prompt.** When a new version is ready, beanies.family quietly updates itself at a safe moment (never mid-edit or mid-save), lands you back on the page you were on, and shows a brief "you're on the latest version" toast. If you've been away for several releases you jump straight to the newest build in one step — no stacked update prompts. Replaces the old "Update now / Later" banner.

### Fixed

- **Google Drive stays connected across app restarts — especially on installed PWAs (Android/iOS).** The PWA was showing a "disconnected" prompt on every force-close/reopen. Root cause (found via the new diagnostic logging): on the full-page redirect sign-in that PWAs/iOS use, the refresh token was being saved under a temporary key instead of your family's key, so the next launch couldn't find it — and reconnecting didn't fix it because the reconnect wasn't asking Google for a fresh refresh token. Now every reconnect explicitly re-grants offline access (you'll see Google's consent screen, by design), the token is always stored under the family key, and any token left under the old temporary key is automatically migrated on the next launch — so existing affected devices self-heal. Applies uniformly to desktop, iPhone/iOS, and Android. See ADR-028.

### Added

- **Full diagnostic logging & telemetry (self-hosted on AWS).** A new `logEvent` tier captures the whole `debug/info/warn/error` diagnostic stream that previously died in the browser console, batches it (offline-aware), and ships it to a new `POST /logs` endpoint → a telemetry Lambda → a 90-day CloudWatch log group we can search with Logs Insights. Every Slack error is now also queryable historically. The firehose is anonymous by design — it correlates by a random family identifier and never carries names, balances, transactions, or email (the allowlist is re-enforced server-side as a safety net). The security Help Center article now discloses this. Activates only after the infrastructure is deployed; until then it's a harmless no-op. See ADR-027.

### Fixed

- **Fewer "Google session expired" interruptions after overnight tab sleep.** Silent refresh now retries up to 5 times (was 3) with stepped backoff totaling ~22.5 s of patience (was ~4.5 s), enough to survive Chrome desktop's wake-from-sleep network race on Windows. Investigation of the 2026-05-19 morning cascade found zero Lambda invocations during the failure windows — the `fetch()` calls never left the user's machine because the network adapter was still reattaching from sleep. With longer patience, the first wake fetch can fail-and-retry through the reattach window instead of surfacing the reconnect banner.

- **Wake-time auth failures self-attribute in #beanies-errors.** `offline-queue-flush` alerts caused by `TokenExpiredError` now carry the same diagnostic blob the cold-start surface already attached: per-attempt classification (network / timeout / http / permanent), hidden-duration, visibility state, and refresh-token age. Operators can tell at a glance whether the next firing was a Lambda timeout, network race, HTTP error, or genuine `invalid_grant` revocation — without digging through CloudWatch. The shared builder lives in a single module (`silentRefreshAlertContext.ts`) so cold-start and offline-queue surfaces stay consistent forever.

- **Refresh-token IDB read/write/clear failures stop failing silently.** `getGoogleRefreshToken` previously swallowed IDB read errors with an empty catch block; the IDB delete path was unwrapped entirely. Both now report to `#beanies-errors` (`refresh-token-idb-read` / `refresh-token-idb-clear`) so a corrupted handle DB shows up as actionable signal instead of a quiet sync failure. The function still falls through to the localStorage fallback / completes the cleanup chain — no behavior regression at the call sites.

---

## 2026-05-19

### Fixed

- **Less noise in #beanies-errors when a user simply needs to reconnect.** Cold-start reconnect banners with `hadRefreshToken: false` (no stored refresh token → no auto-recovery possible → user must re-authenticate) no longer fire a Slack alert. The banner UX is unchanged — the user still sees the reconnect prompt — but the by-design state stops cluttering the bug channel. Genuine silent-refresh failures (where a refresh token existed and the attempt failed) still alert.

- **iOS Safari's spurious "internal IndexedDB error" no longer surfaces as a bug.** WebKit occasionally throws "An internal error was encountered in the Indexed Database server" on PWA wake-from-background — a transient, recoverable failure that briefly polluted #beanies-errors with `unhandled-promise-rejection`. We now classify these (alongside the existing chunk-load suppression), retry the IDB write/read once after a 250 ms backoff inside the persistence service, and only escalate to Slack if both attempts fail. Quota/schema/permission errors still surface unchanged.

### Added

- **2-week navigator strip on the weekly calendar.** A new compact strip sits above the weekly timeline (desktop AND mobile), showing the focused week + the next week as side-by-side rows of day pills. Each pill carries DOW, day-number, and 1-3 member-color event-density dots (same grammar as the monthly chips). The focused week gets an orange accent strip on the left; today gets the orange fill. Tap any pill to focus that day on mobile or advance the visible week on desktop; the agenda sidebar is no longer opened (you stay in weekly mode). Doesn't change the existing weekly timeline below — just adds the week-shape overview that was missing.

### Fixed

- **E2E `planner.spec.ts:72` Activity CRUD test now matches the new calendar UI.** The earlier chip-redesign commit (`ea66dd4`) deleted `UpcomingActivities` + `TodoPreview` from the planner page, so the CRUD test's `h3 "upcoming activities" .locator('..')` scope no longer matched anything — both chromium and webkit hard-failed on the two pushes after the redesign. Test rewritten to click activity titles directly (`page.getByText(title).first()`), matching the convention the other 4 planner tests already use.

- **Weekly mobile no longer shows two competing day-pill strips.** Phase B's 2-week navigator strip rendered alongside the legacy 7-pill mobile strip, stacking them on top of each other. The legacy strip is removed — the new navigator is a superset (same week + the next, plus density dots that respect the chip color rule). Less vertical real estate, fewer competing affordances.

- **Tapping a day on the navigator strip keeps you in weekly mode.** Previously the strip emitted `select-date` which the parent page handles by opening the day-agenda sidebar — yanking the user out of weekly view. The strip is now strictly for week-internal navigation: tap a day to focus it (mobile) or to advance the week (desktop). To open the agenda, click an event chip directly.

- **Navigator strip highlight now follows the selected day, not today.** The orange pill on the strip used to stay on today regardless of which day the user had tapped. The selected pill now uses a filled-orange "you are here" treatment, while today gets a subtler outline-only orange so it stays findable but doesn't compete with the active selection.

- **Navigator strip rows stay static when tapping inside.** Clicking a day in the second (next-week) row used to reshuffle the strip — the second row moved up and a new row appeared below, which made the strip feel like it was running away from the user. Now the strip stays anchored to whatever 2 weeks it was showing; tapping any day moves the timeline below to that day's week and shifts the "focused-week" accent strip between the two rows. The prev/next arrows above the strip are the only thing that moves the strip itself (along with the timeline, in sync).

- **2-week navigator strip uses past-aware labels.** When the user paged backwards on the strip, both rows said "Upcoming" — wrong for any week before today. Labels now resolve by row position relative to today's week: "this week" for the row containing today, "next week" for the row immediately after, "last week" for the row immediately before, "Upcoming" for any further-future row, and "Earlier" for any further-past row.

- **2-week navigator strip is mobile-only.** On desktop and tablet the full week is already visible in the time grid and the prev/next arrows handle week navigation, so the strip was duplicating information without adding any. It now only renders below the `md` breakpoint — desktop/tablet weekly view goes back to its original layout.

- **Deleted family members no longer leave stale "Unknown" pills on activities and to-dos.** When a member is deleted, their ID stays in existing `assigneeIds` arrays (so the assignment is restored automatically if the member is ever un-archived). `MemberChip` used to render those orphan IDs as a generic gray "Unknown" pill that couldn't be removed. The chip now silently skips any ID that doesn't resolve to a current family member — orphan pills disappear from activity drawers, to-do rows, the weekly + daily timelines, and the activity-list card all at once, without disturbing the underlying data. If the member is restored, the pills come back automatically.

- **"Today" button on the monthly view now scrolls to today on mobile.** Tapping the today button used to be a no-op when you were already on the current month — but on mobile the long vertical day-stack means today's card could be ~800px below the viewport. The button now always smooth-scrolls to today's card with the same 80px headroom as the first-mount auto-scroll, whether you were on a different month (which also changes the year/month) or already on the current one.

- **Monthly mobile opens at today, with today visible even when empty.** The vertical day-stack used to land at the 1st of the month, forcing users to scroll to find today. Now on first mount of the current month, the view auto-scrolls to today's card (with ~80px headroom under the topbar). Today's card itself gets a 3px orange left bar and a soft orange wash, so even when there are zero events scheduled it reads as the intentional "you are here" placeholder — including a small `TODAY` caption under the day number when the events column is empty. Navigating to a different month no longer auto-scrolls.

### Changed

- **Monthly calendar replaces dots with member-color chips.** The month view previously showed timed activities as small colored dots — readable as "something is happening" but never "what". Each day now renders up to 4 chips per cell with the assigned bean's color as a left bar, the category emoji, the time, and the truncated title. A `+N more` button opens the full day. Solo events use the bean's own colour; whole-family (no-assignee) and shared (2+ assignees) events use Heritage Orange. On mobile, the 7-column grid collapses to a vertical day-stack — each day card gets a DOW label ("tue 19"), week separators between Mondays mark the current week in orange, and multi-person events surface an avatar stack on the right so you can tell "everyone vs just the parents" at a glance. A new mobile-only legend strip below the toolbar lists the family members as colored dots in a single row, never wrapping.

- **Activities page simplified.** "Upcoming Activities" and "Family To-Do" sections below the calendar are removed — the new chip calendar carries the upcoming list directly, and todos with due dates already appear on the calendar. The canonical to-do page stays at `/todo`. The page is now vacations card → calendar → archived-activities toggle, ~270 LOC lighter, and reads as a single calm scroll on mobile.

### Removed

- `UpcomingActivities.vue` and `TodoPreview.vue` components, plus 6 orphan translation keys (`planner.upcoming`, `planner.noUpcoming`, `planner.todoPreview`, `planner.viewAllTodos`, `planner.onCalendar`, `planner.viewMore`).

---

## 2026-05-18

### Changed

- **Welcome gate redesigned for clearer onboarding hierarchy.** A first-time visitor used to see three equal-weight cards (Sign In / Create / Join) with the question "What would you like to do?" and reasonably picked Sign In even when they had no pod yet, dragging them into a loop. The page is now a hero + secondary row: a larger _"where would you like to **begin**?"_ prompt with the verb in the brand gradient heads the page; a full-width **"plant a new pod"** gradient card is the obvious lead, with a "start here" pill, seedling emoji 🌱, and a chevron that nudges right on hover; an "Or" divider; then **"welcome back"** (sign in, 👋) and **"join your family"** (💌) as a paired secondary row underneath. Each secondary card carries a 3px left accent strip (slate for Sign In, Sky Silk for Join) and a faint radial halo behind its icon — quietly belongs to the brand family without competing with the Create gradient. Copy refreshed across the board: Sign In subtitle is now _"Sign in with your .beanpod file"_ (self-disqualifies first-timers who don't have one), Join subtitle is _"Someone sent you a join link"_ (concrete vs the old vague "your family is waiting for you"), Create subtitle ties the encryption pitch to the action: _"Start your family's bean pod - encrypted, yours to keep."_

- **"every bean counts" tagline upgraded.** From plain gray Inter to Outfit italic, lightly tracked, with the word **"bean"** rendered in the brand gradient — a small typographic echo of the "begin" highlight in the prompt below, landing on a different word position so they read as designed-together rather than repeated.

### Fixed

- **A user with an unreadable local data file no longer gets stuck in an infinite reload loop.** When a signed-in user's `.beanpod` file failed to load for non-password reasons (file moved, permission revoked, corruption), app init tried to redirect them to `/welcome` to start over. But the router's authenticated-redirect guard (the one that keeps signed-in users out of the welcome screen) bounced `/welcome` straight back to `/nook`, where init re-ran, the file failed again, and the cycle restarted - generating ~1 error alert per second in `#beanies-errors`. Caught 2026-05-18 from one family hitting 40+ alerts in 30 seconds. Three layered fixes: (1) init no longer redirects on irrecoverable load failure - falls through to the post-init health check which surfaces the existing recovery overlay where the user can Reload or Clear Data without the guard fighting; (2) added a defence-in-depth backstop in `safeRouterReplace` that counts cancellation-and-fallback attempts per target across page reloads (via sessionStorage) and stops the fallback after 3 attempts in a row, surfacing the recovery overlay instead; (3) error reporter now persists its dedup window across reloads via sessionStorage (in addition to the existing in-memory bucket) - identical errors fired on every reload of the same tab now coalesce to a single alert per 60 seconds, so the next unforeseen reload loop won't flood Slack.

- **Photo viewer's bottom buttons now match the rest of the app's modal convention.** The lightbox footer used to put Remove on the right (where a thumb naturally lands - the most destructive action in the easiest-to-tap spot) and Download on the left, with no Close button at all. Every other drawer / modal in the app puts the destructive action as an icon-only trash button on the LEFT, secondary utility actions adjacent to it, and the primary "Close" / "Save" button right-aligned with a label. The lightbox footer is now aligned: a red-tinted 🗑️ icon-only square on the left (calls the same delete-with-confirm flow as before), a slate-tinted 📥 icon-only square next to it for Download (rare enough that the icon does the job), and a gradient-orange "Close" primary button on the right that's hard to mis-tap into a delete. Missing-photo state gets the same treatment: trash on the left, "Replace photo" as the gradient primary on the right.

- **Photos now appear in an activity (or milestone, medication, recipe) even if you close the drawer while it's still uploading.** Attaching a photo, closing the drawer mid-upload (before the "counting beans" spinner finished), and reopening it would show no photo and no spinner — the photo was actually saved in the doc, but the drawer's local view never picked it up until a full page refresh. Root cause was a two-layer staleness chain: BaseSidePanel's drawer dialog uses `v-if="open"` so closing unmounts PhotoAttachments and its composable (the async upload kept running and wrote the photoId straight into the doc, but the `update:photo-ids` emit then hit an unmounted component as a no-op); the modal's parent (e.g. FamilyPlannerPage) captures the activity as a plain object reference at click-time, so even when the doc updates the prop reference stays stale; and entity stores (activityStore, milestonesStore, etc.) hold static `ref<Entity[]>` arrays that only refresh on explicit `load*()` calls, not on doc changes. Fix is to read the modal's photoIds straight from the live Automerge doc via a new `photoStore.photoIdsFor(collection, entityId)` helper that's reactive on `docVersion`. The binding now has a deep watch on its source so doc changes propagate even when the source flows through multiple layers; the watch is suppressed during in-flight optimistic operations and re-syncs once on the way out so user-initiated add/remove can't be clobbered. Applied across all five photo-bearing modals (activities, milestones, medications, recipes, and the activity view/edit drawer).

- **Photos no longer get lost on flaky connections.** Attaching a photo to an activity on a slow / spotty network (the 2g case: technically online but Drive uploads timeout or hit 5xx) used to fail with a "couldn't upload photo. please try again." error toast — and the photo was gone. Now those transient failures (network errors, AbortError, Drive 5xx, 429) fall back to the existing offline-upload queue automatically. The user sees a quieter "photo queued - we'll finish uploading when your connection is ready" message, the photo tile renders as pending, and the queue retries on its own as soon as the network stabilises. Genuine failures (auth, malformed request, etc.) still surface a real error toast. If the queue itself fails too (rare: device storage exhausted, private-browsing IndexedDB block), a separate "couldn't save your photo for later" toast distinguishes that from a generic upload failure so users know to free up storage. Belt-and-braces: the `addPhoto` contract now explicitly returns `{ photoId, status: 'completed' | 'queued' }` so callers stop relying on a fragile heuristic to detect queued uploads.

- **Login page no longer crashes on a hidden Vue render path during the resume-setup recovery flow.** When a user with a half-finished onboarding hit a protected route (e.g. PWA reopen at `/nook`), the router guard redirected them to `/welcome?resume=setup` — and the resume-setup detector inside `LoginPage.vue` then threw a `ReferenceError: Cannot access 'stopResumeWatch' before initialization` during render. The cause was a classic temporal-dead-zone trap: `const stopResumeWatch = watchEffect(() => { ...; stopResumeWatch(); })` self-references the const inside its own initializer; on the first synchronous run (which fires when all conditions are already true at mount) the assignment hadn't completed. Vue's error boundary caught it so the app didn't visibly crash and the user could still complete pod creation, but the alert noise fired and the render was aborted mid-effect. Fixed by switching to `let stopResumeWatch: WatchStopHandle = () => {}` then assigning the watchEffect handle to it — the first run safely calls the no-op, then assignment completes for any later reactive re-run. Caught from Boeder Familienplan's Android Chrome onboarding on 2026-05-18.

- **`app.onboardingZombieState` no longer fires an error-channel alert when the user is already on the recovery screen.** The boot-time zombie-state detector in `App.vue` was reporting an error every time it ran — including when the user was already at `/welcome?resume=setup` and the system was working as designed (e.g. a PWA cold reopen during the recovery flow). The alert added zero new information in that case and trained operators to ignore the channel. Now only fires when the user is on a non-recovery route in the zombie state (which is the genuinely-shouldn't-happen signal we want to track). The router-guard alert in `router/index.ts` is unchanged — it still fires when a user navigates TO a protected route in zombie state.

- **Sign In → Google Drive → "no pod" → click-Drive-again loop closed.** When a new visitor without a pod picked Sign In then Google Drive, the "no pod files found" empty state was appended _below_ the still-prominent Drive card, so users re-clicked the same card in a loop. The amber empty-state notice is replaced by a focused "no pod yet on this Google account" panel — Sky Silk seed icon, redirect framing (not error), and three CTAs (**Create a new pod** / Try a different Google account / I have a .beanpod file) plus a low-weight _"just added a pod? Check again →"_ deliberate-retry link. The storage cards no longer render while this panel is showing — they can't bait a re-click. If the user navigates back to the storage cards afterwards, the Drive card now carries a dimmed treatment with a "Checked — nothing found" badge (still clickable for the rare case of a genuinely-just-added file, just not magnetic).

- **`autoLoadFile` no longer silently swallows file-load errors.** A previous bare `catch {}` in `LoadPodView.autoLoadFile` could leave a user stranded on the storage picker with no feedback when the persisted file handle failed to read. Now sets a user-facing `formError` and logs `[LoadPodView] autoLoadFile failed: …` to the console for telemetry. Same console-error breadcrumb pattern added to `handleLoadFromGoogleDrive`, `handleDriveRetry`, and `handleDriveSwitchAccount` so failures in any of those Drive paths carry a developer trail alongside the existing user-facing message.

- **`offline-queue-flush` Slack alerts now carry the underlying cause string.** The alert message used to read `flush rejected after visible` (or `after online` / `after token-acquired` / `after startup`) with no indication of WHY the Drive write rejected — operators had to read the minified stack to triage. The Slack alert format only renders `input.message` + `error.stack` (not `error.message`), so the inner cause was invisible from the alert body. Fix concatenates the underlying error's `.message` into the outer telemetry message, so future cascades on iOS Safari PWA wake (and any other stuck-queue failure) read e.g. `flush rejected after visible: TokenExpiredError: Drive write failed; save queued offline` and triage can decide noise-vs-genuine from the alert alone. Caught from the 2026-05-18 HK pilot cascade.

---

## 2026-05-16

### Added

- **Owners and admins can now reset another family member's password from the UI.** Previously the only fix for a locked-out bean was to delete and recreate them, which orphaned every item tied to that bean. The new "Account Access" panel on each bean's detail page (`/pod/<member>`) lets an admin set a new temporary password for any non-owner human bean who has already joined, with a clear warning to share it privately. Same flow keeps the bean's history, items, sayings, photos — nothing is orphaned. Available to anyone with manage-pod permission; hidden for self (use "Your Account" instead), for the owner (who changes their own password from Settings), and for pets.

### Changed

- **Settings now has a "Your Account" card.** Password, passkeys, and sign-out — the self-serve "this is me" stuff — used to live two clicks deep inside Security & Privacy (Settings → Security → drawer → scroll → Change Password tile). Promoted to a top-level Settings card with the 👤 icon, so changing your own password is now two clicks: Settings → Your Account. Security & Privacy keeps the system-level toggles (device trust + future advanced).

- **Settings → Family Data: "Create New Data File" is now "Resume Setup".** When a signed-in session somehow lands without a pod configured, Settings used to offer a "Create New Data File" button that silently failed pre-pod — exactly the scenario our first user hit in HK. The button now reads "Resume Setup" and routes you into the same hardened pod-creation flow used by `/welcome?resume=setup`, which verifies the file after writing, preserves any partial file as `.corrupt-<timestamp>` on failure, and surfaces a concrete error if anything goes wrong. The sibling "Load Existing Data File" button is unchanged. Subhead reworded from "Create an encrypted data file or load an existing one." to "Finish setting up your encrypted data file, or load an existing one."

- **Sidebar and mobile nav now use a consistent attention-badge system.** The orange numeric pill (previously only next to Goals) is now an attention-only signal — it appears next to any nav item that has something needing your attention, and disappears when there's nothing. **To-Do** shows the count of overdue + due-today tasks. **Budget** shows the count of categories over the limit this period. **Goals** now shows the count of goals past their deadline (replacing the previous "all open goals" count, which wasn't really an alert). **Travel** shows a quieter Sky Silk dot (no count) when a trip is ongoing or starts within the next 30 days — informational, not action-needed. On mobile, the same badges appear inside each nav category when you tap to expand it, and the closed category tab gets a small orange dot at top-left when any item underneath needs attention — so PWA users see the signal at a glance without opening the menu. Screen readers now announce the count alongside the nav label (e.g. "Goals, 3 need attention"). A small foundational hardening also went in: corrupt deadline / date values across goals, to-dos, and trips are now logged to the dev console with a clear context label rather than silently dropping the item from "overdue" filters.

### Fixed

- **Members locked out by a divergent password no longer need to be deleted and recreated.** A handful of family members (across multiple pods) hit a state where their correct password failed at the welcome-gate unlock prompt but worked fine at the per-bean sign-in screen — so the only recovery used to be deleting the bean and recreating them, orphaning their items. Diagnosed two structural bugs in the envelope-key handling: `fetchAndMergeRemote` was merging the per-member wrapped-key dictionary with the remote side winning on duplicates (silently clobbering any freshly-rotated local entry), and three envelope-replacement paths in `syncStore` were wholesale-overwriting the in-memory envelope without preserving local-only key entries. Both are now closed by a single safe-merge helper and a `replaceEnvelope` invariant that's the only path for non-additive envelope writes. Sign-in also now opportunistically re-wraps a member's stale entry the next time they authenticate with their correct password — pods already corrupted in production self-heal without a manual recovery step. If the unlock fails again, the welcome-gate error message now also tells the user the recovery path ("ask a family member to open the pod first — we'll automatically repair the issue on your next sign-in").

- **Offline-queue flush no longer fires duplicate Slack alerts on PWA cold-start, and the alerts now carry the actual failure cause.** On iOS PWA reopens, the offline save-queue triggers (token-acquired, visibility-change, provider-attach) could all fire within ~10ms of each other, kicking off concurrent Drive writes and producing two or three identical Slack alerts per occurrence — all reading `flush returned false` with no underlying cause. Two structural changes fix this: (1) a coalescing guard so only one flush runs at a time — subsequent triggers in the same window piggy-back on the in-flight attempt silently, and (2) the underlying `write()` error now propagates through to the Slack payload so operators see the real cause (token-rejected, Drive 404, network TypeError, etc.) instead of a synthetic placeholder. A new `startup` reason also distinguishes provider-attach auto-flushes from the three event-driven recovery paths, so we can tell at a glance which window the failures are clustering in.

- **Timezone-dependent unit tests no longer fail on CI.** Three to-do helper tests pinned `vi.setSystemTime()` to a UTC instant that was labeled "15:00 SGT" — fine east of UTC, but on CI (Ubuntu, UTC) the same instant is 07:00 and broke the "overdue when dueTime is 10:00" precedence assertion. Switched to the local-time constructor so the fixture is deterministic in any timezone the suite runs in. (Internal CI fix — not user-visible, but it was blocking deploys.)

- **Switching language on the welcome screen no longer shows a misleading "couldn't save your preference" error.** A brand-new visitor who tapped the language picker (top-right of the welcome gate) before creating a pod got an error toast — even though the language did switch correctly — and the same gesture quietly fired two error alerts per click to our error channel. The dual-layer save (device + family) didn't gracefully handle the "no family yet" state: the device write succeeded, but the family-doc write threw because no family doc exists yet. Now the device write — the only one that matters before a pod exists — happens cleanly, the family-layer write is skipped with a dev-only console note for telemetry, and the user sees a clean language switch with no error.

---

## 2026-05-15

### Added

- **Public holidays now show up in the daily briefing — with proper festive treatment.** The Family Nook gets two new holiday surfaces wired off the country-aware holiday dataset that already powers the planner. On the day itself, a banner sits above the orange briefing box with a warm greeting — "Merry Christmas, beans", "Happy Lunar New Year, beans", "Eid Mubarak, beans" and similar for a global allowlist of ~8 widely-recognised holidays, falling back to "Today is {holidayName}" for everything else. Each special holiday gets its own themed treatment: Christmas runs deep evergreen → cranberry with drifting snowflakes; Lunar New Year is cinnabar → gold with a soft glow pulse; Diwali is indigo → amber with six twinkling diyas along the bottom; Eid is sage → cream with a gentle moon halo on the emoji; New Year fires a one-shot confetti burst on mount over a midnight → champagne gradient; Easter, Mother's Day, Father's Day and Thanksgiving each have their own seasonal palette and motif. Local / regional holidays (Vesak Day, Bastille Day, etc.) use a warmed Sky Silk + peach default theme with three quiet sparkle dots — distinct enough to feel like a calendar moment, restrained enough to stay out of the way. The day before any holiday, the briefing list inside the orange box surfaces a top-pinned italic note — "✨ Tomorrow is Christmas Day · school & work may be off" — with no checkbox or chevron (informational, not actionable). Beanie mode adds a "heads up:" prefix to the tomorrow message. Both surfaces respect the existing Settings → Planner "show public holidays" toggle and disappear when no country is set. Every animation honours `prefers-reduced-motion` — falls back to a static decorated banner.
- **Your birthday gets a celebration.** When today is the current viewer's birthday (per their profile DOB), the holiday banner takes precedence over any public holiday and renders the most elaborate treatment in the app — magenta → champagne gradient, drifting confetti pieces, ✦ sparkles, a gently wobbling 🎂 cake emoji, and a soft gold glow that pulses around the banner all day. Plus, once per birthday per device, a full-screen confetti rain fires when the Nook loads, with a personalised "Happy Birthday, {firstName}!" hero that pops in the centre, holds for ~3 seconds, then fades out as 48 colourful confetti pieces fall through the viewport. Gated on localStorage so reloading on the same day doesn't re-trigger; reduced-motion mode skips the screen overlay entirely.
- **Activities can now recur every 2 weeks, monthly-by-date, or monthly-by-weekday.** The recurrence picker on the activity create / edit drawer used to be limited to daily / weekly / yearly. It now includes **Every 2 weeks** (biweekly — for fortnightly piano lessons, bin-day, payday); **Monthly on the {ordinal}** (anchored on the start date's day-of-month — "the 14th"); and **Monthly on the {ordinal} {weekday}** (anchored on the start date's nth weekday — "the 2nd Tuesday", "the last Saturday"). The pill labels render live as you change the start date, so picking a different start date updates the wording without you having to reopen the picker. A new shared `formatActivityRecurrence` helper unifies pill labels and the recurrence summary on the view/edit modal — one place to edit the wording. The frequency chips are auto-disabled when more than one day-of-week is selected on a Weekly activity (with a small hint: "pick just one day of the week to use this option"), since "Every 2 weeks on Mon, Wed, Fri" isn't well-defined.
- **The daily briefing box now has a name.** The orange critical-items card on the Family Nook used to be just an icon, a cycling beanie quote, and a count — leaving first-time users to infer what they were looking at. It now carries a "Your Daily Briefing" label in Outfit italic, sitting inline before the activities/tasks summary so it doesn't steal any vertical height on mobile. The italic display-font treatment differentiates the label from the bold-white motto above and the dimmer count below without competing with either. In beanie mode the label reads as `your daily briefing` (lowercase, italic), respecting the brand's lowercase rule everywhere.

### Fixed

- **Back button during the "creating your pod" animation no longer breaks the app.** The setup-progress modal that shows the step-by-step "Planting your beans... Building your pod..." animation does real work (final sync + auto-sync arming + registry registration) on the last two steps — but the navigation guard that's supposed to block back/close during a critical write was only active for the file-write itself, which had already finished by the time this animation started. Pressing back during the animation could leave the app in an inconsistent state and surface the "oh no, the beans spilled" recovery overlay. Now the guard stays active for the full duration of the setup-progress modal, so back / close-tab / SPA-nav are all blocked (or trigger the native browser confirm) until the modal finishes its work. Belt-and-braces fix #2: after a successful pod creation, the family key is now cached on this device — so even if the guard fails to fire for some reason (e.g. iOS Safari's swipe-to-back can bypass `beforeunload`), a reload recovers automatically without prompting for the password again. Belt-and-braces fix #3: when `router.replace` during init is intercepted by a guard (rather than throwing), the recovery flow now detects this and falls back to a hard `location.replace` so the user genuinely lands at the right URL.

- **The "finish setting up your pod" screen no longer destroys your data.** This is the screen the app shows when an authenticated session exists but the local IndexedDB state says there's no pod yet — usually because the device's cached pod info got cleared (iOS Safari periodically evicts site storage; signing out and back in does it; switching browsers does it). Previously, that screen ALWAYS rebuilt your pod from scratch, generating a fresh encryption key and writing a brand-new (empty) `.beanpod` file to your Google Drive — even when your real pod was still sitting there at a different `fileId`. The result was either a silent overwrite or a duplicate empty file that the app then locked onto, with your real data unreachable through the app (still in Drive, but invisible to beanies.family). It's the exact failure mode that cost our first user their data on May 15. The screen now queries our family registry first: if it finds your family already has a registered pod file, it shows a "We found your pod — enter your password" screen instead and loads the real file. If the registry has no record (genuinely new family that didn't finish onboarding), it falls back to the previous "pick where to save" flow. The same `Automerge.load` corruption check that ships with the pod-creation hardening also runs during this load path, so a damaged file surfaces a clear "this pod file is damaged, contact support" screen with the diagnostics — never a silent recreate.

- **Back button / close tab during pod creation or recovery now blocks instead of breaking.** A non-dismissable router guard refuses to navigate while pod-creation or pod-recovery writes are in flight, and the native browser "leave site?" confirm fires for close-tab. Previously, hitting back mid-write left you in an inconsistent state — a half-written file in Drive, or worse, the recovery screen mistaking a new device for a "never finished setup" device and overwriting your real pod with an empty one.

- **Creating a second pod with the same family name no longer silently orphans the first.** Google Drive lets you have multiple files of the same name in the same folder, with different fileIds — so calling "create new pod" twice with the same family name used to create a duplicate empty file alongside your real one. The app would then bind to the duplicate, leaving the original unreachable. Pod creation now lists the folder first and refuses with a clear "a pod with this family name already exists in your Google Drive — please pick a different family name" message. The existing file is untouched.

- **Pod creation now fails loud instead of silently writing a broken file.** A pilot user on iPhone Safari recently hit a worst-case bug where the `.beanpod` file they created looked normal in Google Drive but, when opened on a second device with the correct password, the encrypted contents couldn't be loaded as a valid family pod — and their data was unrecoverable. The creation flow had reported success and entered the app, with no error fired anywhere. This release adds an end-to-end verify-and-confirm step at pod creation: after writing the file, the app reads it back, decrypts it, and confirms the resulting pod loads cleanly before flipping the "your pod is ready" switch. If any step fails — bad bytes from the network, a partial upload, a cache write that didn't land, or a registry write that couldn't reach our servers — the partial file in Google Drive is renamed to `<family>.beanpod.corrupt-<timestamp>` (forensic preservation, not deleted), local state is reset so a retry starts clean, and the user sees a concrete error message explaining which step failed and what to do next instead of landing on an empty Family Nook with no idea why. The same Automerge sanity check now also runs at every file _read_ site (initial load, sign-in, cross-device sync, resume-setup recovery) — so the same corruption pattern is detected anywhere it could surface, with a typed `CorruptPayloadError` that downstream UIs can react to.

- **Recovery overlay no longer flashes on the way to `/welcome`.** When the app couldn't decrypt your data automatically and redirected you to the welcome page, the post-init health check could fire a moment too early and show the "oh no, the beans spilled" recovery overlay on top of the welcome screen — alarming for what was a clean redirect. The two redirect sites in `loadFamilyData` now `await` their route changes so the health check sees the final route, not the pre-redirect one. Also: the browser's native "leave site?" confirmation now appears if you try to close the tab during pod creation, so you can't accidentally bail mid-write.

- **Beanie tip-of-the-day "try it" buttons now route correctly.** The milestone tip's CTA was pointing at `/goals` (the wrong page entirely — there's no Milestones surface there); the budget tip's CTA had a similar mis-route. Both now land on the right destination — Milestones via the bean's Overview tab, Budget via its proper page.

### Security

- **License audit now runs on every push to main, not just pull requests.** The license-checker CI job was previously PR-only — direct commits to `main` (which is most of our workflow) never triggered it. We could in principle have introduced a copyleft / non-permissive license into the dep tree without noticing. New `license-audit` job in `security.yml` runs on push, PR, and the existing weekly cron, with a diff-free check (full audit of `node_modules` + `web/node_modules`, not just changed deps). MIT / Apache-2.0 / BSD / ISC / CC0 / Unlicense / Python-2.0 only.

### Changed

- **Swiping between days, weeks, and months on the Planner now slides — no more flash.** The horizontal swipe gesture on the day / week / month calendar surfaces previously snapped to the next date instantly, which felt more like an accidental tap than a real swipe. Now the card follows your finger as you drag (with a gentle resistance once you pull past the commit threshold so it doesn't fly off), and on release the current view slides off in the direction your finger went while the new view slides in from the opposite edge — the iOS Calendar pattern. Releasing a short, undecided drag springs the card back to centre. Same easing and timings (~220 ms out, ~320 ms in) feel responsive and quiet, not flashy. Honours `prefers-reduced-motion`: if the OS asks for less motion, the swipe just swaps content instantly like before. Tapping the < / > / today buttons stays instant — they're a direct affordance, not a gesture. New `useCalendarSlide` composable layered on top of the existing `useHorizontalSwipe` (which keeps owning gesture detection); the lower composable's 13-test contract is untouched. 10 new unit tests cover direction, drag preview, rubber-band damping, re-entrancy lockout, and the reduced-motion path.

- **The "Add your family" step of pod creation is simpler now.** Step 3 used to greet you with an empty form half-filled in for adding a family member — presumptuous, since you hadn't said you wanted to add anyone yet. Now you just see your own profile at the top and two clear chip buttons below: **Add an adult** and **Add a little bean**. Pick one and the form opens with that role already selected; the orange "Finish — take me to the Nook" CTA stays out of the way while you're filling it in (the form has its own Cancel + Add member row instead). The form fields are reordered too — role first (already picked, easy to flip), then name, then birthday. The separate "Skip — just me for now" link is gone because Finish does the same thing in the empty state. Plus: "Parent / Adult" → "Adult" everywhere it appears (a grandparent or uncle isn't always a parent, but is always an adult).

- **The airport picker no longer hangs on older Android phones.** Travel and vacation forms have 4046 airports to pick from, and on older or cheaper Androids the dropdown was rendering all of them at once on open — meaning a noticeable freeze before you could even start typing. Now it shows the first 50 results with a "Showing 50 of 4046 — keep typing to narrow" hint, and the filter narrows from there as you type. Same fix applies to every searchable dropdown in the app (currency, account institution, airline, etc.) — they all benefit from the cap and the fast render path.

- **Searching an airport by code now puts the exact match at the top.** Typing `SIN` (or `sin`) used to find Singapore Changi buried under any airport whose name happens to contain "sin" — Singen, Sincelejo, Sindelfingen, etc. Now an exact 3-letter code match jumps to position 0 of the results, case-insensitively. Partial matches don't promote (typing `SI` still scrolls through the list normally), so this only kicks in when you actually know the code.

- **Date pickers can be cleared now.** Selecting a date used to leave you with no way to un-select it — a real problem for optional fields like an activity's end date or a milestone with no fixed day. Each date picker now shows a small × on the pill once a date is set (one tap clears it), plus a "Clear" link inside the calendar popover next to "Jump to today". Both only appear when a date is actually set, so empty pickers stay clean.

- **Standard English wording cleaned across ~38 strings.** Phrases like "no favorites for this bean yet" and "couldn't add that beanie" were using "bean" / "beanie" as a generic noun for a family member, which translated badly to non-English languages. Standard English now uses "member" / "family member" / "child" in those spots; **beanie mode reads exactly the same as before**. Improves the Chinese translation quality (e.g. "Add a child" now translates to "添加一个孩子" instead of the previous literal-quantity rendering).

### Added

- **Family country is now stored in the family registry alongside the file location.** Adds a small operations-side benefit: when troubleshooting a family's setup (e.g. why public holidays aren't showing for them), we can see at a glance which country their pod is set to without asking. No user-visible UI change — the country was already being collected during onboarding and stored locally; this just mirrors it to the central registry. Existing families pick it up on their next normal save.

---

## 2026-05-13

### Added

- **A Milestones card on every family member's profile.** The Overview tab now has six summary cards instead of five — Milestones joins Allergies, Favorites, Sayings, Medications, and Notes. It shows the most recent three with category emoji, title, and "date · category", and tapping it (or "View all →") jumps straight to the member's Milestones tab. Fills out the previously-empty grid slot.

### Changed

- **Scrapbook cards: tapping anywhere on a card now opens the relevant view.** Previously, tapping the photo on a milestone card opened a fullscreen lightbox in place, while tapping the caption navigated to the bean's milestones. That split made the photo feel like a different kind of tap than the rest of the card. Now the whole card behaves the same — one tap takes you to the milestone in its proper view, where the photo can still be expanded fullscreen. Family-wide milestones (not tied to a single bean) keep the in-place lightbox since they have no per-bean destination.

### Fixed

- **The "oh no, the beans spilled" reload loop on iPhone Safari is fixed.** A small group of returning users on iOS Safari could hit a reload loop after a deploy — the page would show "counting beans…", flash a scary "we couldn't load the app" overlay, reload itself, and start over. Sometimes for minutes. Root cause was a triple-whammy: our previous deploys removed old code files from S3 as soon as a new build went up, and CloudFront held onto the old shell page for up to a day, so a stale CDN edge would hand a returning user a page pointing at code files we'd just deleted. The browser would 404, our recovery code would try to reload to a fresh copy, the CDN would serve the SAME stale page, and the loop would run until the CDN finally invalidated. Three fixes shipped together: (1) **old code files now stay on S3** for a grace period so even a stale page has working code to load; (2) **the main shell page now tells the CDN not to cache it long** so the freshest version is served almost instantly after deploy; (3) **the recovery logic is now bounded to 3 silent attempts** with a tappable "Reload / Sign out & clear data" overlay on the 4th — no more locked-out-mid-loop. The error-detection regex was also broadened to catch iOS Safari's specific wording for the underlying browser error (previously it only matched Chrome's wording, which is why iOS users got the scary overlay and Android users didn't).
- **Setting up a new pod on Google Drive now works on iPhones — and an interrupted setup can never strand you in an empty app.** Some iPhone users (depending on whether the app was installed to the home screen or just opened in Safari/Chrome) hit a Google "400 — that's an error" page while connecting Google Drive during pod creation, then got dropped into a blank Family Nook with no data file. Two root fixes: (1) **every iPhone/iPad browser now does the Google sign-in as a full-page redirect** (the same flow installed apps already used) instead of a popup/new tab — popups on iOS don't reliably hand the result back, and a fresh tab trips iOS's cookie protections mid-sign-in, which is what produced that 400. (2) If setup is ever interrupted — that 400, a closed tab, the page reloaded mid-redirect — you now land on a **"Finish setting up your pod"** screen (pop your password back in, pick where your pod lives, done) instead of an empty Nook with no way back. There's also a quiet "Start over instead" there if you'd rather. Plus: the Google-Drive-failed dialog now offers **"Try again"** and **"Use a local file instead"** (not just "OK"), and the Google sign-in window can no longer hang forever — it gives up after a couple of minutes with a clear message.
- **The "🎉 family pod created" signal is now reliable for every new family.** It fires the instant your `.beanpod` file is actually written — for a local file just as much as a Google Drive one (it had been missing for local-file pods) — and on the new "finish setting up" recovery path too. And every onboarding hiccup now lands in the team's error channel (a Google sign-in that fails, a file that can't be created, a setup that completes with no data) so we hear about it instead of guessing.

### Changed

- **Your daily briefing now catches to-dos that used to slip through.** Two changes to the orange "what needs doing" box on the Family Nook: (1) **a to-do assigned to nobody now shows up for everybody** — it's treated as "whoever's free", framed as _"Buy milk (anyone can do this)"_, and stays in everyone's briefing until someone ticks it off (whoever does it gets the credit). Previously an unassigned to-do showed in the To-Do widget and the To-Do page but on nobody's briefing — easy to lose. (2) **a to-do — or a calendar activity — assigned only to a child now shows up for every grown-up in the family**, framed by the child's name, e.g. _"Emma: wear AM uniform for school photos today!"_ The child still sees it as their own. If you want just one parent on the hook instead of all of them, add that parent as an assignee alongside the child — then only that parent (and the child) see it. The existing date rules are unchanged (a child's to-do due next week still won't appear yet), and the help article **Your Daily Briefing** has been rewritten to cover all of this (plus medication reminders, which it never mentioned).
- **The daily briefing box now expands and collapses — smoothly.** When you have more than five things on your plate today, the briefing used to show a faint "+N more ↓" that scrolled you down to "Today's schedule" — which doesn't even include your to-dos, pickups/drop-offs, or medication reminders, so the rest was effectively hidden. It now has a **"Show all N"** button that opens the box right there to show everything (the box grows with a gentle animation rather than snapping, and the new items cascade into view), and a **"Show less"** to fold it back to five. The "Upcoming activities" list on the Family Planner and the to-do preview in the planner sidebar got the same treatment — they could already load more, but now they expand smoothly and can collapse back too.
- **Setting up a new pod now clearly recommends Google Drive — and the local-file warning is shorter and friendlier.** On the "Save & Secure" step of the create-a-pod wizard, **Google Drive is now the headline option** (a prominent card with a clear "Connect Google Drive" action and a one-line "syncs with your whole family, on every device — same encryption as a local file"), and choosing a local file is a quiet "Prefer to store your data locally on this device?" link below it. If you pick the local file, the confirmation modal has been rewritten: gone is the "local files are great for security" line (Google Drive is just as private — both are AES-256), replaced by a short, honest "**Heads up — local files don't sync**" — your data stays on this device and you'd have to share the file manually. Its buttons are now **"Use Google Drive instead"** (the recommended path) and a low-key "Use a local file", and the **× at the top** means you're never stuck in the modal.

## 2026-05-12

### Added

- **A lot more help-center articles.** New guides cover the whole Pod section: **Meet the Beans** (each family member's profile), **Allergies & Medications** (Care & Safety), **Family Milestones**, **The Family Scrapbook**, **The Family Cookbook**, **Emergency Contacts**, and **Adding Photos** (where photos show up across the app, and why they need Google Drive turned on). The **Family To-Do Lists** article also got a polish on its new "Someday · Maybe" section.
- **"Milestones" is now in the "Add something" menu on a family member's page.** The ＋ Add something dropdown on a bean's profile (Meet the Beans → a member) now includes **🌟 Milestone** alongside Favorite, Saying, Note, Allergy, and Medication. Picking any item now also takes you straight to that tab with its add form already open — previously the menu only navigated to the tab.
- **"Someday · Maybe" to-dos — a place for ideas you might do, with no pressure.** Not every to-do is a real commitment. Open any task and switch **Track as** from **📋 To-do** to **💭 Someday · Maybe** (or, on desktop, hover the task and tap the 💭 button) to park it as a loose idea — "take the kids camping", "re-do the garden". Someday tasks collect in their own always-visible **💭 Someday · Maybe** section on the To-Do page, just below your open tasks, so the idea stays in sight — but they're kept out of the way everywhere you're meant to be focused: no daily briefing, no To-Do widget on the Family Nook, not in the planner sidebar or the calendar. Marking a task someday clears its due date and time; switch it back to **📋 To-do** and it becomes a normal undated task you can schedule again. You can still tick one off — it moves to Completed like any other, and reopening it returns it to the Someday section. Updated help article: **Family To-Do Lists** (new "Someday · Maybe to-dos" section).
- **Your country's public holidays on the Family Planner.** Tell beanies.family where your family lives — during first-run setup (next to the currency picker) or any time in **Settings → Country & Holidays** — and the planner marks that country's national public holidays: the days school is usually out and many workplaces shut. On the month view a holiday gets a soft clay-coloured day cell and an italic label like "Memorial Day (US)"; the week view tints the day header; the day view, day agenda, and the planner sidebar show a banner with the holiday name. Tap a holiday anywhere it appears for a short detail card (date, country, and a hedged "work and school are probably off — please check!" note). It's display-only — holidays never get added to your calendar and can't be edited or deleted; deleting an activity that happens to fall on a holiday doesn't touch the marker. A **Show public holidays on the planner** toggle hides them without forgetting your country, and picking **Not set** turns the feature off. The country list and holiday data are bundled with the app — nothing about where your family lives ever leaves your device. (v1 covers national `public` holidays only — regional/state holidays, "bank"-only days, and translated holiday names are future enhancements; if no holidays appear for your country, the dataset doesn't cover it yet — nothing breaks.) New help article: **See your family's public holidays on the planner** (Getting Started).
- **Move your pod between local file and Google Drive — any time, from Settings.** When you first set up beanies.family you chose where your pod lives: a file on your device, or a file on your Google Drive. That choice is no longer permanent. Open **Settings → Family Data Options** and you'll see a **Move to Google Drive** row (if you're on a local file) or a **Move to a local file** row (if you're on Drive) — one tap, a quick confirmation, and your pod is saved to the new spot. Your data isn't decrypted, re-uploaded in the clear, or exposed at any point — same password, same encryption, only the location changes. The file you were using stays exactly where it is (we don't delete it), so keep it as a backup until you're happy with the move. If you use beanies.family on more than one device, the others just need to load the pod again from the new location. Owner-only — if you're a family member, ask whoever set up the pod. If a move can't finish (a network blip while creating the Drive file, say), the app puts you back on your original storage automatically and tells you what happened — your data is never in limbo. New help article: **Moving your pod between local file and Google Drive** (in the help center under Getting Started).

## 2026-05-11

### Added

- **Photos on activities.** Any family activity can now hold up to four photos — a birthday-invite screenshot, the "items to bring" list, a map of the venue, instructions from school, whatever's worth keeping pinned to the calendar entry instead of scattered across your screenshots app. Photos attach from the activity create/edit form (a dashed "Add photos" tile that appears once the activity has a title, date, and an assignee — tapping it saves the activity so the photo has somewhere to land, then opens the picker) and from the activity view drawer (a Photos section right below Notes). Same drag-drop / camera / file-picker / tap-to-zoom lightbox you already know from milestones, medications, and recipes. Activity cards across the calendar (monthly all-day chips, weekly band, daily timeline, the upcoming-activities sidebar, the Nook's recent-activity card) get a small 📷 next to the title when an activity has photos — no thumbnails on the cards, just the signal; tap in to see them.

### Fixed

- **The pod-setup screen can no longer freeze on a stuck spinner.** If something unexpected went wrong while a new family's pod was being finalized (arming auto-sync, registering the family), the setup progress modal could hang indefinitely with no way forward. It now drops to the error screen — Retry / Continue anyway / Go back — for any failure, expected or not, and every failure along the whole create-a-pod path (account creation, storage selection, the first save, finalize) is now reported instead of silently swallowed. Internally, the "new family pod created" notification also now fires the instant the pod is actually written to your Drive/file, rather than when you click through the final confetti screen — so a pod that gets created but whose owner closes the tab on the celebration screen is no longer invisible.
- **Inviting a family member via Email / WhatsApp / SMS / Messenger no longer pops a spurious "couldn't open" error.** Tapping any share channel on the invite step (including during first-run onboarding) handed the link off to your mail app / messenger correctly — but then immediately showed a red "Couldn't open Email. Try Copy Link or another option." toast anyway. The toast came from a leftover popup-blocker check that misread a perfectly normal result as a failure (a `window.open` opened with the `noopener` security flag always reports back "no window", by design — that's not an error). Removed the bogus check; `mailto:` / `sms:` / app-deep-link channels now navigate directly to the OS handler, web channels (WhatsApp/Telegram) open in a new tab, and the only thing that can still raise the toast is a genuine browser-level failure — which no longer pages the error channel either, since "Copy Link" is right there as the fallback. Surfaced by a new family hitting it on the onboarding invite step in desktop Edge.
- **Photo lightbox no longer shows two close buttons.** When an activity / milestone / recipe / medication had two or more photos, opening one in the lightbox showed two "×" buttons in the top-right corner — the modal frame's built-in one and the floating one the viewer adds for its chromeless look. Removed the redundant one (the position info it carried — "2 of 3" — is already shown by the dot indicator at the bottom).
- **Restart Onboarding moved out of Appearance.** It was a big bordered card sitting awkwardly among the Theme / Text-size / Week-start selects in Settings → Appearance. It now lives at the bottom of Settings → Family Data as a compact action row, matching the other buttons there. (Family Data is owner/admin-only, so non-admin members no longer see this rarely-used action — they can re-trigger onboarding by signing out and back in.)
- **Analytics on the app (app.beanies.family) is tracking again.** A refactor a couple weeks back moved the Plausible script from a static tag into an env-var-gated loader (so self-hosters stay offline by default), but the production deploy was never updated to set that var — so the app stopped reporting visitors. Wired it back up; the app now registers page views again. (The marketing site, beanies.family, was unaffected.)
- **Photo attachments could silently fail to save on milestones / medications / recipes.** If a photo uploaded successfully but the follow-up write that pins it to the entry failed (rare — a connection blip mid-save), the photo would silently become an orphan and disappear on the next reload, with no indication anything went wrong. Now any such failure rolls back the optimistic update and shows a "couldn't save your photo, try again" toast — and the unlinked file gets cleaned up automatically. (Fixed while extracting the shared photo-attachment plumbing into reusable composables.)

### Changed

- **Blog post subtitle.** "aloe vera" on the beanstalk now carries the subtitle "a story about my mom."

---

## 2026-05-10

### Added

- **All-day events now show as named chips on the monthly calendar — and multi-day all-day runs (school break, conference, away-on-business) span across cells the same way vacations already do.** Previously, the monthly grid collapsed every non-vacation activity into the same dot row, so a 7am piano lesson and an all-day school holiday looked identical, and a 3-day all-day event rendered as 3 disconnected dots in 3 cells. Now the grid carries a dedicated all-day lane between the day number and the timed-activity dots: single-day all-day events render as a category-colored chip with the title; multi-day events render as per-cell slices with the title only on the start cell, reading as one continuous bar across the row. Lane caps at 2 chips per cell with a `+N` overflow indicator. Clicking a chip opens the activity edit modal, matching the weekly view. Implementation extracted the span-computation logic into a shared util (`computeAllDaySpans`) and the chip into a shared component (`AllDayActivityChip`), then refactored the weekly view to consume both — one renderer for two views, every future visual change to all-day chips lands in one place.

### Fixed

- **Error modal no longer flashes mid-PWA-update on stale-cache cold starts.** When a service worker served an old `index.html` that referenced rotated chunk filenames, certain SW response shapes let the dynamic `import()` resolve to `null` instead of throwing the standard chunk-load error — every downstream `const { foo } = await import(...)` then threw a `TypeError: Cannot destructure property '<X>' of '...' as it is null` that didn't match the existing `isChunkLoadError` regex. App.vue's init catch fell into the generic-error path and rendered the scary error overlay, which flashed several times as the chunk-recovery `hardReload()` cycled the page. Now `isChunkLoadError` recognizes the destructure-of-null shape as the chunk-load symptom it actually is; App.vue's init catch routes those through `hardReload()` with the same once-guard the router/main listeners use, and keeps the initial spinner visible (instead of dismissing into a blank screen) until `location.replace()` lands. DRY pass extracted the `CHUNK_RELOAD_FLAG` constant from `main.ts` + `router/index.ts` into `hardReload.ts` as the single source of truth. Surfaced by greg testing an older-version iPhone PWA mid-update.

---

## 2026-05-09

### Fixed

- **iPhone PWA reconnect prompts no longer triggered by hung OAuth fetches; the loading spinner can no longer freeze after reconnecting.** Both OAuth proxy fetches (`exchangeCodeForTokens` for the popup/redirect token exchange and `refreshAccessToken` for silent refresh) had no network timeout. On iOS Safari over flaky cellular / Wi-Fi handover, `fetch` can hang for minutes or never resolve — and because `attemptSilentRefresh` deduplicates concurrent callers, a single hung fetch pinned every subsequent caller to the same dead promise. The 4-second cold-start defer would still fire the reconnect banner, but clicking Reconnect ran into the same untimedout fetch in `completeRedirectAuth()` during app init, wedging the full-screen "counting beans…" spinner; only force-killing the PWA cleared it, after which the cycle repeated. Now both fetches go through a 15-second `fetchWithTimeout` (`AbortController`-based) with an error message classified as auth-transient — so the wake-event recovery hooks fire and the failure path is observable. Defense-in-depth: the `completeRedirectAuth()` call in app init is wrapped in a 20-second `Promise.race` so the spinner can never wedge even if a future code path adds another awaited fetch. Three new unit tests pin the timeout behaviour. Surfaced by three Slack `cold-start-reconnect-escalation` alerts from a single iPhone family today.

### Added

- **Large reading mode — `Settings → Appearance → Text size`.** Two-level user preference (`Normal` / `Large`) that scales the entire app's typography and spacing by 1.1875× (16 px root → 19 px root). Made comfortably readable on a phone held at arm's length without resorting to pinch-zoom (which on iOS PWAs has a known stuck-zoom failure mode where users can't zoom back out cleanly). The whole app rescales from a single CSS rule because every Tailwind utility and custom rem value is rem-based — there is no per-component large-mode variant. Persists per-device (IndexedDB, applies pre-login) and per-family (Automerge, syncs across devices). Composes orthogonally with Dark mode and Beanie mode.
- **Beanie tip-of-the-day for Large text mode.** Surfaces in the Family Nook tip rotation alongside the Dark-mode tip, with a "try it →" pill that jumps to Settings.

### Changed

- **DRY pass on `settingsStore` — `setTheme`, `setLanguage`, and the new `setTextSize` now share one `persistDualSetting<K>()` helper.** The 14-line dual-write try/catch was duplicated three times before; collapsed to one well-tested code path with toast on failure (with retry action), `error.value` populated, `console.error` with field+value+stack, and exception re-throw so `BaseSelect` can revert visual state.
- **Cleaned ~180 hardcoded px font-sizes across the codebase.** All `text-[Xpx]` arbitrary classes (~160 across 64 components) and inline `font-size: Xpx` in `<style>` blocks (~20) converted to rem-based equivalents so they participate in Large mode. Calendar `ROW_HEIGHT` constant is now in rem; `MobileBottomNav` tab cells use `min-h-14` instead of `min-h-[56px]`. Decorative exceptions (onboarding hero confetti, brand-mark dimensions, fixed-size icon containers) keep px with explicit stylelint-disable comments naming the reason.
- **Stop-the-regression lint rails.** Stylelint's `declaration-property-value-disallowed-list` forbids `font-size: Xpx`; ESLint's `vue/no-restricted-class` forbids `text-[Xpx]` arbitrary classes in templates. Both link to SKILL.md § Text-size accessibility mode in their messages.
- **CIG slide added — "Accessibility & Modes."** New slide 7 in `docs/brand/beanies-cig-v2.html` documents Dark, Beanie, and Large text together. Trailing slide numbers bumped 7→8 … 16→17. SKILL.md typography section gains the "Text-size accessibility mode" subsection codifying the rem rule and the `--text-scale-large` token.
- **Anti-FOUC bootstrap.** Synchronous inline script in `index.html` reads persisted theme + textSize from localStorage before any CSS loads, so cold reloads don't flash default styling. The settings store mirrors both keys via `STORAGE_KEYS` constants on every change. Pays down a pre-existing dark-mode FOUC bug as a bonus.
- **Travel-plan airport dropdown now covers ~4,200 commercial airports globally, up from ~200 hand-curated ones.** The previous list missed plenty of perfectly mainstream destinations — HGH (Hangzhou Xiaoshan), CKG (Chongqing), GMP (Seoul Gimpo), and many others. The list is now generated from [OurAirports](https://ourairports.com/data/) (public domain) filtered to airports with `scheduled_service=yes` and a valid IATA code, so anywhere with regular commercial flights is in. General-aviation strips (e.g. TOA Torrance) remain excluded; the combobox's "Other" entry covers that case. The list also picks up an optional `country` field (ISO alpha-2) for future disambiguation UI.

### Added

- **`npm run update-airports` and a monthly GitHub Action (`airport-sync.yml`) keep the airport list current.** The action runs on the 1st of each month, regenerates `src/constants/airports.ts` from the latest OurAirports data, and opens a PR if anything changed. Same operational pattern as the daily translation-sync workflow.

---

## 2026-05-08

### Added

- **New blog post: "It must be nice to have beanies by your side."** Published to the beanstalk introducing **activity finance linking** — the feature that connects an activity (a kid's piano lessons) or an asset loan directly to a bank account so the cost shows up in your transactions feed and net worth without re-typing it in two places. Hooked on a real-world piano-teacher 3-month bill, framed via a Hamilton/Jefferson "can we get back to beanies" callback. Cover image is the activity-edit modal with the COST → PAY FROM block highlighted. Aloe vera unfeatured so the new post anchors the homepage gradient card alone.

### Fixed

- **Stuck silent-refresh now surfaces the reconnect prompt within ~4 seconds of a cold page load, every time.** The morning-after hardening pass on yesterday's silent-refresh escalation. Five gaps were closing the previous fix's window: the consecutive-failure counter was module-level state that reset on every page reload (so reload-loops never accumulated to threshold); the threshold of 3 required ~27 OAuth proxy fetches across three separate refresh attempts before escalation; the boot-time background load explicitly suppressed UI on `auth-transient` failures, deferring to a counter that would never cross; the wake listener only handled `visibilitychange` (missing `focus`, `pageshow` — which is load-bearing for BFCache restore on mobile after sleep — and `online`); the offline queue retried only on `online`, so when the failure cause was auth (not network) the queue sat forever waiting for an event that would never come. The fix persists the failure counter to sessionStorage so reload-loops accumulate; lowers the threshold to 2 with a `>=` operator (defensive against overshoot races); broadens the wake listener to all four events; introduces a ~4-second deferred banner-fire from the cold-start auth-transient branch so a wake-event-triggered refresh has time to land silently before the user is alarmed; and wires the offline queue to flush on `onTokenAcquired` (so an auth recovery flushes a stuck queue) and on `visibilitychange → visible`. A separate pre-existing silent failure was also fixed: an IndexedDB rejection during refresh-token recovery used to throw past the wake listener's catch boundary; now wrapped + reported via telemetry. Added five new `reportError` telemetry surfaces for production observability of the new paths.
- **Featured blog post no longer eats the page on portrait cover images.** The `/blog` featured-card layout had `aspect-ratio: auto` + `min-height: 340px` on the media column, which let a portrait cover image (873×1578 px in the new post's case) drive the entire grid row to ~900px tall — pushing the back-issue grid below the fold on desktop. The featured-card media is now bounded by `aspect-ratio: 16/10` + `max-height: 480px`, and switched from `object-fit: cover` to `object-fit: contain` so portrait screenshots render in full inside the kraft polaroid frame instead of being cropped.

### Changed

- **CSS structural cleanup — closed a class of cascade-layer bugs and retired 8 `!important` smells.** Yesterday's Caveat-font fix surfaced that `src/style.css` had several base/component rules outside any `@layer`. Tailwind v4 puts utilities in `@layer utilities`, and unlayered styles beat layered styles regardless of selector specificity — so any utility class like `font-caveat` on those elements silently lost. The fix wraps the four affected groups (`html`/`body`/`#app`, the `.beanies-input` cluster, `select.beanies-input`, the date/time inputs, and the Chrome `::picker(select)` block) in `@layer base` so utility classes can override per element. Additionally, `NookSectionCard` was the lone outlier in the codebase — every other card-shaped component (14+) uses `bg-white dark:bg-slate-800` with `var(--sq)` and `var(--card-shadow)` tokens; aligning `NookSectionCard` (and `ContentSkeleton`, which copied the outlier per its own comment) to that convention retired the global `.dark .nook-card-dark { ... !important }` rule AND made `NookVacationCard`'s two `!important`s unnecessary (Vue scoped-style specificity is sufficient). `GoalsPage`'s `.progress-fill-green !important` rule is replaced with Tailwind gradient utilities toggled in the `:class` binding. Onboarding `BaseCombobox`/`BaseSelect` overrides moved out of the global `onboarding-shared.css` into the owning components' scoped style blocks, where the `[data-v]` specificity boost retires the four `!important`s without touching the shared components — net coupling decrease, onboarding internals stop leaking to the global namespace. Body `font-family` reads from `var(--font-inter)` token; legacy color tokens (`--color-primary`, `--color-primary-dark`, `--heritage-orange`, `--color-secondary`) now derive from the `--color-*-{500,600,700}` scale defined once in `packages/brand/theme.css` (single source of truth; resolved hexes identical, no caller rewrites). `.attention-pulse` joins the reduced-motion kill-list. Net effect for users: on the Family Nook, section cards now render at 24px border-radius (was 20px) — slight visual delta that brings nook cards into alignment with the rest of the app's cards. `!important` count: 19 → 11 actual declarations; remaining 11 are all justified (reduced-motion universal kill-switch + transform-vs-hover overrides on tilted scrapbook cards).
- **Activity-finance-linking blog post body polished post-publish.** Three Notion-side edits synced over the day: "Sorry about last week's post" → "I want to apologize for last week's post" (softer pivot), "From now on, I'll try" → "From now on though, I'll try" (better connective), "falling out of favor lately" → "rapidly falling out of favor" (sharper aside on vibe coding's reception). Subtitle ("your family married to your finances (with apologies to lin-manuel miranda)") moved from an italic first-line of the body into the proper `subtitle` frontmatter field so it renders in the Fraunces-italic kicker slot above the lead paragraph (matches every other post).

---

## 2026-05-07

### Added

- **Milestones — a dedicated place for the moments that matter.** Each bean now has a "Milestones" tab on their pod page for capturing dated moments (first words, first steps, lost teeth, school graduations, family vacations, religious milestones), each with optional photos. A new family-wide timeline at `/family/timeline` shows everyone's milestones in chronological order — scroll back through the year and watch the family's story unfold. Categories are grouped into Firsts, Achievements, Family, and Celebrations to keep the picker scannable. Photos open in the same tap-to-zoom lightbox used elsewhere in the app.
- **Family Scrapbook redesign — tabbed spreads with a real page-flip.** `/pod/scrapbook` is no longer a flat masonry feed. A horizontal "spine" at the top pages between an **Everyone** overview and each bean's individual magazine-style spread, with a directional 3D page-turn transition between them. The Everyone spread leads with a "What's happening lately" hero block (the most recent moment, photo-emphasized when available), then per-bean clusters showing each member's most recent items, and a "Family moments" footer for memories that belong to the whole family. CSS-only kraft paper / washi tape / taped-and-ripped-paper aesthetic (no images, no JS). Stable per-card rotations so the page never reshuffles visually when new memories arrive.
- **Pets are first-class in the Family Scrapbook.** Pets get their own avatar tab in the spine and their own per-bean cluster on the Everyone overview, alongside the humans. Click a pet's avatar to open their personal spread the same as any human's. (Previously the spine and clusters were filtering for humans only.)

### Fixed

- **Reconnect prompt now appears when silent token refresh is genuinely stuck — not only when Google has revoked your refresh token.** Previously, the reconnect surface fired only on a definitive `invalid_grant` from Google's token endpoint. Any other persistent failure mode — proxy briefly down, mobile-network jitter that outlasted the 4.5s retry budget, refresh token not yet loaded into memory — left silent refresh quietly returning `null` with no UI signal at all. The Family Scrapbook bug greg surfaced this evening hit exactly that path: the desktop tab couldn't pull fresh data from Drive on reload, but no banner or toast appeared, and you had to discover the dead state manually via Settings → Family Data. The fix tracks a consecutive-silent-refresh-failure counter; once three retry-exhausted attempts have piled up, the reconnect surface comes up the same way it does on `invalid_grant`. The counter resets on any successful token acquisition (silent, popup, redirect, or silent auth-code), so a recovered transient blip self-heals without flicker.
- **Family Scrapbook no longer pans horizontally on mobile to reveal a strip of background.** Every entry card on the scrapbook page carries a small inline `transform: rotate(±X deg)` for the tilt aesthetic. Rotated elements visually extend past their grid cell without changing their flow width — and the browser's horizontal-scroll calculation includes that visual extent, so the page allowed users to drag horizontally to reveal the rotated cards' overflow. Other pages don't tilt content, which is why this was scrapbook-only. Added `overflow-x: clip` to the page root (rather than `hidden`, which would create a scroll context and break sticky-positioned ancestors).
- **"Our family scrapbook" title now renders as actual handwriting.** The title — and several other Caveat-styled accents on the page — was silently falling back to a sans-serif because of a CSS cascade-layer ordering issue: a global heading style was unlayered, which beats Tailwind's layered utility classes regardless of selector specificity. The heading rule has been moved into the proper layer so utility classes can override per element. Caveat at weight 400 has also been added to the Google Fonts URL so any unweighted handwritten-style usage works going forward.
- **The "Your data isn't being saved" red banner no longer appears on overnight wakes when auth has already self-healed.** Root cause: when a tab woke from long idle, the access token had expired and the wake-time refresh sequence (`processRecurringItems` → debounced save) raced ahead of silent-token refresh. Three back-to-back save failures crossed the `consecutiveFailures ≥ 3` threshold and showed the banner — but silent refresh then succeeded silently, leaving the banner stuck because nothing reset the failure counter. The fix has three parts: (1) `onTokenAcquired` now triggers a `saveNow()` when the save-failure banner is up, so a successful save through the recovered token clears the banner via the existing `recordSaveSuccess` chain; (2) the banner is deferred up to 5 seconds when a silent refresh is in flight, giving recovery a fair shot before alarming the user; (3) telemetry (`save-failure-banner` events to `#beanies-errors`) classifies whether the banner fires immediately or after the deferred window, so we can tune the recovery window and catch genuine save failures separately.
- **The save-failure banner no longer covers the AppHeader.** Previously rendered as `position: fixed top-0` at `z-[250]`, the banner physically blocked the header on standalone PWAs (where there's no browser-chrome refresh button to fall back to). It now renders inline at the top of the app shell, pushing the header down rather than overlapping it. Sidebar, mobile bottom-nav, and main scrollable area are unaffected.

### Changed

- **Save-failure banner CTAs simplified to a single "Refresh app" action.** "Reconnect to Google Drive" was duplicate UX — `GoogleReconnectToast` is the canonical reconnect surface and is now mutually exclusive with the banner via a new `shouldShowSaveFailureBanner` computed (true only when the banner is up AND the reconnect toast is not). "Download backup" was rare-case panic UX with a working path in Settings; removed from the banner. The new "Refresh app" button calls `hardReload()` (the canonical refresh primitive that evicts stale service-worker caches), matching the action that historically resolved the stuck-banner state in practice.

---

## 2026-05-06

### Added

- **Direct `/create` route for jumping straight into the create-pod flow.** New URL `app.beanies.family/create` lands users directly on the create-a-new-family-pod view, mirroring the existing `/join` route's pattern. Useful for marketing CTAs, contact-form replies, and any other path that wants to drop a brand-new user into pod creation without first walking them through the welcome selector. `LoginPage` already supported the `'create'` initial-view; this just wires the route to it. New `create.title` translation key auto-synced to Chinese via `npm run translate`.

- **"Don't have the password?" disclosure on the file-unlock screen.** When someone lands on the password unlock screen via Drive's "Open with beanies.family" gesture (or a copy-pasted `/open` URL) and doesn't have the password, they now see a clear, brand-aligned info card below the password form explaining they need an invite link from the family owner — not a new pod of their own. White squircle card with soft brand shadow + Sky Silk icon-circle (matches the existing security-messaging cards in the same view) and a key icon that semantically ties to "no password = no key". First version was a generic SaaS info-notice pattern; refined after a frontend-design pass to mirror the brand's existing visual vocabulary so it reads as part of the same system rather than a third-party widget.

### Fixed

- **`.beanpod` files in Google Drive are now correctly tagged as `application/octet-stream`.** Legacy `.beanpod` files were uploaded with `mimeType: 'application/json'` even though the V4 envelope is encrypted binary. Drive's content-sniff couldn't validate the bytes as JSON, fell back to "File Type: unknown" in its UI, and (more importantly) the Google Workspace Marketplace SDK's "Open with..." matcher refused to surface the integration for those files — almost certainly the actual root cause of the Marketplace review's "Drive integration not appearing" rejection point. The fix has three parts: every new `.beanpod` is now created with the correct MIME type, every save overwrites legacy metadata via the upload's Content-Type header, and a one-shot opportunistic migration runs on first read per session to PATCH any pod still on the wrong type. Migration is idempotent and non-critical (failures swallowed and retried next session); console emits `[GoogleDriveProvider] migrated .beanpod mimeType: application/json → application/octet-stream` when it actually patches.

- **`/open` and `/create` no longer redirect to `/welcome` for unauthenticated users.** Both routes are legitimate pre-auth entry points (Drive's "Open with..." gesture sends users to `/open` directly with a file ID; `/create` is a deep-link into the create-pod flow), but the App.vue runtime auth-redirect was hardcoded to allow only `Welcome`, `Login`, and `JoinFamily` route names through. The two new routes have `meta.requiresAuth: false` set, but App.vue's runtime check uses `route.name` not meta — and they were missing. Symptom in incognito testing: hitting `/open?state=...` flashed a loading screen then redirected to `/welcome` before the page could even parse its state.

### Changed

- **Drive sync OAuth is now silent for users who installed via Google Workspace Marketplace.** When a user installs beanies.family from the Marketplace listing, Google grants the listing's scopes (`drive.file` + `userinfo.email`) at install time. Previously, when the user later clicked "Connect Drive" in the app, our OAuth call still showed Google's account-chooser popup — the second consent screen Google's review team flagged as a duplicate-permissions issue. The app now first attempts a fully-silent auth-code request via a hidden iframe with `prompt=none`. For Marketplace-installed users with pre-granted scopes, this completes silently in under a second with no popup at all. For direct-signup users who haven't pre-granted scopes, Google returns `login_required` and the existing popup-based flow runs as before — no behavioral change. The `OAuthCallbackPage` was extended to handle iframe context (posts to `window.parent` when there's no opener but it's inside a frame) alongside the existing popup and full-page-redirect modes.

---

## 2026-05-05

### Added

- **Swipe horizontally on the calendar to change date.** Natural mobile-calendar gesture across all three planner views — daily, weekly, and monthly. Swipe left advances forward in time (next day / next week / next month), swipe right goes backward. Chevron buttons stay; swipe is additive, not a replacement. Three guardrails make it safe alongside the daily view's existing vertical scroll: axis lock (only commits if the first ~8px is clearly horizontal), iOS edge-back avoidance (touches starting <20px from the left edge are ignored on the browser to not fight Safari's edge-swipe-back; mouse drags from the edge still work), and a 60px commit threshold so accidental nudges don't fire.
- **"Open with beanies.family" from Google Drive.** Right-click any `.beanpod` file in Drive → "Open with beanies.family" → the app opens directly to the password unlock screen with that pod already loaded. No file picker, no second OAuth (Drive auto-handles consent before redirect). Behind the scenes this is a new `/open` route that parses Drive's `state` query param, fetches the file via the existing `drive.file` scope, and routes into the standard load-pod flow with the encrypted envelope pre-loaded. Fully integrated with the Workspace Marketplace listing (currently in review). For users hitting the page via direct entry / bookmarks where popups can be blocked: a clean "One more click to continue" recovery screen with a single Continue with Google button.
- **Food category for activities.** New "Food" group in the activity picker covering food-centric family events: Brunch 🥞, Coffee ☕, Dining Out 🍽️, Drinks 🍹, Picnic 🧺, Other Food 🍴. Mappings into transaction categories so logging "Friday brunch" pre-fills the right expense bucket. Cyan/teal palette matches the transaction-side Food group for visual consistency across the planner and budget.
- **Add another activity** link on the activity-created confirmation. Setting up a kid's term-of-school routine (piano weekly + swim weekly + art weekly + math tutoring) typically means 4-6 activities back-to-back. The previous "close confirm → reopen FAB → choose Add Activity → re-pick the date" tap chain on each repetition added up. There's now a small "+ add another activity" link below the OK button — one tap and the next activity form opens with the same date pre-filled. Time and assignee aren't carried forward (different per activity in real batch flows).

### Changed

- **Airport + cruise port dropdowns now show two-line items with a right-aligned IATA badge.** Long airport labels like "Indianapolis - Indianapolis International (IND)" used to truncate in the dropdown, making it hard to disambiguate between airports in cities with multiple options (London LHR/LGW/STN, NYC JFK/LGA/EWR, Paris CDG/ORY). Each option now shows the city name large on top, the airport name smaller below, and the IATA code right-aligned as a monospace badge — Google Flights / Kayak pattern. The right-aligned codes form a vertical visual rail so you can scan codes to find the airport you actually want. Search still runs against the full text — typing "Changi" or "JFK" or "Heathrow" all match.
- **`/open` recovery screens have one clear primary action.** Previous side-by-side equal-weight buttons ("Sign in directly" + "Continue") were misleading — both looked equally important, but only the right-hand one was the path you actually wanted. Each non-loading state now follows the canonical beanies CTA pattern: ONE full-width Heritage Orange gradient button as the dominant primary, with the escape hatch demoted to a small text link below. Labels also clarified to name the destination — "Continue" → "Continue with Google", "Sign in directly" → "or pick a different pod →".
- **Privacy policy and terms updated for Google Workspace Marketplace review accuracy.** Three accuracy gaps fixed: (1) removed the false "app-specific folder" claim — `drive.file` is per-file, not folder-scoped, (2) corrected the Google authentication section to reflect that we only request `userinfo.email`, not name or profile picture, (3) added a new "Google Workspace Marketplace" section explicitly disclosing the "Open with beanies.family" gesture for Drive integration. Plus explicit `.beanpod` content disclosure (encrypted family planning data, unreadable to us or Google) and a direct link to Google's permissions revoke page.

### Fixed

- **Inline edits on recurring activities no longer silently fail when you dismiss the scope picker mid-save.** Caught from a production error in `#beanies-errors` — an iOS Safari user inline-edited a recurring activity field, the scope picker (this only / this and future / all) opened as expected, and something — modal swipe, navigation, Drive sync deleting the activity in the background — nullified the modal's bound props mid-await. When the scope picker resolved, the save handler tried to read `activity.id` off a now-null reference and threw, swallowed by the unhandled-rejection path. Net effect: the user's edit was lost without any visible error. `saveDraft` now captures the activity once at function entry and uses that stable local for all subsequent store calls, so the post-await accesses can't race the prop nullification. Side benefit: edits also persist correctly even if the user does dismiss the modal while the scope picker is up — the captured ID is still valid in IndexedDB, so the update lands.
- **Family Organization guide synced from Notion (canonical source).** Four typo fixes greg made in the Notion master copy now live in the repo: "Our weekends being packed" → "Our weekends were packed" (grammar), "Kids rewrites those rules" → "Kids rewrite those rules" (subject-verb agreement), "that something else is usually you" → "that somebody else is usually you" (people, not things), and "You need both - but the habit comes first." → "You need both, but the habit comes first." (punctuation). `lastUpdated` bumped to 5 May 2026.
- **`ActivityCategory` type union sources of truth re-aligned.** The runtime list (`ACTIVITY_CATEGORIES`), the TypeScript type union, and the activity → expense category mapping had each silently drifted over the past two weeks. Fixed: 11 missing IDs added to the type union (`field_trip` for School, `mma` + `taekwondo` for Sports, the entire Entertainment group), `field_trip → school_fees` mapping added. Plus a new structural-invariant test that parses all three sources and asserts the ID sets match in both directions — future drift in any one of them now fails CI rather than surfacing weeks later.

### Removed

- **Dead `UserFamilyMapping.familyRole` field cleanup.** The field was written to IndexedDB at signup and join but never read anywhere in the app — role is derived from the Automerge member record, not from the registry mapping. Dropped the field from the type and both write sites; existing rows keep their stale value harmlessly (no migration needed since there's no index on the field). Internal hygiene only — no user-visible change.

---

## 2026-05-04

### Fixed

- **Photos no longer randomly fail to load with no apparent error.** Google's `lh3.googleusercontent.com` image CDN rate-limits per-Referer, and the global per-Referer bucket for `http://localhost:5173` (the Vite default dev port, shared across millions of devs worldwide) was getting exhausted — so dev environments and any other shared-origin contexts would silently 429 on `<img>` loads while production's distinct origin (`https://app.beanies.family`) had its own clean bucket. The IMG element fired `onerror` with no useful diagnostics, so the symptom in the wild was "photos work in production but break on localhost," with a fallback to the beanie variant. Added `referrerpolicy="no-referrer"` to every `<img>` tag that resolves to a Drive-hosted URL (avatar overlays, photo thumbnails, the lightbox itself, medication cards, polaroid recipe heroes, scrapbook photos). With no Referer header, Google rate-limits by IP only — effectively unlimited for a single user. Caught live from greg's localhost throwing 429s while the same files loaded fine on prod and via direct-link in a fresh tab; a small privacy bonus too (Google no longer learns which page is rendering its hosted images).

### Added

- **Tap a recipe photo to open it full-screen.** Recipe detail page hero polaroid is now clickable when there's a photo — opens the same shared photo lightbox that's already used for member avatars, medication snaps, and per-entity photo attachments. Cookbook landing-page polaroids deliberately stay non-clickable since their tap navigates to the recipe detail; the lightbox lives on the detail page.

### Changed

- **Photo lightbox chrome is now slightly more refined and consistent.** All photo-viewing surfaces in the app already shared one component (`PhotoViewer.vue`), but its chrome was a touch generic. Subtle refinements: warm-shifted backdrop (rgb(20 15 15 / 0.96) instead of pure black) so the modal stops feeling clinical against the Heritage Orange / Cloud White palette elsewhere, larger tap targets on close + chevrons with smoother hover transitions and a tactile scale cue, and a cleaner photo-position indicator — when there are multiple photos, a centered row of dot pips appears at the bottom of the image (Heritage Orange for the current photo) instead of the previous tiny "1 of 3" footer text. Photo gets a soft drop-shadow so it floats off the dark backdrop. Restraint over flair — the photo is the hero, the chrome supports it.

### Fixed

- **Stale-tab self-heal now also catches Vue Router's "Couldn't resolve component" failure mode.** The May-3 PWA stale-chunk recovery (`b19a106`) installed a `router.onError → hardReload()` chain that automatically replaces a stale tab when a lazy route import fails after a deploy. Its matcher covered the three browser-native shapes (Chrome's "Failed to fetch dynamically imported module", Firefox's "error loading dynamically imported module", Safari's "Importing a module script failed") but missed the Vue Router fallback shape: when the lazy `import()` resolves to something that isn't a valid module — e.g., CloudFront serves the SPA's 404 HTML in place of a rotated chunk filename — Vue Router throws `Couldn't resolve component "default" at "<path>"` instead. Same root cause, different observable error, no auto-recovery. Caught live from a tab three deploys behind HEAD; user got the error overlay instead of the silent flash-and-reload the May-3 fix was designed to deliver. Matcher widened to also recognize this Vue Router shape, and the existing recovery chain handles the rest. 6 unit tests now lock in all four matcher shapes plus negative cases.

- **Header date and greeting now refresh after a desktop sleep / tab wake.** Reported live by greg: a tab left open overnight (Mac sleeping in between) showed yesterday's date in the header even after switching to another tab and back. The wake-detection plumbing itself (`useToday` + `useStaleTabRefresh`) was working correctly — `today.value` advances on `visibilitychange → visible`, on `pageshow` with bfcache, and on the self-rearming midnight timer, and the heavy refresh fires correctly. The bug was downstream: `AppHeader.vue`'s `todayFormatted` and `greeting` computeds called `new Date()` directly, with no reactive dependency on `useToday().today`, so they evaluated once on mount and never recomputed. Wired both to read `today` (and `lastVisibleAt` for the morning/afternoon/evening greeting transitions) so Vue tracks them as deps and the header re-renders on every wake. Confirmed via the existing `useToday` and `useStaleTabRefresh` test suites — both still green.

### Changed

- **Self-hosting docs now reference Sam Ledoux's community OAuth-proxy implementation.** Path B (the Drive-sync self-host path) previously documented only the in-tree AWS Lambda reference. [`Snaxilla/beanies-oauth-proxy`](https://github.com/Snaxilla/beanies-oauth-proxy) is now linked as a community alternative for self-hosters who'd rather run a Node side-car via Docker / Dokploy / Coolify / Railway / Raspberry Pi than spin up an AWS account. SPEC-conformant, ~190 lines, zero deps. Updates in `docs/SELF_HOSTING.md` Step 2 and `infrastructure/lambda/oauth/README.md` "Alternative runtimes".

### Added

- **Change Password — new tile in Settings → Security & Privacy.** You can now change the password you use to unlock your beanpod and sign in. The flow asks for your current password, then a new one (with confirmation), verifies the current one against your salted hash, re-wraps the family key under the new password (so the old password can no longer unwrap), and updates the stored hash. Other devices pick up the change next time they sync. Passkey-only members (no current password) don't see the tile — a separate "Set Password" affordance can be added later if needed. Note: there's no admin path to reset a forgotten password — by design, since data is encrypted at rest with no recovery key. 7 unit tests cover the auth orchestration (not authenticated, empty new password, same as current, wrong current, no password set, missing family key, happy path).

### Security

- **Fixed a password-collision vulnerability in the file-open auto-sign-in path.** When a user opened an existing pod file with a password (`LoadPodView`), the decrypt routine called `tryUnwrapFamilyKey`, which iterated over every member's wrappedKey and returned the FIRST one that successfully unwrapped — then auto-signed the user in as that member to skip the bean picker. Per-member salts mean two members can both use the same password without producing identical hashes, but their wrappedKeys both unwrap with the shared password (each with their own salt), so the loop was effectively returning whichever member came first in `Object.entries` order. Net effect: in a pod where two members happened to pick the same password, opening the file as one of them could sign you in as the OTHER. Per-member login (`signInWithPassword(memberId, password)` from the bean picker) was already safe since `verifyPassword` is salt-scoped to a specific member's hash; only the auto-sign-in shortcut was vulnerable. Fix: `tryUnwrapFamilyKey` now iterates the FULL list and returns every memberId whose wrappedKey unwrapped (`memberIds: string[]` instead of `memberId: string`). The auto-sign-in path takes effect only when exactly one member matched; when two or more match, the user is dropped through to the bean picker so they explicitly choose who they are, and the per-member salted hash check confirms identity. 3 new unit tests cover unique-password, shared-password (two matches), and wrong-password cases.

### Changed

- **Join-flow errors no longer offer a dead-end "Ask for a new invite" button.** Every join error code carried the option as a recovery action, but the handler just reset the view to the generic "Pick beanpod file" picker — useless to a user who clicked an invite link, since they don't have the file to pick. Removed the button from all five error codes that listed it; the prose copy already directs the user to the only real remedy ("Ask the inviter for a new one"), which is out-of-band anyway. Where `retry` is still meaningful (`INVITE_TOKEN_EXPIRED`, `INVITE_TOKEN_INVALID`) it remains as the sole button. `FILE_FAMILY_MISMATCH` keeps "Sign in with a different account". `FILE_DECRYPT_FAILED` and `NO_UNCLAIMED_MEMBERS` now render no buttons at all — the prose tells the user what to do (contact a family admin / wrong file).

- **Join-flow diagnostic blob now includes the URL token's hash** (8-char prefix), so when `INVITE_TOKEN_INVALID` fires we can tell at a glance whether the URL token's hash is among the inviteKeyHashes in the loaded envelope (different bug — should not happen) or is NOT (the documented "stale envelope" case where the device read a copy of the .beanpod file from before the new inviteKey landed).

### Fixed

- **Pod ownership can no longer be transferred to a member who hasn't joined yet.** Yesterday's Transfer Pod Ownership flow filtered the recipient list by adult + not-self but didn't check whether the candidate had actually set up their account. That meant you could hand the pod over to an invited-but-unjoined adult — who has no password, no passkey, and no auth identity bound to the pod — and immediately lose the ability to transfer it back, since the modal is gated on `isOwner` of the current session and the original owner has just demoted themselves. The `normalizeRoles` self-heal wouldn't catch it either: it only fires on 0 or >1 owners, and exactly one (just unreachable) owner exists. Fix is defense in depth: the modal narrows eligible recipients to `requiresPassword === false` (the canonical "has joined" signal, same one the self-heal already prefers when picking a fallback owner), and the store-level `transferOwnership` action rejects unjoined targets with a `reportError` so any direct-call path or future modal drift can't bypass the rule. Empty-state copy sharpened to explain why a candidate isn't showing up: "Adults must join your pod (set up their account) before they can become owner."

- **Account picker no longer races webkit's accessibility tree under CI load.** The account category chip picker (used everywhere accounts are added or edited) used to mount and unmount its expanded subtype panel on every category click via `v-if` — a totally fine pattern on every browser except WebKit-CI under contention, where the accessibility tree could lag the new panel by >15 seconds. Symptom in the wild: an E2E test trying to click "🏦 Checking" right after "🏦 Bank" hard-failed about once a week, recurring four times in three weeks. Restructured to pre-mount one expanded block per expandable category (Bank / Investment / Retirement) and gate visibility with `v-show`, so picking a category is now a CSS display toggle rather than a Vue mount + a11y-tree repopulation. No visible change for users; the racing E2E test should stop hard-failing on webkit.

---

## 2026-05-03

### Added

- **Owner crown badge + Transfer Pod Ownership flow.** Bean cards now show a Heritage Orange 👑 crown overlaid on the owner's avatar (top-right corner) — finally a clear visual answer to "who's the super-admin of this pod?". The redundant Admin/Member dropdown next to every name is gone; granular permissions stay where they always have been (the pencil-icon edit modal, where canManagePod / canViewFinances / canEditActivities live as toggles). And ownership is no longer permanent — Settings now has a "Transfer Pod Ownership" tile (owner-only) that opens a three-step flow: pick an adult → re-authenticate (passkey first, password fallback) → confirm. Atomic Automerge change handles both the demote and promote in one transaction; the auth session role updates inline so the UI reflects the new state without a reload. Re-auth was extracted into a reusable `<ReauthChallenge>` component since the next high-stakes operations (delete pod, leave pod, change family name) will all want it.

### Fixed

- **Self-heal for pods missing an Owner record.** Some early prod families ended up with no member having `role === 'owner'` — likely a legacy migration that stripped the field. The Owner pill never showed because there was nobody to put it on. `applyDefaults()` in the family-member repository now backfills `role: 'member'` so undefined never silently slips through any read path, and a new `normalizeRoles()` step runs every load to ensure exactly one Owner exists. If none is found, it promotes the earliest-created human (preferring the family-creator seat that doesn't require a password) and stamps full permissions. Also migrates legacy `admin` rows to `member` while preserving `canManagePod=true` so existing admins keep their effective permissions. Fully idempotent — the heal writes nothing on subsequent loads and is gated behind a single atomic Automerge change. 12 new unit tests cover the normalization paths and the transfer flow.

### Changed

- **Activity categories: "Fun" group renamed to "Party"; new "Entertainment" group added.** The Party group still holds the same celebration-style life events (birthday party, wedding, bar mitzvah, other celebration) — just the label changes. The new Entertainment group covers media and live events: Movie, Show / Musical, Concert, Theme Park, Sporting Event, Museum, Festival / Fair, and Other Entertainment, with a distinct rose/pink color palette so it doesn't blur into existing groups in the picker. All eight new entertainment activities map to the existing `entertainment` expense category, so logging a transaction tied to "Friday movie night" pre-fills the right budget bucket. Travel-planner banner copy at the top of the activity drawer also tightened from "Make It a Family Vacation!" to "Add a Travel Plan!" — closer match to what tapping it actually does.

### Fixed

- **Activity creation no longer races two confirmation dialogs on slower browsers.** When a new activity was saved on the Family Planner, the "Activity Created" confirmation modal opened _before_ the Activity edit modal had finished closing — so for a single render tick, two `role="dialog"` overlays with `aria-modal="true"` coexisted in the DOM. Modern desktop browsers cope; webkit (Safari, iOS Safari) under load could stall the second modal's visibility for >15 seconds while the first was still teleported in. The visible symptom was a stuck activity-edit screen after pressing "Add activity". Reordered: the activity modal closes first, Vue flushes the v-if removal on `nextTick`, and only then does the confirmation modal mount. Caught while triaging a recurring webkit-only E2E flake (3rd recurrence on the same test) — the test had been incorrectly classified as a flake three times running, when in fact it was the same latent ordering bug surfacing inconsistently with CI load. Reclassified retroactively as a real bug in `docs/E2E_HEALTH.md`.

- **The "beans got lost in the cloud" toast no longer fires on every reload tap when the Google access token is expired.** Caught while testing the reload flow on a dev environment with an expired token + failed silent refresh. Two layers were producing competing user-facing signals for the same auth-transient state: the auth layer (per the recent self-heal fix) intentionally stays quiet on transient silent-refresh failures and only escalates to a Google reconnect banner on `invalid_grant`, but the sync layer was setting `backgroundSyncError = 'Could not refresh data from cloud'` on every failed read, which `BackgroundSyncBar`'s watcher promoted to a loud warning toast. Result: every reload-icon tap (and every auto-poll cycle) fired the toast even though the auth layer was correctly handling the situation. Fix: classified `backgroundSyncError` by kind (`auth-transient` / `decrypt` / `network`) — the sync state still flips so success toasts in callers like `AppHeader.handleRefreshAll` are correctly suppressed, but `BackgroundSyncBar` now skips the toast when the kind is `auth-transient`. Auth layer keeps owning the user-facing escalation. Detection regex matches the `silent refresh failed` substring shared by both `TokenExpiredError` shapes (default + Drive-read-rejected).

- **PWA users no longer hit a fatal "oh no, the beans spilled" crash after a deploy — the app now self-heals.** Reported live by greg from an Android Chrome PWA: navigation crashed with `Failed to fetch dynamically imported module: .../FamilyNookPage-DZK3iJ0T.js`, the error overlay's "Reload" button did nothing useful, and the only escape was waiting hours for the SW to update on its own. Root cause: the PWA's workbox precache holds the previous build's `index.html`, which references content-hashed JS chunk filenames that no longer exist on the server after a new build ships; every lazy `import()` lookup 404s until the SW activates a new version, and `registerType: 'prompt'` only does that once the user accepts an update prompt they may never see. Five-part fix in one PR: (1) new `src/utils/hardReload.ts` primitive that calls `registration.update()`, posts `SKIP_WAITING` to any waiting worker, evicts every entry from the Cache Storage (workbox precache, fonts, etc.), then `location.replace`s the same URL — the only sequence that defeats a stale precache. (2) `router.onError` now matches the chunk-load message shapes (Chrome / Firefox / Safari variants) and calls `hardReload()` automatically, with a `sessionStorage` loop guard cleared on the next successful `afterEach` so a future deploy gap can recover too. (3) `vite:preloadError` window listener catches the modulepreload variant of the same failure (different code path, same root cause) and triggers the same recovery; chunk-load failures are now filtered out of `unhandledrejection` before the Slack reporter sees them. (4) The error-overlay "Reload" button — and the "Sign Out & Clear Data" path — now call `hardReload()` instead of the soft `window.location.reload()` that the PWA's SW just intercepted. (5) The header's refresh-icon path was hardened in the opposite direction: when its `safeServiceWorkerUpdate` finds a new version waiting after the update poke, the user now gets an actionable "A new version is ready / Reload Now" toast instead of silently sitting on stale code. Net effect: any PWA user who hits a stale chunk after the next deploy will see a one-second white flash of the recovery reload instead of a fatal overlay; users who actively refresh and a new version is available will see a one-tap reload prompt; and `#beanies-errors` stops collecting "Failed to fetch dynamically imported module" alerts that were previously each one frustrated user.

- **Pets now selectable when adding medications, allergies, sayings, favorites, notes, and family activities.** The FAB inline + sheet member picker filtered out pets — adding a medication or allergy for the dog was impossible from the FAB despite the data model allowing it. Same gap on the activity assignee picker (pets couldn't be added as participants in "morning walk with Buddy"). Audit covered 16 surfaces across the app that filter family members; categorized each as keep-humans-only (todos, accounts, transactions, assets, financial goals, recipes, dropoff/pickup duties, vacation travelers, invite/login flows) vs allow-pets (medications, allergies, sayings, favorites, notes, activities). Surgical changeset: the two FAB pickers switched from sortedHumans to sortedMembers; the shared FamilyChipPicker gained an opt-in `includePets` prop (default false — every existing call site preserves humans-only behavior unchanged); ActivityModal + ActivityViewEditModal pass `include-pets` on the assignee picker only (dropoff/pickup stay humans-only since they require a driver). The FAB picker also previously carried a misleading code comment claiming pets can't be the target of meds/allergies — corrected. **Deferred**: activities-page filter chip strip pet support (architecturally non-trivial since `memberFilterStore` is shared with Accounts + Transactions and is humans-only by design), and goals (schema is financial-only — "allow pets" is a no-op until a non-financial goal type exists).

---

## 2026-05-02

### Fixed

- **Dismissing the passkey prompt is now silent — no error toast, no Slack alert.** When the user tapped Cancel (or the prompt timed out) on the post-onboarding "Enable passkey?" sheet, three things were wrong: (1) iOS/Android surface that gesture as `DOMException: NotAllowedError`, which `passkeyService` was returning as `{ success: false, error: 'Registration was cancelled' }`; (2) `App.vue:handleEnablePasskey` was piping the cancellation through `showToast('error', ...)`, telling the user they'd hit an error when in fact they'd just exercised a normal choice; (3) the toast's auto-reporter was forwarding "Registration was cancelled" to `#beanies-errors` as a real production alert. Same shape on the authentication side ('Authentication was cancelled' from the BiometricLoginView passkey sign-in). Caught after a real Xu Family registration test on iOS 18.7 — the user successfully completed the password-based path, but the passkey-dismissal alert still fired to Slack. Fix: added a first-class `cancelled` flag to both `RegisterPasskeyResult` and `AuthenticatePasskeyResult` (set whenever the underlying `NotAllowedError` is caught); all three call sites — App.vue, BiometricLoginView, PasskeySettings — now branch on `result.cancelled` first and exit silently with a console warn instead of surfacing an error. authStore.signInWithPasskey no longer sets `error.value` on cancellation either, so any reactive UI bound to it stays clean. 2 new unit tests cover both result types' cancellation paths.

- **Engine-panic Slack alerts now identify which store action triggered the failure.** Yesterday's `wrapAsync:engine-panic` surface (added to catch wasm-bindgen "recursive use of an object detected" panics like the one a real iPad iOS 15 + Google Search App user hit) shipped without any caller-identifying context — the alert carried the rust message and the wasm stack but nothing about which of the ~7 stores or 90 wrapAsync call sites actually threw, leaving each firing un-actionable. wrapAsync now accepts an optional `action` label and threads it into the alert as `context.action`. Backfilled the highest-traffic call sites first — todoStore, activityStore, transactionsStore, vacationStore, goalsStore, accountsStore (25 actions total) — covering every CRUD path through which a real user would reach an engine panic. Long-tail stores (sayings, favorites, member notes, etc.) still emit unlabeled alerts for now; those will be backfilled when traffic justifies. Triggered by a 2026-05-02 j&m household firing on the same iPad iOS 15.8 + GSA WKWebView shape — same family fired twice in 48 sec, suggesting a reproducible per-user trigger we couldn't act on without knowing the action.

---

## 2026-05-01

### Added

- **New beanstalk post: "aloe vera".** A personal essay (~2400 words) about losing my mom and a half-empty bottle of aloe vera that has survived ten moves and one shipping container from Japan to Singapore. Featured on the `/blog` index. Cross-posted to Substack the same day; this is the canonical beanstalk version.

### Fixed

- **Google Drive reconnect prompt now appears only when truly unrecoverable.** The yellow "reconnect to Google Drive" toast had been firing far more often than it should — after multi-hour tab inactivity, after the "get fresh beans" SW reload, and on transient network blips during background sync. Five issues stacked on top of each other in the auth layer, all addressed in one fix: (1) the silent-token getter (`getValidTokenSilent`) used to fire the banner from inside its own catch path on **any** silent-refresh failure, including transients — callers had no chance to retry before the user saw it. The banner trigger is now decoupled and fires only when the refresh token is _permanently_ unrecoverable (Google returns `invalid_grant`, i.e. the user revoked the grant at accounts.google.com or it actually expired). (2) New visibility-change + page-mount auth wake listener proactively refreshes the access token whenever the tab regains focus AND the token expires within ~2 minutes, plus once at install — covers both multi-hour absence and the cold-boot/SW-reload path where the in-memory `setTimeout` is gone. (3) The banner is now self-healing: any successful silent refresh (background or interactive) auto-clears it via the existing `onTokenAcquired` subscriber registry, so transient races that briefly flip it up resolve themselves at the next refresh. (4) Silent-refresh retry budget bumped from 2 attempts to 3 with stepped 1.5s/3s backoff — catches the typical mobile-network blip that the third attempt usually clears. (5) Existing `invalid_grant` short-circuit unchanged — that's the only legitimate reason to surface the banner, and now it's the only path that does. Net effect: the toast is robust to tab backgrounding, SW reload, and transient Drive 5xx; it appears exactly once when (and only when) the user actually needs to re-authenticate. 8 new unit tests cover the new behavior; full suite green at 1916 passing.

- **Onboarding picker errors now self-report to `#beanies-errors` with the actual cause.** Previously, when a joiner hit `PICKER_SCRIPT_LOAD_FAILED` during invite onboarding (or any of the 6 other previously-silent error paths in the join flow — invite-token mismatch, family-id mismatch, no-unclaimed-members, file-read 404, etc.), nothing reached the team's Slack alerting and the user-copyable diagnostic blob was the only signal. Worse, `PICKER_SCRIPT_LOAD_FAILED` was actually a catch-all overloaded across 5 distinct underlying failure modes (config missing, script-tag load fail, picker construction throw, auth chain throw, plus the existing iframe/timeout paths) — the actual exception text was logged to console and dropped on the floor. Two changes: (1) the `pickBeanpodFile` discriminated union widened to a precise 6-value reason taxonomy (`config | load | open | auth | iframe | timeout`) with an optional `message` carrying the underlying `Error.message` through to the diagnostic blob and the new mapped error code (`PICKER_FAILED` for runtime issues, `PICKER_SCRIPT_LOAD_FAILED` for true config/network issues, `PICKER_TIMEOUT` for hangs). The auth-chain `try` block in `usePickBeanpodFile.pick` was also narrowed structurally to make the auth-vs-picker boundary visible in code — preventing future drift back to a single opaque `'script'` catch-all. (2) New `recordError` helper in `useJoinFlow` consolidates all 8 `currentError.value = ...` sites into one source of truth that ALWAYS fires `reportError` to Slack with the captured detail in the message body. Going forward, every join-flow failure produces an actionable alert with the actual exception text — no more debugging from user-pasted diagnostic blobs alone. Also includes two surgical bug fixes that ride along: the cached `scriptPromise` now resets to null on script-load failure so the user's "Retry" button actually retries (was returning a cached rejection forever), and `tryAutoLoadByFileId` returning `'needs-pick'` (= silent token couldn't reach the file = wrong account) now forces consent on the picker call so Google's account chooser appears with `loginHint` pre-filled instead of silently rendering against the wrong Drive.

### Fixed

- **Store-action errors now ship a stack trace + a friendlier user message.** Two related issues with the generic store-action wrapper. (1) `wrapAsync` (the catch-all wrapper used by ~7 stores — transactions, todos, favorites, photos, etc.) called `showToast('error', e.message)` without passing the Error itself, so every caught throw landed in `#beanies-errors` with surface `app` and **no stack frames** — leaving each firing essentially un-diagnosable on the receive side. The Error now travels through to the reporter, so future Slack alerts include the call-site stack. (2) Engine-internal panics (wasm-bindgen `recursive use of an object detected which would lead to unsafe aliasing in rust`, wasm trap messages, `RuntimeError`, etc.) previously rendered the raw rust string directly in a user-facing toast — confusing and scary. wrapAsync now substitutes a friendly "Something went wrong / please refresh / support has been notified" toast for those messages while reporting the original raw text + stack to Slack under a dedicated `wrapAsync:engine-panic` surface, so engineering keeps the diagnostic value without users seeing engine internals. Triggered by an iPad iOS 15 + Google Search App webview firing this morning that floated wasm-bindgen output to a real user. 9 new tests cover the two paths and the engine-panic regex list (`recursive use`, `unsafe aliasing`, `unreachable executed`, `memory access out of bounds`, `RuntimeError`, `wasm`).

### Changed

- **Travel plans timeline — today indicator redesigned.** Iterated through three variants with greg before landing on the final shape. Today's row now keeps the same calendar-circle + "Day N · date" header that every other day uses (consistent rail rhythm), with the trip-relative "● TODAY · Day N of M" cue carried by a subordinate Heritage Orange pill rendered immediately below the date header. The previous design — which had the orange pill standing in for today's date header — confused users on free-rest days because the pill visually attached to the previous day's content. New flow: today's date circle gets a Heritage Orange border + pulsing halo (replaces the separate rail-diamond from the old design); the chip below adds the trip-relative context; segments inside today's group still render with orange connector dots. A synthetic empty group is injected for today when mid-trip and no real group exists, so free-rest days still get the consistent date header treatment. `prefers-reduced-motion` users get a static orange ring instead of the pulse.

### Fixed

- **`--heritage-orange` CSS variable now actually defined.** Many components across the app reference `var(--heritage-orange)` — the today indicator, accommodation gap circles, onboarding scaffolds, several others — but the variable itself was never declared in `style.css`. Most call sites masked the bug with an inline fallback (`var(--heritage-orange, #f15d22)`); the call sites that didn't were silently rendering `currentColor` (≈ near-black). Defined globally now as a brand alias of `--color-primary` (`#f15d22`); same hex in dark mode (brand color is constant). Also added a defensive fallback to the new `.today-date-circle` rule so the page is robust if the global var is ever removed.

- **Travel plans timeline — past-day muting now applies to gap entries too.** Accommodation-gap entries (the dashed orange "no accommodation booked" warnings) previously rendered at full opacity regardless of whether the date was past, today, or future. On trips where yesterday had only a gap (no segments → no date-group), the past/today visual boundary landed one day too late: yesterday read as today-styled while two-days-ago read as past-muted. Gap entries now share the same `opacity-55 saturate-50` mute as past date-groups, so the past/today boundary lands at one consistent place on the rail.

- **Travel plans timeline — past gaps harmonized with the rest of the rail.** Past gap circles previously kept the warning-flavored dashed orange border + 🏨 emoji, which looked out-of-place against the muted teal past-day rail. Past gaps now use the regular solid-teal date-circle border (matching past date-groups); future and today gaps keep the dashed orange warning style since they're still actionable. The 🏨 emoji and the gap card below are unchanged, so "no accommodation that night" still reads.

- **Travel plans timeline — duplicate "today" date label suppressed.** When today had both an accommodation gap and (after the redesign) a synthetic empty group, the gap's date header would show today's date a second time below the today indicator. Gap entries now suppress their date-header when a date-group exists for the same date — a useful side-effect cleanup for any non-today date that has both segments and a gap, which previously also showed two date headers.

- **The "counting beans" loading label now uses brand-approved colors.** The animated gradient sweep that travels across the words previously included two off-palette colors (a yellow `#ffd93d` and a saturated cyan `#00b4d8`), with the cyan also appearing in the third pulsing dot and the bean graphic's glow at the 33% mark of its breath cycle. All three replaced with Sky Silk `#AED6F1` — the brand's canonical cool partner to Heritage Orange + Terracotta. The sweep now reads `Heritage Orange → Terracotta → Sky Silk → Terracotta → Heritage Orange`, symmetric around the cool middle so the loop has no visible seam. The warm-to-cool-to-warm motion the original designer wanted is preserved; the cool peak just reads as calm-and-safety blue per the brand voice instead of attention-grabbing yellow/cyan.

### Security

- **OAuth proxy CORS hygiene tightened.** Four defense-in-depth improvements to the Lambda that handles Google Drive sign-in token exchange. (1) `Vary: Origin` header on every CORS response — without it, any cache between the client and proxy can serve a wrong-origin response. (2) `Cache-Control: no-store` on every response (success, error, preflight) — token exchanges are credentials and no intermediary should ever cache them. (3) Defense-in-depth `403 forbidden_origin` for POSTs whose Origin header isn't allowlisted — browser CORS only blocks the response read, not the request itself, so without this an attacker page could have the proxy execute requests against Google server-side even though the response would be unreadable to them. POSTs with no Origin header (curl / server-to-server) still pass through. (4) The redirect-URI allowlist is now auto-derived from `CORS_ORIGIN` (`<origin>/oauth/callback` for each origin) rather than hardcoded — single source of truth, one less env var for self-hosters to keep in sync, and matches the SPA's actual callback path. Zero behavior change for cloud users (the auto-derived list matches the previous hardcoded list exactly). Self-hosters following Path B of `SELF_HOSTING.md` no longer need to edit code to add a deploy origin — just set `CORS_ORIGIN`.

---

## 2026-04-30

### Fixed

- **Travel-segment chips on the calendar no longer block clicks on the activity beneath them.** A 1-hour activity (or 30-min, or any short activity) overlaid by a flight chip became un-tappable: the segment chip's wrapper div was sized to a full 1-hour synthetic block, so even though the chip itself only renders ~28px tall, the empty area below it still captured pointer events — clicks on the bottom half of the activity card hit the invisible wrapper instead of the activity. Multi-hour activities masked the bug because hours 2+ were outside the wrapper's reach. Fix: `pointer-events-none` on the wrapper + `pointer-events-auto` on the chip itself, so the wrapper passes through clicks while the chip stays interactive. Same pattern was already applied on the desktop daily view; this PR propagates it to week view (`WeeklyCalendarView.vue`) and the mobile DayTimeline (`DayTimeline.vue`). Added "DO NOT REMOVE" comment naming the bug it prevents so a future maintainer can't accidentally undo it.

- **Language switcher no longer freezes when switching to a language with missing translations.** Previously, clicking the Chinese flag after a fresh deploy could lock the switcher for 30s–1m: the click handler awaited the slow MyMemory backfill loop (~200ms × 500 keys) and the mobile switcher was actively `:disabled` while loading, so the user couldn't flip back to English mid-load. The bundled JSON applied instantly (cosmetic switch was always fast) but the user-visible freeze made it look broken. Three lock-step fixes: (1) new `useLanguageSwitcher()` composable owns a fire-and-forget switching contract — both `AppHeader` and `MobileHamburgerMenu` consume it, never awaiting the backfill, with a heavy "DO NOT add `await` back" comment to prevent regression; (2) closure-scoped `activeLoadToken` cancellation token in `translationStore` — every reactive write and every API loop iteration checks staleness before applying, so a mid-load language switch supersedes the previous load within ≤200ms (next loop iteration), preventing stale Chinese results from clobbering a newer English switch; (3) mobile language buttons no longer carry `:disabled` or `pointer-events-none` — switcher is always interactive. Bonus reliability: catastrophic translation-load failures (JSON 404, IndexedDB dead) now route through the universal `errorReporter` to `#beanies-errors` and surface a user toast (was silently swallowed before — click looked ignored). Per-key API failures are non-fatal and logged with `[translationStore]` prefix; stale-load aborts are intentionally silent (user explicitly superseded). 8 new unit tests cover instant cosmetic switch, isLoading toggle correctness, both stale-bailout phases, catastrophic failure surfacing, stale catastrophic silence, and per-key tolerance. Plan: `docs/plans/2026-04-30-language-switcher-freeze.md`.

### Changed

- **Member filter relocated from the global header/sidebar to inline chip filters on the three pages that actually use it (Activities, Accounts, Transactions).** Resolves the long-standing "click does nothing" UX symptom — the global control was visible on every page but only ~3 pages read its state, so clicks on Dashboard / Pod / Nook / Goals / Assets / Recurring updated the store invisibly. Now each consumer page has its own contextual chip row + a small "Filtered to: X" line so the active filter is visible at the point of action. State still shared across the 3 pages via the same `useMemberFilterStore`, so filtering to "wife" on Accounts carries to Transactions automatically. New `useMemberFilterChips()` composable encapsulates the toggle/select-only/active-names pattern; FamilyPlannerPage refactored to consume it on day 1 to close 3-way duplication. The deleted `MemberFilterDropdown.vue` (141 lines) carried a silent-failure bug — its v-model setter ignored `toggleMember()`'s `false` return when the user tried to deselect the last member, leaving the UI desynced from the store. The chip path replaces that case with an intuitive "deselect last → revert to All" un-filter, unit-tested + commented to prevent regression. Frees the global header/sidebar slot for an upcoming notifications surface. New i18n key `filter.filteredTo` (en + beanie + zh — "筛选至： {names}"). 15 new unit tests covering all three onSelectMember cases plus reactivity and edge cases. Plan: `docs/plans/2026-04-30-member-filter-relocation.md`.

### Added

- **Travel segments now surface on the activities calendar.** Flights, trains, ferries, and cruises with explicit departure/arrival times appear as chips on the Family Planner across all three views (month, week, day) and the mobile DayTimeline. Each segment renders two markers — one at the departure datetime and one at the arrival datetime — automatically distributed across days for overnight or cross-month trips. Click a chip to open the existing `TravelSegmentEditModal` drawer in place; edits flow through the existing vacation store so the calendar updates live. Direction-aware emoji (🛫 / 🛬) plus a bold "DEP" / "ARR" prefix differentiate the two markers of the same flight at a glance. Booked segments use a solid teal left-border; pending ones use a dashed outline + italic so it's a visual reminder to confirm the booking. Concurrent-edit defense: if the segment being edited is removed by another device mid-session, the editor closes with an explanatory toast instead of silently dropping into empty-form mode. Pure helper layer in `src/utils/vacation.ts` (table-driven `SIDE_FIELDS` so adding a new transport type is a one-row change) keeps the derivation testable without store mocks. Caller-side time-grid union keeps `useTimeGrid` agnostic to segments. New `<TravelSegmentChip>` component shared across week/day/DayTimeline; month view inlines its own compact variant. 31 new tests (helper + store integration + component). Plan: `docs/plans/2026-04-30-travel-segments-on-calendar.md`.

- **Local-file polling for Path-A self-host (cloud-folder sync).** When a user's active provider is `LocalStorageProvider` (a `.beanpod` file inside a Dropbox / iCloud / OneDrive synced folder), the sync engine now polls the file every 15s while the tab is visible, fires an immediate poll on each hidden→visible transition, and merges any external edits via Automerge — so changes from another family member's device show up automatically once the cloud-storage client syncs the file. Polling is gated on a new optional `supportsLocalPolling()` method on `StorageProvider`: `LocalStorageProvider` returns true (FSA `getLastModified()` is O(1) OS metadata), `GoogleDriveProvider` returns false (Drive uses save-time merge instead). New generic `usePollWhileVisible(callback, intervalMs, options?)` composable in `src/composables/` consumes the singleton `useToday().isVisible` ref so no new event listeners are registered. Throwing callbacks are caught and reported via `errorReporter`; the loop never dies.

- **Cloud-storage conflict-copy detection.** When a user opens a `.beanpod` file whose name matches a known conflict-copy pattern (Dropbox `(conflicted copy …).beanpod`, OneDrive `…-conflict.beanpod`, Google Drive desktop `… (1).beanpod`, iCloud `… 2.beanpod`), the app surfaces a warning toast explaining that Automerge will merge it on load and the duplicate can be deleted after. New `src/utils/beanpodFilename.ts` (22 unit tests) holds the patterns; iCloud's `<name> N.beanpod` shape is treated as warn-only because the same shape is plausible as a user-chosen filename.

- **`LocalFileSyncWarning.vue` extracted as a reusable warning modal.** The inline modal previously duplicated at `CreatePodView.vue:1013-1053` is now a single component used by `CreatePodView` (and ready for `LoadPodView` if needed). Single source of truth for the local-file storage trade-off copy.

- **Self-host Lambda deploy reference docs.** Path-B self-hosters now have step-by-step AWS deploy guides at `infrastructure/lambda/oauth/README.md` (OAuth proxy, required) and `infrastructure/lambda/registry/README.md` (registry, optional smoothness). Runtime-agnostic API contract at `infrastructure/lambda/oauth/SPEC.md` — Cloudflare Workers / Vercel Edge / any Node host work too. `infrastructure/README.md` now points at the self-host references from the top.

### Fixed

- **Self-host Drive sign-in no longer fails with a misleading "VITE_REGISTRY_API_URL is not configured" error.** The OAuth proxy code path was tied to the registry's env var, so a self-hoster who'd configured `VITE_GOOGLE_CLIENT_ID` for Drive but had no registry would hit a confusing error mid-sign-in. Three changes: (1) new `VITE_OAUTH_PROXY_URL` env var that takes precedence and falls back to `VITE_REGISTRY_API_URL` (cloud regression sentinel — both env vars are first-class, neither is deprecated); (2) new `features.oauthProxy` gate composed from either env var; (3) Drive UI gates (`canInviteFamily`, `isGoogleDriveAvailable`, `capabilities.googleDrive`) widened from `features.drive` to `features.drive && features.oauthProxy`, so self-hosters with only a Google client ID see the Drive card disabled with a new "Drive sync needs an OAuth proxy" tooltip pointing at SELF_HOSTING.md → Path B. Reported by an external self-hoster. 1806 unit tests pass; cloud's existing `.env.local` (only `VITE_REGISTRY_API_URL` set) continues to work unchanged — covered by an explicit regression-sentinel test.

- **`LocalStorageProvider.read()` and `write()` no longer leak unclassified browser errors.** The File System Access API can fail in five distinct ways (permission revoked, disk full, stale handle, corrupted file, unknown) and each warrants different recovery: the first three need the IndexedDB file handle cleared so the next session re-prompts the user, the others don't. Both methods now run errors through a single pure `classifyFileError()` function (one source of truth — read and write paths can't drift), report the failure to the existing universal error reporter (Slack + console with `[LocalStorageProvider]` prefix), conditionally clear the stored handle, and re-throw so upstream save logic still sees the failure. Includes 11 new tests (table-driven classification rules + write/read failure cases). Five new i18n keys cover the user-facing toast messages.

- **Two silent `.catch(() => {})` blocks in `syncStore.ts` (registry remove during disconnect, registry register after save) now log non-critical failures with `[syncStore]` prefix.** Behavior unchanged — registry is optional smoothness — but failures are no longer invisible.

### Changed

- **`docs/SELF_HOSTING.md` rewritten with two clear paths.** Path A (local file in a synced folder, zero env vars, desktop only) and Path B (run your own OAuth Lambda, full feature parity). Decision tree at the top, honest browser-support and conflict-copy limitations called out, Google Cloud Console setup steps gated under Path B only. Path A's zero-env-var promise verified end-to-end against the codebase audit.

---

## 2026-04-29

### Added

- **Cloud-hosted vs self-hosted: explicit, consistent UX across the app.** A self-host clone of the repo no longer pretends to be the cloud build until something fails — every cloud-dependent feature is now visibly disabled with a clear "Cloud-hosted only" tooltip, or hidden when leaving it in would leak data to the cloud build (analytics, marketing-site cross-links, Slack telemetry). New three-state badge in the Settings footer: **☁️ Cloud-hosted version** on `app.beanies.family`, **🛠 Self-hosted · Developer build** when all essential env vars are configured (greg's local dev), or **🏠 Self-hosted · Community build** with a "Learn more" link to the new `docs/SELF_HOSTING.md` reference. Privacy fixes: Plausible analytics and the MyMemory translation rate-limit upgrade no longer silently flow self-host activity to greg's accounts — both are now gated by their own env vars and quietly disabled when unset. Pod-page Invite Beanie button + per-bean share icon disable with tooltip when Drive or registry isn't configured. LoadPodView and CreatePodView Drive cards show "Not configured" badges instead of failing silently when clicked. New `src/config/features.ts` is the single source of truth for all 9 cloud feature gates; legacy helpers (`supportsGoogleDrive`, `isRegistryConfigured`, `isInviteGateEnabled`) deleted in favour of direct `features.X` reads at every call site. New `docs/SELF_HOSTING.md` covers the full env-var matrix, Google OAuth Console steps, optional Slack/analytics/translation upgrades, and known cosmetic limitations (OG meta-tag hardcoding, Passkey relying-party label). README gets a 1-paragraph self-hosting section linking to the doc. `.env.example` regrouped by feature with section headers, missing vars added, unused `VITE_CONTACT_WEBHOOK_URL` (lives in the marketing site) dropped. 1792 unit tests pass; type-check + lint clean; `zh.json` regenerated.

- **LoadPodView coming-soon storage providers tucked into a disclosure (matching the setup wizard).** The 2×2 storage grid on the existing-user load step previously rendered Dropbox + iCloud as full-size dimmed cards next to Drive + Local File. Now they collapse into a single `▸ More providers coming soon` disclosure with three compact dashed chips (Dropbox / iCloud / OneDrive — same set as `CreatePodView`'s post-2026-04-28 markup), so the only visible storage choices are the ones that actually work. Three orphaned i18n keys removed.

### Fixed

- **Phantom "Google session expired" toast no longer appears immediately after a successful Drive sign-in.** Two compounding bugs caused the toast to fire on every fresh login:
  - **Stale state leaked across sign-out cycles.** `authStore.signOut()` cleared Google tokens and the user record but never called `syncStore.resetState()`, so any per-session UI flag (`showGoogleReconnect`, `showSaveFailureBanner`, the file-polling timer, `pendingEncryptedFile`) survived sign-out, was hidden during the login screen by the `v-if="!authStore.needsAuth"` gate, and re-revealed the moment the user re-authenticated. Fix: both `signOut()` and `signOutAndClearData()` now invoke `syncStore.resetState()` (dynamic import to avoid the circular dep) so per-session state is wiped cleanly.
  - **`loadFromFile` set the reconnect banner on every Drive read failure, not just auth failures.** Any transient text-null result from Drive — network jitter during service-worker activation, brief 5xx from Google's API, fetch failure during a deploy — fired the banner permanently. Real auth failures already promote the banner via the expiry-callback chain (`setupTokenExpiryHandler`); the duplicate trigger in `loadFromFile` removed.
  - Defensive: `loadFromGoogleDrive` now clears `showGoogleReconnect`/`showSaveFailureBanner`/`saveFailureLevel`/`lastSaveError`/`error` at the start of a fresh sign-in. Belt-and-suspenders against any stale flag that ever leaks past the sign-out reset.

- **Silent retry now happens at every layer of the Google Drive auth path.** Previously a single transient blip (network jitter, brief 5xx, SW activation race) could fire the reconnect banner. Three layers fixed:
  - `withRetry` in `googleDriveProvider` now retries on `TypeError` from `fetch` (DNS/TLS/offline-blip) in addition to 5xx/408. Same exponential backoff (1s → 2s → 4s).
  - `performSilentRefresh` in `googleAuth` retries once with a 1.5s delay on transient OAuth-proxy failures. `invalid_grant` and "Token has been expired or revoked" short-circuit immediately — those are permanent and retrying just delays the inevitable banner.
  - Result: the reconnect banner now fires only on confirmed auth failure (refresh token revoked / silent refresh exhausted / 401 after silent retry). Transient network blips recover invisibly. 4 new unit tests cover the retry behaviour; the previous "queues for offline on network error" test was renamed and updated to verify queueing only after retry exhaustion (the old test expected the bug — failure on first try). 1792 unit tests pass.

### Changed

- **Onboarding wizard's per-member Send button now opens the canonical InviteWizardModal instead of an inline panel.** The Step-6 invite section on the onboarding wizard's Complete step previously had its own inline send orchestration (Drive share + link generation + open `ShareInviteModal`). It now delegates to the same `InviteWizardModal` component the Pod page's per-bean share icon uses — opens with `prefill={ email, memberName }`, skips Step 0 (picker), lands on Step 1 (confirm/edit email + checkbox) → Step 2 (QR + copy/share channels). Already-joined members render a "Already joined" status chip with no Send button (via `member.requiresPassword === false` — same pattern as `InvitePickerStep.vue`). Members without an email still get a Send button — the wizard's Step 1 lets the user type one in, matching the existing per-bean share flow for placeholder-email members. Eliminates ~40 lines of inline send orchestration; the wizard owns email confirmation, link generation, QR rendering, and inline error UI as a single source.

- **InviteWizardModal accepts an optional `layer` prop** (default `'overlay'` z-[60], can be `'top'` z-[250]). Required because the OnboardingWizard's full-screen overlay sits at `z-index: 200` (formerly `9999` — lowered to align with `BaseModal`'s documented chrome tier); without `layer="top"`, the InviteWizardModal opened beneath the onboarding overlay and clicking Send appeared to do nothing. The Pod page's instance keeps the default.

- **"Invite Beanies" button no longer requires the family registry env var to be set.** The earlier gate (`canInviteFamily()`) required `features.drive && features.registry`. The registry isn't actually required for invites — the joiner can use Google Drive Picker to find the shared `.beanpod` file manually, registry just smooths the lookup. Loosened the gate to require only `features.drive`. `docs/SELF_HOSTING.md` updated to reflect that the registry is optional for invites.

- **Friendlier "no Google account" error wording.** When Drive's permissions API rejects an invitee email with "...do not have a Google Account...", the error toast now reads _"Sorry, we couldn't share with that email! Please double-check and use a valid Google account email."_ (was: _"Google couldn't share with that email — double-check it's a Gmail or Workspace address."_).

### Fixed

- **Onboarding wizard Send button no longer silently fails (z-index regression).** `OnboardingWizard`'s full-screen overlay had `z-index: 9999`, but child modals (the new `InviteWizardModal` from the Step-6 invite panel, and the older `ShareInviteModal`) used `BaseModal`'s `layer="overlay"` (`z-[60]`). Modals opened correctly but rendered behind the onboarding overlay — clicking Send appeared to do nothing. Fixed by lowering `OnboardingWizard` to `z-index: 200` (the documented chrome tier per `BaseModal`'s layer comment) and giving `InviteWizardModal` an optional `layer="top"` (`z-[250]`) prop so it stacks correctly above the wizard. Also explains why the previous `ShareInviteModal` UX felt "no link/QR generated" — the modal was rendering, just invisibly.

- **Invite gate now has a Close (X) button.** Previously the gate had no cancel/back path; users navigating to /create-family without an invite token were trapped on the modal with no way back to the create/join chooser short of using the browser back button. Added a top-right X button (uses the standard `BeanieIcon name="close"` styling matching `BaseModal`'s built-in close pattern), visible across all three modes (token / request / confirmed). Emits a `cancel` event the parent `LoginPage` handles by setting `activeView = 'welcome'`.

- **Browser-back from the login page no longer lands on `/nook` with empty data.** New `router.beforeEach` auth guard for routes declaring `requiresAuth: true`: when `authStore.isAuthenticated === false`, redirect to `/welcome` with the original `fullPath` preserved as a `?next=` query param (for future post-sign-in destination routing). The guard is gated on `authStore.isInitialized` so the initial app boot — where `isAuthenticated` flips from false to true asynchronously during session restore from IndexedDB — doesn't bounce a legitimately authenticated user to `/welcome`. After init completes, `App.vue`'s `loadFamilyData` handles the boot-time no-session case explicitly; this guard catches every subsequent navigation (browser-back, deep links, manual URL entry) while unauthenticated.

- **"Not a Google account" error from folder share is no longer silently swallowed.** Drive's permissions API has an asymmetry: file shares for non-Google emails return 200 OK and create a "pending invite" (Drive emails the address asking them to sign in), but folder shares for the same email return 403 Forbidden with `"...do not have a Google Account..."`. The folder-share's failure is therefore the most reliable signal that the invitee can't actually access the pod. Previously this was logged as a non-fatal warning and the user was left looking at a QR code their invitee couldn't redeem. Now: the folder-share `catch` detects the asymmetric "no Google account" pattern (matching both `do not have a google account` and the older `not a google account` phrasings) and promotes it to fatal — `error.value` is set to `invalid-google-email` with `recovery: 'edit-email'`, and the wizard surfaces the friendlier error inline so the user can correct the address. Other folder-share failures (network, edge permissions) stay non-fatal as before. New `isInvalidGoogleEmailError(e)` helper deduplicates the pattern matching across both the file-share catch (already detected this) and the folder-share catch (new). 1 new unit test covers the asymmetric file-succeeds-folder-rejects path.

- **Settings footer "Learn more" link, README clone URL, and SELF_HOSTING.md links now point at the correct GitHub repo** (`gparker97/beanies-family`, not the wrong `gregcmartin/beanies-family` placeholder I'd used). Three places swept and corrected.

- **Stale `BaseModal` + `MobileHamburgerMenu` refactor item dropped from STATUS pending list.** The work was already shipped on 2026-04-28 via the `useFullscreenOverlay` consolidation (commit `8a91f84`); both files now consume that composable, which bundles the Esc-handling and scroll-lock that the pending block listed. No PR needed — the validation header notes the cleanup.

---

## 2026-04-28

### Changed

- **Onboarding wizard v2 — split into 6 focused steps + inline per-member invites.** The post-pod-creation onboarding wizard, previously 4 steps with the second being a 1,095-line "Money" mega-step (account + recurring + savings stacked on one screen), now flows as **Welcome → Account → Recurring → Savings → Activity → Complete**. One decision per screen, breathable. Welcome is decluttered (paragraph + 3 pillar cards dropped, replaced with a "let's set up your bean pod" tagline). The Account step gets a new owner picker (single-select chip picker, only renders when there's >1 human in the family, defaults to the wizard owner; the auto-name preview "Mary Lynn's OCBC Checking" updates reactively); field order is **Bank → Balance → Type chips → auto-name preview + Add** (easiest-to-answer first). Activity step replaces the single-select assignee dropdown with a multi-select `FamilyChipPicker` matching the rest of the app. Step 6 adds an inline per-member invite section that reuses the existing `useInviteFlow` + `ShareInviteModal` primitives — visibility-gated to Drive storage AND ≥1 member with a shareable email; no inline invite UI for local-storage or lone-owner pods. Each Add-step now has remove buttons on confirmed rows and shows already-added items above the entry form so users can fix mistakes without leaving the step. Side-effect bug fix: the savings-percent slider value now actually reaches the Complete summary card (was previously hardcoded to 20). The redundant `celebrate('setup-complete')` modal that fired on Finish is gone — the Complete screen IS the celebration moment, no second "all set" surface needed. Step header restructured to put progress pips at top center (was: top-right tucked next to the title). All step titles + chip labels now respect beanie-mode lowercase (account types, frequency labels, savings-mode toggles, activity presets — every user-visible string flows through `t()` with `en` + `beanie` variants). 20 new i18n keys, 27 unused keys deleted; zh.json regenerated cleanly. Bug fixes along the way: bank combobox dropdown teleports to body so it can't be clipped by modal `overflow:hidden` (with edge-aware flip-up positioning); fixed scrollbar / gradient-cuts-off bugs by moving the gradient backdrop to the scroll container and letting the modal grow naturally with the OUTER overlay scrolling if content exceeds viewport; mobile horizontal-overflow on the Recurring card's account picker resolved with proper flex-wrap layout. Plan at `docs/plans/2026-04-28-onboarding-wizard-v2.md`. Mockup at `docs/mockups/onboarding-wizard-v2.html`.

- **Setup wizard Step 3 add-member form — natural field order + clearer role labels.** Reordered fields from Role → Name → Birthday to **Name → Birthday → Role** (universal form-design principle: easiest/least committal field first, narrow, then categorize). Dropped the redundant "Type" prompt label above the role chips — the chips' emoji + labels are self-describing. Beanie-mode role labels also tightened: `loginV6.parentBean` "big beanie" → **"parent beanie"**; `loginV6.littleBean` "little beanie" → **"child beanie"**. The `parent / child` distinction is unambiguous (a 16-year-old isn't really "little"); affection in beanie mode is preserved by the "beanie" suffix instead of by the size adjective. en values unchanged.

- **Drive pod-created success modal — celebratory + tighter.** When a brand-new pod's `.beanpod` file lands on Google Drive, the success modal now reads "**Your pod is planted! 🌱**" with a one-line subtitle "Saved safely — let's add your family next." and a single compact file-badge below. The previous orange callout instructing users to manually share the file via Drive's UI is gone — that flow is handled by the per-bean share button on the Pod page (and the upcoming onboarding-end invite prompt), not this success moment. The "Location: beanies.family folder" subline is also omitted from the modal (still surfaces in Settings → Family Data where users actually want to find it later). ~60% less visible text on what's meant to be a milestone celebration.

### Fixed

- **App init no longer surfaces a false "failed to start" recovery screen when the user is being redirected to login.** Pre-existing race in `App.vue`'s init flow: when `loadFamilyData()` decided "sync configured + Drive fetched ✓ + needs password ✓ + no cached key → redirect to /welcome", the post-init health check still ran, found no Automerge doc, and surfaced the orange recovery overlay on top of the login page (confusing UX). The exchange-rate refresher then fired and crashed for the same reason — caught by `.catch(console.error)`, just noise but pollution. Now: `App.vue` tracks a `docLoaded` flag through the health check; if the doc isn't loaded, suppresses the recovery UI **only when the user is on a login-flow route** (`/welcome` or `/login` — i.e. `loadFamilyData` deliberately redirected them) and skips the rate-refresh path entirely (its callees would throw). Genuine init failures (network, file missing, etc.) still surface the recovery UI as before. Each branch logs cleanly with `[App]` prefix; no silent failures.

### Changed

- **Setup wizard tightened — fewer words, hide-and-reveal where it counts.** The first-run "Create a new pod" wizard's three steps each lost a redundant subtitle, and Step 2's 75-word security paragraph collapsed into a `▸ How this works` disclosure (3 short bullets, hidden by default). The three coming-soon storage-provider cards (Dropbox / iCloud / OneDrive) shrunk into a single `▸ More providers coming soon` disclosure with compact chips. The disabled-state CTA now reads "Pick a storage to continue" (intent-shaped) instead of a dimmed generic "Next". Step 1 title goes "Grow a brand-new pod" → **"Start your pod 🌱"**; Step 3 title "Add your family members" → **"Add your family 🫘"**; Step 3 final CTA "Finish" → **"Finish · take me to the nook 🏡"** (destination-shaped). Member tiles in Step 3 now show the captured birthday inline (`🫘 Parent bean · 14 May`). The cream-warmth experiment: a subtle white-to-cream gradient on the modal frame, scoped to this wizard for now and evaluated after live. New `formatBirthdayShort` helper in `src/utils/date.ts` (with documented empty-string fallback for missing/invalid input). 7 i18n strings updated, 5 unused keys removed, 8 new keys added (covering the new disclosure body + disabled-CTA copy); zh.json regenerated cleanly. Mockup at `docs/mockups/setup-wizard-v2.html`. Plan at `docs/plans/2026-04-28-setup-wizard-v2.md`.

### Security

- **fast-xml-parser bumped to 5.7.1** (via `@aws-sdk/xml-builder` coordinated update) — fixes [GHSA-9554-fp4j-h2g6](https://github.com/advisories/GHSA-9554-fp4j-h2g6): XML comment + CDATA injection via unescaped delimiters in XMLBuilder output. Used transitively through the AWS SDK in our DynamoDB code path. CI green confirmed our usage doesn't trip the documented breaking entity-handling change in 5.7.x.

### Changed

- **Dependency cleanup pass — 13 dependabot PRs triaged, 3 merged, 8 deferred, 2 closed as superseded.** Merged: development-dependencies group (10 minor/patch bumps incl. postcss XSS fix), production-dependencies group (@automerge/automerge 3.2.5 → 3.2.6, vue patch, tailwindcss patches, @tailwindcss/vite patch), fast-xml-parser security fix (above). Deferred to focused-migration work (each closed with a comment naming the cascade): astro 5 → 6, vite 7 → 8, @astrojs/mdx 4 → 5, astro-seo 0 → 1, astro-og-canvas + canvaskit-wasm pre-1.0 minor bumps, eslint 9 → 10 (peer-deps cascade confirmed locally via ERESOLVE), stylelint 16 → 17 (same shape). Closed as superseded: standalone postcss PR (covered by the dev-deps group), older astro 6.1.6 PR (newer 6.1.8 was open). Remaining 5 security alerts triaged as non-applicable or unfixable-transitive — see STATUS.md `Engineering follow-ups`.

### Fixed

- **Slack `#beanies-errors` no longer fires on transient service-worker update failures.** First production error report after the auto-error-notifications shipped was a `TypeError: Failed to update a ServiceWorker` from a user on Android Chrome over 4G — three call sites (`UpdatePrompt.vue` periodic 5-min poll + visibility-change refresh, and `AppHeader.vue` refresh-all button) were calling `registration.update()` without catching the rejection. Any transient fetch failure of `sw.js` (mobile signal blip, momentary CDN error, mid-deploy cache invalidation) floated up to the global `unhandledrejection` listener and pinged Slack. There is **zero user impact** when this happens — the currently-installed SW keeps serving fine; the next update attempt succeeds. New `safeServiceWorkerUpdate(registration, source)` helper wraps `registration.update()` with a `.catch()` that logs `[serviceWorker] update from <source> failed (transient)` + the Error to console (devs retain debugging visibility) but intentionally does NOT promote to an error report. All three call sites now use the helper. Compliant with the no-silent-failures rule: failure is caught + classified + logged with prefix + Error; the "non-critical → console only with documented fallback" path applies.

### Changed

- **Today's date now shows on every page in the app header — and in Heritage Orange.** Previously the date appeared only on the Family Nook + Dashboard, in 40%-opacity Deep Slate that was hard to read. For a planner app, today's date is the primary orientation anchor — it deserves to be present and legible everywhere, not hidden chrome on two pages. The desktop header now carries it on every page in `text-primary-500` (Heritage Orange, Outfit medium 500, 12px) — pairing visually with the H-Orange already used on the user's name in the Nook welcome line so the two highlights read as a coherent emphasis pattern. On compact screens (mobile + tablet, <1024px) where the header is too tight for a subtitle, the date moves to the Nook body as a single-line conversational caption: **"It's Tue, 28 April · Your family at a glance"** — date inline in H-Orange semibold, year omitted (implicit from context), short day name (`Tue`/`Wed`/etc.) to save horizontal space. Replaces the previous three-line stack (welcome → date → caption) with a tighter two-line block (welcome → date+caption). New `formatTodayCaption()` date helper + new `nook.todayCaption` i18n key with en + beanie variants ("it's tue, 28 april · your bean pod at a glance"). zh.json regenerated.

### Fixed

- **Mobile hamburger menu no longer breaks page-scroll lock when stacked over a modal.** The hamburger drawer used to toggle `document.body.style.overflow` directly with no error handling, bypassing the ref-counted `overlayStack` shared by every other overlay. Result: closing the hamburger while a modal was also open re-enabled body scroll under the modal, and a sandboxed-iframe failure of the style mutation would crash the watcher silently. The drawer now goes through the same `useFullscreenOverlay` composable (which wraps the ref-counted scroll-lock + the standard try/catch + logged fallback) used by all other viewport-blocking overlays, so stacked behavior is consistent and any failure is captured + classified + logged with `[useBodyScrollLock]` + Error. Bonus: `BaseModal` / `BaseSidePanel` mounted with `open: true` initially now lock scroll during setup (old non-immediate watcher deferred the lock until the prop transitioned), and the hamburger now releases its lock on unmount-while-open via `onScopeDispose` (old code never released).

### Changed

- **Overlay components consolidated onto a single `useFullscreenOverlay` composable.** Internal refactor: `BaseModal`, `BaseSidePanel`, `MobileHamburgerMenu`, and `MobileNavBeanStack` now share one named primitive that bundles Esc-to-close + body-scroll-lock — the two contracts every viewport-blocking overlay needs. ~80 lines of inline duplication deleted. Public APIs unchanged (same props, emits, slots — no caller updates needed). Future overlay-universal a11y work (focus trap, `aria-modal`, page `inert`) lands at one site instead of four. 1747 unit tests pass.

- **Mobile bottom nav v3 — 4-tab shell with bean-stack categories.** The mobile bottom navigation collapses from a flat 6-tab strip (Nook / To-do / Activities / Travel / Piggy Bank / Pod) to a calmer **4-tab layout** (Nook / Planning / Money / Pod). Tapping Nook navigates directly. Tapping any of the other three opens a vertical "bean stack" — a column of round bean buttons paired with side cards carrying one-line hints (e.g. Activities · _plan, schedule, log_; Accounts · _checking, savings, cards_). The bean stays anchored over the active tab; the side card auto-flips toward whichever screen-half has more space. Active route is the bottom bean (closest to thumb), ringed in Heritage Orange. Esc key, scrim tap, Android back gesture, browser back, and route changes all close the stack cleanly. Money tab hides automatically when finance permissions are off (3-tab fallback). The 5 Pod sub-routes (Meet The Beans, Scrapbook, Cookbook, Care & Safety, Emergency) are now first-class beans in the Pod stack instead of being buried in the hamburger drawer. Full ARIA: each category tab carries `aria-haspopup="menu"`, `aria-expanded`, `aria-controls`, and active beans get `aria-current="page"`. Focus management: opening the stack focuses the active route's bean (or the bottom bean as fallback); closing returns focus to the trigger tab. `prefers-reduced-motion: reduce` honored — animations skip cleanly without leaving items invisible. Implementation pulls a meaningful DRY win: three new single-purpose composables (`useEscapeClose` 7 tests, `useBodyScrollLock` 6 tests, `useBackGestureClose` 7 tests with re-entry guard for programmatic `history.back()`) replace inline scroll-lock + Esc + back-gesture machinery; an `isRouteActive` pure helper kills a previously-duplicated `route.path === path \|\| startsWith(...)` pattern across the sidebar and the bottom nav; a new `mobileCategory` field on `NavItemDef` lets the 4 mobile categories derive cleanly from the single `NAV_ITEMS` source-of-truth (no parallel constant to maintain). Module load throws on missing hint keys — typos cannot ship. 1747 unit tests pass (up from 1675; +72 new); type-check + lint clean. Plan: `docs/plans/2026-04-28-mobile-nav-v3-bean-stack.md`. Mockup: `docs/mockups/mobile-nav-bean-jar-v3.html`. Issue: #190. Refactor of `BaseModal` and `MobileHamburgerMenu` to consume the new composables is intentionally deferred to a follow-up PR (single-purpose cleanup, isolated regression risk).

---

## 2026-04-27

### Added

- **Medication dose reminders in the Family Nook critical briefing.** Every active medication with a structured `dosesPerDay` (1-4) now appears in the daily briefing as `Don't forget: {medication} for {member} ({remaining} more today)` until that day's required doses are logged — then the reminder disappears, mirroring the todo-completion behavior. Tap the reminder to open the medication's detail drawer (the existing `MedicationViewModal` with the dose log + give-dose buttons). Medication frequency capture redesigned: the free-text `frequency` field is replaced by a chip selector (Once / Twice / 3× / 4× / Other) using the existing `FrequencyChips` component already used by 3 other forms — full DRY consistency. Picking 1-4 auto-fills the display string ("twice daily" etc.) and a live preview line shows users exactly what gets saved; "Other" reveals a free-text input for as-needed / hourly / custom schedules with a slide-fade animation. Legacy medications (no `dosesPerDay` set) open the form with "Other" selected and existing frequency text preserved — zero information loss, no fragile auto-migration parser. Audience: reminders show to all family members with "for {member}" carrying the context, so caretakers and patients both see what's relevant without a new role-gating concept. New `frequencyDisplayFor()` + `isValidDosesPerDay()` helpers in `src/utils/medicationFrequency.ts` (8 unit tests); 7 new medication scenarios in `useCriticalItems.test.ts` (single/plural copy, cleared-when-all-logged, over-dose defensive, legacy skipped, "as needed" skipped, inactive skipped). 1675 unit tests pass; type-check + lint clean. Plan: `docs/plans/2026-04-27-medication-dose-reminders.md`.

- **Universal error reporting to Slack — first-class app-wide feature.** Every caught error in beanies — every `showToast('error', ...)`, every Vue render exception, every unhandled JS error or promise rejection — now fires a structured Slack message in `#beanies-errors` with surface name, family identification (id + name + email), build SHA, route context, browser/network info, and stack trace. Privacy-first: a strict allowlist (NOT a blocklist) gates every context field — only email is allowed as PII; **no member names, transaction descriptions, activity titles, goal names, or user-typed content of any kind**, ever. Violation drops the field with a console warn so devs see the lint signal in dev tools. Spam-prevention via count-summary dedup: first occurrence sends immediately, subsequent occurrences within 60s increment a counter, and at the 60s window close a single follow-up message reports `🔁 fired N more times` if N > 0 — full visibility into bug frequency without channel flooding. UUID/timestamp/numeric-ID/hex normalization collapses "nearly identical" errors into a single bucket. The toast component shows a small italic "Support has been notified" line whenever an error was reported, so users know the issue is being looked at without setting a support-email expectation. Every code-level failure mode (webhook unset, fetch throws, context build throws, re-entry, dedup skip, allowlist drop, string truncation) logs to `console.warn` with the `[errorReporter]` prefix — zero silent failures. Webhook URL stored as the GitHub repo variable `BEANIES_ERROR_WEBHOOK_URL` (not a secret) per the project's `vars.* not secrets.*` rule for non-sensitive config. New `errorReporter.ts` + 21 unit tests; existing `slackNotify` utility refactored to share the underlying `slackPost` helper (also fixed a pre-existing silent `catch {}` bug in it as a bonus). Validation/UX-only error toasts (clipboard fail, stale URL filter) opt out via `{ silent: true }`.

### Fixed

- **No more unsolicited Google sign-in popups after a deploy or during background sync.** Three places in the Drive code (`googleAuth.getValidToken`, `googleDriveProvider.read`, `googleDriveProvider.write`) used to fall through to an interactive popup whenever silent token refresh failed — including for transient failures like a brief network blip during service-worker activation. The popup opened _immediately_ (synchronously, without a user gesture in the call stack), so users felt like the app was prompting them to re-authenticate at random — particularly right after every deploy. Now: a new `getValidTokenSilent()` is the silent-only path used by all background Drive operations (read, write, polling, the wake-time stale-tab refresh). On silent-refresh failure it throws a `TokenExpiredError` AND fires the existing `onTokenExpired` callback channel, which surfaces the existing reconnect banner via `syncStore.showGoogleReconnect`. The reconnect button is now the **only** path to interactive Google auth — the popup never opens without a deliberate click. Failed saves are queued via the existing offline-flush queue and replay on reconnect, so no data is lost. The original `getValidToken` (popup-fallback) is retained and used only by genuinely user-gesture-triggered call sites (Settings → Reconnect, invite share, Meet The Beans). 26 provider tests updated to assert no-popup behavior; new tests cover the offline-queue + TokenExpiredError surfacing path.

- **App no longer shows yesterday's data when opened for the first time on a new day.** Two layered fixes: a new reactive `useToday()` composable is now the single source of truth for "today" — it auto-advances at midnight via a self-rearming timer and on tab wake via `visibilitychange` / `pageshow`, so every list, computed, and chart that filters by today re-renders correctly. A new `useStaleTabRefresh()` composable watches the same composable and runs a heavy refresh on day-change or long-absence wake (>5 min): reload Pinia stores from Automerge, generate today's recurring transactions, refresh exchange rates, silently re-acquire the Google token, and pull remote Drive deltas. Each step has its own try/catch with explicit error classification — critical failures surface as a user-facing toast, non-critical failures log with an `[useStaleTabRefresh]` prefix and the underlying Error object (no silent swallows). The previous `App.vue` visibility handler was a quiet `.catch(console.warn)` that didn't refresh "today" anywhere; the local `attemptSilentReconnect` was extracted to a shared `src/utils/silentReconnect.ts` and its bare `catch {}` replaced with a logged warning. 18 call sites that read `today` now go through the composable so every consumer reacts to the same source.

### Changed

- **Invite Beanie button is now the visual centrepiece of the Pod page header.** Inviting a family member is the central gesture that unlocks beanies.family — the button now reflects that. New gradient pill (Heritage Orange → Terracotta → Golden) with the hugging-beanies family logo in a white circle on the left and a subtle sheen that sweeps across every 5 seconds. Hover lifts and wobbles the mascot. The shimmer + wobble animations gate behind `prefers-reduced-motion: reduce` so users with vestibular sensitivities aren't strobed. Replaces the off-white pill that visually lost to "Add Bean".
- **Invite wizard polish.** Confirm-checkbox section now hides until an email is entered (was showing "Add an email above to continue" — redundant with the disabled CTA, just noise). FAQ links (Google Family Link, accounts.google.com) now render with the standard Heritage-Orange + underline-on-hover styling — previously the `.wizard-faq-link` class was scoped CSS but the FAQ content is `v-html`-injected and never reached the rule. Switched to `:deep()` so it applies.

- **Invite wizard now opens with a beanie picker.** The generic "Invite Beanie" CTA used to drop you in front of a blank email field — you had to remember and retype the address of someone already in the pod. It now opens a Step 0 picker that lists every beanie waiting to join as a tappable row; already-joined beanies and the pod owner are dimmed with a status chip explaining why; an end-of-list "+ add a new beanie" tile funnels into the existing add-member drawer, and on save the wizard reopens at the email-confirm step with the new bean pre-selected. Per-bean share button (the BeanCard share icon) is unchanged — still skips the picker. When a picked beanie has no real email yet (system placeholder like `*@temp.beanies.family`), the email field stays blank and surfaces a Sky-Silk warning chip plus a "what if my child doesn't have an email?" expandable hint pointing to Google Family Link.
- **FAQ section refresh.** "Questions or worries?" → "You've got questions? We've got answers"; dropped Caveat for Outfit-bold (Caveat is reserved for Step 2's QR accent now). Q3 ("what if they don't use Google?") was wrong — non-Google joiners can't open the Drive-backed pod. Restored the accurate answer pointing to `accounts.google.com` with a kids note linking to Google Family Link. Q2 (kids' beanies) gets the same Family Link reference.

---

## 2026-04-26

### Changed

- **Invite Beanie flow rebuilt as a 2-step wizard.** Both invite entry points — the generic "Invite Beanie" button and the share icon on every bean's card — now funnel through one explicit wizard. Step 1 is a single email field with a confirmation checkbox bound to the primary CTA, so users have to actively confirm "this is the Google account email for the family pod" before the link is generated. Step 2 makes the QR code the always-visible centrepiece for in-the-room sharing, with the messaging channel grid (WhatsApp, Telegram, SMS, Messenger, WeChat, Email) below an "or send a link" divider. Per-step beanie mascots and a "questions or worries?" FAQ disclosure (encryption, little beanies, no-Google-account) replace the previous helper-text crowd on a single screen. Internally, all invite-link state moved into a single `useInviteFlow` composable so the page and the wizard share one source of truth, and the channel grid is now a shared component used by both the wizard and the existing "Continue on another device" recovery in the join flow. No protocol or service changes — same encrypted invite tokens, same Drive permission grants, same `loginHint` pre-population for multi-account joiners.

### Added

- **Joiner onboarding hardening — issue #185 architecture pass shipped end-to-end.** The join flow has been rebuilt around a single `useJoinFlow` composable that owns all state (URL parsing, registry lookup, OAuth, Drive read, Picker, decrypt, member-pick, password commit) plus a flat `JOIN_ERRORS` registry that maps each failure code to one i18n message + an ordered list of recovery actions + a severity. `JoinPodView.vue` slimmed from 1,155 to 437 lines — it's now presentational and binds to the composable. Every error screen surfaces concrete, structured recovery buttons (e.g. "Try again", "Sign in with a different account", "Continue on another device") instead of free-form error strings, and the picker iframe's iOS-WebKit "API developer key invalid" symptom is now mapped programmatically (the `LOADED`-then-`CANCEL` heuristic in `pickBeanpodFile` distinguishes a real cancel from an iframe-bootstrap failure). Yesterday's recovery primitives (`usePickBeanpodFile`, `recoverFromMissingFile`, `googleAccountAssertion`) are reused, not reinvented. ADR-024 documents the pattern; CLAUDE.md gains a "Cloud Auth UX" rule (always pre-populate via `loginHint`, never pre-warn users that a flow might fail). Manual cross-browser test matrix template now lives in `docs/E2E_HEALTH.md` ready for real-device verdicts.
- **"Copy diagnostic info" link on every join error screen.** Produces a structured JSON blob (device info, current step, error code + context, URL params with truncated secrets, registry lookup result, envelope inviteKey hash prefixes, Google email, redirect-auth flag, timestamp) so users hitting an unfamiliar error can copy-paste a single self-contained dump back to support — no dev tools or screenshots needed.
- **"Continue on another device" recovery on join errors.** The `tryAnotherDevice` recovery action opens the existing `ShareInviteModal` titled "Continue on another device" with the join URL pre-filled, reusing the same channels (WhatsApp, Telegram, SMS, Messenger, WeChat, Email, Copy + QR). No new component.
- **Inviter side: "Invite a beanie" generic flow now requires sharing with an invitee email before the link is generated** (Drive-backed pods only). The shared email becomes both the Drive permission grant AND the `login_hint` baked into the rendered invite URL. Sharing with a different email regenerates the link with the new hint, reusing the cached invite token (no envelope-slot churn per recipient). A persistent "🔗 Your invite link is set to pre-fill for `<email>`" badge always shows whose hint is in the link about to be sent. Local-provider pods keep their existing behavior; per-bean share button on each BeanCard is unchanged (already embedded the bean's email).

### Fixed

- **Joiner onboarding on iPhone Safari: probable fix for the cookie-consent → "API developer key invalid" chain.** A previous hotfix routed all iOS browsers through full-page redirect-auth to dodge a popup-blocker on the original auto-fire-on-mount join flow. With the user-gesture deferral now in place (auth fires from a button tap, not on page load), iOS regular Safari supports popup OAuth — and popup OAuth doesn't introduce the ITP top-level navigation that breaks the Google Picker iframe's auth context. `shouldUseRedirectAuth()` now only returns true for installed standalone PWAs; iOS regular Safari, iPad regular Safari, Android Chrome (non-PWA), and desktop browsers all use popup OAuth again. Existing fallback path remains: if a popup ever does get blocked at runtime, the join flow catches the error and falls back to redirect-auth.
- **Joiner: "Choose your data file" CTA now appears for any Google Drive invite, regardless of `fileId`.** Previously gated on a "cloud load failed" flag — with no `fileId` to load, the flag stayed false and the user landed on the local-file drop zone instead of the Drive Picker. Now renders whenever the invite is `google_drive`-backed.
- **`INVITE_TOKEN_INVALID` is no longer a dead end.** The most common cause of an unrecognized invite token is a stale Drive CDN read just after the inviter saved the new key — the iPhone fetched a few-seconds-old version of the file. Both `INVITE_TOKEN_INVALID` and `INVITE_TOKEN_EXPIRED` errors now lead with a "Try again" recovery that re-runs the whole flow against the freshest version of the file on Drive.
- **"Ask for a new invite" recovery no longer spins forever.** The handler previously only cleared the error, leaving the step at `'authenticating'` / `'loading'` — the view re-rendered the busy spinner indefinitely. Now also resets the step to `'awaiting-auth'` so the Picker CTA reappears, ready to accept a fresh link from the inviter.
- **Multi-account UX: invite links now pre-populate Google's account chooser.** Per-member invite links sent from the Meet The Beans share modal now embed the invitee's email as a base64-encoded `hint=` URL parameter. On the joiner's side, the join page decodes that hint and forwards it to Google as `login_hint`, so users with multiple Google accounts land in the correct chooser slot (instead of having to spot the right account in a long list, or accidentally signing in with the wrong one and hitting a cryptic "couldn't load the file" error). The hint is purely a UX nudge — the security boundary remains the invite token, not the email.
- **Internal: invite-URL construction is now a single canonical helper.** Previously split between `inviteService.buildInviteLink(token, familyId)` (returned a hash-routed URL with `f=` param) and `MeetTheBeansPage.buildBaseJoinUrl()` (returned a non-hash URL with `fam=` param) — the production share modal used the latter. Consolidated into one `buildInviteLink({ token?, familyId, provider?, fileName?, fileId?, inviteeEmail? })` plus a matching `parseInviteLink(url)` for the joiner side. Both inviter and joiner now go through the same shape; legacy `f=` and hash-routed URLs are still accepted by `parseInviteLink` for backward compatibility. The Share Invite modal also now uses the bean whose card was tapped (the invitee) as the personalization source for the WhatsApp / SMS / email body, instead of the signed-in user's name.
- **Joiner onboarding on iPhone Safari: probable fix for the cookie-consent → "API developer key invalid" chain.** A previous hotfix routed all iOS browsers through full-page redirect-auth to dodge a popup-blocker on the original auto-fire-on-mount join flow. With the user-gesture deferral now in place (auth fires from a button tap, not on page load), iOS regular Safari supports popup OAuth — and the popup path doesn't introduce the ITP top-level navigation that breaks the Google Picker iframe's auth context (the cause of the cookie-consent screen and the "API developer key is invalid" error chain that has been blocking joiners). `shouldUseRedirectAuth()` now only returns true for installed standalone PWAs (where popup→postMessage genuinely can't bridge); iOS regular Safari, iPad regular Safari, Android Chrome (non-PWA), and desktop browsers all use popup OAuth again. Existing fallback path remains: if a popup ever does get blocked at runtime, the join flow catches the error and falls back to redirect-auth.
- **Joiner page: "Choose your data file" CTA now appears for any Google Drive invite, even if the URL has no `fileId`.** The CTA was previously gated on a "cloud load failed" flag that only flipped to true after an attempted load — with no `fileId` to load, the flag stayed false and the user landed on the local-file drop zone instead of the Drive Picker. Surfaced today during iPhone diagnostic testing. Fix: render the CTA whenever the invite specifies the `google_drive` provider, regardless of whether a `fileId` was included in the URL.
- **"Switch Google Account" no longer traps the user in a re-opening chooser loop.** Settings → Family Data → Switch Google Account opened Google's chooser, but dismissing it without picking an account flashed a blank modal and the chooser kept coming back every 10 seconds. Two issues: (1) the switch handler eagerly wiped the IDB refresh token before opening the chooser, so when the user dismissed it the file-polling timer's silent refresh had nothing to fall back on and dropped through to opening the chooser again from a non-gesture context; (2) the "treat next acquisition as a deliberate switch" flag was left armed after a cancel, so the next legitimate token acquisition would silently overwrite the member's bound Google account email. The handler now preserves the IDB token (the in-memory wipe inside `forceConsent` is enough to force the chooser), disarms the switch flag on cancellation, and stays silent on user-initiated cancels instead of showing an error alert. The arming flag is also mirrored to sessionStorage so it survives the PWA / iOS Safari full-page redirect round-trip, and is cleared on app boot if no redirect was completed (back-button bail-out). Token-acquisition subscribers now get an `interactive` flag so background silent refreshes during the switch flow can no longer accidentally consume the arming.
- **Google account "stickiness" across sign-out (multi-account device bug).** Users with two Google accounts on the same device hit a class of confusing failures: signing out and signing back in with a different account would silently route the app to the _previous_ account's Drive (red "we can't find your beanpod" banner; Picker showing the wrong account's files; reconnect appearing to choose A but landing in B). Root cause: `signOut()` cleared Pinia state and the family IndexedDB cache but left every other layer of Google session state alive — in-memory tokens in `googleAuth`, refresh tokens in the separate "handle" IndexedDB + localStorage backup at `beanies_grt_*`, and the cached app folder ID at `beanies_drive_folder_id`. On the next sign-in, an in-flight silent refresh would short-circuit the consent popup using the stale refresh token, returning a token for the previous account before the user ever saw Google's chooser. Fix: new `clearGoogleSessionState()` primitive wipes every layer (revokes the access token, clears in-memory state, removes IDB+localStorage refresh tokens for the active family AND the `__pending__` slot used during login-page OAuth before family adoption). The same primitive now powers both the existing `googleDriveProvider.disconnect()` path and the sign-out paths, so the cleanup is shared and consistent.

### Added

- **Account-bound folder cache (defense in depth).** The `beanies.family` app folder cache in `driveService` is now tagged with the Google account email it belongs to. On every read, the cache is only honored when the active token's account email matches the cache's tag — mismatches trigger automatic re-discovery. Eliminates an entire class of "cached folder ID from account B used under account A's token" bugs even if a future change reintroduces a cleanup gap. localStorage entries upgrade silently from the legacy bare-string format.
- **Account assertion subscriber (defense in depth).** Every successful access-token acquisition (popup, silent refresh, redirect) is now validated against the currently-authenticated member's bound Google account. Three behaviors: first acquisition backfills the binding (verified by the member's own consent); matches are no-ops; mismatches trigger a silent self-correction — wipe session state, force a fresh consent screen with `login_hint` pre-filling Google's chooser to the _expected_ account. A re-entry guard prevents the assertion → re-consent loop from spinning if the user keeps picking the wrong account at the chooser. New `googleAccountEmail` field on `FamilyMember` stores the OAuth-bound identity (distinct from the user-editable `email` contact field — same conceptual split as GitHub account email vs. git author email).
- **"Switch Google account" in Settings → Family Data.** New row shows the currently-signed-in Google account email with a button to switch. Forces a fresh consent screen, then accepts the newly-chosen account as the new ground truth — replaces the `googleAccountEmail` binding for that member. Available to every member for their own record.
- **File-not-found banner now names the account being checked.** The red banner copy now reads "We couldn't find your data file in `gpsp2001@gmail.com`'s Drive..." so account drift is visible at a glance instead of having to guess. The "Go to Settings" button routes directly into the Family Data modal (via `?open=family-data` deep-link, generalizable for future surfaces). The "Pick file from Drive" button now always shows Google's account chooser (`forceConsent: true`) so recovery flows cannot silently land on the wrong account.
- **`login_hint` plumbing through OAuth.** `requestAccessToken`, `startRedirectAuth`, and `useGoogleReconnect.reconnect()` now accept an optional `loginHint` that pre-fills Google's account chooser with the user's expected email — used by the SaveFailureBanner reconnect path and the assertion-driven re-consent.
- **`onTokenAcquired(callback)` subscriber registry in `googleAuth`.** Mirrors the existing `onTokenExpired` pattern. Fires after every successful token acquisition (popup / silent refresh / redirect) with the resolved Google account email. Powers the assertion subsystem; future telemetry/UI hooks can subscribe without modifying `googleAuth` itself.

### Added

- **"Pick file from Drive" recovery action on the file-not-found banner.** When the red "your data file was not found" banner appears (Drive returns 404 when the app tries to read the configured `.beanpod` fileId — typically because the user revoked and re-granted the OAuth grant in their Google account, which wipes the per-file `drive.file` scope association), the banner now offers an in-place "Pick file from Drive" action alongside the existing "Go to Settings" link. Picking the file via Google Picker re-grants `drive.file` scope, the app verifies the picked file decrypts with the in-memory family key and matches the active session's familyId, then swaps the provider to the new fileId and resumes sync — no need to sign out and sign back in to recover.

### Fixed

- **"Reconnect to Google Drive" button no longer silently does nothing in the installed PWA.** Standalone PWAs (Chrome on Android, Edge, etc.) and iOS Safari can't bridge the OAuth popup's `postMessage` back to the app window — the popup either fails to open or opens in a different browser context, so the existing popup-based reconnect flow hung forever with no feedback. The reconnect flow now detects standalone PWA mode and routes through full-page redirect auth instead, matching the join-flow behavior. After the redirect returns to the app, the OAuth code is consumed at app boot in `App.vue` and the next Drive operation picks up the fresh token automatically. If reconnect fails for any other reason (network, OAuth-scope-denied, etc.), the Settings page now surfaces the actual error instead of swallowing it.

## 2026-04-25

### Fixed

- **Sign out no longer hangs when Drive is unresponsive.** The sign-out flow flushed any pending debounced save before clearing auth state, but if Drive was unreachable (API key rejected, file deleted, network offline), the save call would never return — the sign-out modal closed but nothing else happened, the app couldn't navigate to /login, and subsequent visits to `app.beanies.family` got stuck on loading skeletons. The flush is now bounded to 3 seconds with a fallback that proceeds with sign-out even if the save times out or throws. Any pending debounced save is also cancelled so it can't fire after the user has signed out. A missed final save is acceptable; a user trapped on the page is not.
- **Onboarding: "File not found" 404 after the iPhone Safari fix now silently recovers via the file Picker.** After the redirect-auth round-trip on iOS, the joiner has a valid Google token but their `drive.file`-scoped token doesn't yet have API-level access to the inviter's `.beanpod` by ID — under that scope, an email-based file share doesn't manifest as file-by-ID readability until the joiner explicitly opens the file via Picker. The auto-load now detects the 404/403 / "File not found" pattern and silently auto-opens the Picker with the cached token, instead of dumping the user into an error screen. Also fixed an iOS redirect loop where `handlePickFromDrive` always routed iOS through `startRedirectAuth` even when a valid cached token already existed.
- **Onboarding: invitee on iPhone Safari no longer hits "popups are blocked" right after scanning the QR.** The join page used to fire Google OAuth automatically on mount, which iOS Safari blocks because there's no user gesture in the call stack. The page now uses a silent token check first, defers interactive auth to the existing "Pick from Drive" CTA so the tap is a real user gesture, and routes iOS / iPadOS through full-page redirect auth instead of a popup. After the redirect comes back with a fileId, the file auto-loads — no extra Picker step.
- **Onboarding: "that folder doesn't have a pod inside" false negative when joining a shared family.** Picking a folder under the `drive.file` OAuth scope does not grant API list-access to files owned by another user, so the post-pick lookup always returned zero results even when the `.beanpod` was visibly inside. The join flow now picks the `.beanpod` file directly via the Picker, which works correctly for files shared by another user. Photos were already independent of this path (public-link + CDN).

### Changed

- **Chapter 1 + 2 content sync from Notion.** Greg's Notion edits to the "overwhelmed with family planning" and "family organization" pillars are now mirrored to the repo. Chapter 1 gains a new "red flags" section about when overwhelm has tipped into something more serious, the section order has been reorganized so the calm-down + share-the-load conversation comes before the practical tooling sections, the partner-on-board section now precedes the tools-help-vs-hurt section, and the source-of-truth section opens with a Vanilla Ice riff ("Stop - collaborate and listen"). Chapter 2 adds a research callout on family routines + rituals (citing the AAP's overview), tightens the "family OS" short-answer, and adds a paragraph on the youngest beanie joining the chore system. Both bump `lastUpdated` to today and shipped to prod on commit `8ebcdfb`.
- **Chapter pages: prev/next nav now sits above the "from the beanstalk" further-reading box.** A reader finishing a chapter sees the canonical curriculum walk first; the spoke posts are a deeper-dive option after that.
- **Removed duplicate "further reading" heading from chapters 1-3.** The trailing `## further reading` markdown heading + comment was vestigial — the template's auto-rendered related-posts aside already provides that section.
- **Library hero renamed to "the beanies family library".** The /guides hero, JSON-LD `CollectionPage.name`, JSON-LD `ItemList.name`, and `<title>` tag all match.
- **Substack rename — `gpbeanies.substack.com` → `everybeancounts.substack.com`.** Updated every live reference: the auto-subscribe POST endpoint on signup (`CreatePodView`), the embed iframe on `/blog` (`SubstackSubscribe`), the bio link on `/about/greg`, the glossary entry for "the beanstalk", and the three pillar guides on `/guides`. The new URL matches the brand tagline and is easier to say aloud.
- **Plausible analytics split into two sites.** The Vue PWA at `app.beanies.family` now reports to its own dedicated Plausible site (script `pa-jvjpzIr6FM9tDKaS1gZaK`); the Astro marketing site at `beanies.family` keeps its existing site (`pa-3pxexgz2YF03NyMDucQKN`). Marketing and product traffic are now cleanly separated so DAU, signup conversion, and feature usage can be analyzed without filter gymnastics.

### Added

- **`/plausible-exclude` route on the Vue app.** Mirrors the existing marketing-site exclusion page — visit it once per device/browser to set `localStorage.plausible_ignore = true` and stop the tracker on `app.beanies.family`. Unauthenticated, no layout, brand-styled standalone page.
- **Mobile nav redesign mockups (design-only, not yet shipped).** Two interactive HTML mockups exploring a calmer 4-category bottom nav (Nook / Planning / Money / Pod) that uses a "bean-jar stack" pattern — tap a category and a vertical column of beans rises from the tab. v1 (`docs/mockups/mobile-nav-bean-jar.html`) compares three layouts; v2 (`docs/mockups/mobile-nav-bean-jar-v2.html`) commits to the system rule "cluster bloom = ADD, pure bean stack = NAVIGATE", with a Heritage Orange `+` seal differentiating the FAB's bloom from the nav's stack, plus a scaling stress test (3 / 6 / 10 items) and a `＋N more` overflow strategy. Implementation deferred to a future session.
- **Mobile nav v3 mockup, approved (still design-only).** `docs/mockups/mobile-nav-bean-jar-v3.html` is the approved iteration: each bean now carries a side card with a bold label + a one-line hint preview (e.g. "Activities / plan, schedule, log"; "Assets / home, cars, and more"). The bean stays anchored over the active tab; the text card extends inward toward whichever side of the screen has more space (auto side-flip — left-half tab → card on the right, right-half → card on the left). Eyebrow ribbon dropped (redundant with the active tab label below). The `＋N more` overflow bean carries its own hint too. Includes a head-to-head v2-vs-v3 comparison and an 18-string hint-copy guide for greg's voice review before the strings land in `uiStrings.ts`. Vue implementation pending.
- **Blog post page uplift mockup (proposed, awaiting approval).** `docs/mockups/blog-post-uplift.html` proposes a v1 redesign of `/blog/[slug]` that carries the index's per-issue tint (orange / terracotta / sky / kraft / slate) into the post header — wash strip, Fraunces-italic kicker pill ("issue 04 · 17 apr · 4 min read"), tint-tied chip, h2 prefix dot, blockquote rule + wash, link colors. Title bumps from 1.45rem to clamp(1.6, 3.8vw, 2.4rem). One Fraunces-italic drop cap on the first paragraph. Body prose stays sans-serif Outfit (deliberately not lifting the family library's Fraunces serif body — the line that keeps blog and library distinct). Section i: head-to-head current-vs-v1 on `buy-fruit`. Section ii: terracotta / sky / slate variants. Annotations spell out what's NOT lifted from the guide e-zine.

---

## 2026-04-24

### Fixed

- **Permission semantics across the pod.** The three member toggles now have clean, non-overlapping scopes: **Can view finances** (piggy bank), **Can edit family content** (recipes, cookbook, cook logs, medications, allergies, emergency contacts, scrapbook, sayings, favorites, notes, todos, travel plans — everything except the family roster), and **Can manage family members** (add/edit/delete members, family name, pod-level settings). Before this, the cookbook, recipes, and emergency contacts were incorrectly gated on "manage pod", so a member with edit-family-content but no manage-members permission could open the "add recipe" modal but not save it, and couldn't see the edit / log-cook buttons on a recipe. Scrapbook, medications, allergies, todos, and travel plans weren't gated at all. All add-affordances (buttons, add-tiles, empty-state CTAs, quick-add intents) now follow the same rules. The toggle labels in the family member modal have been renamed to match.
- **Quick-add sheet hides actions you can't do.** The + button sheet used to show every action to everyone — a member without finance permission would see "Transaction" / "Account" / "Budget" / "Asset" / "Goal", tap one, and get bounced to the no-access page. Those items now disappear from the sheet entirely when the member can't view finances; likewise content items (recipes, cook-log, medications, allergies, etc) disappear when the member can't edit family content. Empty sections don't render.

### Added

- **"Fresh off the press" divider on the beanstalk.** A small zine-style ornament now sits between the masthead and the latest-issue card on `/blog` — thin Heritage Orange rules fading in from each side, bracketing a Fraunces-italic label flanked by two accent dots. Replaces the previous "card butts up against the hero" layout.
- **New family-reading illustration on the family library.** `/guides` now leads with a warm family-reading scene (dad + three beanies gathered around a book) sitting on a soft multi-stop radial halo. Gentle bob animation, redesigned from an absolute-positioned corner sticker into a proper two-column flex so nothing clips on mobile.
- **Themed date + time pickers across the app.** New `BeanieDatePicker` and `BeanieTimeInput` components replace every native date/time field. Both use the same pill vocabulary as the existing preset-time picker: filled Heritage Orange when a value is chosen, slate when empty, Outfit font. Date picker has a calendar popover with Today/Tomorrow quick chips and respects your **Week Starts On** setting. Time picker opens a themed 3-column popover (Hour · Minute · AM/PM) with Now/Clear shortcuts — no more generic browser UI.
- **Smaller, cleaner reschedule + activity forms.** The reschedule modal and new-activity flow no longer squeeze date + start + end time into one row when it's tight — date gets its own line and the times sit below, so nothing clips.
- **Compact "+1 day" toggle on flight/train arrivals.** Replaces the wider checkbox + label with a small orange toggle pill, letting arrival time match departure width.

### Changed

- **Beanstalk mascot on mobile is now a watermark.** The tall mascot used to stack above the title on phones and push the pitch + featured card past the fold. It now sits behind the masthead text at low opacity, keeping the brand hello visible without consuming any vertical space.
- **Refreshed subtitles on the three existing beanstalk posts** so each card carries its own one-line hook under the title (Substack-style).
- **Cleaner beanstalk mascot asset.** Swapped the previous background-removed PNG for a fully transparent version — no halo around the character on the hero gradient.
- **Picker popovers teleport out of their parent** so segment cards and modals with clipped overflow no longer cut off the bottom of the calendar or time columns. They reposition on scroll/resize and flip up when they'd overflow the viewport.
- **Quick-edit date/time fields on travel segment cards** now use the themed pickers inline, with the night-flight hint (🌙 early morning / late night) kept alongside.
- **Family library hero copy.** `/guides` now reads "a guide to family organization · in order" (was "a reading curriculum · in order") and opens with "how do we go from feeling overwhelmed to feeling in control?" instead of the declarative version. The reading-time stat is cleaner ("X min reading time" rather than "~X min total · a lifetime to practice"), and the footer credits claude-bot for research help.

## 2026-04-23

### Added

- **The family library — guides landing page redesign.** `/guides` is now an e-zine-style landing with a Fraunces-italic hero, a four-station curriculum arc, and a 2×2 grid of chapter covers. Each pillar gets its own palette + background texture (swirl, grid, ledger rules, circuit traces), a "what's inside" bullet list pulled live from the guide's section titles, a reading-time badge, tag chips, and a slate "read chapter N" CTA. Pillar 1 carries a "start here" ribbon. `ItemList` + `CollectionPage` structured data added for AI crawlers.
- **"family library" in the top navigation** — added next to **beanstalk** so the curriculum has a persistent entry point everywhere on the site. Collapses into the hamburger menu on narrow screens.
- **Hamburger menu on narrow screens.** Below ~820px width, the pill nav swaps to a clean hamburger + full-width dropdown that slides down from the top. All destinations (my story, security, beanstalk, family library, help) + sign-in + primary CTA are available in generously-sized taps. Desktop keeps the full pill nav exactly as before. Escape, overlay click, or orientation change all close the panel.
- **FAQ + Glossary shipped to prod** with their new reference-book look. FAQ: sticky category sidebar with scroll-spy highlighting, filter-as-you-type input, tint-striped category sections, numbered Q cards, footer "get in touch" CTA. Glossary: sticky A–Z jump strip (inactive letters dimmed), alphabetical sections with oversized italic dropcap letters, "core" ribbons on the five foundational terms (beanies.family, pod, .beanpod, local-first, E2EE), and computed "see also" chip trails that surface cross-references already present in the definitions.
- **Four pillar guides shipped to prod.** The Overwhelmed / Family Organization / Family Finance Basics / Local-first Tools guides are now live at `/guides/<slug>` — four long-read pieces averaging ~3–4k words each with short-answer blocks, drop-caps, chapter eyebrows, sticky section rail on wide screens, reading progress bar, and "what to take away" recap cards.
- **Prev/next navigation at the bottom of every guide.** Two cream cards that walk the curriculum in canonical order (overwhelm → organization → finance → local-first), with a hairline top rule and serif titles. At the ends of the walk, the fallback points at the library.
- **Back-to-top button on guide pages.** Glass-disc control pinned to the bottom-right, matches the one on the homepage. Appears after 400px of scroll.
- **Quick reference section on the help index.** Two prominent feature cards (FAQ + Glossary) sit between the category grid and the popular articles block, each with its own emoji watermark, count badge, and gradient wash.
- **Close controls on the quick-add FAB sheet.** A subtle × in the top-right corner and a wider "close" pill at the bottom. The back gesture / device back button / browser back button all now dismiss the sheet (previously did nothing) — the sheet pushes a history entry on open and pops it on close.
- **Quick-add FAB (#37).** A floating "+" button pinned to the bottom-right of every page opens a grouped sheet with 19 add actions spread across four sections — Everyday (Activity, To-do, Transaction, Trip, Cook log, Saying), Family, Money, and Care. Tap anything to land directly in its add form, no matter which page you were on. The button itself is a hand-authored peek-a-boo beanie SVG that themes for dark mode via a single CSS variable. Hidden on Settings / Login / Welcome / 404.
- **Context-aware pre-fill.** When you're on a bean's detail page and tap Saying (or Favorite, Note, Medication, Allergy), the add form opens with that bean already selected. Same for Cook log when you're viewing a specific recipe. No picker step needed.
- **Inline bean picker.** If you tap a bean-specific action from anywhere else (like the Dashboard), the sheet expands directly below the section you tapped with a tile grid of family beanies. Pick one and the add form opens with them pre-selected. Pets are filtered out. Re-tapping a different action updates the picker in place.
- **Recipe + medication pickers.** Tapping Cook log without a recipe in context, or Dose log without a medication, swaps the sheet to a full picker view with a scrollable list — recipes show their polaroid thumbnail, medications show which beanie they belong to. Dose log picks + confirms a dose in one flow without any page navigation.
- **Empty-state guidance.** Tapping Trip idea when you have no trips yet shows a warm "add a trip first" prompt with a one-tap jump into the trip wizard. Same pattern for empty bean / recipe / medication pickers.
- **Stale-link guard.** If a deep-linked `?action=…` URL lands on a page that hides the FAB (e.g. Settings), the query is stripped and a friendly toast explains the menu isn't available there — no silent swallow.

### Changed

- **Top navigation polish.** Added "family library" to the main nav. The footer's main link row now carries **beanstalk · family library · help · faq · glossary · sign in**; privacy + terms moved into a smaller fine-print row alongside the copyright, matching the classic legal-strip convention. The GitHub link was dropped from the footer since the homepage already surfaces GitHub prominently.
- **Contact CTAs unified on the Slack-backed modal.** Every non-coding feedback surface — FAQ intro / empty-state / footer, glossary footer, homepage story, and the "Can I give feedback" FAQ answer — now points at the existing "get in touch" modal (the one opened by the footer's `💬 get in touch with me` button) instead of suggesting a GitHub issue. GitHub issues are reserved for actual coding problems from here on.
- **Em-dashes swept out of long-form content.** Every `—` and `–` in the four pillar guides + the welcome-to-the-beanstalk blog post was replaced with a plain ASCII hyphen — em-dashes read as an AI-writing tell, and the content should feel human.
- **Guide library chapter numbers dropped the leading zero.** "chapter 01 / 02 / 03 / 04" is now "chapter 1 / 2 / 3 / 4" — reads more naturally. The curriculum arc circles follow suit.
- **Quick-add FAB tightened.** Removed the **Recurring** tile from the Money group; it was redundant with **Transaction** (both landed in the same drawer, and the recurrence toggle inside is one click away). Money now shows 4 tiles.
- **Smooth scroll across the marketing site.** Anchor clicks and table-of-contents jumps now glide to their target instead of snapping, matching the homepage's existing feel. Respects `prefers-reduced-motion`.
- **Unified the "add from deep link" flow.** The bean-tab-specific `?add=1` query shortcut is replaced by the FAB's richer `?action=<name>` intent system. User-facing behavior is unchanged; under the hood, all Bean tabs + the Pod index pages now consume intents through one composable with proper error handling (unknown actions surface a toast; handler exceptions are caught and reported).

### Fixed

- **Guides library page was rendering blank cards on prod.** An invalid `:not(::after)` selector clause was silently killing the CSS rule that brought pillar-card content above a texture overlay, leaving every card empty.
- **FAQ + Glossary answer links now show the correct orange-underlined styling.** Scoped CSS wasn't reaching the inline HTML in answers/definitions; flipped the style blocks to `is:global` with every selector namespaced under the page root.
- **Mobile header no longer overflows the viewport** — replaced by the hamburger + dropdown design described above.
- **Recipe detail "back to the cookbook" double arrow.** A literal `←` was baked into the translation string while the button also rendered a chevron-left icon; removed the literal arrow so the icon owns the single visual cue.
- **Guide first-bullet alignment.** When a section started with a list rather than a paragraph, the drop-cap floated into the list's vertical space and pushed only the first bullet's marker to the right. Fixed by containing the drop-cap float to its paragraph box via `display: flow-root`.
- **Guide heading line-wrapping** — titles and subtitles were wrapping after a few words because `overflow-wrap: anywhere` was applied at the guide-prose root. Moved the aggressive wrapping to paragraphs only; headings break on word boundaries.
- **List markers (bullets and numbers) were missing** on guide pages because a Tailwind preflight reset was stripping `list-style`. Re-applied explicit `list-style: disc/decimal` inside guide prose with Heritage-Orange markers.
- **Spacing between counts and the following word** on FAQ + Glossary ("6questions" / "3terms") — Astro was collapsing the literal space between adjacent `{expr}` interpolations; fixed with a template-literal expression.

---

## 2026-04-22

### Changed

- **Pillar guides redesign — tier 1 (prototype on pillar 1, not yet live in prod).** The first of four pillar guides (`/guides/overwhelmed-family-planning`) now renders with a family-zine editorial treatment: "TL;DR" answer cards on each section (the existing short-answer blocks promoted from inline bold to distinctive kraft-paper cards with a Heritage Orange rail), gradient drop-caps on the first paragraph after every heading, "CHAPTER 01/02/03…" eyebrows above each heading, a numbered-chapter table of contents, a sticky section rail on wide screens (≥1200px) that highlights the section you're currently reading, a thin reading-progress bar at the top, and a Deep Slate "what to take away" recap card at the end of the guide. Body prose switches to the Fraunces serif typeface for long-read warmth; display + metadata stay in the existing Outfit. All changes are in the shared template, so the other three pillars will inherit the treatment once their `keyTakeaways:` frontmatter is populated. Guides remain `draft: true` and are not live in prod — preview via `npm run dev:web`.

### Fixed

- **Net worth chart now reflects manual balance adjustments.** Previously, when you manually edited an account balance (or any other balance adjustment recorded against an account), the historical net worth chart on the dashboard silently dropped the adjustment from its replay — so a $500k bump made yesterday would render as a flat line at the new amount across the entire chart history. The chart now correctly shows the step where the adjustment happened, with the prior history reflecting the pre-adjustment balance. Adjustments on credit-card or loan accounts move the line in the opposite direction (since balance changes there mean debt changes).
- **Net worth chart now respects when accounts and assets were created.** Adding a new account or asset today no longer makes it appear at its current value across the entire historical chart. Pre-creation chart points correctly omit the entity, so adding a $10k savings account today produces a step up at today rather than a flat line. Buying a $500k house with a $200k loan added the same day shows zero retroactive contribution (the asset and the linked loan account cancel each other out before that date).
- **Net worth chart now accounts for principal vs interest on loan payments.** Loan payments split into a principal portion (which reduces debt) and an interest portion (which is real cost). Previously the chart only reversed the cash side of a loan-payment expense, so historical net worth was overstated by the cumulative principal you'd paid. Now reflects the principal payback against the loan balance correctly — the chart only "drops" by the interest portion at each payment.
- **Reports "Income vs Expenses" chart no longer counts transfers and balance adjustments as expenses.** The bar chart's per-month aggregation was treating every non-income transaction as an expense via a binary classification — so a $500k positive balance adjustment would render as a $500k expense for that month, and every transfer between accounts would be double-counted. Income, expenses, and net cash flow stats on the Reports page also self-correct.
- **Activity feeds now show a distinct icon for manual balance adjustments.** The Nook "Recent Activity" card and global search results were rendering balance-adjustment transactions with the credit-card / expense icon. Adjustments now use a scale (⚖️) icon, with the tint reflecting the direction (green for positive, orange for negative). Transfers also pick up a distinct arrows icon and blue tint.

### Changed

- **More informative chart errors.** When the dashboard net worth chart can't render due to an unexpected error (data corruption, missing exchange rates, etc.), it now shows a brief "Could not render net worth history. Check the console for details." message in place of the silent empty state, while logging the underlying error to the console.

---

## 2026-04-21

### Added

- **Goal activity log + quick-contribute flow.** Tap a goal card to open a new read-only drawer showing progress, priority, deadline, and a chronological log of every contribution — automated transactions routed toward the goal and manual contributions you report outside the tracked system. A prominent **Contribute** button in the footer opens a lightweight modal where you enter an amount and an optional note about where the money came from ("mom's birthday money", "bonus", etc.). Crossing 25 / 50 / 75 / 100% of the target fires a celebratory moment; a Contribute that's tapped by mistake can be reversed for 6 seconds via an **Undo** button in the success toast. Manual contributions also get an inline trash icon in the activity log for persistent delete with confirmation. Clicking "View all →" from a goal's activity log filters the transactions page to that goal.
- **Goal edit form: "Current amount" → "Remaining amount".** The field is now labeled by what you have left to save rather than what you've accumulated — more intuitive for savings and debt-payoff goals alike. Reducing the remaining amount records as a positive contribution on the activity log.
- **Account activity log + manual balance audit trail.** Tap an account card to open a new read-only drawer showing balance, institution, and a filterable, date-grouped log of every credit, debit, and balance correction on the account. Filter chips let you narrow to Manual / Recurring / Loans / Goals / Transfers. Tap any row to jump straight to the transaction's detail view. Transfers appear in both source and destination accounts' logs with a direction arrow. Linked-to-asset accounts still redirect to the Assets page.
- **Manual balance edits now leave a paper trail.** When you change an account's balance by hand, a dedicated "balance adjustment" entry is recorded with the signed delta, the date, and which family member made the change. These entries show as `Adjusted by {name}` in the activity log (or "Adjusted by you" for your own edits). They're read-only — if a past correction needs tweaking, create a new adjustment instead. Balance adjustments are **excluded from all income/expense totals**, budgets, and dashboard summaries since they're corrections, not cash flow.
- **Account column on the transactions page.** At tablet+ widths, each transaction row now shows which account it belongs to as a small member-colored pill. Transfers render as `Main Checking → Savings`. On mobile, the account name appears inline under the description. Clicking "View all →" from an account's activity log filters the transactions page to that account (with a dismissible pill to clear the filter).
- **Close button on the medication view drawer.** The drawer now has a neutral **Close** button paired with the primary **Log a dose** button in the footer, matching the Cancel/Save convention used on other view-edit modals across the app.
- **Ended medications now tuck into a collapsible history section.** On each bean's medication tab, active medications stay in the primary grid while ended ones collapse into a **📋 Ended medications** section with a count pill — matches the pattern used for completed goals on the Goals page. Collapsed by default so current meds don't compete for attention with history; tap the section to expand.

### Changed

- **Tapping a goal card opens a view, not an edit.** Same pattern as accounts / medications / activities / todos. The pencil (✏️) icon on the card still opens the edit form directly; the primary footer action on the new drawer is Contribute, and edit now lives as a pencil icon in the drawer header.
- **Tapping an account card opens a view, not an edit.** Matches how medications, activities, and todos already behave — the card opens a read-only detail view first, with the pencil (✏️) icon still opening the edit form directly. The Edit button inside the view modal takes you straight into edit mode.
- **Transactions page header: "Family" → "Who".** Short, clear label for the member column on the transactions table.
- **Sidebar sub-navigation stays tight.** The Pod's sub-items (Meet the Beans, Scrapbook, Cookbook, Care & Safety, Emergency Contacts) now auto-collapse when you navigate away from `/pod/*` and auto-expand when you're inside it. You can still pin the sub-nav open on any page via the chevron — it just re-collapses the next time you move into a different top-level section. Paired with a small density tightening on the nav items themselves, the sidebar no longer overflows on typical laptop viewports.
- **About Greg page bio refresh.** Sentence-cased the opening copy and added a mention of vibe coding among the topics covered on the beanstalk blog.

### Fixed

- **Joiner Drives no longer get an empty `beanies.family` folder at sign-in.** Previously, opening the "Load from Drive" view eagerly created the app folder on every user's Drive — which was wasted for anyone about to accept an invite and load a pod shared from someone else's Drive. Sign-in listing now searches globally for `.beanpod` files with no folder-creation side effect; the folder is still created on-demand when you actually create a new pod or upload a photo.

### Changed

- **The medication detail view is now a right-side drawer** (instead of a centered modal), matching the app's convention for view/edit surfaces. The primary action "Log a dose" lives as the drawer's save button; its confirm dialog stacks cleanly on top.
- **"I gave this dose" → "Log a dose"** — shorter, clearer action label across the card quick-action and drawer CTA.
- **Dose-log flow is always a confirmation.** Tapping 💊 now opens a dialog that shows today's doses for the medication (or "No doses logged today yet"), plus an editable date + time defaulting to now. Future values blocked. Supports retroactive logging for doses you forgot to mark, and prevents over-dosing by showing you the last-given time before you confirm.

### Fixed

- **Tapping anywhere on a calendar activity's location field now opens Google Maps.** Previously tapping the location text opened a quick-edit box while only the pin icon opened the map — inconsistent. The whole field is now the map tap target; editing the location moves to the main **✏️ Edit** button. Consistent with the travel-plans pattern.

### Added

- **Medication view modal + one-tap dose log.** Tapping a medication card now opens a read-only detail view with the bottle photo up top, who it's for, and the dose/frequency meta. A big orange **"I gave this dose"** button records an administration entry with a single tap — date, time, and the signed-in family member are captured automatically. A recent-doses list sits below the button so everyone can see who gave the last dose and when. An **Undo** button appears in the success toast for a few seconds in case the tap was a mistake. If you'd already logged a dose for the same medication today, a friendly confirm asks "Already given today — do you want to log another dose?" before adding a duplicate, so multiple caregivers can't accidentally double up. A 💊 quick-action button on each medication card lets you log a dose without opening the modal for meds you give often. Ended medications hide the dose button and CTA entirely — no accidental logging on a med the family has stopped. Past entries can be removed via the trash icon on any row. Edit is still reachable via the ✏️ button inside the view modal, routing to the existing edit drawer.

### Changed

- **Deleting a medication now also removes its dose history.** Previously there was no dose history to cascade; now there is, and the delete confirmation explicitly tells you the history will go with it. Done in a single atomic CRDT change so the doc never holds orphan log entries.

### Fixed

- **Editing one travel segment's date no longer overwrites a different segment.** Inline-editing a date on any travel-segment card (flight, train, activity, car) was corrupting another segment's date — typically the earliest travel segment in the trip. Root cause was a Vue template-ref collision: every travel-segment type uses `departureDate` as its date field name, so the hidden-picker refs all piled into the same array and the "open picker" helper always opened the first one. User's intended edit would then fire on the wrong input, saving the new date onto the wrong segment. Refs are now scoped per segment (`input-<segmentId>-<field>`) so each card owns its own picker. If you had a date go sideways on a recent inline edit, you'll want to check the affected segment and restore it.

### Changed

- **The "today" marker on the trip timeline is now the date header itself.** Previously, on days when you had travel segments scheduled, the pulsing orange "TODAY · Wed Jun 5 · DAY 4 OF 10" banner sat above a second, duplicate `DAY 4 · Wed Jun 5` row with a calendar-icon circle — two rows saying the same thing. The banner now stands in for both: it replaces the calendar-icon circle and the date header for today's group, so you get one clear focal point on the rail regardless of whether today has segments or is a free day. Past and future days keep their usual calendar-icon circles.
- **Today's segment connector dots now echo the banner's Heritage Orange.** The tiny dot + short horizontal line that tether each segment card to the timeline rail used to be teal on every day; today's segments now render them in Heritage Orange (at slightly higher opacity so they actually register). Attention flows down the rail from the prominent pulsing banner, through the quieter orange connectors, into the neutral card content — a small nudge that ties today's segments visually back to the banner.

---

## 2026-04-20

### Added

- **Activity cards on the mobile timeline now show who it's for and where.** Small colored initial-circles (up to 3, matching each Beanie's color, stacked with a slight overlap) sit at the top-right of each card. Location appears inline after the time as `· 📍 <location>`. Works on both timed cards and the all-day row; hovering a circle shows the full name.
- **Tapping a day on the monthly calendar now opens that day's full timeline** instead of the agenda sidebar. The agenda view is still reachable via a new **Agenda** button in the daily view's nav bar (next to Today). Weekly-view day clicks also drill in, for consistency.
- **Richer loading spinner.** The "counting beans" loading state has been rebuilt: the beans breathe on their spin (subtle scale pulse), cast an animated color-cycling glow (orange → teal → terracotta), and sit in a soft orange halo that fades cleanly into the page. The label gained a gradient sweep through the brand palette, and the static ellipsis is now three bouncing dots — one per brand color — staggered around the baseline where a real ellipsis sits. All animations respect `prefers-reduced-motion`.

### Fixed

- **Pets now show "Pet Beanie" on the Bean detail page.** The role line under a Bean's name (and the "Role" row in their About ribbon) used to fall through to "Parent Bean" for pets because the logic only checked `ageGroup`. Both surfaces now check `isPet` first and match the label already used on the Family Nook row.
- **Tablet (iPad / small-laptop) view of the activity calendar no longer overflows.** At 768–1023px, the member-name pills on activity cards used to wrap below the time label and spill past the bottom edge of short (30-min) cards. Cards are now a clean two-row layout (title / time · location · assignee dots) and the name pills swap for the same compact initial-circles used on mobile. Desktop above 1024px keeps the full name pills.
- **Mobile daily view no longer duplicates the member filter.** The in-view Beanie pills inside the daily timeline were redundant with the page-level filter at the top of the planner, and looked cramped on phones. Removed the duplicate; the mobile timeline now follows whatever the page-level filter has set (same as desktop column-hiding).
- **Help article links to `app.beanies.family` now render as actual links.** Four mentions in the Getting Started and PWA install articles rendered as plain text; they're now proper clickable anchors that open in a new tab.
- **PWA install guide reminds you you don't need to sign in first.** A short note on step 1 of each device section so you don't sign in on the web page and then again inside the installed app.

### Changed

- **Spinner refinements based on feedback.** Scaled back the orange halo (wider, softer, no hard disc edge) and dropped the dashed orbit ring so the loading state reads as atmosphere rather than chrome. Dropped the ellipsis dots from mid-line to baseline so they sit where a typographic "…" would.

### Fixed

- **Moving a flight no longer silently shrinks your trip.** Trip start/end dates are now user-owned rather than derived from segment dates on every save (see ADR-023). Changing an outbound or return flight within your trip window leaves the trip unchanged; changing one _past_ the window extends the window. The only way to shrink is a manual date edit on the trip summary page. This fixes the "orphaned accommodation" error greg hit when moving a flight later — the hotel was never orphaned, the trip had silently contracted around it.

### Changed

- **Multi-line fields are now actually multi-line across every travel form.** Address, notes, agency-address, description — anywhere a user would reasonably type more than one line — used to be a mix of `<input>` and `<textarea>` depending on which form you opened. The wizard used textareas for some, the edit modals used single-line inputs for the same fields, and styling drifted between them. Now everything routes through one new shared `<BaseTextarea>` (3 rows for notes + descriptions, 2 rows for addresses). Same border, padding, focus ring, dark-mode treatment across the wizard's inline editor and the post-creation edit modal — so an "address" field looks and behaves identically whether you're creating a hotel in the wizard or editing one afterward.
- **Long text on the trip timeline now expands cleanly instead of being jammed into a single-line input.** Notes, description, location, and address fields on each segment card used to render as a single-line inline-editable `<input>` — fine for a short street address, unreadable for a multi-line note or anything longer than the column. They're now display-only, line-clamped to 2 lines by default, with a **SHOW MORE ↓** toggle that appears only when the text actually overflows. URLs in the text autolink safely (escaped first, then wrapped in `target="_blank" rel="noopener noreferrer nofollow"`; trailing sentence punctuation stays outside the link). Editing still lives on the ✏️ button on the card header, which opens the full edit modal — one clean path for editing, one for reading.
- **Flight and cruise segment editors now surface trip-shape fields first.** The flight edit modal starts with a single prominent row of Date | Departure airport | Arrival airport — the three fields every flight needs regardless of booking status — then a "Booking details" caption groups airline, flight number, times, and booking reference. Cruise gets the same treatment (embarkation + disembarkation dates + departure port on top). Field order now matches the mental model: "what shape is this leg?" first, "who did I book it with?" second. Wizard inline carries through the same asterisks-when-booked behavior from the prior fix.

### Added

- **"You are here" marker on the trip timeline.** When today falls inside your trip window, the timeline now shows a Heritage Orange rail marker at today's position — a single horizontal bar with `TODAY · Wed Jun 5` on the left and `DAY 4 OF 10` on the right, with a subtle pulsing diamond on the rail to say "this is live." If today has no segments, the marker calls it out as a "free and easy" day so you know it's not an error. Past days on the timeline dim to `opacity-55` with a hint of desaturation; today's date node switches its connector ring from teal to Heritage Orange so the transition from past to future is unmissable. Open the app mid-trip and you see today's plan at a glance.
- **Day-number prefix on every timeline date header.** Each date group now reads `DAY 3 · WED JUN 5`, giving a trip-relative reference that pairs with the "you are here" marker.
- **Trip dates display + click-to-edit at the top of the trip summary.** The date range now sits in a chip at the top of every trip's detail view; tapping **Edit dates** reveals the same start/end pickers used in the wizard (with the quick-add chips), and committing hits the store directly. `aria-expanded` / `aria-controls` wiring keeps the interaction accessible. Cancelling restores the previous values.
- **Out-of-range warning banner on the trip summary.** When any segment falls outside the trip window, an amber banner above the timeline shows the count and the current date range, with a **Show me** button that smooth-scrolls to the first misaligned segment. Per-segment amber badge surfaces on the card itself via the existing hint system — two layers of awareness for the same facts.
- **Trip start/end dates as first-class wizard Step 1 fields.** Creating a new trip now asks for start + end dates upfront — required to advance past Step 1. Below the two date pickers, three quick-add chips ("+3 days", "+1 week", "+2 weeks") set end from start in one tap; both dates remain manually editable. Below the inputs a live summary reads "Jun 1 → Jun 10 · 10 days". Validation messages are wired for screen readers via `aria-describedby`.
- **Segment dates auto-populate from the trip window on add.** Round-trip flight → outbound gets trip start, return gets trip end. Cruise → embarkation/disembarkation filled. Train/ferry/car → departure. First accommodation → check-in/out. Rental car / shuttle → pickup/return. Activities still pick their own day. Users can always override after prefill; existing dates on a segment are never overwritten.
- **Out-of-range segments now raise a visible amber hint.** If any segment's date falls before the trip start or after the trip end, the per-segment hint banner explains which side it's on. Uses the existing `computeTimelineHints` surface — one rendering path for all "something's up with this segment" states.

### Fixed

- **Travel plan segment modals no longer fire the "required" error state the moment you open them.** Opening a booked flight, cruise, or accommodation in the editor used to immediately paint empty booking-contingent fields (airline, ship name, confirmation number, etc.) with an orange error ring, even before you'd tried to save. The ring now only fires on a save attempt. In the meantime, an asterisk beside the label tells you which fields _will_ be required — so the same signal is there, just not shouting. Applies across the Flight/Cruise/Train/Ferry/Car/Activity segment editor, the Accommodation editor, and the Transportation editor.

### Changed

- **Renamed session-bracket skills.** `/start-of-day` → `/start-session`, `/end-of-day` → `/end-session`. Triggers broadened to cover switching machines and clearing context, not just day boundaries. `/good-morning` still works as the morning alias (symlink preserved).

### Fixed

- **Avatar photos now render on every surface that shows a member.** Seven call sites (Nook row, dashboard row, app header trigger + 3 dropdown slots, member filter dropdown trigger + option rows, login picker grid + selected card, settings profile header, accounts page section + row, goals page section) were passing `:variant` and `:color` to `<BeanieAvatar>` but skipping `:photo-url`, so the SVG fallback rendered even when the member had a real avatar. All wired up to a new shared helper.

### Changed

- **Consolidated "Your Beans" row into one component.** NookYourBeans + FamilyBeanRow were 90% identical (same structure, events, avatars, role labels) — and had drifted in three separate bugs today (pet sort, pet role label, missing photo-url). Extracted to `BeanListStrip` with `labelKey` / `addLabelKey` / `density` props. FamilyNookPage and DashboardPage now mount the shared component; both deleted files.
- **Shared `getMemberAvatarUrl` / `markMemberAvatarError` helpers** in `useMemberInfo`. Every avatar call site now uses the same two-liner — future rosters can't reintroduce the missing-photo bug by forgetting to wire the URL.
- **Tapping a bean on the Nook row opens the Meet-This-Bean overview** (`/pod/<memberId>`) instead of the edit modal. Dashboard row unchanged (still goes to `/family`).

### Fixed

- **Pet role label on "Your Beans" rows.** The grey role label under each avatar on the Nook and dashboard Family Bean rows fell back to "Parent" / "Big Bean" for pets because the mapping only checked `role === 'owner' || ageGroup === 'adult'`. Now pets show **"Pet Beanie"** (English) / **"pet beanie"** (beanie mode) — matching the role pill in the Add/Edit Beanie drawer. Extracted the role-label helper into a single shared `getMemberRoleLabel()` in `useMemberInfo` so the two components (and any future rosters) stop duplicating the same 5-line switch.

- **Pets now sort last everywhere, including on the Nook.** The earlier fix put pets last in `sortedMembers`, but five surfaces were iterating `familyStore.members` directly (unsorted) or `familyStore.humans` without sorting. Fixed NookYourBeans, FamilyBeanRow, MeetTheBeansPage, FamilyScrapbookPage member-filter chips, and PickBeanView login picker to use `sortedMembers` / `sortedHumans` consistently.

### Changed

- **Pets sort last in every member list.** The family-member sort is now a three-tier order: adults (oldest → youngest) → children (oldest → youngest) → pets (oldest → youngest, then alphabetical). Applied at the single source of truth (`familyStore.sortedMembers`), so every surface that lists members — Meet the Beans grid, Family Nook row, Scrapbook feed, member chip filters, calendar columns, etc. — picks up the new order automatically.

### Fixed

- **PhotoViewer lightbox layout + always-visible close button.** On mobile the read-only lightbox left a white gap below the photo (body's padding was visible + the black container maxed at `min-h-60vh`), and with no header + no footer there was no close affordance — only tapping the backdrop dismissed it. Added a `flushBody` prop to `BaseModal` that drops the body's default `overflow-y-auto p-6` for edge-to-edge media content, and an `overflow-hidden` on the modal wrapper so flush content clips to the rounded corners. PhotoViewer now passes `flush-body`, fills the body with `h-full bg-black/95`, and renders a floating X close button in the top-right of the black container that's always visible regardless of mode (read-only avatar lightbox or editable medication/recipe viewer).

### Added

- **Tap a family member's avatar to see it full-size.** On the Add/Edit Beanie drawer (next to the avatar picker) and on the Meet-This-Bean hero, tapping or clicking an avatar photo now opens it in a read-only lightbox — same component used for medication and recipe photos, same zoom-in cursor on hover. Tapping the default beanie SVG (no photo yet) is inert. Edit controls stay next to the picker and behind the ✏️ Edit button respectively so there's only one path to each edit action.

### Changed

- **Photo rendering switched to `lh3.googleusercontent.com`.** Freshly-uploaded photos (including brand-new avatars) were failing to load with the previous `drive.google.com/thumbnail?id=...` URL — Drive hasn't generated a thumbnail for a file yet at upload time, and `drive.google.com/*` URLs can also bounce anonymous loads to a sign-in interstitial even for anyone-with-link files. Switched every `getPublicUrl` call site to Google's image CDN (`lh3.googleusercontent.com/d/{id}=w{N}`): works immediately for fresh uploads (falls back to serving original bytes when a thumbnail isn't ready), no session sensitivity, same size-modifier support for server-side resizing.

### Fixed

- **Family member avatar now has a visible Remove button.** The avatar picker's Remove action used muted-gray text on a light drawer background — technically visible, easily missed. Restyled to the destructive red treatment used elsewhere (`border-red-300 text-red-700`, dark-mode equivalent) so it reads at a glance as "remove this photo."

- **PhotoViewer footer buttons are visible.** The Remove / Download / position-label elements in the full-screen photo viewer (opened from medication, recipe, and other photo surfaces) were styled for a dark image-overlay background — `text-white/80`, `text-red-300`, `text-white/60` — but the BaseModal footer they actually render inside is `bg-gray-50` (light mode) / `bg-slate-900` (dark mode), so those classes disappeared into it. Destructive Remove button now uses `border-red-300 text-red-700 hover:bg-red-50` with a dark-mode variant; Download stays neutral gray with proper contrast; position label reads clearly in both themes.

- **Family members can see photos uploaded by others — via public-link rendering.** Empirical test of the folder-Picker recovery banner (shipped earlier today) revealed it doesn't actually solve the problem: picking the `beanies.family` folder via Drive Picker does NOT extend `drive.file` OAuth scope to files created by other users inside it. Joined members kept 404ing on photos even after reconnect. Root architectural fix: every photo upload now sets `anyone-with-link → reader` permission on the Drive file, and rendering uses direct Drive CDN URLs (`drive.google.com/thumbnail?id=...&sz=wN` for thumbs, `drive.google.com/uc?export=view&id=...` for full). No OAuth token required to fetch bytes. A one-time migration sweep (`useEnsurePhotosPublic`) runs per-session when the `.beanpod` file ID resolves, iterating every photo in the Automerge doc and setting the permission; per-photo 403 (not this user's file) skipped silently — the file's owner runs the sweep on their own device. Privacy model: URLs live in the encrypted Automerge doc (family key required to decrypt), so effective exposure is the same trust boundary as every other piece of family data. Rolled back the recovery banner machinery (Banner + composable + 25 translation keys) since public-link rendering means there's nothing to reconnect. Kept the folder-pick join flow and the shared `<ErrorBanner>` — both useful independent of this issue. Full scope + privacy analysis in [ADR-021](docs/adr/021-photo-storage.md).

- **Family members can see photos uploaded by others.** Joined members were 404ing on every photo their family uploaded. Root cause: the app uses the `drive.file` OAuth scope (per-file authorization), and the join flow picked the `.beanpod` file — which grants API access to that one file only, not to sibling photos in the same folder. Drive-level folder sharing gives drive.google.com UI visibility but not API access under `drive.file`. Fix has two parts: (1) the join flow now picks the `beanies.family` **folder** via Drive Picker, which grants `drive.file` scope to the folder and every descendant (`.beanpod` + all photos) in a single pick; (2) for family members who joined before this change, a new amber **"Some photos aren't loading"** banner appears when photoStore detects any broken photo, with a **Reconnect** action that opens the same folder picker and validates the selection against the current pod before clearing caches. Both paths share new `findBeanpodInFolder` helper + `useRecoverPhotoAccess` composable, and feed into a new shared `<ErrorBanner>` component that both `SaveFailureBanner` and the new recovery banner now use. Full scope discussion added to [ADR-021](docs/adr/021-photo-storage.md).

### Added

- **Take-photo button on mobile photo attachments.** On phones and tablets, the Add Photo affordance is now two side-by-side tiles — **Take Photo** (opens the rear camera directly via `capture="environment"`) and **From Library** (opens the gallery). Desktop unchanged (single **Add Photo** tile → gallery). Prior behavior suppressed the OS camera option on Android Chrome because `multiple` was hardcoded on, which forces gallery-only. The change applies to every photo surface in the app — medication bottles, cook-log dish snaps, recipe photos, and future integrations. Detection uses `matchMedia('(pointer: coarse)')` so laptops with touchscreens (where the trackpad is still the primary pointer) get the desktop UX, not the mobile one.

### Fixed

- **PWA update-on-nav reliably fires after an overnight tab sleep.** The prior implementation installed the route guard only after a 60-second grace timer — which reset every time `needRefresh` flipped true. When a tab sat overnight and the new version was detected on wake (via the `visibilitychange` handler), the grace clock started fresh, so the user's first click slipped through before the guard armed and the update never applied. The grace timer is now gone: the guard arms the instant an update is detected and defers the reload only while a modal/drawer is open or a Drive save is in flight, so clicking nav never interrupts a mid-edit or an in-flight save. Also fixed a pre-existing bug where dismissing the update banner tore down the guard — dismiss now only hides the UI.

### Changed

- **Friendlier copy on the pet hint** in the Add/Edit Beanie drawer: "Pets are part of your pod, but don't ask them to sign in — they're notoriously bad at using computers." (Replaces the prior matter-of-fact "Pets are part of the pod but can't sign in, get invites, or manage anything.")

### Added

- **Clickable Bean Overview modules.** Each of the five overview modules (Allergies, Favorites, Sayings, Medications, Notes) on the Bean Detail Overview tab is now a keyboard-reachable button card — click anywhere, or press Enter/Space when focused, to jump to the matching tab. Previously only the small "View all →" link was actionable.

### Fixed

- **Medication active-state timezone bug.** Medications with a `startDate` of "today" could flip to **Ended** for users east of UTC — the `isActive()` check compared form dates (local) against `new Date().toISOString().slice(0,10)` (UTC). Consolidated three drift-prone copies (medicationsStore / MedicationCard / BeanMedicationsTab) into a single `isMedicationActive()` helper that uses local-today via `toDateInputValue`.
- **Sidebar "The Pod" expand/collapse on mobile.** The mobile hamburger menu's flat item mapper dropped `NavItemDef.children` entirely, so Pod's 5 sub-items (Meet the Beans / Scrapbook / Cookbook / Care & Safety / Emergency Contacts) were unreachable from phone. Rebuilt to mirror desktop's nested rendering via `useSidebarAccordion`; expand/collapse state now syncs across viewports via localStorage.
- **Pet avatar + role not rendering.** Five `getMemberAvatarVariant()` callers (BeanCard, BeanHero, FamilyBeanRow, MemberFilterDropdown, NookYourBeans) were cherry-picking `{ gender, ageGroup }` from member and dropping the new `isPet` flag — pets rendered as humans. Also hid the Member/Admin `MemberRoleManager` dropdown for pets on BeanCard (they have `role: 'member'` internally but no real access levels).
- **Care & Safety sidebar caps raised 5 → 6** with a "View all {N} →" overflow link to `/pod/safety` on the Heads-up / Today's Care cards, so medications beyond the fifth no longer disappear.
- **Invite modal skipped for pet saves.** The auto-open Invite modal after creating a family member now only fires for humans — pets can't receive invites.
- **Mobile responsiveness (two full passes).**
  - Round 1: 7 Pod hero headers (padding `px-8 py-7` → `px-4 py-5 sm:px-8 sm:py-7`), title `text-3xl` → `text-2xl sm:text-3xl` with leading-tight + break-words, inline buttons stack full-width at mobile.
  - BeanTabs — at mobile only the active tab shows its label; inactive tabs are emoji-only so all 6 fit without horizontal scroll.
  - Sayings rail cards `w-56` → `w-48` on mobile; StatStrip forces 2-col at mobile; BeanCard action icons bumped from 28 px → 36 px touch targets.
  - Round 2: 7 form modals' side-by-side grids `grid-cols-2` → `grid-cols-1 sm:grid-cols-2` so date / dose / phone-email pairs stack on 375 px; birthday picker uses weighted columns (`2fr_1fr_1.2fr`) so full month names fit; MedicationCard photo anchor `w-24 sm:w-28`.
- **E2E `invite-join` spec updated** for `/family` → `/pod` redirect and "Add a Beanie" → "Add Beanie" rename. Logged a webkit-only onboarding flake in `docs/E2E_HEALTH.md`.
- **Security lint unblock** — silenced a false-positive `security/detect-possible-timing-attacks` on `useFileDrop.ts`'s MIME-type equality check. This had been blocking the Security Scanning workflow (and therefore prod deploys) for ~15 pushes; deploys now green.
- **Pod overview sidebar card sizing + overflow** already noted above.

### Changed

- **Meet the Beans redesigned to the Pod overview mockup.** Unified header with kicker "The Pod · Family Scrapbook" + editable family name + one-line stats summary + inline **Invite Beanie** / **Add Beanie** buttons. Body switches to a pod layout (main column + 320 px right sidebar): bean cards sit in a 2-col responsive grid and read highlights directly from the content stores; Recent family sayings rail shows up-to-8 tilted pastel sticky notes; kraft-paper **Secret Family Recipes** strip surfaces up to 4 recipe thumbs + "Add a recipe" tile. Right sidebar replaces Family Stats / Events with **Heads up — Allergies** (severity-chipped list) + **Today's Care** (active meds) + compact Events-this-week.
- **About ribbon on Bean Overview** — moved from white card tiles with shadow to a single flat tinted ribbon (silk→slate gradient, thin vertical dividers, small 🫘 ABOUT kicker). Visually distinguishes informational facts from the clickable dashboard modules below.
- **Copy consistency** — "Add Bean" → **"Add Beanie"**, "Invite Bean" → **"Invite Beanie"**, pet role chip "🐾 Pet" → **"🐾 Pet Beanie"**, BeanCard heads-up label "Heads up" → **"Heads up — Allergies"**.
- **MedicationCard active-state colour** swapped from off-brand emerald to on-brand Sky Silk (#AED6F1).
- **Pets hidden from human-only surfaces across the app (#171).** Pets appear wherever they belong (Meet the Beans roster, scrapbook feed, member avatars, home Family Row, global search, milestones/birthdays, photo galleries) and are now filtered out of every surface where they'd be semantically wrong:
  - **Assignee pickers** — todos, activities, account/asset/goal owners, vacation travelers, onboarding activities. Fixed globally by filtering pets out inside `FamilyChipPicker` (used by every owner/assignee picker) and in the direct `memberOptions` map in `OnboardingFamily.vue`.
  - **Filter chips** — activity/todo/planner filter strips. Fixed globally by filtering pets out inside `MemberChipFilter`.
  - **Global member filter dropdown** (top of finance pages) — filtered at the `MemberFilterDropdown` options source.
  - **Finance member grouping** — AccountsPage "Group by member" sections, GoalsPage per-member sections, subtitle counts (Accounts / Goals). Pets never owned accounts/goals anyway; now they don't appear as empty sections either.
  - **Reports** — Financial reports member-filter dropdown now humans-only.
  - **Planner columns + member chips** — daily/weekly calendar views + FamilyPlannerPage filter panel.
  - **Todo page member chips** — FamilyTodoPage member filter strip.
  - **Cook log "who cooked this"** — CookLogFormModal dropdown humans-only.
  - **Login** — PickBeanView avatar grid (pets can't sign in). JoinPodView "unclaimed members" list filters pets explicitly (belt-and-suspenders; pets have `requiresPassword: false` so they were already excluded).
  - **Vote counts** — VacationIdeaCard's "everyone!" pill compares vote count to human count, not total members.
  - **Global filter store** (`memberFilterStore`) — scoped to humans only so `isAllSelected` doesn't flip off when a pet is added.

  Foundation: added `familyStore.humans` / `sortedHumans` / `hasPets` computed getters so every call site uses one consistent filter instead of hand-rolling `!m.isPet` checks.

## 2026-04-19

### Fixed

- **Mobile responsiveness — form modals + MedicationCard (round 2).**
  - 7 form modals (Saying, Allergy, Medication ×2 grids, CookLog, Recipe, EmergencyContact) had side-by-side field pairs using `grid-cols-2` at all breakpoints. On a 375px phone these fields shrink to ~140px each — dates and emails no longer fit. Switched to `grid-cols-1 sm:grid-cols-2` so paired fields stack on mobile and sit side-by-side from `sm:` up.
  - **Birthday picker** (FamilyMemberModal) was `grid-cols-3` with equal thirds — full month names ("September") clipped at mobile. Changed to `grid-cols-[2fr_1fr_1.2fr]` so month gets double width, day and year stay compact. Universal improvement — reads better at every viewport.
  - **MedicationCard** photo anchor narrowed from `w-28` to `w-24 sm:w-28` so the info column gets breathing room at 375px.
  - Verified: all 8 Pod form modals use `variant="drawer"` → BaseSidePanel → full-width on mobile already. FrequencyChips already uses `flex-wrap`. BeanOverview / Favorites / Sayings / Notes / Allergies / Medications tab grids all collapse to 1 column at mobile via `md:grid-cols-2` responsive modifier.
- **Mobile responsiveness across The Pod (round 1).** Full pass over every new Pod surface at the 375px baseline:
  - **Sidebar mobile nav** — "The Pod" is now expandable/collapsible on mobile (previously its 5 sub-items — Meet the Beans / Scrapbook / Cookbook / Care & Safety / Emergency Contacts — were simply dropped by the hamburger menu's flat item mapper). The mobile menu now mirrors desktop: tapping the chevron toggles the nested sub-nav, and `useSidebarAccordion` (module-scoped + localStorage-backed) keeps the expand/collapse state in sync across mobile and desktop.
  - **Hero headers** (Meet the Beans, Bean Detail, Cookbook, Scrapbook, Care & Safety, Emergency Contacts, Recipe Detail) — all dropped from `px-8 py-7` / `px-9 py-8` to `px-4 py-5 sm:px-8 sm:py-7` so they breathe at mobile instead of eating the viewport. Page titles shrink from `text-3xl` to `text-2xl` on mobile with `leading-tight` + `break-words` so long family names don't overflow.
  - **Header action buttons** (Invite Bean / Add Bean / Edit / "I cooked this" / Add Recipe) — stack full-width below the title on mobile and return to an inline row from `sm:` up.
  - **Bean Detail tabs (6-tab strip)** — at mobile, only the active tab shows its label; inactive tabs are emoji-only so all 6 fit without horizontal scrolling. Labels return from `sm:` up.
  - **Meet the Beans sayings rail** — sticky notes drop from `w-56` to `w-48` on mobile so two cards are visible at a glance on a 375px viewport.
  - **StatStrip** — forced to 2 columns on mobile (was 4 — stats were ~70px wide each), back to N columns at `sm:`.
  - **BeanCard action buttons** — bumped from `p-1.5` (~28px) to `h-9 w-9` (36px) touch targets.

### Added

- **Pet Beans.** Add your dog, cat, or other furry family member to the pod. The Add / Edit Bean drawer now has a third role pill — 🐾 **Pet Bean** — alongside Parent Bean and Little Bean. When Pet is selected, email and permissions fields disappear (pets never receive invites, sign in, or manage anything) and the avatar swaps to a cute beanie dog in the Heritage-Orange palette. Pets count toward the family total in stats and roster views, can have favorites / allergies / medications / sayings / notes like any other bean, and never show the amber "waiting to join" badge or the share-invite button. Uses a new `isPet` flag on `FamilyMember` (additive, non-breaking) plus a new `'pet-dog'` avatar variant backed by `public/brand/beanies_pet_dog_icon_transparent_350x350.png`.

### Changed

- **Meet the Beans — Pod overview redesign.** Page now matches the approved mockup: unified header with kicker ("The Pod · Family Scrapbook"), family name (editable), and one-line stats summary ("5 beans · 12 favorites · 9 sayings · 4 recipes · 2 active meds · 3 allergies"), plus inline **Invite Bean** + **Add Bean** buttons on the same row. Body switches to a pod layout (main column + 320px right sidebar): bean cards sit in a 2-col responsive grid and read their highlights directly from the content stores; a **Recent family sayings** rail shows up-to-8 tilted pastel sticky notes; a kraft-paper **Secret Family Recipes** strip surfaces up to 4 recipe thumbs + an "Add a recipe" tile. The sidebar replaces the old Family Stats / Events panel with a **Heads up — allergies** card (severity-chipped list across all beans) and a **Today's care** card (active meds across the family), with a compact Events-this-week list below.
- **MedicationCard — pharmacy-shelf aesthetic.** Medication cards now feature the bottle photo as a prominent left-side anchor when one exists; without a photo, a brand-colored capsule illustration on a prescription-paper gradient (diagonal hatching + "Rx" watermark) fills the slot so the card never feels half-empty. A 4px Sky-Silk spine on the left edge signals active state (slate when ended); the active/ended chip uses on-brand Sky Silk for active instead of the old emerald green.

### Added

- **The Pod (P6 — Family Scrapbook).** New `/pod/scrapbook` page merges favorites, sayings, and notes from every bean into a single newest-first feed. Pastel multicolor gradient hero with a faded 📖 watermark, filter toolbar (type chips + member chips + clear), CSS-columns masonry layout (3 → 2 → 1 col responsive), and a "Load more" button that appends 30 entries at a time. Sayings render as tilted sticky notes; favorites as category-emoji cards; notes as title + body clamps. Click any entry to jump to the owning bean's tab.
- **The Pod (P5 — Emergency Contacts).** New `/pod/contacts` page with a family phonebook for sitters, grandparents, or anyone minding the kids — doctors, dentists, teachers, schools, plus an "Other" category with a custom label (poison control, emergency pickup, etc.). Search across name/role/phone/email, filter chips per category with live counts, and a grouped list with inline call + email actions. The Care & Safety page now shows a real top-3 preview that routes to the full list (was a stub placeholder before).
- **The Pod (P4 — Family Cookbook + Cook Log).** New `/pod/cookbook` page holds the family's secret recipes — name, prep time, servings, ingredients, preparation steps, family notes, and up to 4 photos per recipe (placeholder illustration when none). `/pod/cookbook/:recipeId` is the recipe detail view with a "I cooked this today" action that opens the Cook Log form (5-star rating, what went well, what to try next time, optional dish photo). Cook logs roll up into per-recipe stats (times cooked, avg rating, last cooked) + a cookbook-wide stats band. A 5-star save fires a new `recipe-5star` celebration toast. Food favorites on a bean's Favorites tab can now link to a cookbook recipe and show a "🥘 From the Family Cookbook →" link-through.
- **The Pod (P3 — Care & Safety).** Allergies and Medications tabs on each bean are now fully editable. Allergy form captures type, severity, what to avoid, reaction, emergency response, diagnosed-by, last reviewed — severity drives a red/amber/green side-stripe and sort order. Medication form captures dose, frequency, start/end or "ongoing" toggle, notes, and an optional bottle photo (second production consumer of the photo foundation — photos land in `data/<familyId>/photos/` just like avatars). New **Care & Safety** page at `/pod/safety` gives a cross-family at-a-glance view: allergy count + severe count + active medication count, severity-sorted allergies across all beans, active medications across all beans, and a stub for Emergency Contacts (ships in P5).
- **The Pod (P2 — Bean Detail).** Each bean now has a dedicated detail page at `/pod/:memberId` with six tabs: Overview, Favorites, Sayings, Allergies, Medications, Notes. Clicking a bean card opens the detail page; the old edit drawer is still available via the new pencil button on the card. **Favorites, Sayings, and Notes** are fully editable: categorize favorites (food / place / book / song / toy / other), capture memorable quotes on pastel sticky notes with optional date + place, and jot freeform notes per bean. Allergies + Medications tabs show empty-state placeholders until Phase 3.
- **The Pod (P1 — foundation).** Sidebar restructured: "My Family" retires, "The Pod" (🌱) nests under Treehouse with five sub-items (Meet the Beans / Family Scrapbook / Family Cookbook / Care & Safety / Emergency Contacts). `/family` redirects to `/pod`. Sub-pages currently redirect to the Meet the Beans landing page until their phases ship (P3–P6).
- **Profile photos for family members.** Upload a photo in the edit-bean modal and your bean's card shows it in place of the beanie variant. Uses the existing Drive sync — photos are compressed locally (1024px, q=0.92) and stored at `beanies.family/data/<familyId>/photos/`. Removing a photo cleans up after the 24-hour grace period; deleting the member cascades the avatar automatically. First real consumer of the photo foundation.
- **Caveat accent font.** Added as the third brand font, reserved for handwritten-style content (saying quotes, polaroid captions, recipe notes). Never used for UI chrome; falls back to Outfit cursive if the webfont fails to load.
- **The Pod — family scrapbook plan + mockup.** Approved implementation plan for turning the Family area into a six-capability hub (Meet the Beans, Family Scrapbook, Family Cookbook, Care & Safety, Emergency Contacts, Family Scrapbook feed). Six-phase rollout, 8 new Automerge collections, photo integrations, Caveat accent font, first integration of the photos foundation. Full plan: `docs/plans/2026-04-19-the-pod-scrapbook-cookbook.md`; mockup: `docs/mockups/family-pod-scrapbook.html`
- **Photo attachments (foundation)** — reusable capability for attaching photos to entities. Ships the plumbing (photoStore, usePhotos composable, PhotoThumbnail / PhotoViewer / PhotoAttachments components, client-side JPEG compression, offline upload queue, Drive-folder sharing on invite, one-time folder-share migration for existing families) without wiring it into any specific entity yet. Integration for activities, family avatars, etc. ships in follow-up plans. See [ADR-021](docs/adr/021-photo-storage.md).
- **`useFileDrop` composable** — drag-drop handler extracted from `JoinPodView.vue`; reusable by the new photo UI and any future drop-zone.
- **`useFilePicker` composable** — programmatic `<input type="file">` wrapper with accept filter, multi-file support, cancel handling, and `value` reset so re-picking the same file still fires `change`.

### Changed

- **`driveService.createFile`** now accepts `string | Blob | Uint8Array` with an optional `contentMimeType` (default `application/json` preserves existing `.beanpod` behavior). Required for binary photo uploads.
- **Invite flow** now shares the `beanies.family` Drive folder alongside the `.beanpod` file so photos uploaded by any member are accessible to everyone.

## 2026-04-18

### Added

- **Plan: general photo attachment capability** — reusable foundation for attaching photos across entities (activities, family members, etc.). Photos stored unencrypted in the shared `beanies.family` Drive folder (inherits `.beanpod`'s share model), referenced by Drive file ID in Automerge. Thumbnails + full-size via Drive's CDN `thumbnailLink`. Missing-photo UX (Replace / Remove). Tombstones + GC sweep. See `docs/plans/2026-04-18-photos-general-capability.md`

---

## 2026-04-17

### Added

- **New blog post: "buy fruit"** — greg's personal story about the moment his wife assigned him a "buy fruit" todo. Published at `/blog/buy-fruit` with screenshot (WebP, 118KB). Cross-linked from the overwhelmed guide's relatedPosts and inline "buy fruit" mention
- **Substack link** on greg's `/about/greg` bio page in the "find me elsewhere" section

### Changed

- **Overwhelmed guide updated** — merged Notion draft with new content: Brigid Schulte _Overwhelmed_ book reference (time confetti concept), new "5 minutes further" reset section, bold `**short answer:**` blocks at all 11 H2s for AIO/GEO extraction, book links to fairplaylife.com + brigidschulte.com
- **Greg bio rewritten** by greg in his own voice — updated copy, fixed typos
- **Travel plans blog** — replaced screenshot (redacted email), minor copy edits
- **MVO architecture pattern** documented across CLAUDE.md, docs/ARCHITECTURE.md, and GitHub wiki. beanies.family follows Model/View/Orchestrator, not MVC — this now drives all architecture and coding decisions

### Fixed

- **Blog index** now shows new posts immediately — removed stale "introducing todos" coming-soon card, fixed CloudFront cache invalidation (was gated on staging/production target; now always invalidates apex distribution)
- **E2E tests** updated for `/welcome` routing after HomePage.vue deletion — removed dead `homepage-get-started` references, fixed state leakage in google-drive spec with `about:blank` teardown pattern

### Removed

- **Staging infrastructure** cleaned up — removed `staging.beanies.family` CloudFront distribution, ACM cert, Route53 DNS records, and noindex response-headers policy from Terraform. Deleted `WEB_CLOUDFRONT_DISTRIBUTION_ID` GitHub variable. Deploy workflow simplified: no more staging/production dropdown, all deploys go to production

---

## 2026-04-16

### Performance

- **Self-hosted Outfit + Inter fonts** on the Astro marketing site using `@fontsource-variable` packages. Removed all Google Fonts third-party requests (`fonts.googleapis.com` + `fonts.gstatic.com`). Variable fonts with `unicode-range` mean browsers download only the latin subsets needed (~80KB per page vs 120+ KB previously across multiple round-trips). Privacy bonus: no request to Google on every page load
- **Converted 26 brand/blog/help images to WebP** (siblings, originals kept for legacy URLs). Total savings: 2.96 MB across the site. The largest win: the main mascot dropped from 1.24 MB PNG to 113 KB WebP (−91%). Blog screenshots and PWA-install guide images also converted
- **Lighthouse CI** now runs on every PR that touches `web/**`, `content/blog/**`, `content/guides/**`, or `packages/**`. Asserts performance ≥95, SEO ≥95, LCP ≤2.5s, CLS ≤0.1, TBT ≤200ms, script weight ≤30 KB/page. Blocks merges that regress perf

### Added

- **Blog posts now render Byline, Breadcrumbs, and RelatedArticles** components. Every post has a linked "by greg" author byline pointing to `/about/greg`, a breadcrumb trail with BreadcrumbList JSON-LD, and a "further reading" section (3 same-category posts, or latest 3 if fewer). Help articles also gained BreadcrumbList JSON-LD. Optional `updatedDate` frontmatter field on blog posts is now supported — sets `dateModified` in BlogPosting JSON-LD when present

- PWA re-install notice for users who installed the app **before** the Astro cutover (2026-04-14). Those users still have a home-screen icon pointing at the old apex origin — the Astro apex already redirects them to `app.beanies.family`, and now also flags the bounce with a query param so the Vue app shows a one-time dismissable modal explaining the situation, reassuring about data safety ("your family file, Drive sync, and password are untouched"), and walking through platform-specific re-install steps (iOS Safari Share menu, Android Chrome three-dot menu, desktop Chrome install icon). Dismiss persists in localStorage. Automatically clears when the user is detected running the new PWA at `app.beanies.family`. Plausible events `pwa_stale_detected`, `pwa_stale_dismissed`, `pwa_stale_install_clicked` track rollout impact. New reusable `noticeFlag(key)` utility (`src/utils/notice.ts`) for any future one-time-notice situations

### Changed

- Marketing surfaces consolidated to the Astro site — help, privacy, and terms now live only at `beanies.family/help`, `/privacy`, `/terms`. In-app links open in a new tab, preserving your PWA session. One codebase per page going forward. Direct visits to any `app.beanies.family/{help,privacy,terms}*` URL redirect cross-origin to the equivalent apex path so existing bookmarks keep working. Trade-off: these pages now require network (previously bundled into the PWA offline cache)

### Removed

- Five Vue pages (`HelpCenterPage`, `HelpCategoryPage`, `HelpArticlePage`, `PrivacyPolicyPage`, `TermsOfServicePage`), three help-only components (`HelpArticleCard`, `HelpArticleRenderer`, `HelpPublicHeader`), one help-search composable, 40+ `help.*` and 4 `legal.*` translation keys. Content at `src/content/help/` is untouched — still consumed by the Astro site. Net reduction: ~2100 lines deleted

---

## 2026-04-15

### Changed

- CI hygiene: migrated Vue deploy (`deploy.yml`, `translation-sync.yml`) from the legacy `CLOUDFRONT_DISTRIBUTION_ID` / `S3_BUCKET` secrets to `APP_CLOUDFRONT_DISTRIBUTION_ID` / `APP_S3_BUCKET` repo variables. Non-sensitive config is now visible in the GitHub UI and follows the `APP_*` / `WEB_*` / `APEX_*` naming scheme used elsewhere. Legacy secrets deleted after a verification deploy passed

### Added

- Draft scaffolds for `/help/glossary` (18 terms, `DefinedTermSet` JSON-LD) and `/help/faq` (20+ Q&As, `FAQPage` JSON-LD) — both hidden in prod via the `DraftPlaceholder` pattern. Content iteration happens locally via `npm run dev:web`; flip `DRAFT=false` to publish (#167)

---

## 2026-04-14

### Added

- Astro scaffold for the new marketing site at `web/` — part of the SEO + AIO/GEO optimization initiative (#167). The public marketing pages, beanstalk blog, and help center will move to server-rendered static HTML at the apex domain, while the Vue PWA will live at `app.beanies.family`. This unlocks visibility to AI crawlers (GPTBot, ClaudeBot, PerplexityBot, CCBot) that do not execute JavaScript
- Shared `@beanies/brand` package — single source of truth for brand theme, nav, and JSON-LD schema. Consumed by both the existing Vue app and the new Astro site; eliminates duplication of colors, fonts, and author/organization data
- Full Astro route tree: homepage, /about/greg, /blog (index + posts), /help (index + 5 categories + 24 articles), /privacy, /terms — 36 pages total, each with unique title, canonical URL, OpenGraph + Twitter Card meta, and JSON-LD (Organization, WebSite, SoftwareApplication, BlogPosting, Article, BreadcrumbList, Person). All metadata is in the raw HTML — no JS required for crawlers to read it
- Help center client-side search (MiniSearch island) — lazy-loaded ~10 KB JS on the `/help` page only. Index derived from the same help content modules as the articles; no content duplication
- SEO plumbing: `robots.txt` with explicit allowlist for 24 AI crawlers and traditional search engines; hand-curated `llms.txt`; auto-generated `llms-full.txt` (56 KB of concatenated blog + help content); RSS feed at `/blog/rss.xml`; IndexNow key file; dynamic sitemap covering all 36 URLs with `lastmod`
- Dynamic 1200×630 OG images per blog post — generated at build time via `astro-og-canvas` (CanvasKit/WASM Skia, no headless browser). Heritage Orange → Terracotta gradient with beanies logo
- Web Vitals RUM on every marketing page — `web-vitals` sends LCP, INP, CLS, FCP, TTFB to Plausible as custom events; Plausible script itself ported from the Vue app
- Phase A Terraform for the apex cutover (#167): new `app-subdomain` module (ACM cert, CloudFront distribution, Route53 alias for `app.beanies.family` sharing the existing Vue S3 bucket via OAC) and new `web` module (S3 bucket for Astro, `staging.beanies.family` CloudFront distribution with `X-Robots-Tag: noindex` response header). Manual-trigger `deploy-web.yml` GitHub workflow and apex-redirects CloudFront Function (authored, unattached pending Phase C). Cutover runbook at `docs/runbooks/cutover-apex-to-astro.md`. No existing infrastructure is modified — Phase A is purely additive

### Changed

- Repo is now an npm workspace monorepo (root, `web/`, `packages/*`). The Vue app stays at the repo root for now; it will move to `apps/app/` in a later focused refactor
- Vue PWA is now reachable at `app.beanies.family` (in addition to the apex). New CloudFront distribution shares the existing Vue S3 bucket via OAC. OAuth + Google Drive sign-in verified end-to-end on the new origin
- Astro homepage and blog are now pixel-perfect ports of the Vue production pages — same hero, mascot, decorative beans, 3-device showcase, security cards, personal story with pinyin ruby, contact modal, scroll progress bar, reveal-on-scroll animations, back-to-top, image lightbox. Vue interactive logic ported to vanilla JS in `<script>` tags so no Vue runtime ships with the Astro site
- Unified site chrome — pill nav + dark page-footer extracted into shared components and rendered on every page (homepage, blog, help, privacy, terms). One header + one footer everywhere
- Astro now loads Outfit + Inter from Google Fonts (matches the Vue prod typography 1:1; system-font fallback was making text look subtly stretched)
- Astro favicon set matches the Vue app — `beanies_small_bean_favicon_32x32.png` + apple-touch-icon `beanies_father_son_icon_192x192.png`
- Registry DDB split into prod + dev tables. The OAuth Lambda routes by request `Origin`: localhost dev sessions write to `beanies-family-registry-dev`; production origins write to `beanies-family-registry-prod`. Real-user metrics + outbound contact lists now come from a clean prod table (13 real users after migration; 232 historical "Test Family" E2E rows purged)
- E2E suite auto-cleans up after each test — every test pod is removed from the registry table in the Playwright fixture's `afterEach` hook (no more accumulating "Test Family" rows). E2E pod also renamed to "E2E Test Family" so any future cleanup can grep for it
- CORS allowlist on the registry + OAuth APIs extended to `https://app.beanies.family` and `http://localhost:4173` (preview server)

### Added

- Phase C cutover code authored — frontend Terraform module parameterized with `origin_bucket_regional_domain_name`, `viewer_request_function_arn`, and `enable_spa_fallback` variables (all defaults preserve current behavior). Merged `apex-cutover.js` CloudFront Function combines authenticated-path 301s, legacy `/beanstalk*` redirects, and Astro `.html` URL rewriter into one function. Cutover is now a 3-line edit in `infrastructure/main.tf` + one `terraform apply`
- `npm run dev:all` script — starts both the Vue dev server (5173) and the Astro dev server (4321) in parallel with color-coded prefixes, killable with one Ctrl+C
- Cutover runbook (`docs/runbooks/cutover-apex-to-astro.md`) — full step-by-step Phase B/C procedure with verification checklists, rollback plan, and a "Lessons from Phase B" section capturing CORS/OAuth/URL-rewriter/naming gotchas so future cutovers don't rediscover them
- Migration script (`scripts/migrate-registry-dev-rows.mjs`) — multi-mode tool for one-time cleanup of the registry tables. Auto-classifies by email pattern, supports `--keep-prod-only` with a hardcoded keep-list of confirmed real users, plus `--scrub-dev` for cleaning the dev table

### Fixed

- Apex distribution now invalidates correctly on `target=production` deploys via the new `APEX_CLOUDFRONT_DISTRIBUTION_ID` repository variable (gracefully no-op pre-cutover when unset)

---

## 2026-04-13

### Fixed

- Onboarding wizard overlay no longer sticks on Safari/iOS — replaced the outer Vue `<Transition>` with a deterministic class toggle + timed unmount so the overlay always clears after you finish onboarding (#153)
- App init loading spinner no longer blocks clicks on Safari after the app is ready — the overlay now has `pointer-events-none` since it only contains a spinner (#153)

### Changed

- E2E tests run with `prefers-reduced-motion: reduce` and decorative infinite CSS animations are disabled under that preference — improves test reliability on WebKit and respects the accessibility preference for real users (#153)
- E2E CI workflows consolidated — `main-ci.yml` no longer duplicates the Playwright pipeline; `e2e.yml` handles all E2E runs with an event-aware matrix (main push: Chromium; `run-e2e` PR label: Chromium + WebKit; weekly: all three)
- WebKit E2E stability — reduced-motion rule now also zeroes out CSS `transition-duration` (not just `animation-*`), page-object `goto()` calls use `waitUntil: 'domcontentloaded'` so a slow/missing `load` event no longer hangs navigation, and the webkit Playwright project has a per-test timeout and extra retry to absorb its ~2–3× slower Linux CI runtime (#155, #156, #165)
- WebKit E2E now runs on every main-branch merge alongside Chromium (not just on opt-in) so Safari/iOS regressions are caught before they reach users (#166)
- CI no longer fires duplicate E2E runs when multiple labels are added to a PR with `run-e2e` already applied — the trigger now checks which label was just added (#166)
- `google-drive.spec.ts` "Create Pod step 2" hardened against a WelcomeGate → CreatePodView transition race (#165)

---

## 2026-04-12

### Added

- Family registry now captures owner email, newsletter opt-in, and join date (write-once `createdAt`) — enables early-adopter identification and future contact (e.g. manual Substack onboarding)

### Changed

- Consolidated the three `registerFamily()` payloads in `syncStore` into a single shared helper (DRY)

## 2026-04-10

### Added

- Daily calendar view — see your whole family's day at a glance with per-member columns, color-coded headers, and click-to-create with pre-filled member
- Blog post: "does family trip planning stress you out? me too" — travel plans feature intro with screenshot
- Image lightbox on blog posts — click any image to view enlarged in an overlay
- UTM tracking on all blog post links for analytics
- Hover "+" on weekly and daily calendar time slots now shows the time range (e.g., "3pm – 4pm")
- "all day" label shown beneath all-day activities in list views
- `/pilot-scout` skill for finding potential pilot users across Reddit, HN, Quora, Product Hunt, and more

### Changed

- Activity drawer field order: title → schedule → who → category (more natural creation flow)
- Blog URL changed from `/beanstalk` to `/blog` (old URLs redirect automatically)
- Blog title renamed from "beanstalk blog" to "beanie beanstalk"
- Nav links renamed from "blog" to "beanstalk" across all pages
- Family members now sorted adults-first (oldest→youngest), then children, across all member pickers
- One-time activities no longer show recurring fee schedule chips or monthly charge — linked payment is one-time only

### Fixed

- Calendar view switch (month → week → day) no longer auto-scrolls to bottom of page
- Coming soon blog cards updated (travel plans removed, 2 cards remain)

---

## 2026-04-09

### Added

- Privacy Policy page at `/privacy` — covers local-first data model, Plausible analytics, Google Drive encryption, cookies (none), children's privacy, data portability
- Terms of Service page at `/terms` — "as is" warranty, not financial advice, liability limitations, open source license, acceptable use
- Twitter Card meta tags, canonical URL, and OG image metadata for better social sharing previews
- `robots.txt` and `sitemap.xml` for SEO
- Plausible custom event tracking for signups, logins, feature usage, and family deletions — all aggregate, no PII
- New families auto-subscribed to the Beanstalk newsletter (Substack) during signup with opt-out checkbox
- `/end-of-day` skill for session wrap-up and status updates

### Fixed

- Substack newsletter auto-subscribe during signup now works — replaced broken `fetch` + JSON (silently stripped by CORS) with hidden form POST that Substack actually receives
- Privacy and terms links added to blog/help page footer (PublicFooter)
- "Back to home" link on legal pages now goes to `/home` instead of `/nook`
- npm audit vulnerabilities resolved (0 remaining)
- Removed emoji from beanstalk welcome post greeting

## 2026-03-27

### Added

- "Your Daily Briefing" explainer article in Help Center — explains the critical activities orange box on the Family Nook, including what triggers each item type, sorting logic, and the five-item limit
- "Family To-Do Lists" how-to article in Help Center — creating, editing, completing, sorting, filtering, and deleting tasks
- "Travel Plans & Vacations" how-to article in Help Center — the five-step trip wizard, timeline, booking progress, accommodation gaps, ideas voting, and countdown
- "The Family Nook — Your Home Base" explainer article in Help Center — every widget on the Nook homepage explained: greeting, daily briefing, schedule cards, vacation card, to-do widget, milestones, Piggy Bank, recent activity, and onboarding wizard
- `beanies-help-docs` project-level skill for creating and auditing help center articles

### Fixed

- "View all articles" link on Help Center landing page no longer navigates to getting-started category — now smooth-scrolls to the full article index

### Changed

- Help Center landing page: article index section redesigned — category cards show article preview (up to 4 per category with overflow hint), centered header with subtitle, clickable cards navigate to category page
- Help Center category page: redesigned with hero banner, article count badge, subtle background glow, and "Explore other topics" section linking to sibling categories

---

## 2026-03-26

### Added

- "All" fee schedule option for activities — pay one upfront amount covering every session from start to end date, with exact per-session cost breakdown and one-time linked transaction
- Fee schedule hint badge with bulleted explanations of each payment option
- Clickable summary cards on Transactions page — tap Income or Expense card to filter the list by direction, with a colored ring highlight on the active card and a dismissible filter chip
- Dashboard Income and Expense summary cards now navigate to the Transactions page pre-filtered to the corresponding direction

### Changed

- Fee schedule chips reordered (Each, All, Weekly, Monthly, Yearly, Custom) and removed Quarterly option
- Activity modal field order reorganised: cost/fee fields now appear after drop-off/pick-up duties instead of mid-form, grouping logistics together and financials together for a more natural flow
- Travel wizard steps 2–4 now show large, engaging card-style buttons for initial segment selection (matching the Step 1 trip type grid), then switch to compact pills for adding more segments
- Travel wizard step 5 (Ideas) now shows a collaboration hint encouraging family members to add and vote on ideas together anytime

### Fixed

- Time picker dropdown now auto-scrolls to the currently selected time when opened, instead of always starting at the top of the list
- All activity time displays now use 12-hour format (e.g. "2:30pm") instead of raw 24-hour values — affects Nook schedule, activity list cards, weekly calendar grid, and activity detail modal
- Activity view modal now shows start/end time inside the grey schedule summary box for both recurring and one-time activities

## 2026-03-25

### Added

- Schedule summary box in transaction view modal — shows recurrence pattern, start/end dates for recurring transactions, or date for one-time transactions (matching the activity view convention)
- Link field on all travel segment types — flights, cruise, train/ferry, car, accommodations, and transportation now support an optional URL (previously only activities and ideas had this)

### Changed

- Travel segment link field moved from activity-only to a common field at the bottom of all travel edit forms
- Accommodation edit modal pairs link with contact phone on a shared row
- Transportation edit modal pairs link with booking reference on a shared row
- Removed standalone recurrence pill from transaction view modal (replaced by the summary box)
- E2E test suite overhauled: 87 → 21 tests (76% reduction), 15 → 7 spec files, CI runs Chromium only (~44s vs ~10 min)
- Introduced Three-Gate Filter, 25-test budget cap, and E2E health tracking (`docs/E2E_HEALTH.md`)
- Project changelog (`CHANGELOG.md`) introduced with 2-week backfill from git history

## 2026-03-24

### Added

- Success toasts when reconnecting after going offline or recovering from a network error

### Performance

- Cache-first loading with skeleton screens — app shell renders instantly from cache, data loads in background
- Manual refresh replaces automatic background sync for better user control

## 2026-03-23

### Added

- Share invite modal with social sharing channels (WhatsApp, email, copy link, QR code)
- Cross-device passkey support with PRF key re-wrapping for seamless login across devices
- Delete Family & All Data option in settings with password gate for safety
- Quick-link prompt with attention pulse on transaction form — suggests linking to activities or loans
- Late-night/early-morning flight warnings on travel timeline
- Link previews for travel plan ideas (fetches title, description, image from URL)
- Undo button on todo completion celebration modal
- Unified reschedule UX across all activity types (one-time, recurring, materialized)

### Changed

- All dates standardised to dd MMM yyyy format globally (e.g. "25 Mar 2026")
- Night flight detection consolidated into single-source hint system

### Fixed

- Dashboard net worth breakdown cards now expand independently
- Hint bubble flips above button when near viewport bottom
- Family member creation flow during pod setup — explicit add-another step
- Drive invite reads now cache-bust to pick up latest tokens
- Beanie mode text "counted a bean" replaced with "task completed"

## 2026-03-22

### Added

- Global search overlay with beanies-themed design — search across transactions, activities, accounts, goals, and travel
- Beanstalk Blog — public-facing blog with markdown rendering
- Hint badges on link payment and link goal fields in transaction form
- Field Trip category added under School activities
- Travel: standardised segment titles, one-way/return flight support, booked-status validation

### Changed

- All form modals migrated from center modals to right-side drawers
- Add buttons standardised — consistent gradient pills, top-right placement
- Travel idea editing now opens drawer from wizard instead of inline expand

## 2026-03-21

### Added

- Dedicated Travel Plans page with chronological timeline, edit modals, and idea editing
- Travel activity segments (shows, theme parks, sporting events, concerts, excursions)
- Auto-generated segment titles from field data (e.g. "SYD → LAX" for flights)
- Helpful hints for overlapping bookings on travel timeline
- Trip-type-specific countdown language ("cruise in X days" vs "trip in X days")
- Wizard add-by-type flow and pending items shown in timeline with gold tint
- Link field on travel ideas with auto-prepend https

### Changed

- Nook section cards unified with shared NookSectionCard component

### Fixed

- Accommodation gap warnings now open wizard to correct step
- Existing accommodations preserved when adding new stay
- Delete enabled on undated travel items
- Todo quick-add bar no longer auto-focuses on mobile/tablet
- Family creation onboarding flow — 4 UX fixes

## 2026-03-20

### Added

- Family vacation planner — complete feature with data model, store, 5-step wizard, segment cards, idea voting, calendar bars, and sidebar integration
- Vacation view modal with chronological timeline and inline editing
- Airline and airport autocomplete dropdowns (136 airlines)
- Cruise line, ship, and port autocomplete dropdowns
- Collapsible segment cards showing key details at a glance
- Expanded view modal cards showing all populated fields
- Recurring/one-time toggle moved to top of transaction modal
- Custom header prop for edge-to-edge modal headers

### Fixed

- Vacation data persistence across page refresh (Automerge collection migration)
- Return flight auto-populate copying only first letter
- Required flight fields with automatic return flight population from outbound data
- Separate outbound/return flights with editable title hints
- View modal polish — hero gradient, corners, countdown, BeanieFormModal integration

## 2026-03-19

### Added

- Prompt archive system for tracking all AI prompts (`docs/prompts/`)
- Branded QR code with logo overlay on invite modal
- Redesigned invite modal as stepped flow

### Fixed

- Nook "This Week" card items now grouped by day/date

## 2026-03-18

### Changed

- README rewritten with concise setup instructions (replaced story format)

### Fixed

- Assignee chip cutoff in weekly calendar activity blocks

## 2026-03-17

### Added

- Weekly calendar view with shared component extraction
- All-day activities, multi-day spanning, and form validation UX
- Creation confirmation modal for transactions and activities
- Category icons, name fixes, date-grouped upcoming section, new sports categories
- Info popover on Create Monthly Payment toggle
- Activity/transaction categories with enforced alphabetical ordering

### Changed

- Default to week view on desktop, month view on mobile
- Activity modal fields reordered with compact assignee pickers and schedule summary
- Preferred currency now uses search picker with alphabetical settings tiles
- Shared TodoItemRow component extracted (DRY refactor)

### Fixed

- Scope picker now shows when editing materialized recurring transactions
- Currency display and preferred currencies stay in sync when changing base currency
- Assignee picker popover wrapping and mutual exclusion
- Consistent transaction click behavior and view modal conventions

## 2026-03-16

### Added

- Loan repayment linking with amortization schedule and recurring payment system
- Info hints on locked fields explaining why they can't be edited
- Asset card payment summaries and amortization explainer
- Compact mobile todo layout with shared assignee picker
- Skip scope modal for linked payments, show success confirmation instead

### Changed

- All activity fee schedules normalised to monthly for linked transactions
- Compact schedule section, biweekly frequency removed

### Fixed

- Linked transaction fields properly locked with cross-navigation between entities
- Ghost projections and default category for linked payments

## 2026-03-15

### Added

- Comprehensive category overhaul — new categories for transactions and activities
- Education/Lessons split into separate category groups
- Net worth breakdown cards expand inline to show account details

## 2026-03-14

### Added

- Net worth breakdown card on dashboard with category tiles
- Reschedule UI for planner activities — drag or pick new date
- Week start day setting (Monday or Sunday) for calendar
- ShowFiguresPrompt component for hidden financial figures (dashboard and budget)
- Edit budget button on spending by category card

### Fixed

- Dashboard breakdown card ordering, pill wrapping, and period overflow
- Deleted accounts filtered from transaction modal dropdown
- Motivational quote and subtitle wrapping on mobile

## 2026-03-13

### Added

- Goals and Assets pages revamped with motivational design and DRY consolidation
- Assets visual polish — equity bars, stat subtexts, card animations, hint popover
- Shared UI string resolver for E2E tests to prevent text-change breakage

### Changed

- All E2E tests migrated to use `ui()` string resolver

### Fixed

- Progressive translation loading and pre-deploy translation sync

## 2026-03-12

### Added

- Comedy movie quotes added to daily mottos on the Nook

### Fixed

- Passkey registration uses progressive fallback for platform authenticator
- Landing page floating nav font sizes and mobile layout fixes

## 2026-03-11

### Added

- Slack webhook notifications for new family creation events

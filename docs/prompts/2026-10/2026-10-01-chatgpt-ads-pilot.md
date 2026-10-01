---
date: 2026-10-01
category: marketing-tooling
issue: 118
plan: none
tags: [chatgpt-ads, attribution, utm, metrics, plausible]
---

# ChatGPT Ads pilot: plan, attribution issue, metrics panel

Launch strategy and copy live in Notion only (Launch HQ → "ChatGPT Ads Pilot — Oct 2026"). This log
records the prompts and the repo-side outcome.

## Prompts

**2026-10-01** — "Ok - now i quickly want to work on the chatGPT ads marketing plan, copy, utm links, etc.
... what i'd like to do is create a few campaigns to cycle through - what would you suggest? ... also
... do you think we should add also enable the chatgpt pixel-type tracking so we can track conversions
in chatgpt, or is that a privacy issue? also, should we add a 'chatGPT ad' type option in 'how did you
hear about us?'"

**2026-10-01** — "go to write this plan into notion (may need to create an appropriate page in launch
HQ) and also add a high priority issue with /beanies-new-issue for the carry the utm thru to the slack
message and thru to all plausible sites including to app.beanies.family if possible ... also update the
beanies-metrics skill to capture this new information and update the metrics report and metrics claude
artifact as appropriate to understand the performance of the campaign and which ad copy performs the
best, how they convert, etc ... total cost, cost per acquisition (meaning a new joiner). we can't have
an ROI yet until we start actual plans."

**2026-10-01** — "also please print the proposed copy and utm links for all the campaign proposals" /
"here are the tracking parameters that chatGPT has in their ad creation box: {campaign_id},
{ad_group_id}, {ad_id}, {ad_account_id}, {oppref}" / "yes create the issue" / "no need a github
issue, just the tracker row".

## Outcome

- Evidence gathered: Plausible showed the first ad hour as 3 Direct homepage visits with no UTM
  (ChatGPT strips the referrer on ad clicks), so untagged ad traffic is invisible. Code trace found no
  UTM capture anywhere, heard-via goes only to the create-pod Slack message, and the privacy page rules
  out a third-party pixel.
- Decisions (recorded in Notion): UTM via the ads tracking-parameters box, no OpenAI pixel or
  Conversions API, carry UTM through to the app + Slack + Plausible, add a "ChatGPT ad" survey option,
  one campaign with four parallel angles (straight / funny / testimonial / alternative), SG + US + UK + AU.
- Tracker row **#118** created (Not started, High, tracker-only): carry UTM attribution through to the
  app, the create-pod Slack message and Plausible, plus the survey option. Full scope + file pointers on
  the row for implementation in another session.
- `beanies-metrics` skill: new manual ad-spend ledger source (`~/.config/beanies/ad-spend.json`,
  example in `assets/ad-spend.example.json`), paid Plausible queries by utm_source/campaign/content on
  both sites, a `paid` block in `dashboard_data.json` (spend, clicks, CTR, CPC, visitors, CTA clicks,
  pods, CPA, credit progress, winner, attribution source), a "paid campaigns" dashboard panel (light +
  dark), and the terminal-report section. Verified with a full pipeline run and Playwright screenshots.
  Real ledger seeded with the eight ads and the one untagged 2026-10-01 pod; `daily` is empty until
  greg fills it from Ads Manager.

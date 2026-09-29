---
date: 2026-09-29
category: feature
issue: '#115 (Notion)'
plan: ''
tags: [email, ses, campaigns, notion, registry, unsubscribe, privacy]
---

# Owner email campaigns (#115)

## Prompts

- **2026-09-29** "I've been thinking lately that i woudl like a method to be able to send an email to all beanies users, or a subset of users. I would not mail very often - mostly it would be ad-hoc ... just the ability to email to a list of beanies users, with a nice, well formatted email that looks professional and consistent. we could use SES (from AWS) or another service as appropriate. Is this something we could put together ourselves, or would you propose to use a provider like mailchimp?"
- **2026-09-29** "/beanies-new-issue let's take this as an issue at medium priority as per the above. My idea is that the email text would be held in notion, similar to how we have the beanstalk blog and issue tracker ... we could select the segment and preview as you proposed before sending. ... let's also prepare SES as required (take out of test mode, etc)"
- **2026-09-29** Intake answers: audience = all owners with unsubscribe (explicit sign-up unticks stay excluded); no Settings toggle, unsubscribe only; mockup yes, no GitHub issue, no feature gate.
- **2026-09-29** "yes you can go ahead to create the issue. ... I've now created a notion page called 'email capaigns' and created the first example email ... the unapplied infra changes should be applied now ... you should be able to apply the terraform"
- **2026-09-29** "yes let's run /beanies-pre-plan #115 and note the test email is just an early draft, not finished or polished yet, but we can use it just to test the design"
- **2026-09-29** Pre-plan answers: sender cbc@beanies.family (Migadu, "chief bean counter"); add Preheader, Sent Count + Sent At, CTA Label + CTA URL to the Notion Emails DB; "Never Finished Pod Creation" = family created, no file saved.
- **2026-09-29** "add teh mockup as a claud eartifact pls"
- **2026-09-29** "let's go with (a) for now" (direction A, the letter)

## Outcome

- Recommended self-built on SES over Mailchimp (emails stay in AWS, already a disclosed processor).
- Notion tracker #115 created. SES domain identity applied (`infrastructure/modules/email`, `ef7f9a70`): DKIM + MAIL FROM `bounce.beanies.family` verified; production access requested (pending AWS review).
- Mockup `docs/mockups/owner-email-campaign-2026-09-29.html`, direction A approved.

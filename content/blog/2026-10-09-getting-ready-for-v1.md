---
title: 'getting ready for the big day'
slug: getting-ready-for-v1
date: 2026-10-09
category: stories
coverEmoji: 🎉
coverImage: /blog/getting-ready-for-v1-bear-steals-database.webp
excerpt: 'v1 is nearly here. a look at the under-the-hood work getting beanies.family ready, and some good news: magic beans go from 10 to 25 a day, at no extra cost.'
subtitle: 'as release day approaches, i come bearing good news'
featured: false
author: greg
draft: false
longAndShort:
  built: 'a massive stability overhaul ahead of v1, plus a daily magic beans allowance raised from 10 to 25.'
  helps: 'changes save more reliably, security is improved, and busy days are less likely to hit the magic beans limit.'
  where: 'the stability work is automatic; your magic beans count is in `Settings › Your beanies Plan`.'
  intro: 'A new feature - we know our families are busy, so if you just want to know what changed, and not sit through a whole long story about why (how boring is that, right?), here’s the breakdown:'
---

The day is nearly upon us, my friends (and beans).

I’m here again, in the wee hours of the morning, standing in front of my computer with a bleary-eyed gaze, maximizing my tokens at dawn. The issues list is dwindling. The beans are simmering in the saucepan, bubbly and aromatic, as, I suppose, beans are meant to be. The platform is starting to feel like it’s ready.

**So, when is v1 actually coming out?**

Provided everything goes to plan, v1 should be here around the middle of October. I know, _exciting times_!

My glorious _claude-bot_ and I are in the final stages of a multi-week overhaul of lots of “under the hood” stuff. Our focus is around data storage, security, general stability, and other things that you may not see, but would definitely feel if they were broken.

In IT, this is known as “non-functional testing”, which is a term I hate, because it sounds like you’re testing stuff that doesn’t work. What it actually means is, rather than building stuff your users could actually, well, use, you’re working on stuff that is foundational to the platform. The benefits are less immediate, but manifest over the long term.

One of the hardest things to get right with [beanies.family](https://beanies.family/?utm_source=blog&utm_medium=post&utm_campaign=getting-ready-for-v1&utm_content=homepage-mention) (and, presumably, [local-first software](https://beanies.family/guides/local-first-family-finance-planning-tools?utm_source=blog&utm_medium=post&utm_campaign=getting-ready-for-v1&utm_content=pillar-local-first) in general) is how data is stored. Not having a database is really a thing to bear.

![Two beanies in knitted hats roast marshmallows at a forest campfire beside a database server, until a bear sneaks up behind them and runs off with it](/blog/getting-ready-for-v1-bear-steals-database.webp)

_no, claude, i didn’t mean our database got stolen by a bear_

Centralized cloud databases are amazing, and they make everything simple - they just _work_. That’s why people love them (and apparently, bears steal them in the woods). Every bit of data is in one central, lovely (and hackable) place. But when it comes to my beanies, local-first is the way to go to [keep your (and our) data safe](https://beanies.family/blog/have-your-cake-and-eat-it-too?utm_source=blog&utm_medium=post&utm_campaign=getting-ready-for-v1&utm_content=privacy-explainer). The benefit of being able to nearly guarantee (as much as one could) that your data is safe is worth the challenge of making it work. And anyway, having that challenge is part of the fun, isn’t it?

In the meantime, I’ve been doing my best to respond to user feedback, but I’ve had to put some suggestions on the back burner while the focus is on prepping the platform for v1.

**So tell me - what is this “under the hood” stuff you’re talking about?**

Well, here’s a list of some of the things we’ve released already (or are literally in the process of testing and releasing):

- Improved reliability when making changes to large beanpod files over a slow internet connection
- Improved how the system handles concurrent edits from two (or more) different devices
- Fixed a rare edge case where transaction balances could be wrong when two devices make edits on the same account or goal
- Improved the behavior of calendar synchronization across different time zones
- Made some serious improvements to [your beanpod’s encryption](https://beanies.family/blog/passwords-are-so-two-thousand-and-late?utm_source=blog&utm_medium=post&utm_campaign=getting-ready-for-v1&utm_content=passwords-post) to help protect against offline brute-force attacks, which will become live together with v1
- Fixed a bug where the app could have incorrectly assigned ownership permissions under certain circumstances
- … and lots more little beans …

On top of everything, one of the biggest “under the hood” challenges has simply been (bean?) to implement pricing that can weave itself naturally into the app, while still preserving your privacy, and not impacting anything about how you use beanies.family. After some fairly exhaustive research (actually) into various provider options, I’ve decided that our payment provider will be Stripe, which is kind of like saying we did no research at all and just chose Stripe, which might also be a perfectly reasonable thing to do. Stripe is the industry standard, the market leader, and when it comes to billing, it’s a safe and secure option. It also works well internationally and covers all of our key use cases, so, here we are.

**I’m a bit worried about that magic beans limit of 10 per day - what if I need more than that?**

So for full disclosure: the above is actually a genuine question from me, because, well, I hit the limit. But I’m also happy that I can be in a position to come bearing **good news**: the _magic beans_ tier has been raised to [**_25 magic beans per day_**](https://beanies.family/pricing?utm_source=blog&utm_medium=post&utm_campaign=getting-ready-for-v1&utm_content=pricing-page), rather than 10! And it won’t cost you a dime (or even a bean) more.

The main reason for the _magic beans_ cap is to prevent abuse - I never wanted to restrict how many _magic beans_ (which, for those who [missed the blog](https://beanies.family/blog/getting-down-to-brass-tacks?utm_source=blog&utm_medium=post&utm_campaign=getting-ready-for-v1&utm_content=pricing-post), or just plum forgot, is our cutesy term for AI) could be used by families who genuinely need it. After analyzing the data for how magic beans are actually used (and hitting the limit myself), I concluded that a limit of 10 could actually impact families on particularly busy days, so it’s been raised. At no extra cost. Because I don’t want anybody reaching the limit when they need it most - I know how frustrating that would be.

![The magic beans plan card on the pricing page: $9.99 a month or $84.99 a year, with "up to 25 magic beans every day" circled in orange](/blog/getting-ready-for-v1-magic-beans-plan-card.webp)

_in case you missed it_

So that’s it - we’re coming down to the wire, and I’m using just about every hour god gave me for final testing and tweaking. I’m thrilled and invigorated by all the positive feedback from families who enjoy the app, and happy to see more people signing on every day. I’m seeing (through [Plausible](https://plausible.io/privacy-focused-web-analytics), our fully anonymized and privacy-preserving analytics provider) more and more people visiting the site and using the app, and a wider variety of features being used.

I encourage more families to [explore what’s available](https://beanies.family/?utm_source=blog&utm_medium=post&utm_campaign=getting-ready-for-v1&utm_content=explore-features) in beanies.family, and I hope everybody here takes this opportunity to look around and see what’s out there.

Believe it or not, it actually takes time to write these, so there may even be some “quietly released” surprise features that have gone out before I’ve had a chance to actually announce them properly (a soft bean-launch, if you will).

I’m also seeing more and more early beanies [joining us on discord](https://beanies.family/discord?utm_source=blog&utm_medium=post&utm_campaign=getting-ready-for-v1&utm_content=discord-cta), and it’s been great getting a chance to speak directly to some of you.

Thanks again for being on the journey with me, and I hope you stick with us for the next stage. It’ll be an awesome ride.

-greg

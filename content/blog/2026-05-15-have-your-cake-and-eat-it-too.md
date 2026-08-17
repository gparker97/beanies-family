---
title: 'have your cake, and eat it too'
slug: have-your-cake-and-eat-it-too
date: 2026-05-15
category: use-case
coverImage: /blog/beanies-privacy-security-infographic.webp
excerpt: "how to manage your family's precious data without giving it away."
subtitle: "how to manage your family's precious data without giving it away"
featured: false
author: greg
---

A handful of people (okay, it was 2, but that's something) have confessed to me that they would love to use [**beanies.family**](https://beanies.family/?utm_source=blog&utm_medium=post&utm_campaign=privacy-explainer) to keep track of all their important family and money stuff, but they're worried about giving away their data — specifically, putting all that sensitive data, _especially_ financial data, on one app.

Trust me, I sympathize. I didn't want to do it either. That's exactly why I built [**beanies.family**](https://beanies.family/?utm_source=blog&utm_medium=post&utm_campaign=privacy-explainer).

[**beanies.family**](https://beanies.family/?utm_source=blog&utm_medium=post&utm_campaign=privacy-explainer) **exists because you shouldn't have to choose between convenience and privacy.** If you want to learn why, read on.

(If you don't care about why, and for whatever reason you just trust me implicitly — _bad_ idea — then you can ignore the rest of this post and just [create a bean pod](https://beanies.family/?utm_source=blog&utm_medium=post&utm_campaign=privacy-explainer). But I suggest you read on.)

I wrote a guide about [local-first tools, privacy, and security](/guides/local-first-family-finance-planning-tools), which is a ~20-min read about how you can keep your data private with certain software. But if you're busy with a thousand things (like most of us), here's the official (for those of you who are 'experienced' enough to remember our best friend from high school) "Cliff Notes" version.

**Where hath my credit gone?**

It was an ordinary Sunday morning in 2017. One man logged into his bank account, and saw something that didn't make sense: A credit card he never asked for, charges he didn't recognize, and a loan application already approved in his name, none of which came from him. Months earlier, a [massive security breach at Equifax](https://en.wikipedia.org/wiki/2017_Equifax_data_breach) had exposed his social security number, birth date, and everything else needed to become him. Financially, he was out in the world.

Even though Equifax data was encrypted, hackers were still able to gain access due to an app vulnerability which exposed decrypted data, allowing it to be accessed.

The fraud could be reversed, eventually, but the exposure couldn't. Unlike a password, you can't just change an SSN and move on. For at least one person, the breach turned the abstract concept of "data security" into something permanent and personal. Having your data exposed in the wild is something you can never take back.

**What is encryption, really?**

No, the person in this story is not me, but things like this [really happen](https://www.cbsnews.com/news/equifax-breach-victim-speaks-out/). Stories like this play out after every security breach, which is why it helps to know how to protect yourself, and to understand different types of software security models, including **End-to-end Encryption (E2EE)** and **Server-side Encryption (SSE)**. Don't worry, I'll try to keep this short.

The term "encrypted" gets thrown around a lot when it comes to privacy. Plenty of cloud apps will proudly declare that your data is encrypted, but leave out the part where they hold their own encryption keys. In practice, this means that your data cannot be read directly, so it _is_ protected against something like an unauthorized person accessing company data. However, the company can still decrypt and read the data.

There are 2 main ways encryption is used to protect data:

- **Server-side encryption (SSE)** — Data is scrambled on the company's servers, but the company (i.e. the server owner) holds the key. If the app is hacked, breached, or subpoenaed, your data may be exposed. Useful for security, but not "true" privacy.
- **End-to-end encryption (E2EE)** — Data is scrambled on your device with a key that only you (or people you authorize) hold. The company sees nothing but encrypted data and has no access to the key, meaning they could not access the data even if they wanted to. Hackers are out of luck — their meticulously planned data extraction yields nothing but scrambled text.

For real data privacy, **End-to-end Encryption (E2EE)** is what you want. A cloud-first app that says "your data is encrypted" may or may not actually preserve your privacy using E2EE.

The key thing to keep in mind is that **Server-Side Encryption (SSE)** is a **_security_** feature, while **End-to-end Encryption (E2EE)** is a **_privacy_** feature.

**Local-first tools**

Encryption is only half of the story. The other half is where your data actually _lives_.

Most apps you use today are "cloud-first". Your data lives on someone else's server, and your phone is a window into that data in the cloud. If the company is acquired, breached, goes bankrupt, or otherwise goes away, your data goes with it. A couple famous stories of SaaS apps doing a disappearing act are [Mint](https://techcrunch.com/2023/11/02/personal-finance-monarch-intuit-mint/) and [Sunrise](https://fortune.com/2016/05/11/microsoft-sunset-sunrise-calendar-app/). It's not common, but it's a genuine risk.

Local-first flips the cloud-first model on its head. Your data lives on your devices, and the cloud is optional. The internet can be used for syncing data, or sharing with people you trust. Even without internet, the app still works. Your data stays with you, always, in a format you can read.

If the software you use is **local-first** _plus_ **E2EE**, the level of "trust" required shrinks dramatically. And when it comes to your precious family and financial data, that's the way it should be.

**That all seems pretty good. Why couldn't we do this before?**

If you think this all sounds too good to be true, you're not alone.

The truth about **local-first + E2EE** software, for most of the past couple decades, is that it was technically possible, but financially unviable. Building an engine that handled offline conflicts between documents, multi-device merging, and end-to-end encryption took a small army of senior engineers. Big companies could afford it, but generally were not willing to forfeit lucrative data ownership. Small companies and indie developers couldn't handle the building cost, so cloud-first apps remained the default.

**Three things** are converging right now to change that:

- **Web browsers are better** — The browser-native [**Web Crypto API**](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API) gives you proper end-to-end encryption. [**IndexedDB**](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API) gives you a reliable on-device database cache. The [**File System Access API**](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API) gives you ownership and access to your local files (at least in most browsers). PWAs let you install web apps like native apps. The technical and performance limitations of the past decade's web browsers have largely been overcome.
- **Open-source conflict resolution libraries are mature** — Merge algorithm libraries like Automerge, Yjs, and others that can merge your family's data from multiple devices into one document are battle-tested, proven, and mature.
- **AI-assisted coding has compressed the timeline** — What used to be years of development for a small team can be compressed to several months with safe, managed, and carefully guided oversight and usage of AI-assisted coding.

The privacy vs. convenience trade-off we always faced is something a lot of us accepted as a given. But with a lot of the tooling problems now solved, we don't have to take it as a given anymore, and I doubt **beanies.family** will be the last app to take advantage of this new world!

**So, is beanies safe?**

Yes. But read on.

As I've said several times, I use AI (and more specifically, claude code primarily) to help build beanies. I build software for a living, and without my glorious claude-bot, this app would take years (not to mention tons of money) to build.

AI has gotten a bad rap in terms of security, but AI is not _inherently_ insecure.

If you put in place the proper guardrails, guidance, and oversight, including careful code and security reviews, both manual and automated, using AI to build software can be as secure (or even more secure) than building by hand. Admittedly, that's a big _if_.

- We use the browser-native [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API), a web standard built into all modern browsers and maintained by the same security teams that review Chrome, Safari, and Firefox.
- Our code is put through multiple layers of security scanning before deployment (including CodeQL, SAST, secrets detection, dependency scanning, plus a license audit).
- No data is stored on our servers (so there is no possibility of a breach there).
- Our source code is maintained on a [public GitHub repository](https://github.com/gparker97/beanies-family) so it can be read, reviewed, and audited by any person (or robot) who so chooses.

When you use [**beanies.family**](https://beanies.family/?utm_source=blog&utm_medium=post&utm_campaign=privacy-explainer), your family data lives on your device in an encrypted file. The encryption keys are derived from your password, and stored on your device.

If you lose your password, we can't help you, and that's the whole point.

Even if a hacker wanted to poke around our dark corner of the internet, there is nothing there except code and app configurations — so good luck finding anything to sell, steal, or leak.

I built [**beanies.family**](https://beanies.family/?utm_source=blog&utm_medium=post&utm_campaign=privacy-explainer) so you can have peace of mind for both your family and your data. Once again, I don't care about your finance data, and I'm not picking up your kid for you.

So go forth, plan your family's life, track your money, and rest easy knowing your data is _not_ out there, quietly being used to train some ad model or LLM.

Some of this is a bit technical and confusing. If you have lingering concerns, questions, or just want to make a comment, you can [contact me on beanies.family](https://beanies.family/?utm_source=blog&utm_medium=post&utm_campaign=privacy-explainer) or post your questions on Substack. I will personally reply (perhaps after losing sleep on your behalf thinking about the answer). That is the kind of service we have on offer here at beanies.family. You won't find it anywhere else.

Create your safe and secure pod at [beanies.family](https://beanies.family/?utm_source=blog&utm_medium=post&utm_campaign=privacy-explainer).

By the way, why would you _have_ a cake, but not _eat_ it? I never understood that. But that's a topic for another post, I guess.

Thanks again for reading, my beans. Wishing you all peace of mind, security, and most of all, privacy.

greg

![Local-first plus end-to-end encryption: your family's data, only on your devices](/blog/beanies-privacy-security-infographic.webp)

_and if you don't even have enough time to read this article, here's an infographic ❤️_

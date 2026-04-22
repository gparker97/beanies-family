---
title: 'local-first family and financial planning tools: what they are and why they matter'
slug: local-first-family-finance-planning-tools
excerpt: "a guide to family and financial planning apps that don't harvest your data. what local-first actually means, the trade-offs, and the tools worth trying."
heroEmoji: 🔒
publishedDate: 2026-04-22
lastUpdated: 2026-04-22
relatedPosts:
  - welcome-to-the-beanstalk
  - accidentally-built-greatest-family-app
tags:
  - local-first
  - privacy
  - family-apps
  - e2ee
draft: true
---

## what does "local-first software" actually mean?

**short answer:** local-first means that your data lives on your devices first. Data on the internet or in the cloud is secondary and optional. The app works offline, doesn't require an account on a remote server, and survives even if the app or company you're using goes out of business. Local-first is the opposite of cloud-first, where the cloud holds the source of truth, and your device is just a window into it.

For the past couple decades, "the cloud" has been the default for internet apps. You open an app, log in, and access your data without thinking too much about where it may be coming from, whether it's someone else's computer or a data center you'll never visit. When the internet goes down, the app is useless. If the company gets acquired, your data goes with it. If the company shuts down — let's just hope you exported your data before that happens.

Local-first software flips that model on its head. The golden source of truth is your device, whether it's your phone, laptop, or tablet. The cloud is optional, used only for syncing between your devices or sharing with people you trust. If the company disappears, your data is with you — still right there on your device or a trusted storage platform, in a format you can read.

Local-first is a small philosophical shift with big practical consequences — your data is yours, you can use it offline, and nobody can take it away from you.

## the problem with "cloud-first" apps — and why your data isn't really yours

**short answer:** when an app stores your data on someone else's server, you're renting access to your own information. The software or app provider owns the storage, the format, the export rules, and the ability to shut you out at any time. This is all as per terms that you agreed to when you started using the app.

Perhaps you've experienced an app you know and love suddenly changing its pricing model. Typically this happens after being acquired by another company, but not always. Or maybe one of your favorite apps just quietly disappeared. That is the cost of using cloud-first software, and most of us accepted it as a given for doing business on the internet.

For some real-world examples, see: the [Mint shutdown](https://blog.intuit.com/news-social/mint-sunset-announcement/) ← <add link to relevant article> <!-- link added: greg confirm --> and [Sunrise calendar](https://techcrunch.com/2016/08/31/microsoft-shuts-down-sunrise-app/) ← <add link to relevant article> <!-- link added: greg confirm -->. It's a real risk — not theoretical.

There's a deeper issue, though, and it's the one that should actually worry you more — those companies do more than just hold your data — they can read it and sell it.

While some companies are scrupulous and ethical about this, others are not. For one example of an unscrupulous company, see [Life360's history of selling precise location data](https://themarkup.org/privacy/2021/12/06/the-app-that-promises-to-keep-families-safe-is-selling-precise-location-data-on-tens-of-millions-of-its-users) to data brokers ← <add link to relevant article> <!-- link added: greg confirm -->.

Many companies are somewhere in the middle, and the position they hold today is not necessarily the position they'll hold after an acquisition or the next funding round.

When I was researching personal finance apps for my own family, I had a brief moment of clarity that I wrote about in an early blog post. Most of the apps we use happily today require us to hand over keys to important parts of our lives — and when it comes to personal finance apps, that is especially true with financial accounts.

We trust that the company on the other end will be careful with those keys, with no recourse if they aren't.

Local-first software doesn't ask for that trust, because it doesn't need it.

## what "privacy-preserving" actually means — and what it doesn't mean

**short answer:** "privacy-preserving" means the people running the software cannot read your data, even if they wanted to, or were "forced to" (for example, due to a legal subpoena or government interference). "Encryption" on its own is not privacy preserving, especially if the company holds the key — that's just "encryption at rest" — and it doesn't guarantee privacy.

On an ordinary Sunday morning in 2017, one man logged into his bank account and saw something that didn't make sense — a credit card he never asked for, charges he didn't recognize, and a loan application already approved in his name, none of which came from him. Months earlier, a massive security breach at Equifax, a company that encrypts data but holds the keys (SSE), had exposed his Social Security Number, birth date, and everything else needed to become him. Financially, he was already out in the world.

The fraud could be reversed, eventually, but the exposure couldn't. Unlike a password, you can't just change a Social Security Number and move on. The breach turned the abstract concept of "data security" into something permanent and personal. Having your data exposed in the wild is something you can never take back.

Stories like this are why it's important to understand the distinction between End-to-end Encryption (E2EE) and Server-side Encryption (SSE).

The term "encrypted" gets thrown around a lot when it comes to privacy. Plenty of cloud apps will proudly declare that your data is "encrypted" — but leave out the part where they hold the encryption keys. In practice, what this means is that your data cannot be read directly from the database — so it protects against something like an unauthorized person accessing company data. However, the company can still decrypt and read the data.

There are two kinds of encryption that matter:

- **Server-side encryption (SSE)** — Data is scrambled on the company's servers, but the company (i.e. the server owner) holds the key. If the company is hacked, breached, or subpoenaed, your data is exposed. Useful, but not real privacy.
- **End-to-end encryption (E2EE)** — Data is scrambled on your device with a key that only you (or people you authorize) hold. The company sees nothing but ciphertext, and could not access the data even if they wanted to. As far as hackers, they're also out of luck — they will see nothing but scrambled text.

A privacy-preserving app uses E2EE. A cloud-first app that says "your data is encrypted" may or may not actually preserve your privacy.

The key thing to keep in mind is that Server-Side Encryption (SSE) is a security feature, while End-to-end Encryption (E2EE) is a privacy feature.

## end-to-end encryption, explained without the math

**short answer:** you can think of E2EE like sending a locked safe through the mail. The company carrying the safe can see the box, weigh it, and route it to where it needs to go, but they can't open it. Only you, or somebody you've shared the key with, can open the safe.

The math behind E2EE is complex, but the concept is simple — when your data leaves your device, it's unreadable.

Encrypted data looks like your text has been put through a blender. It's scrambled to the point that nothing makes sense. The only way to unscramble it is with a secret key, which is a string of letters and numbers so long that it would take a normal computer hundreds of years to try all the different combinations before the key could be found.

Encrypted data sits on databases and travels through the internet locked. Only your device, using a stored secret key the server has never seen, can unlock it.

The long and short of all this is, even if a hacker breached an E2EE company tomorrow and downloaded everything they found, they'd get a giant pile of useless, unreadable text. Your family planning data, your finances, your private notes would all be locked, even from the people you're paying to host them.

## the local-first manifesto: 7 ideals, in terms that anyone can understand

**short answer:** in 2019, a research group called [Ink & Switch](https://www.inkandswitch.com/) ← <link to ink and switch website> <!-- link added: greg confirm --> published the seven properties they think every truly local-first app should have. In summary, those properties are: fast, multi-device, offline, lasts forever, secure, collaborative, and yours.

The original Ink & Switch paper is an enlightening and interesting read if you want the full version. Below are the seven ideals, in non-technical terms:

- **No spinners** — The app should be instantly fast because your data is already on your device. No "loading..." while it talks to a server. In cases where data is encrypted, decrypting data may take time, even if it is done locally.
- **Your work is not trapped on one device** — Your data should sync across your phone, laptop, and tablet without forcing you into one specific cloud service.
- **The network is optional** — Offline should be a first-class consideration, not a degraded mode.
- **Your data lasts forever** — Even if the company goes away, the data is always readable.
- **Secure and private by default** — End-to-end encryption isn't a premium feature — it's the baseline expectation.
- **Collaboration without conflict** — Two people editing the same thing offline shouldn't cause conflicts or a file versioning mess when they reconnect.
- **You retain ultimate ownership** — Your data is yours — you can take it elsewhere if you want. Nobody can lock you out or hold your data hostage for any reason.

That's it — seven properties, none of which most cloud apps deliver. Until very recently, most of these properties were technically very hard to deliver. Improvements in data storage, front-end technologies, conflict resolution (see CRDTs — more information below), and other important areas have enabled local-first apps to be a real and practical solution in today's marketplace.

## CRDTs: how local-first apps stay in sync without a server telling them what to do

**short answer:** a CRDT (Conflict-free Replicated Data Type) is a type of data structure that lets multiple devices edit the same data offline, and then merges their changes back together without ever resulting in a conflict. CRDT is the technology that makes local-first collaboration possible.

If you've ever used Google Docs and watched two people type at the same time without overwriting each other, you're watching something similar to a CRDT in action. The difference is that Google Docs uses a central server to broker the merges.

CRDTs let you do the same thing without a central server. With local-first CRDTs, each device records its changes as small operations (i.e. "user added the letter A at position 5"). When devices reconnect, they exchange operations and merge all changes in a way that will always produce the same result, using an algorithm that's mathematically proven.

The true magic is in the fact that the result will always be the same. Think of it as two people editing the same shopping list. Both devices are offline, and when they finally come online and sync with each other, they don't fight — they merge.

Without CRDTs, local-first software is theoretically possible, but practically miserable, because the users would have to manually resolve every conflict. With CRDTs, things just work.

One of my early, non-negotiable requirements for beanies.family was that it would be a local-first application, with data stored on your machine and under the user's full control. We hit our first real roadblock when I started testing with my family — data consistency was awful.

It wasn't until we found the [Automerge](https://automerge.org/) library, which is a native implementation of CRDTs, that things finally started to work. Without CRDTs, beanies.family would not be able to exist in its current form. I owe all the wonderful people at [Ink & Switch](https://www.inkandswitch.com/) ← <add link> <!-- link added: greg confirm --> and [automerge](https://automerge.org/) ← <add link> <!-- link added: greg confirm --> a beer.

## the old trade-off that no longer applies: privacy vs. convenience

**short answer:** until recently, the privacy vs. convenience choice was assumed to be a given. Cloud apps were easy, convenient, and cheap, but giving away your data was the price you had to pay. Privacy-preserving alternatives could be technical, awkward, or simply unworkable for those of us who were not IT wizards. Mainstream users overwhelmingly picked convenience, and that's how we got here.

For most of the past couple decades, if you wanted true privacy, your options were limited:

- **Self-host everything** — Set up a server in your basement. Configure some fundamental hosting technologies, such as DNS, TLS certificates, web servers, storage, and the like. Support and maintenance of your self-hosted rig would become a full-time job. This was suitable for IT gurus, tinkerers, and hobbyists, but not for the general population.
- **Small, open-source apps with no sync** — These work well if you only use one device, but they're painful if you actually live a modern life across phones, laptops, and tablets, and more.
- **Trust a "privacy-focused" cloud company** — Privacy-first companies tend to be more permissive, but they are still cloud-first. You're hoping for more favorable terms, but you're still giving up ownership and control.

Choosing convenience came with companies like WhatsApp / Meta reading your contacts, Google Calendar reading your schedule, fitness apps reading your health vitals and location, and finance tracking apps reading your transactions.

The trade-off felt permanent, because the technology required to make local-first software easy and accessible to non-technical users, such as efficient sync, painless E2EE, and cross-platform UI, simply didn't exist for solo developers or small teams.

Luckily, the world has changed, and we're living in it.

## how vibe coding is removing the privacy vs convenience trade-off

**short answer:** the combination of mature local-first tools ([Automerge](https://automerge.org/) <link> <!-- link added: greg confirm -->, [Yjs](https://yjs.dev/) <link> <!-- link added: greg confirm -->), browser-native crypto and storage ([Web Crypto](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API) <link> <!-- link added: greg confirm -->, [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API) <link> <!-- link added: greg confirm -->, the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API) <link> <!-- link added: greg confirm -->), cross-platform shells ([Tauri](https://tauri.app/) <link> <!-- link added: greg confirm -->, [Capacitor](https://capacitorjs.com/) <link> <!-- link added: greg confirm -->), and AI-assisted coding has made the new world possible. Small teams (or even individuals) can now build polished, privacy-preserving apps that used to take teams of experienced developers and architects literally years to build.

The truth about local-first software for the last decade is that it was technically possible, but financially unviable. Building a sync engine that handled offline conflicts, multi-device merging, and end-to-end encryption took a small army of senior engineers. Big companies could afford that army, but weren't willing to forfeit data ownership. Small companies and indie developers couldn't afford the building cost, so cloud-first apps remained the default.

Three things are converging right now to change that:

- **Open-source CRDT libraries are mature enough to use in production** — Automerge, Yjs, and others are battle-tested. Rather than building a CRDT from scratch, you're using a library that is battle-tested, proven, and actively maintained.
- **Browsers have caught up** — The [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API) gives you proper end-to-end encryption. [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API) gives you a reliable on-device database. The [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API) gives you ownership and access to your local files (at least in most browsers). PWAs let you install web apps like native apps. The limitations of the past decade have largely been overcome.
- **AI-assisted coding has compressed the timeline** — What used to be years of development for a small team can be compressed to several months with safe, managed, and carefully guided oversight and usage of AI-assisted coding.

This is roughly the story of how beanies.family came into existence. If you want the longer version, follow me on substack and I'll be posting a lot more about this new world — trust me.

The privacy vs. convenience trade-off was a tooling problem, not a values problem. That tooling problem has now been solved, and I doubt beanies.family will be the first app to take advantage of this new world!

## how to spot a local-first app in the wild

**short answer:** the trademarks of local-first apps are obvious if you know what to look for. Local-first apps work offline, they let you export your data in a real format, they tell you exactly where your data is stored, and that your data is owned by you.

Here's a quick checklist when you're evaluating an app, and want to know whether it's actually local-first:

- **Does it work offline?** Open the app, switch your phone to airplane mode, and see if it still functions. If everything stops working, it's probably not local-first.
- **Can you export your data?** Look for an export option that lets you download a file in a format you can read — something like JSON, CSV, Markdown, or simply text (even if the file extension is not .txt, it may still be a recognizable format). If the only export is a PDF or a contact us form, it's probably not local-first.
- **Is account creation optional?** Many local-first apps let you start using the app without signing up. The cloud account is a convenience to help with data synchronization, not a requirement.
- **Where is your data stored?** A real local-first app will be specific. The documentation should say something like: "Your data lives in an encrypted SQLite file in this folder on your device." Cloud apps rarely provide specific answers to where your data is stored.
- **Is the file format documented?** If your data is exported to a common file format, like the ones listed above under "Can you export your data?", you know you can get your data out, even years from now. If it's a proprietary format that you don't recognize and cannot read directly from your computer in notepad, you're betting on the company's continued existence.

Apps that pass this checklist today include [Obsidian](https://obsidian.md/), [Logseq](https://logseq.com/), [Standard Notes](https://standardnotes.com/), [Cryptee](https://crypt.ee/), [beanies.family](https://beanies.family/), and a growing list of others.

## what local-first tools look like for families and finance planners (and tools that do both)

**short answer:** for families, local-first means your precious, shared family and financial data — things like calendars, schedules, finances, bank accounts, and kids' info — lives on your family's devices, and not on a stranger's server. The data is synchronized between phones via end-to-end encrypted cloud storage that you control. Nobody outside the family can read it — that's a mathematical certainty.

Family data is some of the most sensitive data we own. It includes our kids' schedules, our finances, our health information, relationships, and more. Yet many of us (including past me) happily stored it in apps run by major corporations with strong incentives to monetize data and attention. Case in point is the [Cozi parent company](https://www.prnewswire.com/news-releases/cozi-family-organizer-acquired-by-time-inc-300228234.html) <link here> <!-- link added: greg confirm -->, [Life360's history of selling location data](https://themarkup.org/privacy/2021/12/06/the-app-that-promises-to-keep-families-safe-is-selling-precise-location-data-on-tens-of-millions-of-its-users) <link here> <!-- link added: greg confirm -->, and the long list of family-app shutdowns that took user data with them — [Sunrise](https://techcrunch.com/2016/08/31/microsoft-shuts-down-sunrise-app/) and [Mint](https://blog.intuit.com/news-social/mint-sunset-announcement/) are two well-known examples <link to an example>. <!-- link added: greg confirm -->

Local-first for families means a different architecture and experience:

- The app lives on each family member's device.
- The shared family data lives in an end-to-end encrypted file.
- Your family data file syncs through a cloud storage account you already own, such as Google Drive, iCloud, or Dropbox, but is encrypted before it leaves your device. The cloud only sees scrambled text.
- If a family member adds soccer practice for your youngest while their phone is offline, that change merges cleanly when they reconnect, without conflicts.

This is the model on which [I built beanies.family](https://beanies.family/blog/accidentally-built-greatest-family-app). Partly because it was the model I wanted for my own family, but also because, once it was clear what the new tooling that we discussed above could do — it felt almost negligent not to.

**Families are an obvious win for local-first software.** The data is sensitive, the use cases are inherently multi-device, and the cost of getting it wrong is high. Nobody should be staring over your shoulder at your family's precious personal and financial data except you. And your beanies.

Thanks for reading. If you want the personal story of how I ended up here, start with [why I built beanies.family](https://beanies.family/blog/welcome-to-the-beanstalk).

## further reading

- [Ink & Switch: local-first software](https://www.inkandswitch.com/local-first/) — the foundational paper.
- [Automerge](https://automerge.org/) — the CRDT library powering many local-first apps (including beanies.family).
- [Yjs](https://yjs.dev/) — another widely-used CRDT library.
- [Obsidian](https://obsidian.md/), [Logseq](https://logseq.com/), [Standard Notes](https://standardnotes.com/) — three of the most polished local-first apps you can use today.

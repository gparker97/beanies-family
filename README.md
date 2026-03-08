# Hey, guys! 🫘

Yes, it's *actually* me. Even AI could not come up with a greeting as mundane as "Hey, guys!" Indeed, there are still some things humans are better at than robots, such as glorious, unadulterated, deliciously spontaneous non-sequiturs, like how I like to fart outside taco trucks on wednesday afternoons. But getting back to the point...

Since the day I "graduated" college for a real job, put in a solid month of (let's call it) work, and witnessed my first paycheck direct-deposited to my bank account, this is the app I've wanted to create. I gazed lovingly at the glorious $2,867 (minus taxes) in my account that day, and dreamt about the day I would definitely become a billionaire. Or at least the day I wouldn't be a starving student anymore.

It started with a janky spreadsheet. I added formulas, tables, charts. I kept track of how much I spent and saved and projected it forward. I might have even written some VB macros, toying with my sheet for months (maybe years) trying to get it to work the way I wanted.

Then, the world changed (in, let's say, 2008), and I said to myself, "Hey, self! Why do you keep trying to re-invent the wheel (the wheel having been invented earlier that year)? There's a million personal finance apps out there! Just download one, you numbskull."

So I did, and I fiddled with those fickle banking connectors that sync your transactions, but always fail. Then they ask for your credentials 10 times in a row, and proceed to not work anyway. They ask you to upload CSVs, then say they can't read them. Lots of my important transactions were in cash or paid on cards. Some banks and cards don't provide reliable APIs. When things did work (rarely) it was temporary and only tracked what you *did* spend, not what you *planned* to spend.

My goal was never to record every last transaction and track my budget down to the penny. If that's yours, this app probably isn't for you. I just wanted a rough idea, so I would know if I was going to end up as a hobo in 6 months.

Then, we had kids. With one (1) child, we could generally manage. After 2 kids, life got crazier. Bump that up to 3 (at school age) and welcome to the insane world of chaos and confusion and writing readmes to dumb personal family planning apps you vibe coded on a whim at 3am. Or, whatever.

Soccer practice, piano lessons, math tutor, gymnastics (2 types), chinese classes, taekwondo, and don't forget your actual school fees, your rent (or mortgage), and the list goes on. Who has to pay for what, and when, and how, and to who? Or is it whom? Also, while you were obsessing over the proper application of archaic English grammar rules, you realized you forgot to pick up your kid from his baseball tryouts. And it's raining. At least he has his umbrella. (Cue glance to the floor to spot the umbrella that fell out of his sports bag).

When my youngest was about 6 months old, my wife started calling him 小豆豆. Which in Chinese sounds endearing, but just means little bean. Cuz he sort of looked like one. It sounds cute in English too, so I called him beanie, and it stuck.

I built this app to track all that stuff I mentioned above: your family finances, what you spent and received, what you plan to spend and receive (roughly), and to tell you how much you'll have in the future - in short, your "wealth".

But also, to track your *actual* family life: piano lessons, schoolwork, sports practice, family vacations (we may even give you advice), and, of course, who will pick up whom (yes, *whom*). In short, anything we can help you with, even in a small way, as you navigate the joys and sorrows of a complicated, crowded, chaotic, stressful, but of course, rewarding? (sorry, I meant, rewarding) family life.

It's not a perfect app. It doesn't sync with banks (and I doubt it ever will). But it gives you a rough idea of how much you have, how much you will have, and what in this world you actually have to do *today*. (Of course, only if you tell it that stuff first. It's not magic.)

Treat [beanies.family](https://beanies.family) like a friend, and it will reward you in spades. Maybe it'll even buy you a beer the next time you can spare 22 minutes after work and have $7 saved from meticulously tracking your budget every month. (Is that how much beers cost nowadays? I wouldn't know.)

You can clone and install it for free if you want to run it locally. The data never leaves your machine if you don't want it to. We don't even own a database (well, not a real one). I don't want your janky finance data anyway, and I'm not picking up your kid for you.

If you want the cloud version so you can share it with your family (don't worry, your data still stays with you), create a family account at [beanies.family](https://beanies.family). Just drop me a line for an invite code. You could also set up the infra by yourself, but that's a pain and you know it.

Here's the fun stuff:

- Claude Max / Opus 4.6 (Mostly. I may have pitched in a line or 2.)
- Vue 3 / Typescript + Vite / Tailwind / Pinia
- IndexedDB (to cache encrypted family data in your local browser, which you can clear at anytime)
- Browser-native Web Crypto API (AES-256-GCM) - Your data is fully encrypted in transit and at rest and never leaves your personal storage location, except to travel directly to your browser's (encrypted) cache
- Automerge (for CRDTs - adds a bit of heft to the package, but we tried rolling our own merge algorithms and trust me, it's not worth it - keeping your data safe is what matters)
- Vitest (unit tests) + Playwright (E2E tests) + Dependabot to keep dependencies up to date and secure (seriously, how cool is Dependabot!?)
- One single, stupid, plain vanilla DynamoDB in the cloud to map your email to family ID so we can locate your (encrypted) family data file in your personal location that only you can access. Nothing else. Anywhere. Ever.

So there it is. If you're a techie nerd like me, run it locally. If you don't want to deal with the bs, use [beanies.family](https://beanies.family).

I'm using [beanies](https://beanies.family) to track our money, our various (1) houses, our (0) boats, my wife's (currently missing) diamond ring (ask my wife where she lost hers.. unfortunately beanies can't tell you that), and more. I'll use it even more for their piano lessons, soccer practices, school plays that, as a respectable father, I really should attend, and to make sure we don't forget to pick up our son from his after school math tutor (again). All while keeping our data safe and secure on my family's personal storage (unless I open read access on my data file to the world and tell everyone the key. Which I won't. Probably.).

If you have a question, comment, suggestion, or just wanna say hi, you can say it here or raise an issue. If you're using it for free and wanna drop me a satoshi for my time (or just cuz you like the app), that's cool too (1beanks5zbnAcptUe.SdrepxqrCzxEuA2z).

Simplify your family life. Every bean counts.

Enjoy beanies, bros.

Peace.

Greg

<img width="192" height="192" alt="beanies_father_son_icon_192x192" src="https://github.com/user-attachments/assets/c6b6fd45-cc71-4feb-9c7d-3fb41c42a4a3" />


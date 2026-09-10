/**
 * The one place a price lives.
 *
 * The rendered plans table, the client-side currency switcher, the early-family
 * discount lines and the FAQPage JSON-LD all read from here, so a price change
 * is one edit and cannot drift between the number a person sees and the number
 * a crawler indexes. Adding a currency is one entry in `PRICES`; the page renders
 * a switcher button per entry and nothing else knows the list.
 *
 * Positioning (research, 2026-09-10): family-organiser annual mean $70.62
 * (n=7, ex-Maple); $84.99 is +20.3%, the top of the agreed 15-20% premium band.
 */
/**
 * THE GATE. While false, /pricing renders the site's draft placeholder with
 * noindex, and every link into it (nav, footer, the beta trust badge, the
 * homepage hedge) renders as it did before this page existed. Flip to true to
 * publish. One constant, so there is exactly one thing to forget.
 *
 * What this does NOT gate: the prose rewrites on the switching pages and the
 * help FAQ, which describe the new model in words. Those are ordinary copy.
 */
export const PRICING_LIVE = false;

export type CurrencyCode = 'USD' | 'SGD';

export interface PriceTable {
  /** Button label on the switcher. */
  label: string;
  free: string;
  monthly: string;
  yearly: string;
  /** yearly / 12, for the "works out to" line. */
  yearlyPerMonth: string;
  /** The 50%-off-for-life figures for families who joined before v1.0. */
  halfMonthly: string;
  halfYearly: string;
  /** The first-ten deal. $1 in whichever currency the family pays in. */
  one: string;
  /** Yearly saving against 12x monthly, already rounded. */
  savePct: number;
}

export const PRICES: Record<CurrencyCode, PriceTable> = {
  USD: {
    label: 'USD $',
    free: '$0',
    monthly: '$9.99',
    yearly: '$84.99',
    yearlyPerMonth: '$7.08',
    halfMonthly: '$4.99',
    halfYearly: '$42.49',
    one: '$1',
    savePct: 29,
  },
  SGD: {
    label: 'SGD S$',
    free: 'S$0',
    monthly: 'S$13',
    yearly: 'S$110',
    yearlyPerMonth: 'S$9.17',
    halfMonthly: 'S$6.50',
    halfYearly: 'S$55',
    one: 'S$1',
    savePct: 29,
  },
};

export const DEFAULT_CURRENCY: CurrencyCode = 'USD';

/** Length of the everything-included trial that starts at v1.0. */
export const TRIAL_DAYS = 90;

export interface PricingFaq {
  id: string;
  q: string;
  /** Plain text. Rendered as one paragraph and reused verbatim in the JSON-LD. */
  a: string;
}

/**
 * Written in greg's voice and reviewed by him. Plain strings on purpose: the
 * same text feeds the visible accordion and the FAQPage schema, and HTML in
 * here would have to be stripped for one of them.
 */
export const PRICING_FAQS: PricingFaq[] = [
  {
    id: 'why-free-tier',
    q: 'wait, you keep saying "something\'s gotta give". so why is there a free tier?',
    a: "because subscribers pay for it. that's the arrangement, and it's the same one proton and bitwarden run on. the free tier isn't me being generous with money i don't have; it's paying families keeping the door open for everyone else. if that ever stopped working, the free tier would go before beanies did - and you'd hear about it here first.",
  },
  {
    id: 'after-90-days',
    q: 'what do i actually lose after 90 days?',
    a: "one thing: the ai helper, because every time it runs it costs me real money. that's it. your calendar, lists, meals, money, the wall, your whole family - all still there, all still free. and if you've got your own openai or anthropic key, plug it in and the ai helper works on free too. you pay them instead of me.",
  },
  {
    id: 'never-subscribe',
    q: 'what if i never subscribe?',
    a: "then you use beanies for free, minus the ai, for as long as you like. no nagging, no features quietly disappearing, no \"upgrade now\" popups. if it's useful, i'd love it if you subscribed one day. if it's not, i'd rather know why.",
  },
  {
    id: 'why-more-than-cozi',
    q: 'why is it more than cozi?',
    a: "because you're not the product. cozi is cheaper on the free tier because the ads are paying, and its paid tier is about the same as mine. beanies costs a little more than the average family app because there's nothing else propping it up - no ads, no data deals - and because you get the money side, the family side and the wall in one place. premium, not silly.",
  },
  {
    id: 'here-now',
    q: "i'm here now. what does that get me?",
    a: "half price on any paid plan, permanently, for joining before v1.0. the first 10 families who rate the app and tell me they did get $1 a month instead. both are for as long as you stay, and there's no renewal to miss.",
  },
  {
    id: 'prove-early',
    q: 'how do you know i was here before v1.0?',
    a: "your pod has a creation date, and that's the whole test. no code, no coupon, no screenshot. you don't need to do anything today except be here.",
  },
  {
    id: 'data-if-i-leave',
    q: 'what happens to my data if i stop paying, or leave?',
    a: "nothing. it's in your own encrypted file, not on my server, so there's nothing for me to lock or delete. stop paying and you're on the free tier. leave altogether and you take the file with you. export everything, whenever you like.",
  },
  {
    id: 'self-host',
    q: 'can i just run it myself for free?',
    a: "yes. it's open source, and self-hosting is free, forever, no strings. you'll need somewhere to run it and a bit of patience, but you'll never see a bill from me.",
  },
  {
    id: 'other-currencies',
    q: 'will there be other currencies?',
    a: "yes. usd and sgd first, because that's where most beanies live right now. others as families ask for them. the price is the price wherever you are - nobody pays more for being somewhere else.",
  },
];

import type { HelpArticle } from './types';

export const HOW_IT_WORKS_ARTICLES: HelpArticle[] = [
  {
    slug: 'net-worth-calculation',
    category: 'how-it-works',
    title: 'Net Worth Calculation',
    excerpt:
      'How beanies.family calculates your net worth from accounts, assets, and liabilities across multiple currencies.',
    icon: '\u{1F4CA}',
    readTime: 4,
    popular: true,
    updatedDate: '2026-03-09',
    sections: [
      {
        type: 'heading',
        content: 'The formula',
        level: 2,
        id: 'formula',
      },
      {
        type: 'paragraph',
        content: 'Net worth is calculated as:',
      },
      {
        type: 'codeBlock',
        content: 'Net Worth = (Account Assets + Physical Assets) - (Credit Cards + Loans)',
      },
      {
        type: 'heading',
        content: 'What counts as an asset',
        level: 2,
        id: 'assets',
      },
      {
        type: 'list',
        content: '',
        items: [
          '<strong>Account balances</strong> \u2014 Checking, savings, investment, crypto, and cash accounts (where <em>Include in Net Worth</em> is on)',
          '<strong>Physical assets</strong> \u2014 Real estate, vehicles, investments, collectibles (current value)',
        ],
      },
      {
        type: 'heading',
        content: 'What counts as a liability',
        level: 2,
        id: 'liabilities',
      },
      {
        type: 'list',
        content: '',
        items: [
          '<strong>Credit cards</strong> \u2014 Outstanding balance on credit card accounts',
          '<strong>Loans</strong> \u2014 Mortgages, personal loans, and other loan accounts',
        ],
      },
      {
        type: 'heading',
        content: 'Multi-currency conversion',
        level: 2,
        id: 'multi-currency',
      },
      {
        type: 'paragraph',
        content:
          'Each account and asset stores its value in its original currency. When calculating net worth, every amount is converted to your <strong>base currency</strong> using the latest exchange rates before summing.',
      },
      {
        type: 'infoBox',
        content:
          'You can exclude individual accounts or assets from net worth calculations by toggling <em>Include in Net Worth</em> off.',
        title: 'Tip',
        icon: '\u{1F4A1}',
      },
    ],
  },
  {
    slug: 'cash-flow-and-savings-rate',
    category: 'how-it-works',
    title: 'Cash Flow & Savings Rate',
    excerpt:
      'How monthly income, expenses, cash flow, and savings rate are calculated on the dashboard.',
    icon: '\u{1F4B0}',
    readTime: 3,
    popular: true,
    updatedDate: '2026-03-09',
    sections: [
      {
        type: 'heading',
        content: 'Monthly income',
        level: 2,
        id: 'monthly-income',
      },
      {
        type: 'paragraph',
        content:
          'Monthly income is the sum of all <strong>income transactions</strong> in the current month, plus the monthly value of <strong>recurring income</strong> items. All amounts are converted to your base currency.',
      },
      {
        type: 'heading',
        content: 'Monthly expenses',
        level: 2,
        id: 'monthly-expenses',
      },
      {
        type: 'paragraph',
        content:
          'Monthly expenses follow the same pattern: one-time expense transactions this month, plus the monthly value of recurring expenses.',
      },
      {
        type: 'heading',
        content: 'Net cash flow',
        level: 2,
        id: 'net-cash-flow',
      },
      {
        type: 'codeBlock',
        content: 'Net Cash Flow = Monthly Income - Monthly Expenses',
      },
      {
        type: 'paragraph',
        content:
          "A positive cash flow means you're earning more than you're spending. A negative cash flow means you're spending more than you earn.",
      },
      {
        type: 'heading',
        content: 'Savings rate',
        level: 2,
        id: 'savings-rate',
      },
      {
        type: 'codeBlock',
        content: 'Savings Rate = (Net Cash Flow / Monthly Income) \u00D7 100%',
      },
      {
        type: 'paragraph',
        content:
          "The savings rate shows what percentage of your income you're keeping. A higher rate means faster progress towards your goals.",
      },
      {
        type: 'infoBox',
        content:
          'If monthly income is zero, the savings rate displays as 0% to avoid division by zero.',
        title: 'Edge case',
        icon: '\u{1F9EE}',
      },
    ],
  },
  {
    slug: 'dashboard-summary-cards',
    category: 'how-it-works',
    title: 'Dashboard Summary Cards',
    excerpt: 'What each card on the dashboard shows and how the numbers are derived.',
    icon: '\u{1F3E0}',
    readTime: 3,
    updatedDate: '2026-03-09',
    sections: [
      {
        type: 'heading',
        content: 'Overview',
        level: 2,
        id: 'overview',
      },
      {
        type: 'paragraph',
        content:
          'The Piggy Bank dashboard shows four summary cards at the top, giving you a quick snapshot of your financial health:',
      },
      {
        type: 'heading',
        content: 'Net Worth',
        level: 2,
        id: 'net-worth-card',
      },
      {
        type: 'paragraph',
        content:
          'Shows your combined net worth across all accounts and assets, minus liabilities. The trend arrow compares this month to last month.',
      },
      {
        type: 'heading',
        content: 'Monthly Income',
        level: 2,
        id: 'income-card',
      },
      {
        type: 'paragraph',
        content:
          'Total income this month from one-time transactions plus recurring income. The comparison shows the change from the previous month.',
      },
      {
        type: 'heading',
        content: 'Monthly Expenses',
        level: 2,
        id: 'expenses-card',
      },
      {
        type: 'paragraph',
        content:
          'Total spending this month. For expenses, a decrease (negative trend) is shown in green since spending less is generally good.',
      },
      {
        type: 'heading',
        content: 'Cash Flow',
        level: 2,
        id: 'cash-flow-card',
      },
      {
        type: 'paragraph',
        content:
          'Income minus expenses for the current month. The savings rate percentage is shown alongside. Green when positive, Heritage Orange when negative.',
      },
    ],
  },
  {
    slug: 'your-daily-briefing',
    category: 'how-it-works',
    title: 'Your Daily Briefing',
    excerpt:
      'How beanies.family decides what appears in the orange box on your Family Nook — your personal daily briefing of things that need your attention.',
    icon: '\u{1F4CB}',
    readTime: 4,
    popular: true,
    updatedDate: '2026-03-27',
    sections: [
      {
        type: 'heading',
        content: 'What is the daily briefing?',
        level: 2,
        id: 'what-is-it',
      },
      {
        type: 'paragraph',
        content:
          'When you open the <strong>Family Nook</strong>, you might notice a warm orange box near the top of the page. This is your <strong>daily briefing</strong> \u2014 a personal summary of the things that need <em>your</em> attention today. Think of it as a friendly tap on the shoulder: "Hey, here\u2019s what\u2019s on your plate."',
      },
      {
        type: 'heading',
        content: 'Why does it exist?',
        level: 2,
        id: 'why-it-exists',
      },
      {
        type: 'paragraph',
        content:
          'Family life is busy. Activities, to-dos, pickups, drop-offs \u2014 it\u2019s a lot to keep track of. The daily briefing pulls together the most important things <em>you personally</em> need to do today, so you don\u2019t have to dig through calendars and task lists to figure out what\u2019s next.',
      },
      {
        type: 'callout',
        content:
          'The daily briefing is personal \u2014 it only shows items assigned to <em>you</em>. Other family members see their own briefing when they sign in. Family-wide schedules live in the <strong>Family Planner</strong> and <strong>To-Do</strong> pages.',
        title: 'It\u2019s just for you',
        icon: '\u{1F464}',
      },
      {
        type: 'heading',
        content: 'What shows up in the briefing?',
        level: 2,
        id: 'what-shows-up',
      },
      {
        type: 'paragraph',
        content:
          'Two types of items can appear: <strong>activities</strong> happening today and <strong>to-dos</strong> that need your attention. Here\u2019s exactly how each one works.',
      },
      {
        type: 'heading',
        content: 'Activities',
        level: 3,
        id: 'activities',
      },
      {
        type: 'paragraph',
        content:
          'An activity appears in your briefing if it\u2019s <strong>scheduled for today</strong> and you\u2019re involved in one of these ways:',
      },
      {
        type: 'list',
        content: '',
        items: [
          '<strong>You\u2019re on pickup duty</strong> \u{1F697} \u2014 You\u2019ll see a reminder like <em>"Don\u2019t forget to pick up Mia from Swimming at 4:30 PM today!"</em> The time shown is when the activity <em>ends</em>, so you know when to be there.',
          '<strong>You\u2019re on drop-off duty</strong> \u{1F697} \u2014 You\u2019ll see something like <em>"Time to drop off Mia at Swimming at 9:00 AM!"</em> The time shown is when the activity <em>starts</em>, so you can plan your morning.',
          '<strong>You\u2019re assigned to the activity</strong> \u2014 If you\u2019re listed as a participant (but not specifically on pickup or drop-off), you\u2019ll see <em>"You have Swimming at 9:00 AM today!"</em>',
        ],
      },
      {
        type: 'infoBox',
        content:
          'If you\u2019re both the drop-off <em>and</em> pickup person for the same activity, you\u2019ll see the pickup reminder (since that\u2019s the one you\u2019re most likely to forget). You won\u2019t get duplicate messages for the same activity.',
        title: 'No duplicates',
        icon: '\u2728',
      },
      {
        type: 'heading',
        content: 'To-dos',
        level: 3,
        id: 'todos',
      },
      {
        type: 'paragraph',
        content:
          'A to-do appears in your briefing if it\u2019s <strong>assigned to you</strong>, <strong>not yet completed</strong>, and meets one of these conditions:',
      },
      {
        type: 'list',
        content: '',
        items: [
          '<strong>Due today</strong> \u{1F4CB} \u2014 <em>"Don\u2019t forget: Buy birthday present today!"</em>',
          '<strong>Overdue</strong> \u23F0 \u2014 If it was due yesterday or earlier, you\u2019ll get a gentle nudge: <em>"A gentle reminder: Buy birthday present \u2014 it was due March 25"</em>',
          '<strong>No due date</strong> \u{1F4CB} \u2014 If someone assigned you a to-do without a deadline, it still shows up because it\u2019s waiting for you: <em>"Don\u2019t forget: Buy birthday present"</em>',
        ],
      },
      {
        type: 'paragraph',
        content:
          'If another family member created the to-do and assigned it to you, the message will mention their name \u2014 for example, <em>"Dad asked you: Buy birthday present today!"</em> This way you know who to ask if you have questions.',
      },
      {
        type: 'callout',
        content:
          'To-dos with a due date <em>in the future</em> (not today, not overdue) won\u2019t appear in the briefing yet. They\u2019ll show up when the day comes.',
        title: 'Future to-dos',
        icon: '\u{1F4C5}',
      },
      {
        type: 'heading',
        content: 'How items are sorted',
        level: 2,
        id: 'sorting',
      },
      {
        type: 'paragraph',
        content:
          'Items with a specific time come first, sorted from earliest to latest \u2014 so your 8 AM drop-off appears before your 4 PM pickup. Items without a time (like most to-dos) appear after all the timed items.',
      },
      {
        type: 'heading',
        content: 'The five-item limit',
        level: 2,
        id: 'five-item-limit',
      },
      {
        type: 'paragraph',
        content:
          'To keep the briefing quick and scannable, it shows a maximum of <strong>five items</strong>. If you have more than five things on your plate, you\u2019ll see a message like <em>"+3 more for you today"</em> at the bottom. You can find the full picture on the <strong>Family Planner</strong> and <strong>To-Do</strong> pages.',
      },
      {
        type: 'heading',
        content: 'When the briefing is hidden',
        level: 2,
        id: 'when-hidden',
      },
      {
        type: 'paragraph',
        content:
          'If you have nothing that needs your attention today \u2014 no activities, no to-dos due, no overdue items \u2014 the orange box won\u2019t appear at all. A clean Nook means a clean day. Enjoy it!',
      },
      {
        type: 'heading',
        content: 'Tapping on items',
        level: 2,
        id: 'tapping-items',
      },
      {
        type: 'paragraph',
        content:
          'Each item in the briefing is tappable. Tap an activity to open it in the <strong>Family Planner</strong>, or tap a to-do to view and edit it. It\u2019s a quick way to get to the details without leaving the Nook.',
      },
    ],
  },
  {
    slug: 'budget-pace-status-logic',
    category: 'how-it-works',
    title: 'Budget Pace Status Logic',
    excerpt:
      "How beanies.family determines if you're on track, ahead, or over budget throughout the month.",
    icon: '\u{1F3C3}',
    readTime: 3,
    updatedDate: '2026-03-09',
    sections: [
      {
        type: 'heading',
        content: 'What is pace status?',
        level: 2,
        id: 'what-is-pace',
      },
      {
        type: 'paragraph',
        content:
          'Pace status compares your actual spending to where you <em>should</em> be at this point in the month, assuming even spending throughout.',
      },
      {
        type: 'heading',
        content: 'The calculation',
        level: 2,
        id: 'calculation',
      },
      {
        type: 'codeBlock',
        content:
          'Day of month:     15 of 30\nExpected pace:    50% of budget\nActual spending:  $1,200 of $3,000 budget = 40%\nPace status:      Great (well under pace)',
      },
      {
        type: 'heading',
        content: 'Status levels',
        level: 2,
        id: 'status-levels',
      },
      {
        type: 'list',
        content: '',
        items: [
          '<strong>Great</strong> \u2014 Spending is well below the expected pace for the day of the month',
          '<strong>On Track</strong> \u2014 Spending is roughly aligned with the expected pace',
          '<strong>Caution</strong> \u2014 Spending is slightly ahead of pace \u2014 slow down to stay within budget',
          "<strong>Over Budget</strong> \u2014 You've already exceeded your monthly budget, regardless of the day",
        ],
      },
      {
        type: 'heading',
        content: 'Category-level status',
        level: 2,
        id: 'category-status',
      },
      {
        type: 'paragraph',
        content: 'Individual spending categories also have status indicators:',
      },
      {
        type: 'list',
        content: '',
        items: [
          '<strong>OK</strong> \u2014 Under 75% of the category limit',
          '<strong>Warning</strong> \u2014 Between 75% and 100% of the limit',
          '<strong>Over</strong> \u2014 Exceeded the category limit',
        ],
      },
      {
        type: 'infoBox',
        content:
          'In <strong>percentage mode</strong>, the spending budget is derived from your actual monthly income. If your income changes, your budget adjusts automatically.',
        title: 'Dynamic budgets',
        icon: '\u{1F504}',
      },
    ],
  },
];

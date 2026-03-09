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

import type { HelpArticle } from './types';

export const FEATURES_ARTICLES: HelpArticle[] = [
  {
    slug: 'managing-accounts',
    category: 'features',
    title: 'Managing Accounts',
    excerpt:
      'Add bank accounts, credit cards, investments, and more. Track balances across your entire family.',
    icon: '\u{1F3E6}',
    readTime: 3,
    updatedDate: '2026-03-09',
    sections: [
      {
        type: 'heading',
        content: 'Account types',
        level: 2,
        id: 'account-types',
      },
      {
        type: 'paragraph',
        content:
          'beanies.family supports a range of account types to match your real-world finances:',
      },
      {
        type: 'list',
        content: '',
        items: [
          '<strong>Checking</strong> \u2014 Everyday spending accounts',
          '<strong>Savings</strong> \u2014 Savings and deposit accounts',
          '<strong>Credit Card</strong> \u2014 Credit cards (treated as liabilities)',
          '<strong>Investment</strong> \u2014 Brokerage and investment accounts',
          '<strong>Crypto</strong> \u2014 Cryptocurrency wallets and exchanges',
          '<strong>Cash</strong> \u2014 Physical cash on hand',
          '<strong>Loan</strong> \u2014 Mortgages, personal loans, etc. (treated as liabilities)',
          '<strong>Other</strong> \u2014 Anything else',
        ],
      },
      {
        type: 'heading',
        content: 'Adding an account',
        level: 2,
        id: 'adding-account',
      },
      {
        type: 'steps',
        content: '',
        items: [
          'Go to <strong>Accounts</strong> in the Piggy Bank section',
          'Click <strong>Add Account</strong>',
          'Choose the account type, name, currency, and starting balance',
          'Assign it to a family member',
          'Toggle <strong>Include in Net Worth</strong> if it should count towards your totals',
        ],
      },
      {
        type: 'infoBox',
        content:
          'Credit cards and loans are automatically subtracted from your net worth. Their balance represents what you owe.',
        title: 'Liabilities',
        icon: '\u{1F4B3}',
      },
    ],
  },
  {
    slug: 'recording-transactions',
    category: 'features',
    title: 'Recording Transactions',
    excerpt:
      'Track income, expenses, and transfers between accounts with categories and recurring schedules.',
    icon: '\u{1F4B8}',
    readTime: 3,
    updatedDate: '2026-03-09',
    sections: [
      {
        type: 'heading',
        content: 'Transaction types',
        level: 2,
        id: 'transaction-types',
      },
      {
        type: 'list',
        content: '',
        items: [
          '<strong>Income</strong> \u2014 Money coming in (salary, freelance, gifts, etc.)',
          '<strong>Expense</strong> \u2014 Money going out (groceries, bills, entertainment, etc.)',
          '<strong>Transfer</strong> \u2014 Moving money between your own accounts',
        ],
      },
      {
        type: 'heading',
        content: 'Adding a transaction',
        level: 2,
        id: 'adding-transaction',
      },
      {
        type: 'steps',
        content: '',
        items: [
          'Go to <strong>Transactions</strong> in the Piggy Bank section',
          'Click <strong>Add Transaction</strong>',
          'Choose the type (income, expense, or transfer)',
          'Select the account, enter the amount, and pick a category',
          'Add a date and optional description',
        ],
      },
      {
        type: 'heading',
        content: 'Recurring transactions',
        level: 2,
        id: 'recurring',
      },
      {
        type: 'paragraph',
        content:
          'For regular income or bills, toggle <strong>Recurring</strong> when creating a transaction. You can set daily, weekly, monthly, or yearly schedules. Recurring transactions are automatically generated and show up on your calendar in the Family Planner.',
      },
      {
        type: 'heading',
        content: 'Categories',
        level: 2,
        id: 'categories',
      },
      {
        type: 'paragraph',
        content:
          'Transactions are organised into categories (Housing, Food, Transport, etc.) for budgeting and reporting. Each category has a colour and icon for easy visual identification.',
      },
    ],
  },
  {
    slug: 'setting-and-tracking-goals',
    category: 'features',
    title: 'Setting & Tracking Goals',
    excerpt:
      'Set savings goals, debt payoff targets, and purchase plans. Track progress with visual indicators.',
    icon: '\u{1F3AF}',
    readTime: 3,
    updatedDate: '2026-03-09',
    sections: [
      {
        type: 'heading',
        content: 'Goal types',
        level: 2,
        id: 'goal-types',
      },
      {
        type: 'list',
        content: '',
        items: [
          '<strong>Savings</strong> \u2014 Save towards a target amount',
          '<strong>Debt Payoff</strong> \u2014 Track progress paying down a debt',
          '<strong>Investment</strong> \u2014 Grow an investment to a target value',
          '<strong>Purchase</strong> \u2014 Save up for a specific purchase',
        ],
      },
      {
        type: 'heading',
        content: 'Creating a goal',
        level: 2,
        id: 'creating-goal',
      },
      {
        type: 'steps',
        content: '',
        items: [
          'Go to <strong>Goals</strong> in the Piggy Bank section',
          'Click <strong>Add Goal</strong>',
          'Name your goal, set the target amount, and pick a type',
          'Optionally set a deadline and priority level',
          'Assign it to a family member or keep it as a family-wide goal',
        ],
      },
      {
        type: 'heading',
        content: 'Tracking progress',
        level: 2,
        id: 'tracking-progress',
      },
      {
        type: 'paragraph',
        content:
          "Update the current amount as you make progress. The goal card shows a visual progress bar and percentage. When you hit 100%, you'll see a celebration animation!",
      },
      {
        type: 'infoBox',
        content:
          'Set priority to <strong>Critical</strong> or <strong>High</strong> to pin goals to the top of your list and see them on the dashboard.',
        title: 'Tip',
        icon: '\u{1F4A1}',
      },
    ],
  },
  {
    slug: 'budgets-and-category-limits',
    category: 'features',
    title: 'Budgets & Category Limits',
    excerpt:
      'Set monthly budgets with per-category spending limits. Track your pace throughout the month.',
    icon: '\u{1F4B5}',
    readTime: 4,
    popular: true,
    updatedDate: '2026-03-09',
    sections: [
      {
        type: 'heading',
        content: 'Budget modes',
        level: 2,
        id: 'budget-modes',
      },
      {
        type: 'paragraph',
        content: 'beanies.family offers two budget modes:',
      },
      {
        type: 'list',
        content: '',
        items: [
          '<strong>Fixed amount</strong> \u2014 Set a specific monthly spending limit (e.g. $3,000)',
          '<strong>Percentage of income</strong> \u2014 Set a savings target as a percentage, and the spending budget is calculated from your actual income (e.g. save 20% = spend 80%)',
        ],
      },
      {
        type: 'heading',
        content: 'Category limits',
        level: 2,
        id: 'category-limits',
      },
      {
        type: 'paragraph',
        content:
          'Within your budget, you can set limits for individual spending categories (e.g. $500 for Food, $200 for Entertainment). Category cards show a progress bar and status:',
      },
      {
        type: 'list',
        content: '',
        items: [
          '<strong>OK</strong> \u2014 Under 75% of the limit',
          '<strong>Warning</strong> \u2014 Between 75% and 100%',
          '<strong>Over</strong> \u2014 Exceeded the limit',
        ],
      },
      {
        type: 'heading',
        content: 'Pace status',
        level: 2,
        id: 'pace-status',
      },
      {
        type: 'paragraph',
        content:
          'The budget summary card shows your <strong>pace status</strong> \u2014 how your spending compares to where you should be at this point in the month:',
      },
      {
        type: 'list',
        content: '',
        items: [
          '<strong>Great</strong> \u2014 Well under pace',
          '<strong>On Track</strong> \u2014 Spending is roughly on pace',
          '<strong>Caution</strong> \u2014 Slightly ahead of pace',
          '<strong>Over Budget</strong> \u2014 Already exceeded your monthly budget',
        ],
      },
    ],
  },
  {
    slug: 'family-planner-and-activities',
    category: 'features',
    title: 'Family Planner & Activities',
    excerpt:
      'Schedule lessons, appointments, and recurring activities for your family with calendar views and smart recurrence.',
    icon: '\u{1F4C5}',
    readTime: 4,
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
          "The <strong>Family Planner</strong> is your calendar hub for scheduling and tracking family activities \u2014 lessons, sports, appointments, social events, and more. View your family's schedule at a glance with the month calendar, day agenda, and upcoming activities list.",
      },
      {
        type: 'heading',
        content: 'Creating activities',
        level: 2,
        id: 'creating',
      },
      {
        type: 'paragraph',
        content:
          'Click <strong>+ Add Activity</strong> to open the activity form. Give it a title, pick a category (lesson, sport, appointment, social, pickup, or other), and set a date. You can assign the activity to a specific family member and add a start/end time.',
      },
      {
        type: 'paragraph',
        content:
          'Activities can be <strong>one-off</strong> (a single date) or <strong>recurring</strong> (repeating on a schedule). Toggle between these modes at the top of the form.',
      },
      {
        type: 'heading',
        content: 'Recurring activities',
        level: 2,
        id: 'recurring',
      },
      {
        type: 'paragraph',
        content: 'Recurring activities repeat on a schedule you define. Supported frequencies:',
      },
      {
        type: 'list',
        content: '',
        items: [
          '<strong>Weekly</strong> \u2014 Repeats every week. Select specific days (e.g., Monday and Wednesday) for multi-day schedules.',
          '<strong>Daily</strong> \u2014 Repeats every day.',
          '<strong>Monthly</strong> \u2014 Repeats on the same day each month.',
          '<strong>Yearly</strong> \u2014 Repeats on the same date each year.',
        ],
      },
      {
        type: 'paragraph',
        content:
          'You can set an optional <strong>end date</strong> for recurring activities. No new occurrences will be generated after this date.',
      },
      {
        type: 'heading',
        content: 'Editing a single occurrence',
        level: 2,
        id: 'editing-occurrence',
      },
      {
        type: 'paragraph',
        content:
          "When you tap on an occurrence of a recurring activity and click <strong>Edit</strong>, you'll see three options:",
      },
      {
        type: 'list',
        content: '',
        items: [
          '<strong>This Occurrence Only</strong> \u2014 Changes only this specific date. A one-off copy is created, leaving all other occurrences untouched.',
          '<strong>This & All Future</strong> \u2014 Splits the schedule at this date. The original ends the day before, and a new schedule starts from this date with your changes.',
          '<strong>All Occurrences</strong> \u2014 Updates the entire recurring template. Every past and future occurrence reflects the change.',
        ],
      },
      {
        type: 'callout',
        content:
          'The same options appear when deleting a recurring activity occurrence. You can remove just one date, end the schedule from a certain point, or delete the entire series.',
        title: 'Tip',
        icon: '\u{1F4A1}',
      },
      {
        type: 'heading',
        content: 'Activity details',
        level: 2,
        id: 'details',
      },
      {
        type: 'paragraph',
        content: 'Each activity can include additional details:',
      },
      {
        type: 'list',
        content: '',
        items: [
          '<strong>Location</strong> \u2014 Where the activity takes place.',
          '<strong>Transport</strong> \u2014 Assign family members for dropoff and pickup.',
          '<strong>Instructor / Coach</strong> \u2014 Name and contact information.',
          '<strong>Notes</strong> \u2014 Any additional information.',
          '<strong>Fees</strong> \u2014 Track costs per session, month, or term.',
        ],
      },
      {
        type: 'heading',
        content: 'Calendar views',
        level: 2,
        id: 'calendar-views',
      },
      {
        type: 'paragraph',
        content: 'The planner offers multiple ways to view your schedule:',
      },
      {
        type: 'list',
        content: '',
        items: [
          '<strong>Month view</strong> \u2014 A calendar grid showing activity dots on each day. Click a day to open the day agenda sidebar.',
          '<strong>Day agenda</strong> \u2014 A sidebar showing all activities for a selected day, sorted by time.',
          '<strong>Upcoming activities</strong> \u2014 A list of the next 30 activities across all family members.',
        ],
      },
      {
        type: 'heading',
        content: 'Inline editing',
        level: 2,
        id: 'inline-editing',
      },
      {
        type: 'paragraph',
        content:
          'Tap any activity to open its detail view. From there, you can edit most fields directly \u2014 title, time, location, assignee, transport, instructor, and notes \u2014 without opening the full edit form. Changes save automatically when you click away.',
      },
    ],
  },
];

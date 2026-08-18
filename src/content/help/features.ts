import type { HelpArticle } from './types';

export const FEATURES_ARTICLES: HelpArticle[] = [
  {
    slug: 'transfers-and-credit-card-payments',
    category: 'features',
    title: 'Transfers & credit-card payments',
    excerpt:
      'Move money between your own accounts — and pay down or spend on a credit card — so every balance stays right.',
    icon: '\u{1F504}',
    readTime: 3,
    updatedDate: '2026-07-08',
    sections: [
      {
        type: 'paragraph',
        content:
          'Sometimes money just moves from one of your accounts to another — savings from checking, cash to a family member, or a payment to your credit card. A <strong>transfer</strong> records exactly that: it takes the amount out of one account and puts it into the other, in a single step.',
      },
      {
        type: 'heading',
        content: 'Move money between accounts',
        level: 2,
        id: 'transfers',
      },
      {
        type: 'steps',
        content: '',
        items: [
          'Tap <strong>Add transaction</strong>.',
          'At the top, choose <strong>🔄 Transfer</strong>.',
          'Pick the account the money leaves (<strong>From</strong>) and where it lands (<strong>To</strong>).',
          'Enter the amount and tap <strong>Add Transfer</strong>. Both balances update right away.',
        ],
      },
      {
        type: 'heading',
        content: 'Paying a credit card',
        level: 2,
        id: 'card-payments',
      },
      {
        type: 'paragraph',
        content:
          'Paying a card <em>is</em> a transfer — money leaves your checking or cash account and goes <strong>to</strong> the card. Choose your funding account as <strong>From</strong> and the card as <strong>To</strong>; the payment lowers what you owe on the card and the cash you paid with. beanies reminds you of this right under the destination.',
      },
      {
        type: 'heading',
        content: 'Spending on a credit card',
        level: 2,
        id: 'card-spending',
      },
      {
        type: 'paragraph',
        content:
          'To record a purchase you made on a card, add a normal <strong>expense</strong> and pick the card as the account. That raises what you owe on it — the mirror image of a payment. (When the money genuinely moves between two accounts, use a transfer instead.)',
      },
      {
        type: 'heading',
        content: 'Accounts in different currencies',
        level: 2,
        id: 'cross-currency',
      },
      {
        type: 'paragraph',
        content:
          "If the two accounts use different currencies, beanies converts the amount at today's rate and shows you exactly what will arrive before you save. If there's no rate for that pair yet, add one in <strong>Settings → Currencies</strong> and the transfer will convert automatically.",
      },
      {
        type: 'infoBox',
        content:
          'If you tracked a credit card or loan before this update by logging its spending directly on the card, take a quick look at that account’s balance once. Going forward, a purchase on a card raises what you owe and a payment lowers it — the way you’d expect.',
      },
    ],
  },
  {
    slug: 'planning-your-familys-meals',
    category: 'features',
    title: "Planning your family's meals",
    excerpt:
      "Plan the week from your cookbook — who's cooking what, when — and share it so nobody has to ask what's for dinner.",
    icon: '\u{1F372}',
    readTime: 3,
    updatedDate: '2026-08-18',
    sections: [
      {
        type: 'paragraph',
        content:
          "The <strong>Meal Planner</strong> (under 🌳 the Treehouse) lays your week out as a board — days across the top, meals down the side. Plan breakfast, lunch, dinner and as many snacks as you like, say who's cooking, and share the whole thing with the family.",
      },
      {
        type: 'heading',
        content: 'Add a meal',
        level: 2,
        id: 'add-a-meal',
      },
      {
        type: 'paragraph',
        content:
          'On a computer, drag a recipe from your cookbook straight onto a day. On a phone, tap a slot and pick one. If the recipe is not in your cookbook yet, just type its name — beanies adds it as a quick recipe you can fill in later.',
      },
      {
        type: 'list',
        content: '',
        items: [
          "<strong>Who's cooking</strong> — assign a cook; it shows on the meal and in that person's daily briefing (no phone reminder in this version).",
          "<strong>Who's eating</strong> — pick family members, and add guests by name for the night someone's over.",
          '<strong>Eating out, leftovers or skipping?</strong> — drop one of those in instead of a recipe. No recipe needed.',
        ],
      },
      {
        type: 'heading',
        content: 'Mark a meal cooked',
        level: 2,
        id: 'mark-cooked',
      },
      {
        type: 'paragraph',
        content:
          "Open a planned meal and tap <strong>Mark cooked</strong>. beanies opens the cook-log so you can give it a quick rating — that entry is saved to the recipe's history, so your cookbook remembers how it went.",
      },
      {
        type: 'heading',
        content: 'Copy a week & share',
        level: 2,
        id: 'copy-and-share',
      },
      {
        type: 'paragraph',
        content:
          'Had a good week? Tap <strong>Copy last week</strong> to reuse it — meals and cooks come across, ready to tweak. You can also open any past week from the arrows and copy it forward. Tap <strong>Share</strong> to send the day or the whole week to the family over WhatsApp, Messages or wherever you chat.',
      },
      {
        type: 'infoBox',
        content:
          "Copying a week <strong>replaces</strong> whatever was already planned in the target week — beanies warns you first. Anything you'd already marked cooked keeps its history. Sharing sends the whole family's plan for that day or week, so everyone sees the same list.",
      },
    ],
  },
  {
    slug: 'notifications',
    category: 'features',
    title: 'Notifications & reminders — staying on top of what needs you',
    excerpt:
      "The bell in your header keeps track of what's coming due, assigned, and coming up — and the app can give you a timely heads-up before activities, travel and timed to-dos start.",
    icon: '\u{1F514}',
    readTime: 4,
    updatedDate: '2026-07-23',
    sections: [
      {
        type: 'paragraph',
        content:
          "Family life has a lot of moving parts. The notification bell in the top bar gathers the things that need <em>you</em> into one calm place, with warm orange ring-lines beside it when there's something unread. Tap it to open your notifications.",
      },
      {
        type: 'heading',
        content: 'What the bell shows',
        level: 2,
        id: 'what-it-shows',
      },
      {
        type: 'list',
        content: '',
        items: [
          "<strong>Tasks coming due</strong> — a to-do that's yours, with a due date: in the morning for all-day tasks, or about 30 minutes before for tasks with a time. If it slips past due, it's gently flagged as overdue.",
          '<strong>Tasks assigned to you</strong> — when a family member gives you something to do (and for your own no-deadline reminders, so they’re never lost).',
          "<strong>Events coming up</strong> — activities you're part of — whether you're going, dropping off, or picking up — around their reminder time.",
          "<strong>What's new</strong> — each beanies.family update now lives in the bell instead of popping up over your screen.",
          "<strong>Today's tip</strong> — one small tip a day from the beanies, with a 💡 icon. Tap to read the full tip and try the feature it points to.",
        ],
      },
      {
        type: 'heading',
        content: 'Reading, clearing, and re-opening',
        level: 2,
        id: 'reading',
      },
      {
        type: 'steps',
        content: '',
        items: [
          'Tap the <strong>bell</strong> to see your list, grouped by day.',
          'Tap any notification to open its details — that marks it read.',
          'From the details, tap <strong>Open</strong> to jump straight to the task or event, or <strong>Mark unread</strong> if you want to come back to it.',
          'Tap <strong>Mark all read</strong> to clear everything at once — the dot disappears everywhere.',
        ],
      },
      {
        type: 'heading',
        content: 'Reminders before things start',
        level: 2,
        id: 'reminders',
      },
      {
        type: 'paragraph',
        content:
          'On the beanies app (iOS and Android), you can get a notification <em>before</em> something starts — a drop-off, a flight, a timed to-do — so you leave and prepare on time, even when the app is closed. Reminders arrive ahead of the event, not the moment it begins.',
      },
      {
        type: 'steps',
        content: '',
        items: [
          'Open <strong>Settings → Reminders</strong> and turn on <strong>Reminders on this device</strong>.',
          'The first time, your phone asks permission to send notifications — tap <strong>Allow</strong>.',
          'Under <strong>How much notice?</strong>, choose how far ahead each kind arrives.',
        ],
      },
      {
        type: 'list',
        content: '',
        items: [
          '<strong>Activities</strong> use the reminder time set on each activity, so you can give an important one more notice.',
          '<strong>Travel</strong> reminds you before each departure — flights and cruises two hours ahead by default, trains and ferries one hour, all adjustable.',
          '<strong>Timed to-dos</strong> (ones with a time) remind you a set amount before they’re due.',
        ],
      },
      {
        type: 'infoBox',
        content:
          'Reminders are per-device: turning them off on your phone doesn’t affect your tablet or your partner’s phone. Each device sends its own, from the same family plan.',
        title: 'Set per device',
        icon: '\u{1F4F1}',
      },
      {
        type: 'infoBox',
        content:
          'If notifications are switched off for beanies in your phone’s settings, reminders can’t be sent — but nothing is lost: the bell and your daily briefing still show everything the moment you open the app. Turn them back on any time in your device’s notification settings.',
        title: 'If reminders are off',
        icon: '\u{1F514}',
      },
      {
        type: 'heading',
        content: 'A daily tip from the beanies',
        level: 2,
        id: 'daily-tip',
      },
      {
        type: 'paragraph',
        content:
          "Once a day, the beanies drop a small tip in the bell: a feature you might've missed, a habit that helps, a corner of the app worth exploring. Each tip has a 💡 icon and a <strong>try it →</strong> link to the spot it talks about.",
      },
      {
        type: 'paragraph',
        content:
          "Tips stay in the bell after you've read them, so you can always scroll back to one you liked. If you'd rather not see new ones, turn them off in <strong>Settings → Appearance → Daily Tips</strong>. The tips already in your bell stay there; only future ones stop appearing.",
      },
      {
        type: 'infoBox',
        content:
          'Tips are per-device: you may see a different tip on your phone than on your laptop. That keeps them light, just a small daily nudge wherever you happen to open the app.',
        title: 'One tip per device, per day',
        icon: '\u{1F4A1}',
      },
      {
        type: 'infoBox',
        content:
          "Reading a notification on one device clears the dot on your others — your read-state travels with your family file. (Your family already shares the underlying tasks and events; only which ones you've read is added.)",
        title: 'It follows you across devices',
        icon: '\u{1F4F1}',
      },
      {
        type: 'infoBox',
        content:
          'The bell and your daily briefing work everywhere — phone, tablet and the web app. The timed reminders described above are delivered by the iOS and Android apps; on the web the same items still appear in your briefing when you open beanies.',
        title: 'Where reminders reach you',
        icon: '\u{1F331}',
      },
    ],
  },
  {
    slug: 'helpful-hints',
    category: 'features',
    title: 'Helpful Hints — gentle reminders before the things that matter',
    excerpt:
      'Ahead of birthdays, parties, and trips, beanies can drop a gentle, clearly-marked suggestion into your family to-do list — buy a present, start packing, check passports — so the obvious prep never slips.',
    icon: '\u{1F4A1}',
    readTime: 3,
    updatedDate: '2026-07-24',
    sections: [
      {
        type: 'paragraph',
        content:
          'Some prep is obvious in hindsight: a present before a birthday, a bag before a trip, passports before you fly. Helpful Hints notices what is coming up on your calendar and quietly adds a suggested to-do a little ahead of time, so nothing important gets forgotten in the rush.',
      },
      {
        type: 'heading',
        content: 'What is a hint, and how is it different from my own to-dos?',
        level: 2,
        id: 'what-is-a-hint',
      },
      {
        type: 'paragraph',
        content:
          'A hint is a suggested to-do beanies added for you — not something you typed. It sits at the top of your to-do list in a soft warm card with a <strong>Hint</strong> tag and a little icon, so it never looks like one of your own tasks. Tap the <strong>?</strong> beside it any time to remember what it is. Each hint also gives you a gentle notification around the time it appears, using your normal reminder settings.',
      },
      {
        type: 'heading',
        content: 'What can I do with a hint?',
        level: 2,
        id: 'keep-or-dismiss',
      },
      {
        type: 'list',
        content: '',
        items: [
          '<strong>Keep it</strong> (the 📌 button) — the hint becomes a normal to-do you own: assign it, add a due time, tick it off. It keeps a small marker so you remember where it came from.',
          '<strong>Dismiss it</strong> (the ✕ button) — one tap and it is gone, no confirmation.',
          '<strong>Ignore it</strong> — do nothing, and the hint quietly disappears on its own once the event has passed. It never nags and never turns red.',
        ],
      },
      {
        type: 'heading',
        content: 'Which events create hints?',
        level: 2,
        id: 'which-events',
      },
      {
        type: 'list',
        content: '',
        items: [
          "<strong>Birthdays</strong> — a couple of weeks before a family member's birthday, the grown-ups get a nudge to plan a present or party.",
          '<strong>Parties &amp; celebrations</strong> — a couple of days before a birthday party, wedding, or other celebration on the calendar, the people going get a gift reminder.',
          '<strong>Anniversaries</strong> — a couple of weeks ahead, a nudge to plan something.',
          '<strong>Trips</strong> — a week before you travel, a reminder to check passports, visas and travel insurance; a couple of days before, a nudge to start packing.',
        ],
      },
      {
        type: 'heading',
        content: 'How do I turn hints on or off?',
        level: 2,
        id: 'settings',
      },
      {
        type: 'steps',
        content: '',
        items: [
          'Open <strong>Settings → Reminders</strong> and find <strong>Helpful Hints</strong>.',
          'The main switch turns hints on or off <strong>for the whole family</strong>. Off means no hints are created, and any not-yet-kept hints disappear for everyone.',
          'Below it, each kind of hint has its own switch. These control whether <em>you</em> get a notification for that kind on <em>this</em> device.',
        ],
      },
      {
        type: 'infoBox',
        content:
          'The birthday person never sees their own present hint — so a surprise stays a surprise. It shows up only for the grown-ups planning it.',
        title: 'Surprises stay secret',
        icon: '\u{1F381}',
      },
      {
        type: 'infoBox',
        content:
          'The per-kind switches only silence <em>your</em> notifications on the device you change them on. The hint itself still appears in the shared family to-do list for everyone — you just will not be pinged about it.',
        title: 'Your notifications, your device',
        icon: '\u{1F4F1}',
      },
    ],
  },
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
    slug: 'family-todo-lists',
    category: 'features',
    title: 'Family To-Do Lists',
    excerpt:
      'Create tasks, assign them to family members, set due dates, and track what gets done. Your shared family task board.',
    icon: '\u2705',
    readTime: 5,
    popular: true,
    updatedDate: '2026-05-13',
    sections: [
      {
        type: 'heading',
        content: 'Why to-do lists?',
        level: 2,
        id: 'why-todos',
      },
      {
        type: 'paragraph',
        content:
          'Family life runs on small tasks \u2014 pick up milk, sign the permission slip, call the dentist. The <strong>Family To-Do</strong> page gives everyone a shared place to track what needs doing, who\u2019s responsible, and what\u2019s already been ticked off. No more sticky notes on the fridge.',
      },
      {
        type: 'heading',
        content: 'Creating a to-do',
        level: 2,
        id: 'creating',
      },
      {
        type: 'paragraph',
        content: 'The quick-add bar at the top of the page is the fastest way to create a task.',
      },
      {
        type: 'steps',
        content: '',
        items: [
          'Go to <strong>To-Do</strong> in the Treehouse section of the sidebar',
          'Type your task in the <strong>What needs to be done?</strong> field',
          'Optionally, click the \u{1F4C5} calendar icon to set a <strong>due date</strong>',
          'Optionally, use the assignee picker to assign the task to one or more family members',
          'Click <strong>Add</strong> (or press <strong>Enter</strong>) to create the task',
        ],
      },
      {
        type: 'infoBox',
        content:
          'You don\u2019t need to fill in everything upfront. A title is all that\u2019s required \u2014 you can always add a due date, assignee, or description later by tapping on the task.',
        title: 'Keep it simple',
        icon: '\u{1F4A1}',
      },
      {
        type: 'heading',
        content: 'Viewing and editing a to-do',
        level: 2,
        id: 'editing',
      },
      {
        type: 'paragraph',
        content:
          'Tap any task to open its detail panel. From here you can edit everything about the task:',
      },
      {
        type: 'list',
        content: '',
        items: [
          '<strong>Title</strong> \u2014 Click the title text to rename it',
          '<strong>Due date</strong> \u2014 Click to set or change when the task is due',
          '<strong>Due time</strong> \u2014 Appears once a due date is set. Pick a specific time if needed',
          '<strong>Assignees</strong> \u2014 Assign the task to one or more family members',
          '<strong>Description</strong> \u2014 Add notes or extra details. Any links you include are automatically detected and shown as clickable buttons',
        ],
      },
      {
        type: 'paragraph',
        content:
          'The panel also shows who created the task and, if it\u2019s been completed, who completed it.',
      },
      {
        type: 'heading',
        content: 'Completing a to-do',
        level: 2,
        id: 'completing',
      },
      {
        type: 'paragraph',
        content: 'There are two ways to mark a task as done:',
      },
      {
        type: 'list',
        content: '',
        items: [
          '<strong>Tap the checkbox</strong> next to the task in the list \u2014 quick and satisfying',
          '<strong>Open the task</strong> and click <strong>Mark Completed</strong> at the bottom',
        ],
      },
      {
        type: 'paragraph',
        content:
          'Either way, you\u2019ll get a little celebration and the task moves to the <strong>Completed</strong> section at the bottom of the page. Changed your mind? You can reopen a completed task from its detail panel or by tapping the undo button.',
      },
      {
        type: 'heading',
        content: 'Someday \u00b7 Maybe to-dos',
        level: 2,
        id: 'someday-maybe',
      },
      {
        type: 'paragraph',
        content:
          'Not everything on your mind is a real commitment. <strong>Someday \u00b7 Maybe</strong> is for the loose ideas \u2014 \u201ctake the kids camping\u201d, \u201cre-do the garden\u201d, \u201clearn to bake sourdough\u201d \u2014 things you\u2019d <em>like</em> to get to one day but aren\u2019t scheduling and might never do. They stay visible so you don\u2019t lose the idea, without cluttering your real task list.',
      },
      {
        type: 'paragraph',
        content:
          'It\u2019s the difference between \u201cbuy a birthday present\u201d \u2014 a real to-do, even if it doesn\u2019t have a date yet \u2014 and \u201clearn to bake sourdough\u201d, which is a lovely idea with no pressure attached. Both belong on the To-Do page; only one of them should be nagging you in your daily briefing.',
      },
      {
        type: 'paragraph',
        content: 'There are two ways to park a task as Someday \u00b7 Maybe:',
      },
      {
        type: 'list',
        content: '',
        items: [
          'Open the task and switch <strong>Track as</strong> from <strong>\u{1F4CB} To-do</strong> to <strong>\u{1F4AD} Someday \u00b7 Maybe</strong>',
          'On a computer, hover over a task in the list and tap the <strong>\u{1F4AD}</strong> button to park it \u2014 or the <strong>\u{1F4CB}</strong> button on a parked task to make it active again',
        ],
      },
      {
        type: 'paragraph',
        content:
          'Someday \u00b7 Maybe tasks collect in their own <strong>\u{1F4AD} Someday \u00b7 Maybe</strong> section on the To-Do page, just below your open tasks. The section is always visible (it doesn\u2019t collapse) so the ideas stay in sight \u2014 but these tasks are deliberately kept <em>out of the way</em> everywhere you\u2019re meant to be focused: they don\u2019t appear in your <strong>daily briefing</strong>, the <strong>To-Do widget</strong> on the Family Nook, the planner sidebar, or the calendar.',
      },
      {
        type: 'infoBox',
        content:
          'Marking a task as Someday \u00b7 Maybe clears its due date and time \u2014 a someday item is, by definition, not scheduled. If you later switch it back to <strong>\u{1F4CB} To-do</strong>, it becomes a normal undated task and you can give it a due date again.',
        title: 'No due dates on someday tasks',
        icon: '\u{1F4A1}',
      },
      {
        type: 'paragraph',
        content:
          'You can still tick off a Someday \u00b7 Maybe task \u2014 it moves to <strong>Completed</strong> like any other. Reopen it and it returns to the Someday \u00b7 Maybe section, not your active list.',
      },
      {
        type: 'heading',
        content: 'Sorting and filtering',
        level: 2,
        id: 'sorting',
      },
      {
        type: 'paragraph',
        content: 'Use the <strong>Sort</strong> dropdown at the top-right to order your tasks:',
      },
      {
        type: 'list',
        content: '',
        items: [
          '<strong>Newest</strong> \u2014 Most recently created first (default)',
          '<strong>Oldest</strong> \u2014 Oldest tasks first',
          '<strong>Due Date</strong> \u2014 Soonest deadlines first, with undated tasks at the end',
        ],
      },
      {
        type: 'paragraph',
        content:
          'On desktop, you\u2019ll also see <strong>member filter chips</strong> below the sort menu. Tap a family member\u2019s name to see only their tasks.',
      },
      {
        type: 'heading',
        content: 'Overdue tasks',
        level: 2,
        id: 'overdue',
      },
      {
        type: 'paragraph',
        content:
          'If a task\u2019s due date has passed and it\u2019s still open, it\u2019s marked as <strong>overdue</strong> with an orange badge. Overdue tasks also appear in your <strong>daily briefing</strong> on the Family Nook so you don\u2019t lose track of them.',
      },
      {
        type: 'heading',
        content: 'Deleting a to-do',
        level: 2,
        id: 'deleting',
      },
      {
        type: 'paragraph',
        content:
          'Open the task and click the <strong>delete</strong> button in the bottom corner. You\u2019ll be asked to confirm before the task is permanently removed.',
      },
      {
        type: 'callout',
        content:
          'Deleting a task is permanent \u2014 it can\u2019t be undone. If you\u2019re not sure, consider marking it as completed instead so you have a record of it.',
        title: 'Heads up',
        icon: '\u26A0\uFE0F',
      },
      {
        type: 'heading',
        content: 'To-dos on the Family Nook',
        level: 2,
        id: 'nook-integration',
      },
      {
        type: 'paragraph',
        content:
          'Your open tasks also appear on the <strong>Family Nook</strong> homepage in the To-Do widget, with a quick-add bar so you can jot things down without leaving the Nook. Tasks assigned to you that are due today, overdue, or without a due date also show up in your <strong>daily briefing</strong> (the orange box).',
      },
      {
        type: 'paragraph',
        content: 'Two of those rules go a little wider than "assigned to you":',
      },
      {
        type: 'list',
        content: '',
        items: [
          '<strong>A to-do assigned only to a child</strong> shows up in <em>every</em> grown-up’s daily briefing too — framed by the child’s name (<em>"Emma: wear AM uniform for school photos"</em>) — so the parent who actually has to make it happen sees it. The child still sees it as their own task. Want just one parent on the hook instead of all of them? Add that parent as an assignee alongside the child.',
          '<strong>A to-do with no assignee</strong> shows up for <em>everyone</em> (<em>"Buy milk (anyone can do this)"</em>) and stays there until someone ticks it off — so a loose task doesn’t fall through the cracks. Whoever does it gets the credit.',
        ],
      },
      {
        type: 'paragraph',
        content:
          'The full briefing rules — dates, sorting, the five-item limit, medication reminders — are in the <a href="/help/how-it-works/your-daily-briefing">Your Daily Briefing</a> guide.',
      },
    ],
  },
  {
    slug: 'travel-plans-and-vacations',
    category: 'features',
    title: 'Travel Plans & Vacations',
    excerpt:
      'Plan family trips from start to finish \u2014 flights, hotels, transport, activities, and ideas \u2014 all in one place.',
    icon: '\u2708\uFE0F',
    readTime: 5,
    updatedDate: '2026-06-04',
    sections: [
      {
        type: 'heading',
        content: 'Why plan trips in beanies.family?',
        level: 2,
        id: 'why-travel',
      },
      {
        type: 'paragraph',
        content:
          'Planning a family trip usually means juggling flight confirmations in email, hotel bookings in a spreadsheet, and everyone\u2019s ideas in a group chat. <strong>Travel Plans</strong> brings it all together in one place \u2014 flights, stays, transport, activities, and your family\u2019s wish list \u2014 so nothing falls through the cracks.',
      },
      {
        type: 'heading',
        content: 'Creating a trip',
        level: 2,
        id: 'creating',
      },
      {
        type: 'paragraph',
        content:
          'The trip wizard walks you through five steps. You don\u2019t need to fill in everything at once \u2014 you can always come back and add details later.',
      },
      {
        type: 'heading',
        content: 'Step 1: Trip basics',
        level: 3,
        id: 'step-basics',
      },
      {
        type: 'steps',
        content: '',
        items: [
          'Go to <strong>Travel Plans</strong> in the Treehouse section',
          'Click <strong>Plan a Trip</strong>',
          'Give your trip a name (e.g., "Bali Spring Break")',
          'Pick a trip type \u2014 Fly & Stay, Cruise, Road Trip, Combo, Camping, or Adventure',
          'Choose which family members are going',
        ],
      },
      {
        type: 'heading',
        content: 'Step 2: Travel',
        level: 3,
        id: 'step-travel',
      },
      {
        type: 'paragraph',
        content:
          'Add your travel segments \u2014 flights, cruises, cars, trains, or ferries. For flights, you\u2019ll be asked if it\u2019s one-way or round trip, and the return flight is set up automatically. Each segment has fields for dates, times, booking references, and notes.',
      },
      {
        type: 'heading',
        content: 'Step 3: Stay',
        level: 3,
        id: 'step-stay',
      },
      {
        type: 'paragraph',
        content:
          'Add your accommodation \u2014 hotels, Airbnbs, campgrounds, or staying with family and friends. Check-in and check-out dates are pre-filled from your travel dates when possible. You can add the address, room type, confirmation number, and whether breakfast is included.',
      },
      {
        type: 'heading',
        content: 'Step 4: Getting around',
        level: 3,
        id: 'step-transport',
      },
      {
        type: 'paragraph',
        content:
          'Add local transport \u2014 airport shuttles, rental cars, taxis, or buses. Include pickup times, booking references, and agency details so everything is in one place when you land.',
      },
      {
        type: 'heading',
        content: 'Step 5: Ideas',
        level: 3,
        id: 'step-ideas',
      },
      {
        type: 'paragraph',
        content:
          'This is the fun part! Add things your family wants to do \u2014 beaches, restaurants, excursions, shows. Each idea can have a category, estimated cost, and duration. Family members can vote on ideas with the \u2764\uFE0F heart button to help decide what makes the cut.',
      },
      {
        type: 'infoBox',
        content:
          'You can skip any step in the wizard and come back to it later. Click <strong>Save Vacation</strong> on the last step to save what you have, then edit anytime from the trip page.',
        title: 'No pressure',
        icon: '\u{1F60C}',
      },
      {
        type: 'heading',
        content: 'The trip timeline',
        level: 2,
        id: 'timeline',
      },
      {
        type: 'paragraph',
        content:
          'Once your trip is saved, you\u2019ll see a visual <strong>timeline</strong> showing everything in chronological order \u2014 flights, hotel check-ins, transport, and planned activities. Each segment is a collapsible card that you can tap to see full details or click <strong>Edit</strong> to change.',
      },
      {
        type: 'paragraph',
        content:
          'You can add more segments anytime using the <strong>+ add a plan</strong> button at the bottom of the timeline.',
      },
      {
        type: 'heading',
        content: 'Attaching booking documents',
        level: 2,
        id: 'attachments',
      },
      {
        type: 'paragraph',
        content:
          'Every travel segment, stay, and transport item can hold the original booking — attach <strong>images, screenshots, or PDFs</strong> of your airline e-ticket, hotel confirmation, or rental agreement so you can always refer back to the source. Open a segment’s edit drawer (or add it in the trip wizard), then drop files into <strong>Booking documents</strong> or tap to pick them. A \u{1F4CE} count appears on the segment card whenever it has attachments.',
      },
      {
        type: 'paragraph',
        content:
          'Tap an attachment to view it — images open in a full-screen lightbox, and PDFs open for reading (with an <strong>Open in new tab</strong> option on phones). Remove an attachment anytime from the segment’s edit drawer.',
      },
      {
        type: 'infoBox',
        content:
          'Attachments are stored in your family’s encrypted Drive, just like photos — so cloud sync needs to be on. Images are compressed automatically; PDFs are kept as-is, up to 10 MB each. Removing an attachment is reversible only within a short grace window before it’s cleaned up.',
        title: 'How attachments are stored',
        icon: '\u{1F510}',
      },
      {
        type: 'heading',
        content: 'Booking progress',
        level: 2,
        id: 'booking-progress',
      },
      {
        type: 'paragraph',
        content:
          'Each segment can be marked as <strong>Booked</strong> or <strong>Pending</strong>. The trip card and header show a progress bar (e.g., "3 of 5 booked") so you can see at a glance what still needs confirming. Items marked as pending show an <em>"items need booking"</em> badge.',
      },
      {
        type: 'heading',
        content: 'Accommodation gap warnings',
        level: 2,
        id: 'gaps',
      },
      {
        type: 'paragraph',
        content:
          'beanies.family automatically checks your accommodation dates against your trip dates. If there are nights where you don\u2019t have a place to stay, you\u2019ll see a \u{1F3E8} warning in the timeline with a quick link to add accommodation for those dates.',
      },
      {
        type: 'heading',
        content: 'Ideas and voting',
        level: 2,
        id: 'ideas',
      },
      {
        type: 'paragraph',
        content:
          'The <strong>Ideas</strong> panel (on the right side of the trip page, or below the timeline on mobile) is your family\u2019s shared wish list. Anyone can add ideas, and family members vote with the \u2764\uFE0F heart button. Ideas with the most votes float to the top, making it easy to see what everyone\u2019s excited about.',
      },
      {
        type: 'paragraph',
        content:
          'Ideas can be marked as <strong>Planned</strong> once you\u2019ve decided to do them. Planned ideas appear in a separate section so you can see what\u2019s confirmed versus what\u2019s still on the wish list.',
      },
      {
        type: 'heading',
        content: 'Trip countdown',
        level: 2,
        id: 'countdown',
      },
      {
        type: 'paragraph',
        content:
          'Each upcoming trip shows a countdown badge \u2014 the number of days until your adventure begins. The message is personalised to your trip type: "5 days until takeoff!" for flights, "until we set sail!" for cruises, and so on. Past trips show a "Completed" badge instead.',
      },
      {
        type: 'heading',
        content: 'Past trips',
        level: 2,
        id: 'past-trips',
      },
      {
        type: 'paragraph',
        content:
          'Completed trips move to the <strong>Past Trips</strong> section at the bottom of the page. Click to expand and revisit the details \u2014 useful for rebooking a favourite hotel or remembering that amazing restaurant.',
      },
      {
        type: 'callout',
        content:
          'Upcoming trips also appear on the <strong>Family Nook</strong> homepage and across the <strong>Family Planner</strong> \u2014 as a countdown ribbon in the calendar\u2019s top bar and as a coloured band on the trip\u2019s actual dates in the calendar grid. Tap either one to jump to the full trip.',
        title: 'Nook and Planner integration',
        icon: '\u{1F3E0}',
      },
    ],
  },
  {
    slug: 'the-family-nook',
    category: 'features',
    title: 'The Family Nook \u2014 Your Home Base',
    excerpt:
      'Your family\u2019s homepage at a glance \u2014 what\u2019s happening today, upcoming events, to-dos, milestones, and finances, all in one place.',
    icon: '\u{1F3E1}',
    readTime: 5,
    popular: true,
    updatedDate: '2026-03-27',
    sections: [
      {
        type: 'heading',
        content: 'What is the Family Nook?',
        level: 2,
        id: 'what-is-it',
      },
      {
        type: 'paragraph',
        content:
          'The <strong>Family Nook</strong> is the first thing you see when you open beanies.family. Think of it as your family\u2019s home base \u2014 a single page that shows you everything that matters right now: today\u2019s schedule, open tasks, upcoming milestones, and a snapshot of your finances. Instead of jumping between different pages, the Nook brings the highlights to you.',
      },
      {
        type: 'heading',
        content: 'Your personal greeting',
        level: 2,
        id: 'greeting',
      },
      {
        type: 'paragraph',
        content:
          'At the top of the Nook, you\u2019ll see a welcome message with your name and today\u2019s date. It\u2019s a small touch, but it\u2019s your reminder that this space is personalised for <em>you</em>.',
      },
      {
        type: 'heading',
        content: 'The daily briefing',
        level: 2,
        id: 'daily-briefing',
      },
      {
        type: 'paragraph',
        content:
          'The warm orange box below the greeting is your <strong>daily briefing</strong>. It shows a daily motivational message and a quick count of today\u2019s activities and open tasks. If you have things that need your personal attention \u2014 a pickup, a drop-off, overdue tasks \u2014 they appear as tappable items right in the box.',
      },
      {
        type: 'infoBox',
        content:
          'The daily briefing is personal to you \u2014 each family member sees their own. Want to know exactly what appears here and why? See our <em>Your Daily Briefing</em> article in the How It Works section.',
        title: 'Learn more',
        icon: '\u{1F4D6}',
      },
      {
        type: 'heading',
        content: 'Your Beans',
        level: 2,
        id: 'your-beans',
      },
      {
        type: 'paragraph',
        content:
          'A scrollable row of family member avatars. Tap any member to jump to their profile on the Family page, or tap the <strong>+</strong> button at the end to add a new family member.',
      },
      {
        type: 'heading',
        content: 'Schedule cards',
        level: 2,
        id: 'schedule-cards',
      },
      {
        type: 'paragraph',
        content: 'Two side-by-side cards give you a quick view of what\u2019s coming up:',
      },
      {
        type: 'list',
        content: '',
        items: [
          '<strong>Today\u2019s Schedule</strong> \u2014 All activities and to-dos for today, sorted by time. If nothing\u2019s on, it\u2019ll say so.',
          '<strong>This Week</strong> \u2014 The next seven days of activities and tasks (up to six items). A <strong>Full Calendar \u2192</strong> link takes you to the Family Planner for the complete view.',
        ],
      },
      {
        type: 'paragraph',
        content: 'Tap any item in either card to open it directly.',
      },
      {
        type: 'heading',
        content: 'Upcoming vacation',
        level: 2,
        id: 'vacation-card',
      },
      {
        type: 'paragraph',
        content:
          'If you have an upcoming trip planned in <strong>Travel Plans</strong>, a card appears showing the trip name, dates, booking progress, and a countdown (e.g., "12 days until takeoff!"). Tap it to jump straight to the trip details. If no trips are planned, this card is hidden.',
      },
      {
        type: 'heading',
        content: 'Family To-Do',
        level: 2,
        id: 'todo-widget',
      },
      {
        type: 'paragraph',
        content:
          'A full-width widget showing your family\u2019s open tasks (up to eight). It includes its own quick-add bar, so you can jot down a task without leaving the Nook. You can check off tasks right from here, or tap one to see its full details. A <strong>View All \u2192</strong> link takes you to the full To-Do page.',
      },
      {
        type: 'heading',
        content: 'Milestones',
        level: 2,
        id: 'milestones',
      },
      {
        type: 'paragraph',
        content: 'The milestones card shows up to four upcoming events to look forward to:',
      },
      {
        type: 'list',
        content: '',
        items: [
          '<strong>Birthdays</strong> \u{1F382} \u2014 Any family member\u2019s birthday coming up in the next 30 days, with a countdown (e.g., "7 days away")',
          '<strong>Goal deadlines</strong> \u{1F3AF} \u2014 Active financial goals with upcoming target dates',
          '<strong>Completed goals</strong> \u2705 \u2014 Recently achieved goals get a well-deserved moment in the spotlight',
        ],
      },
      {
        type: 'heading',
        content: 'Piggy Bank',
        level: 2,
        id: 'piggy-bank',
      },
      {
        type: 'paragraph',
        content:
          'A compact finance snapshot showing your family\u2019s <strong>net worth</strong> and <strong>monthly budget progress</strong>. The net worth figure animates when it loads, and a monthly change indicator shows how things are trending. Tap <strong>Open Piggy Bank</strong> to go to the full financial dashboard.',
      },
      {
        type: 'callout',
        content:
          'The Piggy Bank card only appears for family members who have <strong>finance view</strong> permission. If you don\u2019t see it, check with the family owner about your role permissions in the Family page.',
        title: 'Finance permissions',
        icon: '\u{1F512}',
      },
      {
        type: 'heading',
        content: 'Recent Activity',
        level: 2,
        id: 'recent-activity',
      },
      {
        type: 'paragraph',
        content:
          'The last section shows recent happenings \u2014 completed tasks from the past week and your latest transactions. Tap any item to view its details. A <strong>See All \u2192</strong> link takes you to the full Transactions page.',
      },
      {
        type: 'heading',
        content: 'First-time setup',
        level: 2,
        id: 'onboarding',
      },
      {
        type: 'paragraph',
        content:
          'The very first time you open the Nook after creating your pod, a setup wizard walks you through the basics \u2014 adding accounts, setting up recurring items, and inviting family members. You can skip any step and come back to it later. Once you finish (or skip), the wizard disappears and the full Nook is revealed.',
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
    updatedDate: '2026-07-12',
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
        type: 'paragraph',
        content:
          'Once a single session has been rescheduled or edited, opening it shows a small note (e.g. “Moved from Wed, 6 Mar”). From there you can <strong>Delete</strong> that session — which removes just it and leaves the rest of the series alone, and it won’t reappear — or tap <strong>Reset to series</strong> to put it back to its original recurring time. Delete means gone; reset means back to the series default.',
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
        content:
          'A bar at the top of the planner stays with you as you scroll, so you always know which month, week, or day you\u2019re looking at. It has arrows and a <strong>Today</strong> button to move around, the Month / Week / Day switch, the family filter, and the <strong>+ Add</strong> button \u2014 all in one place.',
      },
      {
        type: 'list',
        content: '',
        items: [
          '<strong>Month</strong> \u2014 A full-month grid. Each day shows colour-coded chips so you can see who\u2019s got what on at a glance. Tap a day to open it in Day view. On phones the month becomes a tidy day-by-day agenda, and quiet days fold down to a thin line so the busy ones stand out.',
          '<strong>Week</strong> \u2014 A timeline of the week. On phones a two-week strip across the top lets you hop between days at a glance; it tucks down to a single week as you scroll into the timeline so your events get more room.',
          '<strong>Day</strong> \u2014 A single day in detail, with a column for each family member so you can see who\u2019s doing what. The <strong>Agenda</strong> button opens a tidy, time-sorted list for that day.',
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
  {
    slug: 'beanie-lists',
    category: 'features',
    title: 'Beanie Lists',
    excerpt:
      'Shared, categorized checklists for the stuff family life runs on — groceries, packing, chores, before-school routines. One-off or auto-repeating.',
    icon: '\u{1F9FE}',
    readTime: 6,
    popular: true,
    updatedDate: '2026-06-20',
    sections: [
      { type: 'heading', content: 'Why Beanie Lists?', level: 2, id: 'why' },
      {
        type: 'paragraph',
        content:
          'So much of family life is a checklist — the weekly grocery run, the before-school scramble, what to pack for a trip, the jobs to do before a party. <strong>Beanie Lists</strong> give your family one shared home for all of them, sorted by what they’re for, so nothing gets forgotten and everyone can see what’s left to do. You’ll find them under <strong>Beanie Lists</strong> in the Treehouse section of the sidebar.',
      },

      {
        type: 'heading',
        content: 'Lists or to-dos — which do I use?',
        level: 2,
        id: 'lists-vs-todos',
      },
      {
        type: 'paragraph',
        content:
          'A <strong>to-do</strong> is a single task (“call the dentist”). A <strong>list</strong> is a checklist of many items that belong together (“Groceries”, “Before-school”, “Italy packing”) — especially the routines that come back week after week.',
      },
      {
        type: 'infoBox',
        content:
          'Rule of thumb: if it’s one thing, make it a to-do. If it’s a bundle of things you tick off together — or a routine that repeats — make it a list.',
        title: 'Which is which?',
        icon: '\u{1F9ED}',
      },

      { type: 'heading', content: 'Creating a list', level: 2, id: 'creating' },
      {
        type: 'steps',
        content: '',
        items: [
          'Go to <strong>Beanie Lists</strong> in the Treehouse section of the sidebar',
          'Tap the <strong>New List</strong> button (the orange <strong>+</strong>)',
          'In <strong>Start a New List</strong>, pick a <strong>Category</strong> (Home, Kids, Trips…)',
          'Choose a ready-made option under <strong>Start from a Template</strong> — or tap <strong>Start Blank List</strong> to begin from scratch',
        ],
      },
      {
        type: 'infoBox',
        content:
          'Templates are just a head start — they drop in a name and a few starter items (a grocery list arrives with “Bananas, Spinach, Oat milk…”). Once created, the list is yours to rename, add to, and edit however you like.',
        title: 'Templates give you a running start',
        icon: '\u{1F4A1}',
      },

      { type: 'heading', content: 'One-off or repeating?', level: 2, id: 'one-off-or-repeating' },
      {
        type: 'paragraph',
        content:
          'Every list is one of two kinds. You set this when editing a list, under <strong>Repeats?</strong>:',
      },
      {
        type: 'list',
        content: '',
        items: [
          '<strong>One-off</strong> — a list you finish once, like packing for a trip or party prep. Give it a <strong>Due date</strong> if timing matters. When every item is ticked, it moves to the <strong>Completed</strong> area.',
          '<strong>Repeats</strong> — a routine that comes back: <strong>Daily</strong>, <strong>Weekly</strong>, or <strong>Monthly</strong>. A repeating list never “finishes” — instead it unchecks itself at the start of each new period so you start fresh (your grocery list clears every week; before-school clears every morning).',
        ],
      },
      {
        type: 'callout',
        content:
          'A repeating list clearing its checkmarks isn’t a glitch — it’s the point: it “unchecks itself each cycle so you start fresh, no due date needed.” Your items stay put; only the ticks reset.',
        title: 'Repeating lists reset themselves',
        icon: '\u{1F504}',
      },

      { type: 'heading', content: 'Working with a list', level: 2, id: 'working' },
      { type: 'paragraph', content: 'Tap any list to open it. From there you can:' },
      {
        type: 'list',
        content: '',
        items: [
          '<strong>Tick items off</strong> as you go — a little progress bar fills up',
          '<strong>Add an item</strong> with the “Add an item…” field',
          '<strong>Rename</strong> the list, or change its <strong>Category</strong>',
          'Set the <strong>Owner</strong> — who the list belongs to (see below)',
          'Set a <strong>Due date</strong>, or switch <strong>Repeats?</strong> on and pick a frequency',
          '<strong>Link</strong> it to a trip or activity (see below)',
          '<strong>Delete List</strong> when you’re finished with it for good',
        ],
      },

      { type: 'heading', content: 'Editing and reordering items', level: 2, id: 'editing' },
      {
        type: 'list',
        content: '',
        items: [
          '<strong>Rename the list</strong> — tap the list’s name at the top of the drawer, type the new name, and press Enter (or tap away) to save. Press Esc to cancel.',
          '<strong>Fix an item’s text</strong> — tap the item’s words to turn them into an editable field; Enter or tap-away saves, Esc cancels.',
          '<strong>Reorder items</strong> — drag the grip handle (<strong>⠿</strong>) on the left of a row up or down to put items in the order your family works through them.',
        ],
      },
      {
        type: 'infoBox',
        content:
          'Emptying an item’s text doesn’t delete it — it just keeps the previous text. To remove an item, use its <strong>✕</strong> button instead. Reordering is saved per list and syncs to the whole family.',
        title: 'Good to know',
        icon: '\u{1F4A1}',
      },

      { type: 'heading', content: 'Who a list belongs to', level: 2, id: 'owner' },
      {
        type: 'paragraph',
        content:
          'Each list has one <strong>Owner</strong>. Unlike a to-do (which can be shared among several people), a list belongs to a single person — the one looking after it. The owner’s due lists turn up in their <strong>Daily Briefing</strong>. If a list belongs to a child, grown-ups see it in their briefing too, framed by the child’s name, so the parent who actually makes it happen doesn’t miss it.',
      },

      { type: 'heading', content: 'Linking a list to a trip or activity', level: 2, id: 'linking' },
      {
        type: 'paragraph',
        content:
          'A packing list really belongs <em>with</em> your trip. Link them and the list appears right on that trip (or activity) under <strong>Checklists</strong> — so you can tick items off without leaving the page.',
      },
      {
        type: 'steps',
        content: '',
        items: [
          'Open the list and find the <strong>Link</strong> row',
          'Tap <strong>Link to a trip</strong> or <strong>Link to an activity</strong>',
          'Search for the trip or activity and pick it — that’s it',
        ],
      },
      {
        type: 'infoBox',
        content:
          'You can link to your upcoming trips and activities. To remove a link later, open the list and tap <strong>Unlink</strong>.',
        title: 'Good to know',
        icon: '\u{1F517}',
      },

      { type: 'heading', content: 'Where your lists show up', level: 2, id: 'where' },
      {
        type: 'list',
        content: '',
        items: [
          '<strong>The Beanie Lists page</strong> — a <strong>Due soon</strong> shelf at the top, your lists grouped by category below, and a <strong>Completed</strong> area at the bottom. The filter chips (<strong>All</strong>, Home, Kids…) narrow the view.',
          '<strong>Your Daily Briefing</strong> — a one-off list that’s due today, overdue, or simply still has items to do gets a gentle nudge. Repeating lists don’t nag; they just reset.',
          '<strong>The menu badge</strong> — the little orange number beside Beanie Lists counts lists that are overdue or due today, so you know at a glance when something needs you.',
          '<strong>A linked trip or activity</strong> — any list you’ve linked appears there under Checklists.',
        ],
      },
      {
        type: 'paragraph',
        content:
          'Finish a one-off list and you’ll get a little <strong>List complete! \u{1F389}</strong> celebration — because every bean counts.',
      },

      { type: 'heading', content: 'List categories', level: 2, id: 'categories' },
      {
        type: 'paragraph',
        content: 'Every list lives in one of eight categories, so the page stays tidy:',
      },
      {
        type: 'list',
        content: '',
        items: [
          '\u{1F3E0} <strong>Home & Household</strong> — chores, repairs, household routines',
          '\u{1F6D2} <strong>Out & Errands</strong> — groceries, shopping, errands around town',
          '\u{1F9D2} <strong>Kids & School</strong> — before-school, homework, kids’ chores',
          '\u{1FA7A} <strong>Health & Safety</strong> — appointments, medicines, safety checks',
          '\u{1F389} <strong>Celebrations & Traditions</strong> — parties, holidays, gatherings',
          '\u{1F9F3} <strong>Trips & Packing</strong> — what to pack and prep for travel',
          '✅ <strong>Projects & Honey-dos</strong> — bigger job bundles and partner lists',
          '✨ <strong>Just for Me</strong> — your own personal lists',
        ],
      },

      { type: 'heading', content: 'Ready-made templates', level: 2, id: 'templates' },
      {
        type: 'list',
        content: '',
        items: [
          '<strong>Grocery list</strong> — weekly, auto-resets',
          '<strong>Kids’ chores</strong> — weekly reset',
          '<strong>Before-school</strong> — daily checklist',
          '<strong>Vacation packing</strong> — one-off; link it to a trip',
          '<strong>Honey-do list</strong> — a one-off list for your partner',
          '<strong>Party prep</strong> — one-off; pick a date',
        ],
      },

      {
        type: 'callout',
        content:
          'Deleting a list removes it and all of its items for everyone in the family, and there’s no undo. Deleting is for lists you’re truly done with — for a routine that comes around again, just leave it to reset.',
        title: 'Deleting a list can’t be undone',
        icon: '⚠️',
      },

      { type: 'heading', content: 'What’s next?', level: 2, id: 'whats-next' },
      {
        type: 'list',
        content: '',
        items: [
          '<strong>Family To-Do Lists</strong> — for single, shareable tasks',
          '<strong>Travel Plans & Vacations</strong> — link a packing list to your next trip',
          '<strong>Your Daily Briefing</strong> — where your due lists come to find you',
        ],
      },
    ],
  },
  {
    slug: 'sharing-feedback',
    category: 'features',
    title: 'Sharing feedback with the beanies team',
    excerpt:
      'Tell us how beanies.family is treating your family — a quick score and a few words go straight to the people building it.',
    icon: '\u{1F4AC}',
    readTime: 2,
    updatedDate: '2026-07-09',
    sections: [
      {
        type: 'paragraph',
        content:
          "beanies.family is built by a small team that genuinely wants to hear from you. The quickest way to reach us from inside the app is to share a little feedback — how likely you'd be to recommend beanies, and anything on your mind.",
      },
      {
        type: 'heading',
        content: 'Sharing feedback any time',
        level: 2,
        id: 'share',
      },
      {
        type: 'steps',
        content: '',
        items: [
          'Open the menu and tap <strong>Share feedback</strong> (in the footer, near Help and Settings).',
          'Tap a number from 0 to 10 for how likely you are to recommend beanies.family.',
          'Add a few words if you like — the question tailors itself to your score, and it’s always optional.',
          'Tap <strong>Send feedback</strong>. That’s it — usually about ten seconds.',
        ],
      },
      {
        type: 'heading',
        content: 'The occasional prompt',
        level: 2,
        id: 'prompt',
      },
      {
        type: 'paragraph',
        content:
          'Every so often the same short prompt may pop up on its own when you open the app, so you don’t have to go looking for it. You can answer it, or just close it — closing counts as “asked,” so we won’t bring it up again for a while. You’ll never see it stacked on top of another pop-up.',
      },
      {
        type: 'paragraph',
        content:
          'Prefer not to be prompted? Turn it off any time in <strong>Settings → Occasional feedback prompt</strong>. The <strong>Share feedback</strong> menu entry stays available whenever you do want to reach us.',
      },
      {
        type: 'heading',
        content: 'What we can (and can’t) see',
        level: 2,
        id: 'privacy',
      },
      {
        type: 'infoBox',
        content:
          'Your feedback never includes any of your financial data — just your score and whatever words you choose to write. Contact details are optional and only used if you asked us to reply; they’re never shared.',
      },
    ],
  },
  {
    slug: 'account-details',
    category: 'features',
    title: 'Keep account details in one place',
    excerpt:
      'Store the reference details you always dig for — account number, online-banking link, card last-4, crypto wallets — right on the account.',
    icon: '\u{1F3E6}',
    readTime: 3,
    updatedDate: '2026-08-05',
    sections: [
      {
        type: 'paragraph',
        content:
          "An account can hold more than a balance. Under <strong>More Details</strong> on any account you can jot down the reference details you always end up hunting for — the account number, where you log in, which card ends in what, or the public addresses of your crypto wallets. It's all optional, so add only what's useful to you.",
      },
      {
        type: 'heading',
        content: 'Add details to an account',
        level: 2,
        id: 'add-details',
      },
      {
        type: 'steps',
        content: '',
        items: [
          'Open an account and tap <strong>Edit</strong> (or add a new one).',
          'Tap <strong>More Details</strong> to expand the extra fields.',
          'Fill in whatever you like and tap <strong>Save</strong>. Blank fields are simply skipped.',
        ],
      },
      {
        type: 'heading',
        content: 'Which fields appear',
        level: 2,
        id: 'which-fields',
      },
      {
        type: 'paragraph',
        content:
          'Every account can carry an <strong>account number</strong> (except cash, crypto, and credit cards), an <strong>online-banking link and user ID</strong>, and free-form <strong>notes</strong>. Beyond those, the fields adapt to the account type:',
      },
      {
        type: 'list',
        content: '',
        items: [
          '<strong>Checking / savings</strong> — routing or sort code, IBAN, SWIFT/BIC (and an interest rate for savings).',
          '<strong>Credit card</strong> — network, the last 4 digits, expiry, credit limit, and your statement and payment-due days.',
          '<strong>Crypto</strong> — a list of labelled public wallet addresses, each with an optional chain.',
        ],
      },
      {
        type: 'callout',
        title: 'Visible to your whole family',
        icon: '\u{1F46A}',
        content:
          'Account details are stored <strong>encrypted</strong> in your Family Data File, but everyone in your family can see them — the same as your balances. Only add what you’re happy for your family to see.',
      },
      {
        type: 'callout',
        title: 'What beanies never stores',
        icon: '\u{1F512}',
        content:
          'For your safety, beanies deliberately does <strong>not</strong> store your card’s CVV / security code, your PINs, your full card number, your online-banking password, or a crypto seed phrase or private key. Card details keep only the last 4 digits — just enough to recognise the card. A dedicated secure area for passwords is planned for a future update.',
      },
    ],
  },
];

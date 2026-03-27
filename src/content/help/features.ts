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
    slug: 'family-todo-lists',
    category: 'features',
    title: 'Family To-Do Lists',
    excerpt:
      'Create tasks, assign them to family members, set due dates, and track what gets done. Your shared family task board.',
    icon: '\u2705',
    readTime: 4,
    popular: true,
    updatedDate: '2026-03-27',
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
    updatedDate: '2026-03-27',
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
          'Upcoming vacations also appear on the <strong>Family Nook</strong> homepage and in the <strong>Family Planner</strong> sidebar, so the whole family can see what\u2019s coming up.',
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

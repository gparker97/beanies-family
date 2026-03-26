/**
 * UI Strings Registry
 *
 * All user-facing text in the application should be defined here.
 * This enables dynamic translation of the UI.
 *
 * Each string is automatically hashed. When a string changes, its hash changes,
 * triggering re-translation of only that specific string.
 *
 * STRING_DEFS is the single source of truth. Both plain English (en) and optional
 * beanie-themed overrides (beanie) are defined side by side. UI_STRINGS and
 * BEANIE_STRINGS are derived automatically — no manual duplication.
 */

/**
 * Simple hash function for string content.
 * Used to detect when English strings have changed.
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

type StringEntry = { en: string; beanie?: string };

const STRING_DEFS = {
  // App branding
  'app.name': { en: 'beanies.family' },
  'app.tagline': { en: 'every bean counts' },
  'app.version': { en: 'v1.0.0 - MVP' },

  // Global search
  // Blog
  'blog.title': { en: 'Beanstalk Blog', beanie: 'beanstalk blog' },
  'blog.tagline': {
    en: 'The latest beanie news and updates',
    beanie: 'the latest beanie news and updates',
  },
  'blog.featured': { en: 'Featured', beanie: 'featured' },
  'blog.backToAll': { en: 'All Posts', beanie: 'all posts' },
  'blog.newer': { en: 'Newer', beanie: 'newer' },
  'blog.older': { en: 'Older', beanie: 'older' },
  'blog.empty': {
    en: 'No posts yet — the beanstalk is still growing!',
    beanie: 'no posts yet — the beanstalk is still growing!',
  },
  'blog.noPostsInCategory': {
    en: 'No posts in this category yet',
    beanie: 'no posts in this category yet',
  },
  'blog.postNotFound': {
    en: 'This post seems to have wandered off...',
    beanie: 'this post seems to have wandered off...',
  },

  // Global search
  'search.placeholder': { en: 'Search everything...', beanie: 'search your beans...' },
  'search.noResults': { en: 'No results found', beanie: 'no beans found' },
  'search.activities': { en: 'Activities', beanie: 'activities' },
  'search.vacations': { en: 'Travel Plans', beanie: 'beanie trips' },
  'search.todos': { en: 'To-dos', beanie: 'to-dos' },
  'search.accounts': { en: 'Accounts', beanie: 'accounts' },
  'search.transactions': { en: 'Transactions', beanie: 'transactions' },
  'search.goals': { en: 'Goals', beanie: 'goals' },
  'search.assets': { en: 'Assets', beanie: 'assets' },
  'search.members': { en: 'Family Members', beanie: 'beanies' },

  // Common labels
  'common.totalAssets': { en: 'Total Assets', beanie: 'total assets' },
  'common.totalLiabilities': { en: 'Total Liabilities', beanie: 'total liabilities' },
  'common.totalValue': { en: 'Total Value', beanie: 'total value' },
  'common.netAssetValue': { en: 'Net Asset Value', beanie: 'net asset value' },
  'common.appreciation': { en: 'Appreciation', beanie: 'appreciation' },
  'common.depreciation': { en: 'Depreciation', beanie: 'depreciation' },
  'common.assetLoans': { en: 'Asset Loans', beanie: 'asset loans' },
  'common.loanOutstanding': { en: 'Loan Outstanding', beanie: 'loan outstanding' },
  'common.purchaseValue': { en: 'Purchase Value', beanie: 'what you paid' },
  'common.currentValue': { en: 'Current Value', beanie: 'worth today' },
  'common.purchased': { en: 'Purchased', beanie: 'purchased' },
  'common.save': { en: 'Save', beanie: 'save' },
  'common.cancel': { en: 'Cancel', beanie: 'cancel' },
  'common.delete': { en: 'Delete', beanie: 'delete' },
  'common.saving': { en: 'Saving...', beanie: 'counting beans...' },
  'common.shared': { en: 'Shared', beanie: 'everyone' },
  'common.all': { en: 'All', beanie: 'all' },
  'common.none': { en: 'None', beanie: 'none' },
  'common.whatsThis': { en: "What's this?", beanie: "what's this?" },
  'common.family': { en: 'Family', beanie: 'the pod' },

  // Modal shared labels
  'modal.selectCategory': { en: 'Select a category', beanie: 'select a category' },
  'modal.selectSubcategory': { en: 'Select a type', beanie: 'select a type' },
  'modal.selectTime': { en: 'Select a time', beanie: 'select a time' },
  'modal.schedule': { en: 'Schedule', beanie: 'schedule' },
  'modal.recurring': { en: 'Recurring', beanie: 'recurring' },
  'modal.oneOff': { en: 'One-off', beanie: 'one-off' },
  'modal.oneTime': { en: 'One-time', beanie: 'one-time' },
  'modal.whichDays': { en: 'Which Days?', beanie: 'which days?' },
  'modal.howOften': { en: 'How Often?', beanie: 'how often?' },
  'modal.customTime': { en: 'Custom', beanie: 'custom' },
  'modal.willShowOnCalendar': {
    en: 'Will show on your calendar',
    beanie: 'will show on your calendar',
  },
  'modal.moneyIn': { en: 'Money In', beanie: 'money in' },
  'modal.moneyOut': { en: 'Money Out', beanie: 'money out' },
  'modal.direction': { en: 'Direction', beanie: 'direction' },
  'modal.includeInNetWorth': { en: 'Include in Net Worth', beanie: 'include in net worth' },
  'modal.includeInNetWorthDesc': {
    en: 'Count this towards your family net worth',
    beanie: 'count this towards your family net worth',
  },
  'modal.linkToActivity': { en: 'Link to Activity', beanie: 'link to activity' },
  'modal.selectActivity': { en: 'Select an activity...', beanie: 'select an activity...' },
  'modal.noMoreActivities': { en: 'No activities yet', beanie: 'no activities yet' },
  'modal.parentBean': { en: 'Parent Bean', beanie: 'parent bean' },
  'modal.littleBean': { en: 'Little Bean', beanie: 'little bean' },
  'modal.bigBean': { en: 'Big Bean', beanie: 'big bean' },
  'modal.addToPod': { en: 'Add to Family', beanie: 'add to pod' },
  'modal.welcomeToPod': { en: 'Welcome to the family!', beanie: 'welcome to the pod!' },
  'modal.moreDetails': { en: 'More Details', beanie: 'more details' },
  'modal.whatsTheActivity': { en: "What's the activity?", beanie: "what's the activity?" },
  'modal.whatNeedsDoing': { en: 'What needs doing?', beanie: 'what needs doing?' },
  'modal.costPerSession': { en: 'Cost', beanie: 'cost' },
  'modal.whosGoing': { en: 'Who?', beanie: 'who?' },
  'modal.time': { en: 'Time', beanie: 'time' },
  'modal.startTime': { en: 'Start Time', beanie: 'start time' },
  'modal.endTime': { en: 'End Time', beanie: 'end time' },
  'modal.addActivity': { en: 'Add Activity', beanie: 'add activity' },
  'modal.saveActivity': { en: 'Save Activity', beanie: 'save activity' },
  'modal.addTask': { en: 'Add Task', beanie: 'add task' },
  'modal.addToCalendar': { en: 'Add to Calendar', beanie: 'add to calendar' },
  'modal.saveTask': { en: 'Save Task', beanie: 'save task' },
  'modal.toSave': { en: 'to save', beanie: 'to save' },
  'modal.addAccount': { en: 'Add Account', beanie: 'add account' },
  'modal.saveAccount': { en: 'Save Account', beanie: 'save account' },
  'modal.addTransaction': { en: 'Add Transaction', beanie: 'add transaction' },
  'modal.saveTransaction': { en: 'Save Transaction', beanie: 'save transaction' },
  'modal.addGoal': { en: 'Add Goal', beanie: 'plant a goal' },
  'modal.saveGoal': { en: 'Save Goal', beanie: 'save goal' },
  'modal.addAsset': { en: 'Add Asset', beanie: 'add asset' },
  'modal.saveAsset': { en: 'Save Asset', beanie: 'save asset' },
  'modal.addMember': { en: 'Add Member', beanie: 'add a bean' },
  'modal.saveMember': { en: 'Save Member', beanie: 'save member' },
  'modal.accountName': { en: 'Account Name', beanie: 'account name' },
  'modal.accountType': { en: 'Account Type', beanie: 'account type' },
  'modal.balance': { en: 'Current Balance', beanie: 'current balance' },
  'modal.owner': { en: 'Owner', beanie: 'owner' },
  'modal.goalName': { en: 'Goal Name', beanie: 'goal name' },
  'modal.targetAmount': { en: 'Target Amount', beanie: 'target amount' },
  'modal.currentAmount': { en: 'Current Amount', beanie: 'current amount' },
  'modal.priority': { en: 'Priority', beanie: 'priority' },
  'modal.deadline': { en: 'Deadline', beanie: 'deadline' },
  'modal.memberName': { en: 'Name', beanie: 'name' },
  'modal.role': { en: 'Role', beanie: 'role' },
  'modal.birthday': { en: 'Birthday', beanie: 'birthday' },
  'modal.profileColor': { en: 'Profile Color', beanie: 'profile color' },
  'modal.permissions': { en: 'Permissions', beanie: 'permissions' },
  'modal.canViewFinances': { en: 'Can view finances', beanie: 'can view finances' },
  'modal.canEditActivities': { en: 'Can edit activities', beanie: 'can edit activities' },
  'modal.canManagePod': { en: 'Can manage pod', beanie: 'can manage pod' },

  // Status labels
  'status.active': { en: 'Active', beanie: 'active' },
  'status.inactive': { en: 'Inactive', beanie: 'resting' },
  'status.excluded': { en: 'Excluded', beanie: 'excluded' },
  'status.paused': { en: 'Paused', beanie: 'snoozing' },
  'status.recurring': { en: 'Recurring', beanie: 'recurring' },
  'status.completed': { en: 'Completed', beanie: 'done!' },
  'status.overdue': { en: 'Overdue', beanie: 'overdue' },

  // Navigation
  'nav.dashboard': { en: 'Financial Dashboard', beanie: 'finance corner' },
  'nav.accounts': { en: 'Accounts', beanie: 'accounts' },
  'nav.transactions': { en: 'Transactions', beanie: 'transactions' },
  'nav.assets': { en: 'Assets', beanie: 'assets' },
  'nav.goals': { en: 'Goals', beanie: 'goals' },
  'nav.reports': { en: 'Reports', beanie: 'reports' },
  'nav.forecast': { en: 'Forecast', beanie: 'finance forecast' },
  'nav.family': { en: 'Family Hub', beanie: 'my family' },
  'nav.settings': { en: 'Settings', beanie: 'settings' },
  'nav.section.treehouse': { en: 'The Treehouse', beanie: 'family treehouse' },
  'nav.section.piggyBank': { en: 'The Piggy Bank', beanie: 'piggy bank' },
  'nav.nook': { en: 'Family Dashboard', beanie: 'family nook' },
  'nav.activities': { en: 'Family Activities', beanie: 'our activities' },
  'nav.travel': { en: 'Travel Plans', beanie: 'travel plans' },
  'nav.todo': { en: 'Family To-Do', beanie: 'to-do list' },
  'nav.overview': { en: 'Overview', beanie: 'finance corner' },
  'nav.budgets': { en: 'Budgets', beanie: 'budgets' },
  'nav.comingSoon': { en: 'Soon!', beanie: 'soon!' },

  // Common actions
  'action.add': { en: 'Add', beanie: 'add' },
  'action.edit': { en: 'Edit', beanie: 'edit' },
  'action.delete': { en: 'Delete', beanie: 'delete' },
  'action.save': { en: 'Save', beanie: 'save' },
  'action.saveAndClose': { en: 'Save & Close', beanie: 'save & close' },
  'action.saveChanges': { en: 'Save Changes', beanie: 'save changes' },
  'action.cancel': { en: 'Cancel', beanie: 'cancel' },
  'action.confirm': { en: 'Confirm', beanie: 'confirm' },
  'action.close': { en: 'Close', beanie: 'close' },
  'action.done': { en: 'Done', beanie: 'done' },
  'action.view': { en: 'View', beanie: 'view' },
  'action.back': { en: 'Back', beanie: 'back' },
  'action.change': { en: 'Change', beanie: 'change' },
  'action.next': { en: 'Next', beanie: 'next' },
  'action.submit': { en: 'Submit', beanie: 'submit' },
  'action.search': { en: 'Search', beanie: 'search' },
  'action.filter': { en: 'Filter', beanie: 'filter' },
  'action.clear': { en: 'Clear', beanie: 'clear' },
  'action.refresh': { en: 'Refresh', beanie: 'refresh' },
  'action.loading': { en: 'Loading...', beanie: 'counting beans...' },
  'action.pause': { en: 'Pause', beanie: 'pause' },
  'action.resume': { en: 'Resume', beanie: 'resume' },
  'action.markCompleted': { en: 'Mark Complete', beanie: 'mark complete' },
  'action.expandAll': { en: 'Expand All', beanie: 'expand all' },
  'action.collapseAll': { en: 'Collapse All', beanie: 'collapse all' },
  'action.export': { en: 'Export', beanie: 'export' },
  'action.import': { en: 'Import', beanie: 'import' },

  // Dashboard
  'dashboard.netWorth': { en: 'Family Net Worth', beanie: 'alllllll your beans' },
  'dashboard.netWorthBreakdown': { en: 'Net Worth Breakdown', beanie: 'net worth breakdown' },
  'dashboard.breakdown.cash': { en: 'Cash', beanie: 'cash' },
  'dashboard.breakdown.crypto': { en: 'Crypto', beanie: 'crypto' },
  'dashboard.breakdown.investments': { en: 'Investments', beanie: 'investments' },
  'dashboard.breakdown.retirement': { en: 'Retirement', beanie: 'retirement' },
  'dashboard.breakdown.assets': { en: 'Assets', beanie: 'assets' },
  'dashboard.breakdown.liabilities': { en: 'Liabilities', beanie: 'liabilities' },
  'dashboard.breakdown.viewAllAccounts': { en: 'View All Accounts', beanie: 'view all accounts' },
  'dashboard.breakdown.viewAllAssets': { en: 'View All Assets', beanie: 'view all assets' },
  'dashboard.assets': { en: 'Assets', beanie: 'your assets' },
  'dashboard.liabilities': { en: 'Liabilities', beanie: 'beans owed' },
  'dashboard.monthlyIncome': { en: 'Monthly Income', beanie: 'beans coming in' },
  'dashboard.monthlyExpenses': { en: 'Monthly Expenses', beanie: 'beans going out' },
  'dashboard.netCashFlow': { en: 'Net Cash Flow', beanie: 'net cash flow' },
  'dashboard.recentTransactions': { en: 'Recent Transactions', beanie: 'recent transactions' },
  'dashboard.upcomingTransactions': { en: 'Upcoming Transactions', beanie: 'coming up' },
  'dashboard.assetsSummary': { en: 'Assets Summary', beanie: 'assets summary' },
  'dashboard.activeGoals': { en: 'Active Goals', beanie: 'beanie goals' },
  'dashboard.noTransactions': {
    en: 'No transactions yet. Add your first transaction to get started.',
    beanie: 'nothing yet — add your first one to get growing!',
  },
  'dashboard.noUpcoming': {
    en: 'No upcoming transactions in the next 30 days',
    beanie: 'no beans on the horizon for the next 30 days',
  },
  'dashboard.noAssets': {
    en: 'No assets yet. Add assets to track your property and valuables.',
    beanie: 'no big beans yet. add your property and valuables to grow your patch.',
  },
  'dashboard.noGoals': {
    en: 'No active goals. Set a financial goal to track your progress.',
    beanie: 'no goals sprouting yet. plant one and watch it grow!',
  },

  // Recurring
  'recurring.title': { en: 'Recurring', beanie: 'recurring' },
  'recurring.items': { en: 'Recurring Items', beanie: 'recurring items' },
  'recurring.monthlyIncome': {
    en: 'Monthly Recurring Income',
    beanie: 'beans coming in each month',
  },
  'recurring.monthlyExpenses': {
    en: 'Monthly Recurring Expenses',
    beanie: 'beans going out each month',
  },
  'recurring.netMonthly': { en: 'Monthly Savings', beanie: 'beans saved each month' },
  'recurring.noItems': { en: 'No recurring items yet.', beanie: 'no recurring items yet.' },
  'recurring.getStarted': {
    en: 'Click "Add Recurring" to set up automatic transactions.',
    beanie: 'click "add recurring" to plant some automatic moves.',
  },
  'recurring.addItem': { en: 'Add Recurring Item', beanie: 'add recurring item' },
  'recurring.editItem': { en: 'Edit Recurring Item', beanie: 'edit recurring item' },
  'recurring.deleteConfirm': {
    en: 'Are you sure you want to delete this recurring item? Existing transactions will not be affected.',
    beanie:
      'are you sure you want to delete this recurring item? existing transactions will not be affected.',
  },
  'recurring.next': { en: 'Next', beanie: 'next' },
  'recurring.active': { en: 'Active', beanie: 'active' },
  'recurring.paused': { en: 'Paused', beanie: 'paused' },
  'recurring.pauseItem': { en: 'Pause recurring', beanie: 'pause recurring' },
  'recurring.resumeItem': { en: 'Resume recurring', beanie: 'resume recurring' },
  'recurring.editScopeTitle': { en: 'Edit Recurring', beanie: 'edit recurring item' },
  'recurring.scopeThisOnly': { en: 'This Occurrence Only', beanie: 'just this item' },
  'recurring.scopeThisOnlyDesc': { en: 'Change only this date', beanie: 'change only this date' },
  'recurring.scopeAll': { en: 'All Occurrences', beanie: 'all items' },
  'recurring.scopeAllDesc': { en: 'Update the template', beanie: 'update the template' },
  'recurring.scopeThisAndFuture': { en: 'This & All Future', beanie: 'this & future items' },
  'recurring.scopeThisAndFutureDesc': {
    en: 'Split from this date forward',
    beanie: 'split from here on',
  },

  // Accounts
  'accounts.title': { en: 'Accounts', beanie: 'accounts' },
  'accounts.subtitle': {
    en: 'Manage your bank accounts and credit cards',
    beanie: 'where all your beans live',
  },
  'accounts.addAccount': { en: '+ Add Account', beanie: '+ add an account' },
  'accounts.editAccount': { en: 'Edit Account', beanie: 'edit an account' },
  'accounts.deleteAccount': { en: 'Delete Account', beanie: 'remove account' },
  'accounts.noAccounts': { en: 'No accounts yet', beanie: 'no accounts yet' },
  'accounts.getStarted': {
    en: 'Get started by adding your first account',
    beanie: 'add your first bean jar to get growing!',
  },
  'accounts.totalBalance': { en: 'Total Balance', beanie: 'total beans' },
  'accounts.accountName': { en: 'Account Name', beanie: 'account name' },
  'accounts.accountType': { en: 'Account Type', beanie: 'account type' },
  'accounts.currentBalance': { en: 'Current Balance', beanie: 'beans today' },
  'accounts.type.checking': { en: 'Checking Account', beanie: 'checking account' },
  'accounts.type.savings': { en: 'Savings Account', beanie: 'savings account' },
  'accounts.type.credit_card': { en: 'credit card', beanie: 'credit card' },
  'accounts.type.investment': { en: 'Investment Account', beanie: 'investment account' },
  'accounts.type.crypto': { en: 'Cryptocurrency', beanie: 'crypto account' },
  'accounts.type.cash': { en: 'Cash', beanie: 'cash' },
  'accounts.type.loan': { en: 'Loan', beanie: 'loan' },
  'accounts.type.other': { en: 'Other', beanie: 'other' },
  'accounts.type.retirement_401k': { en: '401k', beanie: '401k' },
  'accounts.type.retirement_ira': { en: 'IRA', beanie: 'ira' },
  'accounts.type.retirement_roth_ira': { en: 'roth ira', beanie: 'roth ira' },
  'accounts.type.retirement_bene_ira': { en: 'bene ira', beanie: 'bene ira' },
  'accounts.type.retirement_kids_ira': { en: 'kida ira', beanie: 'kida ira' },
  'accounts.type.retirement': { en: 'retirement', beanie: 'retirement' },
  'accounts.type.education_529': { en: 'college fund (529)', beanie: 'college fund (529)' },
  'accounts.type.education_savings': { en: 'education savings', beanie: 'education savings' },

  // Account categories & subtypes (used in AccountCategoryPicker)
  'accounts.cat.bank': { en: 'Bank', beanie: 'bank' },
  'accounts.cat.investment': { en: 'Investment', beanie: 'investment' },
  'accounts.cat.retirement': { en: 'Retirement', beanie: 'retirement' },
  'accounts.cat.cash': { en: 'Cash', beanie: 'cash' },
  'accounts.cat.loan': { en: 'Loan', beanie: 'loan' },
  'accounts.cat.other': { en: 'Other', beanie: 'other' },
  'accounts.subtype.savings': { en: 'Savings', beanie: 'savings' },
  'accounts.subtype.checking': { en: 'Checking', beanie: 'checking' },
  'accounts.subtype.creditCard': { en: 'Credit Card', beanie: 'credit card' },
  'accounts.subtype.brokerage': { en: 'Brokerage', beanie: 'brokerage' },
  'accounts.subtype.crypto': { en: 'Crypto', beanie: 'crypto' },
  'accounts.subtype.retirement': { en: 'Retirement', beanie: 'retirement' },
  'accounts.subtype.401k': { en: '401k', beanie: '401k' },
  'accounts.subtype.ira': { en: 'IRA', beanie: 'ira' },
  'accounts.subtype.rothIra': { en: 'ROTH IRA', beanie: 'roth ira' },
  'accounts.subtype.beneIra': { en: 'BENE IRA', beanie: 'bene ira' },
  'accounts.subtype.kidsIra': { en: 'Kids IRA', beanie: 'kids ira' },
  'accounts.subtype.retirementGeneral': { en: 'Retirement', beanie: 'retirement' },
  'accounts.subtype.education': { en: 'Education', beanie: 'education' },
  'accounts.subtype.collegeFund529': { en: 'College Fund (529)', beanie: 'college fund (529)' },
  'accounts.subtype.educationSavings': { en: 'Education Savings', beanie: 'education savings' },
  'modal.accountOwner': { en: 'Account Owner', beanie: 'account owner' },

  'accounts.pageTitle': { en: 'Our Accounts', beanie: 'our bean jars' },
  'accounts.subtitleCounts': {
    en: '{members} members · {accounts} accounts',
    beanie: '{members} members · {accounts} accounts',
  },
  'accounts.groupByMember': { en: 'Member', beanie: 'member' },
  'accounts.groupByCategory': { en: 'Category', beanie: 'category' },
  'accounts.addAnAccount': { en: 'Add an Account', beanie: 'add a bean jar' },
  'accounts.assetClass.cash': { en: 'Cash', beanie: 'cash' },
  'accounts.assetClass.investments': { en: 'Investments', beanie: 'investments' },
  'accounts.liabilityClass.creditCards': { en: 'Credit Cards', beanie: 'credit cards' },
  'accounts.liabilityClass.loans': { en: 'Loans', beanie: 'loans' },

  // Transactions
  'transactions.title': { en: 'Transactions', beanie: 'transaction' },
  'transactions.subtitle': {
    en: 'Track your income and expenses',
    beanie: 'watch your beans come and go',
  },
  'transactions.addTransaction': { en: '+ Add Transaction', beanie: '+ add transaction' },
  'transactions.editTransaction': { en: 'Edit Transaction', beanie: 'edit transaction' },
  'transactions.deleteTransaction': { en: 'Delete Transaction', beanie: 'remove transaction' },
  'transactions.noTransactions': {
    en: 'No transactions recorded yet.',
    beanie: 'no bean moves recorded yet.',
  },
  'transactions.getStarted': {
    en: 'Click "Add Transaction" to get started.',
    beanie: 'click "add bean move" to start tracking.',
  },
  'transactions.allTransactions': { en: 'All Transactions', beanie: 'all transactions' },
  'transactions.thisMonthIncome': { en: 'This Month Income', beanie: 'beans in this month' },
  'transactions.thisMonthExpenses': { en: 'This Month Expenses', beanie: 'beans out this month' },
  'transactions.netCashFlow': { en: 'Net Cash Flow', beanie: 'net bean flow' },
  'transactions.oneTime': { en: 'One Time Transactions', beanie: 'one-off transaction' },
  'transactions.recurringTransactions': {
    en: 'Recurring Transactions',
    beanie: 'regular bean moves',
  },
  'transactions.addRecurring': { en: 'Add Recurring', beanie: 'add recurring' },
  'transactions.type.income': { en: 'Income', beanie: 'income' },
  'transactions.type.expense': { en: 'Expense', beanie: 'expense' },
  'transactions.type.transfer': { en: 'Transfer', beanie: 'transfer' },

  // Assets
  'assets.title': { en: 'Assets', beanie: 'big beans' },
  'assets.subtitle': {
    en: 'Track your property, vehicles, and valuables',
    beanie: 'your biggest stuff — property, vehicles, and more',
  },
  'assets.addAsset': { en: '+ Add Asset', beanie: '+ add asset' },
  'assets.addAnAsset': { en: 'Add an asset', beanie: 'add an asset' },
  'assets.editAsset': { en: 'Edit Asset', beanie: 'edit asset' },
  'assets.deleteAsset': { en: 'Delete Asset', beanie: 'delete asset' },
  'assets.noAssets': { en: 'No assets yet', beanie: 'no stuff created yet' },
  'assets.getStarted': {
    en: 'Get started by adding your first asset',
    beanie: 'add your first big bean!',
  },
  'assets.assetName': { en: 'Asset Name', beanie: 'asset name' },
  'assets.assetType': { en: 'Asset Type', beanie: 'asset type' },
  'assets.includeInNetWorthDesc': {
    en: "Count this asset towards your family's net worth",
    beanie: "count this asset towards your pod's net worth",
  },
  'assets.hasLoan': { en: 'Has a Loan', beanie: 'has a loan' },
  'assets.hasLoanDesc': {
    en: 'Track mortgage, auto loan, or other financing',
    beanie: 'track mortgage, auto loan, or other financing',
  },
  'assets.loanDetails': { en: 'Loan Details', beanie: 'loan details' },
  'assets.originalLoanAmount': { en: 'Original Loan Amount', beanie: 'original loan amount' },
  'assets.outstandingBalance': { en: 'Outstanding Balance', beanie: 'outstanding balance' },
  'assets.interestRate': { en: 'Interest Rate (%)', beanie: 'interest rate (%)' },
  'assets.monthlyPayment': { en: 'Monthly Payment', beanie: 'monthly payment' },
  'assets.loanTerm': { en: 'Loan Term (months)', beanie: 'loan term (months)' },
  'assets.lender': { en: 'Lender', beanie: 'lender' },
  'assets.loanStartDate': { en: 'Loan Start Date', beanie: 'loan start date' },
  'assets.purchaseDate': { en: 'Purchase Date', beanie: 'purchase date' },
  'assets.type.real_estate': { en: 'Real Estate', beanie: 'real estate' },
  'assets.type.vehicle': { en: 'Vehicle', beanie: 'vehicle' },
  'assets.type.boat': { en: 'Boat', beanie: 'boat' },
  'assets.type.jewelry': { en: 'Jewelry', beanie: 'jewelry' },
  'assets.type.electronics': { en: 'Electronics', beanie: 'electronics' },
  'assets.type.equipment': { en: 'Equipment', beanie: 'equipment' },
  'assets.type.art': { en: 'Art', beanie: 'art' },
  'assets.type.investment': { en: 'Investment', beanie: 'investment' },
  'assets.type.crypto': { en: 'Cryptocurrency', beanie: 'cryptocurrency' },
  'assets.type.collectible': { en: 'Collectible', beanie: 'collectible' },
  'assets.type.other': { en: 'Other', beanie: 'other' },
  'assets.equity': { en: 'Equity', beanie: 'equity' },
  'assets.activeLoans': { en: 'active loans', beanie: 'active loans' },
  'assets.afterLoanDeductions': { en: 'After loan deductions', beanie: 'after loan deductions' },
  'assets.overall': { en: 'overall', beanie: 'overall' },

  // Goals
  'goals.title': { en: 'Goals', beanie: 'beanie goals' },
  'goals.subtitle': {
    en: 'Set and track your financial goals',
    beanie: 'plant a goal and watch it grow',
  },
  'goals.addGoal': { en: '+ Add Goal', beanie: '+ add goal' },
  'goals.editGoal': { en: 'Edit Goal', beanie: 'edit goal' },
  'goals.deleteGoal': { en: 'Delete Goal', beanie: 'delete goal' },
  'goals.noGoals': { en: 'No goals set yet.', beanie: 'no goals planted yet.' },
  'goals.getStarted': {
    en: 'Click "Add Goal" to create your first financial goal.',
    beanie: 'click "add goal" to plant your first bean dream!',
  },
  'goals.allGoals': { en: 'All Goals', beanie: 'all goals' },
  'goals.activeGoals': { en: 'Active Goals', beanie: 'ongoing goals' },
  'goals.completedGoals': { en: 'Completed Goals', beanie: 'completed goals!' },
  'goals.overdueGoals': { en: 'Overdue Goals', beanie: 'overdue goals' },
  'goals.goalName': { en: 'Goal Name', beanie: 'goal name' },
  'goals.goalType': { en: 'Goal Type', beanie: 'goal type' },
  'goals.assignTo': { en: 'Assign to', beanie: 'assign to' },
  'goals.familyWide': { en: 'Family-wide goal', beanie: 'a goal for your whole pod' },
  'goals.deadlineOptional': { en: 'Deadline (Optional)', beanie: 'deadline (optional)' },
  'goals.type.savings': { en: 'Savings', beanie: 'saving beans' },
  'goals.type.debt_payoff': { en: 'Debt Payoff', beanie: 'debt payoff' },
  'goals.type.investment': { en: 'Investment', beanie: 'investment' },
  'goals.type.vacation': { en: 'Vacation', beanie: 'vacation' },
  'goals.type.vehicle': { en: 'Vehicle', beanie: 'vehicle' },
  'goals.type.home': { en: 'Home', beanie: 'home' },
  'goals.type.education': { en: 'Education', beanie: 'education' },
  'goals.type.emergency': { en: 'Emergency Fund', beanie: 'emergency fund' },
  'goals.type.purchase': { en: 'Other Purchase', beanie: 'saving for' },
  'goals.priority.label': { en: 'priority', beanie: 'priority' },
  'goals.priority.low': { en: 'Low', beanie: 'low' },
  'goals.priority.medium': { en: 'Medium', beanie: 'medium' },
  'goals.priority.high': { en: 'High', beanie: 'high' },
  'goals.priority.critical': { en: 'Critical', beanie: 'critical' },
  'goals.progress': { en: 'Progress', beanie: 'growth' },
  'goals.deadline': { en: 'Deadline', beanie: 'deadline' },
  'goals.reopenGoal': { en: 'Reopen Goal', beanie: 'replant this beanie!' },
  'goals.noCompletedGoals': { en: 'No completed goals yet.', beanie: 'no goals completed yet.' },
  'goals.completedOn': { en: 'Completed', beanie: 'done' },
  'goals.achievedGoals': { en: 'Achieved Goals', beanie: 'achieved goals' },
  'goals.needsAttention': { en: 'Needs Attention', beanie: 'needs attention' },
  'goals.groupByMember': { en: 'By Member', beanie: 'by member' },
  'goals.groupByPriority': { en: 'By Priority', beanie: 'by priority' },
  'goals.addAGoal': { en: 'Add a goal', beanie: 'plant a goal' },
  'goals.almostThere': { en: 'Almost There!', beanie: 'almost there!' },
  'goals.letsCatchUp': { en: "Let's catch up", beanie: "let's catch up" },
  'goals.encourage.planted': {
    en: 'Just planted — every bean counts!',
    beanie: 'just planted — every bean counts!',
  },
  'goals.encourage.growing': {
    en: 'Halfway there — keep growing!',
    beanie: 'halfway there — keep growing!',
  },
  'goals.encourage.pastHalf': {
    en: 'Past the halfway mark — amazing!',
    beanie: 'past the halfway mark — amazing!',
  },
  'goals.encourage.almostThere': {
    en: 'So close — just {remaining} to go!',
    beanie: 'so close — just {remaining} to go!',
  },
  'goals.encourage.overdue': {
    en: 'A little behind — no worries, keep going!',
    beanie: 'a little behind — no worries, keep going!',
  },
  'goals.achieved': { en: 'Achieved!', beanie: 'achieved!' },

  // Goal Link (transaction-to-goal allocation)
  'goalLink.title': { en: 'Link to Goal', beanie: 'link to goal' },
  'goalLink.hintIntro': {
    en: 'When linked, each incoming payment automatically contributes towards this goal. Choose how much:',
    beanie:
      'when linked, each incoming payment automatically goes towards this goal. choose how much:',
  },
  'goalLink.hintPercentage': {
    en: 'Percentage — a share of every payment (e.g. 20% of each payday)',
    beanie: 'percentage — a share of every payment (e.g. 20% of each payday)',
  },
  'goalLink.hintFixed': {
    en: 'Fixed amount — the same amount from every payment, up to the remaining goal balance',
    beanie: 'fixed amount — the same amount from every payment, up to the remaining goal balance',
  },
  'goalLink.selectGoal': { en: 'Select Goal', beanie: 'pick a goal' },
  'goalLink.allocMode': { en: 'Contribution', beanie: 'contribution' },
  'goalLink.percentage': { en: 'Percentage', beanie: 'percentage' },
  'goalLink.fixedAmount': { en: 'Fixed Amount', beanie: 'fixed amount' },
  'goalLink.capped': { en: 'Reduced to meet goal', beanie: 'reduced to meet goal' },
  'goalLink.noGoals': {
    en: 'No active goals in this currency',
    beanie: 'no active goals in this currency',
  },

  // Transaction — Link Payment
  'txLink.linkPayment': { en: 'Link Payment', beanie: 'link payment' },
  'txLink.quickLinkPrompt': {
    en: 'Link to a loan or activity?',
    beanie: 'link to a loan or activity?',
  },
  'txLink.hintLinkPaymentIntro': {
    en: 'Link this outgoing payment to an activity or loan:',
    beanie: 'link this outgoing payment to an activity or loan:',
  },
  'txLink.hintLinkPaymentActivity': {
    en: 'Activity — tracks the cost against a family activity (e.g. swim class, music lesson). The payment appears on the activity timeline.',
    beanie:
      'activity — tracks the cost against a family activity. the payment shows on the activity timeline.',
  },
  'txLink.hintLinkPaymentLoan': {
    en: 'Loan — each payment is automatically split into interest and principal using standard amortization, reducing the outstanding loan balance over time.',
    beanie:
      'loan — each payment is split into interest and principal, reducing the loan balance over time.',
  },
  'txLink.activity': { en: 'Activity', beanie: 'activity' },
  'txLink.loan': { en: 'Loan', beanie: 'loan' },
  'txLink.selectLoan': { en: 'Select a Loan', beanie: 'pick a loan' },
  'txLink.noLoans': { en: 'No Active Loans', beanie: 'no loans around' },
  'txLink.interestPortion': { en: 'Interest', beanie: 'interest' },
  'txLink.principalPortion': { en: 'Principal', beanie: 'principal' },
  'txLink.remainingBalance': { en: 'Remaining', beanie: 'remaining' },
  'txLink.amortizationBreakdown': { en: 'Amortization Breakdown', beanie: 'payment split' },
  'txLink.amountLocked': {
    en: 'Amount set by linked payment',
    beanie: 'amount set by linked payment',
  },
  'txLink.extraPaymentNote': {
    en: 'Extra payment \u2014 full amount goes to principal',
    beanie: 'extra payment \u2014 all goes to principal',
  },
  'txLink.linkedLoan': { en: 'Linked Loan', beanie: 'linked loan' },
  'txLink.linkedActivity': { en: 'Linked Activity', beanie: 'linked activity' },
  'txLink.monthlyTransaction': { en: 'Monthly Transaction', beanie: 'monthly transaction' },
  'txLink.recentTransactions': { en: 'Recent Transactions', beanie: 'recent transactions' },
  'txLink.linkedTransactions': { en: 'Linked Transactions', beanie: 'linked transactions' },
  'txLink.hintDirection': {
    en: 'Linked payments are always outgoing. To change, remove the link from the activity or loan.',
    beanie: 'linked payments are always outgoing',
  },
  'txLink.hintCurrency': {
    en: 'Currency is set by the linked activity or loan and cannot be changed here.',
    beanie: 'currency is set by the linked item',
  },
  'txLink.hintFrequency': {
    en: 'Frequency is managed by the linked activity or loan. Edit the source to change.',
    beanie: 'frequency is managed by the linked item',
  },
  'txLink.hintSchedule': {
    en: 'Schedule dates are managed by the linked activity or loan.',
    beanie: 'schedule is managed by the linked item',
  },
  'txLink.hintLinkedActivity': {
    en: 'This transaction is linked to the activity above. To unlink, disable the monthly payment from the activity.',
    beanie: 'linked to the activity above — disable monthly payment to unlink',
  },
  'txLink.hintLinkedLoan': {
    en: 'This transaction is linked to the loan above. Payments automatically reduce the outstanding balance.',
    beanie: 'linked to the loan above — payments reduce the balance',
  },
  'txLink.hintDateView': {
    en: 'Date is managed by the recurring schedule and cannot be changed for individual transactions.',
    beanie: 'date is managed by the recurring schedule',
  },
  'txLink.hintAmortizationIntro': {
    en: 'Each payment is split into interest and principal using standard amortization:',
    beanie: 'Each payment is split into interest and principal using standard amortization:',
  },
  'txLink.hintAmortizationInterest': {
    en: 'Interest = outstanding balance \u00d7 (annual rate \u00f7 12). This is the cost of borrowing for the month.',
    beanie:
      'Interest = outstanding balance \u00d7 (annual rate \u00f7 12). This is the cost of borrowing for the month.',
  },
  'txLink.hintAmortizationPrincipal': {
    en: 'Principal = payment \u2212 interest. This portion reduces your outstanding balance.',
    beanie: 'Principal = payment \u2212 interest. This portion reduces your outstanding balance.',
  },
  'txLink.hintAmortizationOverTime': {
    en: 'As the balance decreases, more of each payment goes to principal and less to interest.',
    beanie:
      'As the balance decreases, more of each payment goes to principal and less to interest.',
  },

  // Recurring Payment Prompt
  'recurringPrompt.createPayment': {
    en: 'Create Monthly Payment',
    beanie: 'create monthly payment',
  },
  'recurringPrompt.createPaymentHint': {
    en: 'Enable this to automatically create a recurring monthly transaction linked to this item. This helps you accurately track your spending each month and keeps your payments and activities connected — so you always know where your money is going.',
    beanie:
      'Enable this to automatically create a recurring monthly transaction linked to this item. This helps you accurately track your spending each month and keeps your payments and activities connected — so you always know where your money is going.',
  },
  'recurringPrompt.payFrom': { en: 'Pay From', beanie: 'pay from' },
  'recurringPrompt.paymentCreated': {
    en: 'Monthly Payment Created',
    beanie: 'monthly payment created',
  },
  'recurringPrompt.paymentCreatedDetail': {
    en: 'A recurring payment has been set up for this activity',
    beanie: 'a recurring payment has been set up for this activity',
  },
  'recurringPrompt.viewTransactions': {
    en: 'View Transactions',
    beanie: 'view transactions',
  },
  'recurringPrompt.paymentRemoved': {
    en: 'Monthly Payment Removed',
    beanie: 'monthly payment removed',
  },
  'recurringPrompt.paymentRemovedDetail': {
    en: 'The recurring payment and all future transactions have been removed for this activity',
    beanie: 'the recurring payment and all future transactions have been removed',
  },

  // Loan Account Fields
  'loanAccount.details': { en: 'Loan Details', beanie: 'loan details' },
  'loanAccount.interestRate': { en: 'Interest Rate (%)', beanie: 'interest rate (%)' },
  'loanAccount.monthlyPayment': { en: 'Monthly Payment', beanie: 'monthly payment' },
  'loanAccount.loanTerm': { en: 'Loan Term (Months)', beanie: 'loan term (months)' },
  'loanAccount.startDate': { en: 'Loan Start Date', beanie: 'loan start date' },

  // Family
  'family.title': { en: 'Family', beanie: 'the pod' },
  'family.addMember': { en: 'Add Member', beanie: 'add a beanie' },
  'family.editMember': { en: 'Edit Member', beanie: 'edit beanie' },
  'family.deleteMember': { en: 'Delete Member', beanie: 'remove beanie' },
  'family.noMembers': {
    en: 'No family members yet.',
    beanie: 'your bean pod is empty — add your first beanie!',
  },
  'family.role.owner': { en: 'Owner', beanie: 'head beanie' },
  'family.role.admin': { en: 'Admin', beanie: 'admin beanie' },
  'family.role.member': { en: 'Member', beanie: 'beanie' },
  'family.email': { en: 'Email', beanie: 'email' },
  'family.gender': { en: 'Gender', beanie: 'gender' },
  'family.gender.male': { en: 'Male', beanie: 'boy beanie' },
  'family.gender.female': { en: 'Female', beanie: 'girl beanie' },
  'family.gender.other': { en: 'Other', beanie: 'other' },
  'family.ageGroup': { en: 'Age Group', beanie: 'age group' },
  'family.ageGroup.adult': { en: 'Adult', beanie: 'big beanie' },
  'family.ageGroup.child': { en: 'Child', beanie: 'little beanie' },
  'family.dateOfBirth': { en: 'Date of Birth', beanie: 'beanie birthday' },
  'family.dateOfBirth.month': { en: 'Month', beanie: 'month' },
  'family.dateOfBirth.day': { en: 'Day', beanie: 'day' },
  'family.dateOfBirth.year': { en: 'Year (optional)', beanie: 'year (optional)' },
  'family.avatarPreview': { en: 'Avatar Preview', beanie: 'your beanie' },

  // Reports
  'reports.title': { en: 'Reports', beanie: 'bean reports' },
  'reports.subtitle': {
    en: 'Visualize your financial data with charts and reports',
    beanie: 'see how your beanies are growing',
  },
  'reports.noData': {
    en: 'No data available for reports yet.',
    beanie: 'no beanies to make a report yet!',
  },
  'reports.familyMember': { en: 'Family Member', beanie: 'family member' },
  'reports.netWorthOverTime': { en: 'Net Worth Over Time', beanie: 'net worth over time' },
  'reports.netWorthDescription': {
    en: 'Projected net worth based on current assets and recurring transactions',
    beanie: 'how your bean patch could grow',
  },
  'reports.currentNetWorth': { en: 'Current Net Worth', beanie: 'net worth now' },
  'reports.projectedNetWorth': { en: 'Projected Net Worth', beanie: 'net worth later' },
  'reports.projectedChange': { en: 'Projected Change', beanie: 'projected change' },
  'reports.incomeVsExpenses': { en: 'Income vs Expenses', beanie: 'beans in vs beans out' },
  'reports.incomeVsExpensesDescription': {
    en: 'Monthly breakdown of income and expenses by category',
    beanie: 'monthly breakdown of beans coming in and going out',
  },
  'reports.totalIncome': { en: 'Total Income', beanie: 'total beans in' },
  'reports.totalExpenses': { en: 'Total Expenses', beanie: 'total beans out' },
  'reports.netCashFlow': { en: 'Net Cash Flow', beanie: 'net bean flow' },

  // Forecast
  'forecast.title': { en: 'Forecast', beanie: 'bean forecast' },
  'forecast.noData': {
    en: 'No data available for forecasting yet.',
    beanie: 'plant some beans first — then we can forecast your harvest!',
  },
  'forecast.comingSoon': {
    en: 'Coming soon to your bean patch',
    beanie: 'coming soon to your bean patch',
  },
  'forecast.comingSoonDescription': {
    en: "We're growing something special. Financial forecasting will help you see where your beanies are headed.",
    beanie:
      "we're growing something special. financial forecasting will help you see where your beanies are headed.",
  },
  'forecast.feature.projections': {
    en: 'Recurring transaction projections',
    beanie: 'recurring transaction projections',
  },
  'forecast.feature.cashFlow': {
    en: 'Cash flow forecast (3, 6, and 12 months)',
    beanie: 'cash flow forecast (3, 6, and 12 months)',
  },
  'forecast.feature.goals': {
    en: 'Goal achievement projections',
    beanie: 'goal achievement projections',
  },
  'forecast.feature.scenarios': {
    en: '"What if" scenario simulation',
    beanie: '"what if" scenario simulation',
  },

  // Settings
  'settings.title': { en: 'Settings', beanie: 'settings' },
  'settings.subtitle': { en: 'Configure your app preferences', beanie: 'tune your beanie patch' },
  'settings.general': { en: 'General', beanie: 'general' },
  'settings.editProfile': { en: 'Edit Profile', beanie: 'edit profile' },
  'settings.card.appearance': { en: 'Appearance', beanie: 'appearance' },
  'settings.card.appearanceDesc': { en: 'Theme & display preferences', beanie: 'how things look' },
  'settings.card.currency': { en: 'Currency & Rates', beanie: 'currency & rates' },
  'settings.card.currencyDesc': {
    en: 'Base currency & exchange rates',
    beanie: 'your bean currency',
  },
  'settings.card.security': { en: 'Security & Privacy', beanie: 'security & privacy' },
  'settings.card.securityDesc': { en: 'Passkeys & device trust', beanie: 'keep your beans safe' },
  'settings.card.familyMembers': { en: 'Family Members', beanie: 'family members' },
  'settings.card.familyMembersDesc': { en: 'Manage your family', beanie: 'manage your pod' },
  'settings.card.familyData': { en: 'Family Data', beanie: 'family data' },
  'settings.card.familyDataDesc': { en: 'Cloud storage & sync', beanie: 'your bean vault' },
  'settings.card.dataManagement': { en: 'Data Management', beanie: 'data management' },
  'settings.card.dataManagementDesc': { en: 'Export & clear data', beanie: 'export & clear beans' },
  'settings.quickToggles': { en: 'Quick Settings', beanie: 'quick settings' },
  'settings.darkMode': { en: 'Dark Mode', beanie: 'dark mode' },
  'settings.darkModeDescription': {
    en: 'Switch to a darker color scheme that is easier on the eyes',
    beanie: 'switch to a darker color scheme that is easier on the eyes',
  },
  'settings.baseCurrency': { en: 'Base Currency', beanie: 'base currency' },
  'settings.baseCurrencyHint': {
    en: 'Your primary currency for displaying totals and conversions',
    beanie: 'your primary currency for displaying totals and conversions',
  },
  'settings.displayCurrency': { en: 'Display Currency', beanie: 'display currency' },
  'settings.theme': { en: 'Theme', beanie: 'theme' },
  'settings.theme.light': { en: 'Light', beanie: 'light' },
  'settings.theme.dark': { en: 'Dark', beanie: 'dark' },
  'settings.theme.system': { en: 'System', beanie: 'system' },
  'settings.themeHint': {
    en: 'Choose your preferred color scheme',
    beanie: 'choose your preferred color scheme',
  },
  'settings.weekStart': { en: 'Week Starts On', beanie: 'week starts on' },
  'settings.weekStart.sunday': { en: 'Sunday', beanie: 'sunday' },
  'settings.weekStart.monday': { en: 'Monday', beanie: 'monday' },
  'settings.weekStartHint': {
    en: 'Choose which day the calendar week starts on',
    beanie: 'choose which day the calendar week starts on',
  },
  'settings.language': { en: 'Language', beanie: 'language' },
  'settings.beanieMode': { en: 'Beanie Mode', beanie: 'get me out of beanie mode' },
  'settings.beanieModeDescription': {
    en: 'Talk like a real beanie!',
    beanie: "what's with all this dumb bean talk?! just give me plain english!",
  },
  'settings.beanieModeDisabled': {
    en: 'Beanie Mode is only available in English',
    beanie: 'sorry, beanie mode is only available in english',
  },
  'settings.soundEffects': { en: 'Sound Effects', beanie: 'sound effects' },
  'settings.soundEffectsDescription': {
    en: 'Play fun sounds for actions and celebrations',
    beanie: 'play fun sounds for actions and celebrations',
  },
  'settings.sync': { en: 'Sync', beanie: 'sync' },
  'settings.fileSync': { en: 'File Sync', beanie: 'file sync' },
  'settings.syncToFile': { en: 'Sync to a File', beanie: 'sync to a file' },
  'settings.syncToFileDescription': {
    en: 'Save your data to a JSON file. Place it in Google Drive, Dropbox, or any synced folder for cloud backup.',
    beanie:
      'save your data to a json file. place it in google drive, dropbox, or any synced folder for cloud backup.',
  },
  'settings.createNewSyncFile': { en: 'Create New Sync File', beanie: 'create new sync file' },
  'settings.loadFromExistingFile': {
    en: 'Load from Existing File',
    beanie: 'load from existing file',
  },
  'settings.syncEnabled': { en: 'Sync Enabled', beanie: 'sync enabled' },
  'settings.autoSync': { en: 'Auto Sync', beanie: 'auto sync' },
  'settings.encryption': { en: 'Encryption', beanie: 'encryption' },
  'settings.exchangeRates': { en: 'Exchange Rates', beanie: 'exchange rates' },
  'settings.aiInsights': { en: 'AI Insights', beanie: 'ai insights' },
  'settings.aiPoweredInsights': { en: 'AI-Powered Insights', beanie: 'bean advisor' },
  'settings.aiComingSoon': {
    en: 'Coming soon - Get personalized financial advice powered by AI',
    beanie: 'coming soon — your very own bean advisor!',
  },
  'settings.dataManagement': { en: 'Data Management', beanie: 'data management' },
  'settings.exportData': { en: 'Export Encrypted Backup', beanie: 'export encrypted backup' },
  'settings.exportDataDescription': {
    en: 'Download your data as an encrypted .beanpod file (password-protected)',
    beanie: 'download your beans as an encrypted .beanpod file (password-protected)',
  },
  'settings.clearAllData': { en: 'Clear All Data', beanie: 'clear all data' },
  'settings.clearAllDataDescription': {
    en: 'Permanently delete all your data',
    beanie: 'remove all your beanies from this device',
  },
  'settings.clearData': { en: 'Clear Data', beanie: 'clear data' },
  'settings.clearDataConfirmation': {
    en: 'Are you sure you want to delete all your data? This action cannot be undone.',
    beanie: 'this will clear all your beans. are you really sure? this cannot be undone.',
  },
  'settings.yesDeleteEverything': {
    en: 'Yes, Delete Everything',
    beanie: 'yes, clear my bean pod',
  },
  'settings.reconnectDrive': { en: 'Reconnect', beanie: 'reconnect' },
  'settings.forceSave': { en: 'Force Save', beanie: 'force save' },
  'settings.cachePersistWarning': {
    en: 'Local cache is not updating — your data may not survive a page refresh',
    beanie: "local cache isn't saving — your beans might not survive a refresh",
  },
  'settings.about': { en: 'About', beanie: 'about' },
  'settings.appName': { en: 'beanies.family', beanie: 'beanies.family' },
  'settings.version': { en: 'Version 1.0.0 (MVP)', beanie: 'version 1.0.0 (mvp)' },
  'settings.noRatesWarning': {
    en: 'Exchange rates have not been loaded yet. Currency conversions will not work correctly without them.',
    beanie:
      'exchange rates have not been loaded yet. currency conversions will not work correctly without them.',
  },
  'settings.fetchRatesNow': { en: 'Fetch Rates Now', beanie: 'fetch rates now' },
  'settings.switchAnyway': { en: 'Switch Anyway', beanie: 'switch anyway' },
  'settings.ratesFetchFailed': {
    en: 'Could not fetch exchange rates. Check your connection and try again.',
    beanie: 'could not fetch exchange rates. check your connection and try again.',
  },
  'settings.appDescription': {
    en: 'A secure, privacy-focused family finance and planning application.',
    beanie: "a private and secure home for your family's precious beanies",
  },
  'settings.privacyNote': {
    en: 'Your data is always encrypted, both in transit and at rest, and saved to a file you control. Nothing is stored on our servers — your precious financial and family data never leaves your hands.',
    beanie:
      'Your data is always encrypted, both in transit and at rest, and saved to a file you control. Nothing is stored on our servers — your precious financial and family data never leaves your hands.',
  },

  // Form labels
  'form.name': { en: 'Name', beanie: 'name' },
  'form.email': { en: 'Email', beanie: 'email' },
  'form.type': { en: 'Type', beanie: 'type' },
  'form.amount': { en: 'Amount', beanie: 'amount' },
  'form.currency': { en: 'Currency', beanie: 'currency' },
  'form.balance': { en: 'Balance', beanie: 'balance' },
  'form.date': { en: 'Date', beanie: 'date' },
  'form.category': { en: 'Category', beanie: 'category' },
  'form.description': { en: 'Description', beanie: 'description' },
  'form.account': { en: 'Account', beanie: 'account' },
  'form.selectAccount': { en: 'Select an account', beanie: 'select an account' },
  'form.fromAccount': { en: 'From Account', beanie: 'from account' },
  'form.toAccount': { en: 'To Account', beanie: 'to account' },
  'form.owner': { en: 'Owner', beanie: 'owner' },
  'form.institution': { en: 'Financial Institution', beanie: 'banks' },
  'form.country': { en: 'Country', beanie: 'country' },
  'form.other': { en: 'Other', beanie: 'other' },
  'form.searchInstitutions': { en: 'Search institutions...', beanie: 'find your bank...' },
  'form.searchCountries': { en: 'Search countries...', beanie: 'search countries...' },
  'form.enterCustomName': { en: 'Enter institution name', beanie: 'enter institution name' },
  'form.customBadge': { en: 'Custom', beanie: 'custom' },
  'form.frequency': { en: 'Frequency', beanie: 'frequency' },
  'form.frequency.daily': { en: 'Daily', beanie: 'daily' },
  'form.frequency.weekly': { en: 'Weekly', beanie: 'weekly' },
  'form.frequency.monthly': { en: 'Monthly', beanie: 'monthly' },
  'form.frequency.yearly': { en: 'Yearly', beanie: 'yearly' },
  'form.startDate': { en: 'Start Date', beanie: 'start date' },
  'form.endDate': { en: 'End Date', beanie: 'end date' },
  'form.targetAmount': { en: 'Target Amount', beanie: 'target to reach' },
  'form.currentAmount': { en: 'Current Amount', beanie: 'beans so far' },
  'form.priority': { en: 'Priority', beanie: 'priority' },
  'form.notes': { en: 'Notes', beanie: 'notes' },
  'form.includeInNetWorth': {
    en: 'Include in Net Worth',
    beanie: 'count this in my total net worth',
  },
  'form.isActive': { en: 'Active', beanie: 'active' },
  'form.month': { en: 'Month', beanie: 'month' },
  'form.required': { en: 'Required', beanie: 'required' },

  // Validation messages
  'validation.required': { en: 'This field is required', beanie: 'this field is required' },
  'validation.invalidEmail': {
    en: 'Please enter a valid email address',
    beanie: 'please enter a valid email address',
  },
  'validation.invalidAmount': {
    en: 'Please enter a valid amount',
    beanie: 'please enter a valid amount',
  },
  'validation.minLength': {
    en: 'Must be at least {min} characters',
    beanie: 'must be at least {min} characters',
  },

  // Confirmation dialogs
  'confirm.delete': {
    en: 'Are you sure you want to delete this item?',
    beanie: 'remove this item for good?',
  },
  'confirm.deleteAccount': {
    en: 'Are you sure you want to delete this account? All associated transactions will also be deleted.',
    beanie: 'remove this account? all the beans inside go with it.',
  },
  'confirm.deleteMember': {
    en: 'Are you sure you want to delete this family member?',
    beanie: 'remove this beanie from your pod?',
  },
  'confirm.unsavedChanges': {
    en: 'You have unsaved changes. Are you sure you want to leave?',
    beanie: "you've got unsaved changes! leave anyway?",
  },

  // Success messages
  'success.saved': { en: 'Changes saved successfully', beanie: 'beanies saved!' },
  'success.created': { en: 'Created successfully', beanie: 'beanie added!' },
  'success.deleted': { en: 'Deleted successfully', beanie: 'gone!' },
  'success.updated': { en: 'Updated successfully', beanie: 'beanies updated!' },

  // Error messages
  'error.generic': {
    en: 'Something went wrong. Please try again.',
    beanie: 'hmm, a bean got stuck. try again?',
  },
  'error.loadFailed': { en: 'Failed to load data', beanie: "couldn't load your beanies" },
  'error.saveFailed': { en: 'Failed to save changes', beanie: "hmm, couldn't save your beanies" },
  'error.deleteFailed': { en: 'Failed to delete', beanie: "couldn't remove that beanie" },
  'error.networkError': {
    en: 'Network error. Please check your connection.',
    beanie: 'no connection — your beanies are still here though!',
  },

  // Not Found (404)
  'notFound.title': { en: 'Not Found', beanie: 'not found' },
  'notFound.heading': { en: 'Oops! This bean got lost...', beanie: 'oops! this bean got lost...' },
  'notFound.description': {
    en: "The page you're looking for has wandered off. Let's get you back to your beanies.",
    beanie: "the page you're looking for has wandered off. let's get you back to your beanies.",
  },
  'notFound.goHome': { en: 'Back to Dashboard', beanie: 'back to dashboard' },

  // No Access (permission denied)
  'noAccess.title': { en: 'No Access', beanie: 'no access' },
  'noAccess.heading': {
    en: 'This area is off-limits, little bean',
    beanie: 'this area is off-limits, little bean',
  },
  'noAccess.description': {
    en: "You don't have permission to view this page. Ask a pod manager to update your access.",
    beanie: "you don't have permission to view this page. ask a pod manager to update your access.",
  },
  'noAccess.backToNook': { en: 'Back to the Nook', beanie: 'back to the nook' },

  // Empty states
  'empty.noData': { en: 'No data available', beanie: 'no beans here yet' },
  'empty.noResults': { en: 'No results found', beanie: 'no beans matched your search' },

  // Filter
  'filter.members': { en: 'Members', beanie: 'members' },
  'filter.allMembers': { en: 'All Members', beanie: 'all members' },

  // Date/Time
  'date.today': { en: 'Today', beanie: 'today' },
  'date.yesterday': { en: 'Yesterday', beanie: 'yesterday' },
  'date.thisWeek': { en: 'This Week', beanie: 'this week' },
  'date.thisMonth': { en: 'This Month', beanie: 'this month' },
  'date.thisYear': { en: 'This Year', beanie: 'this year' },
  'date.tomorrow': { en: 'Tomorrow', beanie: 'tomorrow' },
  'date.days': { en: 'days', beanie: 'days' },
  'date.currentMonth': { en: 'Current Month', beanie: 'current month' },
  'date.lastMonth': { en: 'Last Month', beanie: 'last month' },
  'date.last3Months': { en: 'Last 3 Months', beanie: 'last 3 months' },
  'date.last6Months': { en: 'Last 6 Months', beanie: 'last 6 months' },
  'date.last12Months': { en: 'Last 12 Months', beanie: 'last 12 months' },
  'date.last2Years': { en: 'Last 2 Years', beanie: 'last 2 years' },
  'date.customRange': { en: 'Custom Range', beanie: 'custom range' },
  'date.allTime': { en: 'All Time', beanie: 'all time' },
  'date.previousMonth': { en: 'Previous Month', beanie: 'previous month' },

  // Months
  'month.january': { en: 'January', beanie: 'january' },
  'month.february': { en: 'February', beanie: 'february' },
  'month.march': { en: 'March', beanie: 'march' },
  'month.april': { en: 'April', beanie: 'april' },
  'month.may': { en: 'May', beanie: 'may' },
  'month.june': { en: 'June', beanie: 'june' },
  'month.july': { en: 'July', beanie: 'july' },
  'month.august': { en: 'August', beanie: 'august' },
  'month.september': { en: 'September', beanie: 'september' },
  'month.october': { en: 'October', beanie: 'october' },
  'month.november': { en: 'November', beanie: 'november' },
  'month.december': { en: 'December', beanie: 'december' },

  // Dashboard (additional)
  'dashboard.savingsGoals': { en: 'Savings Goals', beanie: 'your savings goals' },
  'dashboard.seeAll': { en: 'See All →', beanie: 'see all →' },
  'dashboard.yourBeans': { en: 'Your Family', beanie: 'your bean pod' },
  'dashboard.addBean': { en: 'Add Family Member', beanie: 'add a beanie' },
  'dashboard.healthy': { en: 'Healthy', beanie: 'growing strong' },
  'dashboard.savingsRate': { en: 'savings rate', beanie: 'savings rate' },
  'dashboard.recurringSummary': { en: 'Recurring Summary', beanie: 'recurring summary' },
  'dashboard.netRecurring': { en: 'Net Recurring (Monthly)', beanie: 'recurring (monthly)' },
  'dashboard.upcoming': { en: 'Upcoming', beanie: 'coming up' },
  'dashboard.noRecurringItems': { en: 'No recurring items yet', beanie: 'no recurring beans yet' },
  'dashboard.roleParent': { en: 'Parent', beanie: 'big bean' },
  'dashboard.roleLittleBean': { en: 'Little Beanie', beanie: 'little beanie' },
  'dashboard.chartHidden': { en: 'Chart hidden', beanie: 'chart hidden' },
  'dashboard.noDataYet': { en: 'No data yet', beanie: 'no beans to chart yet' },
  'dashboard.comingUp': { en: 'Coming Up', beanie: 'coming up' },
  'dashboard.yourAssets': { en: 'Your Assets', beanie: 'your assets' },
  'dashboard.yourAccounts': { en: 'Your Accounts', beanie: 'your accounts' },
  'dashboard.noAccounts': {
    en: 'No accounts yet. Add accounts to track your finances.',
    beanie: 'no bean jars yet. add some to start counting!',
  },
  'dashboard.budgetSummary': { en: 'Budget', beanie: 'bean budget' },
  'dashboard.noBudget': {
    en: 'No active budget yet. Set one up to track your spending.',
    beanie: 'no bean budget yet. set one up to keep your beans in check!',
  },
  'dashboard.createBudget': { en: 'Create Budget →', beanie: 'create budget →' },
  'dashboard.budgetSpent': { en: 'spent', beanie: 'spent' },
  'dashboard.budgetRemaining': { en: 'remaining', beanie: 'left' },
  'dashboard.budgetCategories': { en: 'Top Categories', beanie: 'top categories' },
  'dashboard.budgetOver': { en: 'over', beanie: 'over' },

  // Greeting
  'greeting.morning': { en: 'Good morning,', beanie: 'good morning,' },
  'greeting.afternoon': { en: 'Good afternoon,', beanie: 'good afternoon,' },
  'greeting.evening': { en: 'Good evening,', beanie: 'good evening,' },

  // Header / Privacy
  'header.hideFinancialFigures': {
    en: 'Hide financial figures',
    beanie: 'cover the beans',
  },
  'header.showFinancialFigures': {
    en: 'Show financial figures',
    beanie: 'show the beans',
  },
  'header.financialFiguresVisible': { en: 'Finances visible', beanie: 'finances visible' },
  'header.financialFiguresHidden': { en: 'Finances hidden', beanie: 'finances hidden' },
  'header.notifications': {
    en: 'Notifications - Coming Soon',
    beanie: 'notifications - coming soon!',
  },
  'header.editProfile': { en: 'Edit Profile', beanie: 'edit profile' },
  'header.settings': { en: 'Settings', beanie: 'settings' },
  'header.refreshAll': { en: 'Refresh All Data', beanie: 'refresh all beans' },
  'header.refreshSuccess': { en: 'Data refreshed', beanie: 'beans are fresh' },
  'header.refreshNoSync': {
    en: 'No cloud sync configured',
    beanie: 'no cloud sync configured',
  },

  // Sidebar
  'sidebar.noDataFile': { en: 'No data file', beanie: 'no data file' },
  'sidebar.dataEncrypted': { en: 'Data encrypted', beanie: 'data encrypted' },
  'sidebar.notEncrypted': { en: 'Not encrypted', beanie: 'not encrypted' },
  'sidebar.noDataFileConfigured': {
    en: 'No data file configured',
    beanie: 'no data file configured',
  },
  'sidebar.dataEncryptedFull': {
    en: 'Data encrypted (AES-256-GCM)',
    beanie: 'data encrypted (aes-256-gcm)',
  },
  'sidebar.dataFileNotEncrypted': {
    en: 'Data file not encrypted',
    beanie: 'data file not encrypted',
  },

  // Transactions (additional)
  'transactions.showing': { en: 'Showing:', beanie: 'showing:' },
  'transactions.income': { en: 'Income', beanie: 'beans in' },
  'transactions.expenses': { en: 'Expenses', beanie: 'beans out' },
  'transactions.net': { en: 'Net', beanie: 'net' },
  'transactions.noTransactionsForPeriod': {
    en: 'No transactions found for this period',
    beanie: 'no transactions found for this period',
  },
  'transactions.tryDifferentRange': {
    en: 'Try selecting a different date range or add a new transaction.',
    beanie: 'try a different date range or add a new transaction.',
  },
  'transactions.editingProjected': {
    en: 'Editing projected transaction for {date}',
    beanie: 'editing this projected bean for {date}',
  },
  'transactions.deleteConfirm': {
    en: 'Are you sure you want to delete this transaction?',
    beanie: 'remove this transaction for good?',
  },
  'transactions.createdTitle': {
    en: 'Transaction Created',
    beanie: 'transaction created',
  },
  'transactions.createdMessage': {
    en: 'Your transaction has been created!',
    beanie: 'your transaction has been created!',
  },
  'transactions.nextMonthPreview': {
    en: 'Coming Up Next Month',
    beanie: 'beans sprouting next month',
  },
  'transactions.descriptionPlaceholder': {
    en: 'e.g., Grocery shopping',
    beanie: 'e.g., grocery shopping',
  },
  'transactions.filterAll': { en: 'All', beanie: 'all beans' },
  'transactions.filterRecurring': { en: 'Recurring', beanie: 'recurring' },
  'transactions.filterOneTime': { en: 'One-time', beanie: 'one-off' },
  'transactions.filterIncoming': { en: 'Incoming', beanie: 'beans in' },
  'transactions.filterOutgoing': { en: 'Outgoing', beanie: 'beans out' },
  'transactions.showingIncome': { en: 'Showing: Income', beanie: 'showing: beans in' },
  'transactions.showingExpenses': { en: 'Showing: Expenses', beanie: 'showing: beans out' },
  'transactions.searchPlaceholder': {
    en: 'Search transactions...',
    beanie: 'find a bean...',
  },
  'transactions.recurringCount': { en: 'Recurring', beanie: 'recurring' },
  'transactions.oneTimeCount': { en: 'One-time', beanie: 'one-off' },
  'transactions.typeRecurring': { en: 'recurring', beanie: 'recurring' },
  'transactions.typeOneTime': { en: 'one-time', beanie: 'one-off' },
  'transactions.transactionCount': { en: 'transactions', beanie: 'beans' },
  'transactions.projected': { en: 'Projected', beanie: 'future bean' },
  'transactions.projectedLabel': { en: 'projected', beanie: 'projected' },
  'transactions.pageTitle': { en: 'All Transactions', beanie: 'all beans' },
  'transactions.dayOfMonth': { en: 'Day of month', beanie: 'day of month' },

  // Reports (additional)
  'reports.next3Months': { en: 'Next 3 Months', beanie: 'next 3 months' },
  'reports.next6Months': { en: 'Next 6 Months', beanie: 'next 6 months' },
  'reports.next1Year': { en: 'Next 1 Year', beanie: 'next 1 year' },
  'reports.next2Years': { en: 'Next 2 Years', beanie: 'next 2 years' },
  'reports.next5Years': { en: 'Next 5 Years', beanie: 'next 5 years' },
  'reports.next10Years': { en: 'Next 10 Years', beanie: 'next 10 years' },
  'reports.next15Years': { en: 'Next 15 Years', beanie: 'next 15 years' },
  'reports.next20Years': { en: 'Next 20 Years', beanie: 'next 20 years' },
  'reports.allFamilyMembers': { en: 'All Family Members', beanie: 'all family members' },
  'reports.allCategories': { en: 'All Categories', beanie: 'all categories' },

  // Family (additional)
  'family.cannotDeleteOwner': {
    en: 'Cannot delete the owner account.',
    beanie: 'cannot delete the owner account.',
  },
  'family.deleteConfirm': {
    en: 'Are you sure you want to remove this family member?',
    beanie: 'remove this beanie from your pod?',
  },
  'family.editFamilyName': { en: 'Edit family name', beanie: 'edit family name' },
  'family.createLogin': { en: 'Create Login', beanie: 'create login' },
  'family.enterName': { en: 'Enter name', beanie: 'enter name' },
  'family.enterEmail': { en: 'Enter email', beanie: 'enter email' },
  'family.emailNotSet': { en: 'No email yet', beanie: 'no email yet' },
  'family.profileColor': { en: 'Profile Color', beanie: 'profile color' },
  'family.year': { en: 'Year', beanie: 'year' },
  'family.status.waitingToJoin': {
    en: 'Waiting to join',
    beanie: 'waiting to join',
  },
  'family.status.active': {
    en: 'Active',
    beanie: 'active',
  },
  'family.lastSeen': { en: 'Last seen {date}', beanie: 'last seen {date}' },
  'family.neverLoggedIn': { en: 'Never signed in', beanie: 'never signed in' },
  'family.inviteMember': { en: 'Invite {name}', beanie: 'invite {name}' },
  'family.linkCopied': {
    en: 'Invite link copied!',
    beanie: 'magic bean link copied!',
  },
  'family.copyInviteLinkHint': {
    en: 'Copy and share your magic link with your family member',
    beanie: 'copy the magic bean link for this beanie',
  },
  'family.memberAdded': { en: 'Member Added!', beanie: 'new beanie added!' },
  'family.scanOrShare': {
    en: 'Scan QR code or share the link',
    beanie: 'scan the magic code or share the link',
  },
  'family.linkExpiry': {
    en: 'This link expires in 24 hours',
    beanie: 'this magic link expires in 24 hours',
  },
  'family.inviteSection.title': {
    en: 'Invite to join',
    beanie: 'invite this beanie',
  },
  'family.inviteSection.desc': {
    en: "This member hasn't joined yet. Share the link below so they can set up their account.",
    beanie: "this beanie hasn't joined yet! share the magic link so they can join your pod.",
  },
  'family.inviteSection.step1': {
    en: 'Copy the invite link and send it to them',
    beanie: 'copy the magic bean link and send it their way',
  },
  'family.inviteSection.step2': {
    en: 'They open the link and choose a password',
    beanie: 'they open the link and pick a secret password',
  },
  'family.inviteSection.step3': {
    en: "They're in! They can now sign in with their own account",
    beanie: "they're in! they can now sign into your family pod",
  },

  // Family Hub
  'family.hub.title': { en: 'The Bean Pod', beanie: 'the bean pod' },
  'family.hub.subtitle': {
    en: '{count} Beans Growing Strong',
    beanie: '{count} beans growing strong',
  },
  'family.hub.addBean': { en: '+ Add a Beanie', beanie: '+ add a beanie' },
  'family.hub.familyStats': { en: 'Family Stats', beanie: 'family stats' },
  'family.hub.members': { en: 'Members', beanie: 'beanies' },
  'family.hub.totalActivities': { en: 'Total Activities', beanie: 'total activities' },
  'family.hub.upcomingEvents': { en: 'Upcoming Events', beanie: 'upcoming events' },
  'family.hub.eventsThisWeek': { en: 'Events This Week', beanie: 'events this week' },
  'family.hub.noEvents': { en: 'No Events This Week', beanie: 'no events this week' },
  'family.hub.stat.activities': { en: 'Activities', beanie: 'activities' },
  'family.hub.stat.todos': { en: 'Todos', beanie: 'todos' },
  'family.hub.stat.goals': { en: 'Goals', beanie: 'goals' },
  'family.hub.stat.events': { en: 'Events', beanie: 'events' },
  'family.hub.statBeans': { en: 'beans', beanie: 'beans' },
  'family.hub.statUpcoming': { en: 'upcoming', beanie: 'upcoming' },
  'family.hub.highlight.birthday': { en: 'Birthday!', beanie: 'birthday!' },
  'family.hub.highlight.thisWeek': { en: 'This Week', beanie: 'this week' },

  // Settings (additional)
  'settings.preferredCurrencies': { en: 'Preferred Currencies', beanie: 'preferred currencies' },
  'settings.preferredCurrenciesHint': {
    en: 'Select up to 4 currencies to show in the header',
    beanie: 'select up to 4 currencies to show in the header',
  },
  'settings.addCurrency': { en: 'Add currency...', beanie: 'add currency...' },
  'settings.searchCurrencies': { en: 'Search currencies...', beanie: 'search currencies...' },
  'settings.selected': { en: 'Selected', beanie: 'selected' },
  'settings.familyDataOptions': { en: 'Family Data Options', beanie: 'family data options' },
  'settings.familyDataDescription': {
    en: "Your family's financial data is encrypted and safely stored in a file you control.",
    beanie: 'your beans are safe — encrypted and stored in a file only you control.',
  },
  'settings.saveDataToFile': { en: 'Save your data to a file', beanie: 'save your data to a file' },
  'settings.createOrLoadDataFile': {
    en: 'Create an encrypted data file or load an existing one.',
    beanie: 'create an encrypted data file or load an existing one.',
  },
  'settings.createNewDataFile': {
    en: 'Create New Family Data File',
    beanie: 'create new family data file',
  },
  'settings.loadExistingDataFile': {
    en: 'Load Existing Family Data File',
    beanie: 'load existing family data file',
  },
  'settings.loadFileConfirmation': {
    en: 'This will replace all local data with the contents of the selected file and set it as your data file. Continue?',
    beanie:
      'this will replace all local data with the contents of the selected file and set it as your data file. continue?',
  },
  'settings.yesLoadFile': { en: 'Yes, Load File', beanie: 'yes, load file' },
  'settings.grantPermissionPrompt': {
    en: 'Click to grant permission to access your data file.',
    beanie: 'click to grant permission to access your data file.',
  },
  'settings.grantPermission': { en: 'Grant Permission', beanie: 'grant permission' },
  'settings.myFamilyData': { en: "My Family's Data", beanie: "my family's data" },
  'settings.saving': { en: 'Saving...', beanie: 'saving beans...' },
  'settings.error': { en: 'Error', beanie: 'error' },
  'settings.saved': { en: 'Saved', beanie: 'saved' },
  'settings.lastSaved': { en: 'Last Saved', beanie: 'last saved' },
  'settings.lastSyncNever': { en: 'Never', beanie: 'never' },
  'settings.loadAnotherDataFile': {
    en: 'Load another Family Data File',
    beanie: 'load another family data file',
  },
  'settings.switchDataFile': {
    en: 'Switch to a different data file',
    beanie: 'switch to a different data file',
  },
  'settings.browse': { en: 'Browse...', beanie: 'browse...' },
  'settings.switchFileConfirmation': {
    en: 'This will replace all local data with the contents of the selected file and switch to that file. Continue?',
    beanie:
      'this will replace all local data with the contents of the selected file and switch to that file. continue?',
  },
  'settings.dataLoadedSuccess': {
    en: 'Data loaded successfully!',
    beanie: 'data loaded successfully!',
  },
  'settings.familyKeyStatus': { en: 'Family Key', beanie: 'family key' },
  'settings.familyKeyActive': {
    en: 'End-to-End Encrypted',
    beanie: 'end-to-end encrypted',
  },
  'settings.familyKeyDescription': {
    en: 'Your data is protected with AES-256 encryption',
    beanie: 'your beans are locked with aes-256 encryption',
  },
  'settings.exportAsJson': { en: 'Export Readable Data', beanie: 'export readable data' },
  'settings.exportAsJsonDesc': {
    en: 'Download all your data as a plain-text JSON file (not encrypted)',
    beanie: 'download all your beans as a plain-text json file (not encrypted)',
  },
  'settings.noAutoSyncWarning': {
    en: "Your browser doesn't support automatic file saving. Use manual export/import instead. For automatic saving, use Chrome or Edge.",
    beanie:
      "your browser doesn't support automatic file saving. use manual export/import instead. for automatic saving, use chrome or edge.",
  },
  'settings.downloadYourData': { en: 'Download Your Data', beanie: 'download your data' },
  'settings.downloadDataDescription': {
    en: 'Download your data as a JSON file',
    beanie: 'download your data as a json file',
  },
  'settings.loadDataFile': { en: 'Load Data File', beanie: 'load data file' },
  'settings.loadDataFileDescription': {
    en: 'Load data from a JSON file',
    beanie: 'load data from a json file',
  },
  'settings.security': { en: 'Security', beanie: 'security' },
  // Password modal
  'password.enterPassword': { en: 'Enter Password', beanie: 'enter password' },
  'password.enterPasswordDescription': {
    en: 'This file is encrypted. Enter your password to decrypt and load the data.',
    beanie: 'this file is encrypted. enter your password to decrypt and load the data.',
  },
  'password.decryptAndLoad': { en: 'Decrypt & Load', beanie: 'decrypt & load' },
  'password.encryptionError': { en: 'Encryption Error', beanie: 'encryption error' },
  'password.password': { en: 'Password', beanie: 'password' },
  'password.enterPasswordPlaceholder': { en: 'Enter password', beanie: 'enter password' },
  'password.confirmPassword': { en: 'Confirm Password', beanie: 'confirm password' },
  'password.confirmPasswordPlaceholder': { en: 'Confirm password', beanie: 'confirm password' },
  'password.required': { en: 'Password is required', beanie: 'password is required' },
  'password.mismatch': { en: 'Passwords do not match', beanie: 'passwords do not match' },
  'password.incorrect': {
    en: 'Incorrect password. Please try again.',
    beanie: 'wrong password. try again.',
  },
  'password.decryptionError': { en: 'Decryption Error', beanie: 'decryption error' },
  'password.setAndContinue': { en: 'Set Password & Continue', beanie: 'set password & continue' },
  'password.strongPasswordDescription': {
    en: "Choose a strong password to protect your data file. You'll need this password each time you open the app.",
    beanie:
      "choose a strong password to protect your data file. you'll need this password each time you open the app.",
  },
  'password.encryptedFileDescription': {
    en: 'This file is encrypted. Enter your password to decrypt and load your data.',
    beanie: 'this file is encrypted. enter your password to decrypt and load your data.',
  },

  // Setup (kept: keys used by CreatePodView.vue)
  'setup.yourName': { en: 'Your Name', beanie: 'your name' },
  'setup.fileCreateFailed': {
    en: 'Failed to create file. Please try again.',
    beanie: 'failed to create file. please try again.',
  },

  // Auth
  'auth.signingIn': { en: 'Signing in...', beanie: 'signing in...' },
  'auth.creatingAccount': { en: 'Creating account...', beanie: 'creating account...' },
  'auth.signOut': { en: 'Sign Out', beanie: 'sign out' },
  'auth.signOutConfirmTitle': { en: 'Sign Out', beanie: 'sign out' },
  'auth.signOutConfirmMessage': {
    en: 'Are you sure you want to sign out?',
    beanie: 'are you sure you want to leave the pod?',
  },
  'auth.signOutConfirmHint': {
    en: 'Your data is saved and will be here when you come back.',
    beanie: 'your beans are safe and will be here when you come back.',
  },
  'auth.signOutClearDataHint': {
    en: 'Signs out and removes all local data from this device. Use this on shared or public devices.',
    beanie:
      "use this on shared or public devices - signs out and removes all local data from this device. don't worry - your data is safe with you and we'll find it again when you come back.",
  },
  'auth.fillAllFields': { en: 'Please fill in all fields', beanie: 'please fill in all fields' },
  'auth.passwordsDoNotMatch': { en: 'Passwords do not match', beanie: 'passwords do not match' },
  'auth.passwordMinLength': {
    en: 'Password must be at least 8 characters',
    beanie: 'password must be at least 8 characters',
  },
  'auth.createPasswordPrompt': {
    en: 'Create a password for your account. You will use this to sign in next time.',
    beanie: 'create a password for your account. you will use this to sign in next time.',
  },
  'auth.createPasswordPlaceholder': {
    en: 'Choose a password (min 8 characters)',
    beanie: 'choose a password (min 8 characters)',
  },
  'auth.createAndSignIn': { en: 'Create Password & Sign In', beanie: 'create password & sign in' },
  'auth.familyName': { en: 'Family Name', beanie: 'family name' },
  'auth.familyNamePlaceholder': { en: 'The Smith Family', beanie: 'the smith family' },
  'auth.yourNamePlaceholder': { en: 'John Smith', beanie: 'john smith' },
  'auth.passwordPlaceholder': { en: 'At least 8 characters', beanie: 'at least 8 characters' },

  // Common actions (additional)
  'action.ok': { en: 'OK', beanie: 'ok' },
  'action.continue': { en: 'Continue', beanie: 'continue' },
  'action.apply': { en: 'Apply', beanie: 'apply' },
  'action.download': { en: 'Download', beanie: 'download' },
  'action.load': { en: 'Load', beanie: 'load' },
  'action.seeAll': { en: 'See All', beanie: 'see all' },
  'action.tryAgain': { en: 'Try again', beanie: 'try again' },

  // Confirmation dialog titles
  'confirm.deleteAccountTitle': { en: 'Delete Account', beanie: 'remove account' },
  'confirm.deleteTransactionTitle': { en: 'Delete Transaction', beanie: 'remove transaction' },
  'confirm.deleteRecurringTitle': { en: 'Delete Recurring Item', beanie: 'remove recurring item' },
  'confirm.deleteAssetTitle': { en: 'Delete Asset', beanie: 'remove your asset' },
  'confirm.deleteGoalTitle': { en: 'Delete Goal', beanie: 'remove your goal' },
  'confirm.deleteMemberTitle': { en: 'Remove Family Member', beanie: 'remove beanie' },
  'confirm.removePasskeyTitle': { en: 'Remove Passkey', beanie: 'remove passkey' },
  'confirm.cannotDeleteOwnerTitle': { en: 'Cannot Delete Owner', beanie: 'cannot delete owner' },

  // Confirmation dialog messages
  'accounts.deleteConfirm': {
    en: 'Are you sure you want to delete this account?',
    beanie: 'remove this bean jar for good?',
  },
  'assets.deleteConfirm': {
    en: 'Are you sure you want to delete this asset?',
    beanie: 'remove this valuable bean?',
  },
  'goals.deleteConfirm': {
    en: 'Are you sure you want to delete this goal?',
    beanie: 'remove this bean dream for good?',
  },
  'goals.deleteCompletedConfirm': {
    en: 'Are you sure you want to delete this completed goal?',
    beanie: 'remove this finished bean dream?',
  },
  'passkey.removeConfirm': {
    en: 'Remove this passkey? You will no longer be able to sign in with it.',
    beanie: 'remove this passkey? you will no longer be able to sign in with it.',
  },

  // Passkey / biometric login
  'passkey.signInButton': { en: 'Biometric Sign In', beanie: 'beanie face sign in!' },
  'passkey.usePassword': { en: 'Use password instead', beanie: 'use password instead' },
  'passkey.authenticating': { en: 'Verifying...', beanie: 'verifying...' },
  'passkey.welcomeBack': { en: 'Welcome back', beanie: 'welcome back' },
  'passkey.promptTitle': {
    en: 'Unlock with your face or fingerprint?',
    beanie: 'unlock with your face or fingerprint?',
  },
  'passkey.promptDescription': {
    en: 'Next time you sign in, one tap is all it takes. No more typing passwords.',
    beanie: 'next time you sign in, one tap is all it takes. no more typing passwords.',
  },
  'passkey.promptEnable': { en: 'Enable biometric login', beanie: 'enable biometric login' },
  'passkey.promptDecline': { en: 'Not now', beanie: 'not now' },
  'passkey.promptHint': {
    en: 'You can manage this in Settings at any time.',
    beanie: 'you can manage this in settings at any time.',
  },
  'passkey.registerButton': { en: 'Register new biometric', beanie: 'register new biometric' },
  'passkey.registerSuccess': { en: 'Biometric login enabled!', beanie: 'biometric login enabled!' },
  'passkey.registerError': {
    en: 'Failed to register biometric. Please try again.',
    beanie: 'failed to register biometric. please try again.',
  },
  'passkey.signInError': {
    en: 'Biometric sign-in failed. Please try with your password.',
    beanie: 'biometric sign-in failed. please try with your password.',
  },
  'passkey.crossDeviceNoCache': {
    en: 'This biometric was synced from another device. Sign in with your password once to enable it here.',
    beanie:
      'this biometric was synced from another device. sign in with your password once to enable it here.',
  },
  'passkey.wrongFamilyError': {
    en: 'This biometric does not belong to the current family. Please try again.',
    beanie: 'this biometric does not belong to the current family. please try again.',
  },
  'passkey.dekStale': {
    en: 'Your encryption key has changed since biometric was set up. Please sign in with your password and re-register biometric in Settings.',
    beanie:
      'your encryption key has changed since biometric was set up. please sign in with your password and re-register biometric in settings.',
  },
  'passkey.fileLoadError': {
    en: 'Could not load your data file. Please sign in with your password.',
    beanie: 'could not load your data file. please sign in with your password.',
  },
  'passkey.prfFull': { en: 'Full unlock', beanie: 'full unlock' },
  'passkey.prfCached': { en: 'Cached password', beanie: 'cached password' },
  'passkey.lastUsed': { en: 'Last used', beanie: 'last used' },
  'passkey.neverUsed': { en: 'Never used', beanie: 'never used' },
  'passkey.noAuthenticator': {
    en: 'No biometric authenticator detected on this device.',
    beanie: 'no biometric authenticator detected on this device.',
  },
  'passkey.registeredPasskeys': { en: 'Registered biometrics', beanie: 'registered biometrics' },
  'passkey.settingsTitle': { en: 'Biometric Login', beanie: 'biometric login' },
  'passkey.settingsDescription': {
    en: 'Sign in with your fingerprint, face, or device PIN instead of a password.',
    beanie: 'sign in with your fingerprint, face, or device pin instead of a password.',
  },
  'passkey.noPasskeys': {
    en: 'No biometric logins registered yet.',
    beanie: 'no biometric logins registered yet.',
  },
  'passkey.unsupported': {
    en: 'Your browser does not support biometric login (WebAuthn).',
    beanie: 'your browser does not support biometric login (webauthn).',
  },
  'passkey.rename': { en: 'Rename', beanie: 'rename' },
  'passkey.renameLabel': { en: 'Device name', beanie: 'device name' },

  // Trusted device
  'trust.title': { en: 'Do you trust this device?', beanie: 'do you trust this device?' },
  'trust.description': {
    en: 'If this is a trusted device (i.e. your personal phone or laptop), you can keep your data cached locally for instant access next time you sign in.',
    beanie:
      'if this is a trusted device (i.e. your personal phone or laptop), you can keep your data cached locally for instant access next time you sign in.',
  },
  'trust.trustButton': { en: 'Yes, I trust this device', beanie: 'yes, i trust this device' },
  'trust.notNow': { en: 'Not now', beanie: 'not now' },
  'trust.hint': {
    en: 'You can change this in Settings. Use "Sign Out / Clear Data" to remove cached data.',
    beanie: 'you can change this in settings. use "sign out / clear data" to remove cached data.',
  },
  'trust.settingsLabel': { en: 'Trusted device', beanie: 'trusted device' },
  'trust.settingsDesc': {
    en: 'Keep data cached locally (unecrypted) between sign-ins for faster access',
    beanie: 'keep data cached locally (unecrypted) between sign-ins for faster access',
  },
  'auth.signOutClearData': { en: 'Sign Out & Clear Data', beanie: 'sign out & clear data' },

  // File-based auth
  'auth.selectMember': { en: 'Select your profile', beanie: 'select your profile' },
  'auth.enterPassword': { en: 'Please enter your password', beanie: 'please enter your password' },
  'auth.loadingFile': { en: 'counting beans...', beanie: 'counting beans...' },
  'auth.reconnectFile': {
    en: 'Your data file was found but needs permission to access. Click below to reconnect.',
    beanie: 'your data file was found but needs permission to access. click below to reconnect.',
  },
  'auth.reconnectButton': { en: 'Reconnect to data file', beanie: 'reconnect to data file' },
  'auth.noMembersWithPassword': {
    en: 'No members have set a password yet. Please complete onboarding first.',
    beanie: 'no members have set a password yet. please complete onboarding first.',
  },
  'auth.fileLoadFailed': {
    en: 'Failed to load file. Please try again.',
    beanie: 'failed to load file. please try again.',
  },
  'auth.password': { en: 'Password', beanie: 'password' },
  'auth.enterYourPassword': { en: 'Enter your password', beanie: 'enter your password' },
  'auth.signInFailed': { en: 'Sign in failed', beanie: 'sign in failed' },
  'auth.signUpFailed': { en: 'Sign up failed', beanie: 'sign up failed' },
  'auth.createPassword': { en: 'Create a password', beanie: 'create a password' },
  'auth.confirmPassword': { en: 'Confirm password', beanie: 'confirm password' },
  'auth.confirmPasswordPlaceholder': {
    en: 'Re-enter your password',
    beanie: 're-enter your password',
  },

  // Login — Page titles
  'login.welcome': { en: 'Welcome', beanie: 'welcome' },
  'login.title': { en: 'Login', beanie: 'login' },
  'join.title': { en: 'Join Family', beanie: 'join the pod' },

  // Login — Invite / Join
  'login.inviteTitle': { en: 'Invite family member', beanie: 'invite your beanies' },
  'login.inviteDesc': {
    en: 'Share this magic link with your family member so they can join your pod',
    beanie: 'share this magic link with your family member so they can join your pod',
  },
  'login.copied': { en: 'Copied!', beanie: 'copied!' },
  'login.copyLink': { en: 'Copy link', beanie: 'copy link' },

  // Login v6 redesign
  'loginV6.badgeEncrypted': { en: 'End-to-End Encrypted', beanie: 'end-to-end encrypted' },
  'loginV6.badgeSecurity': { en: 'Bank-Grade Security', beanie: 'bank-grade security' },
  'loginV6.badgeLove': { en: 'Built with Love', beanie: 'built with love' },
  'loginV6.badgeZeroServers': {
    en: 'Zero Data on Our Servers',
    beanie: 'zero data on our servers',
  },
  'loginV6.welcomePrompt': {
    en: 'What would you like to do?',
    beanie: 'what would you like to do?',
  },
  'loginV6.signInTitle': { en: 'Sign in', beanie: 'sign in to your bean pod' },
  'loginV6.signInSubtitle': {
    en: 'Load your family data file',
    beanie: 'load your family data file',
  },
  'loginV6.createTitle': { en: 'Create a new pod!', beanie: 'start a new bean pod!' },
  'loginV6.createSubtitle': {
    en: "Start your family's financial journey",
    beanie: 'plant your first bean!',
  },
  'loginV6.joinTitle': { en: 'Join an existing pod', beanie: 'join an existing pod' },
  'loginV6.joinSubtitle': {
    en: 'Your family is waiting for you',
    beanie: 'your family pod is waiting for you!',
  },
  'loginV6.loadPodTitle': { en: 'Load your pod', beanie: 'load your pod' },
  'loginV6.loadPodSubtitle': {
    en: 'Your data stays on your device — always',
    beanie: 'your data stays on your device — always',
  },
  'loginV6.dropZoneText': {
    en: 'Drop your .beanpod file here',
    beanie: 'drop your .beanpod file here',
  },
  'loginV6.dropZoneBrowse': { en: 'or click to browse', beanie: 'or click to browse' },
  'loginV6.cloudComingSoon': { en: 'Coming soon', beanie: 'coming soon' },
  'loginV6.securityYourData': { en: 'Your Data, Your Cloud', beanie: 'your data, your cloud' },
  'loginV6.securityEncrypted': { en: 'AES-256 Encrypted', beanie: 'aes-256 encrypted' },
  'loginV6.securityZeroServers': {
    en: 'Zero Servers, Zero Tracking',
    beanie: 'zero servers, zero tracking',
  },
  'loginV6.fileLoaded': { en: 'loaded', beanie: 'loaded' },
  'loginV6.unlockTitle': { en: 'Sign In', beanie: 'sign in' },
  'loginV6.unlockTitleWithFamily': {
    en: 'Sign In to {familyName}',
    beanie: 'sign in to {familyName}',
  },
  'loginV6.unlockSubtitle': {
    en: "Enter your password and we'll find your account",
    beanie: "enter your password and we'll find your account",
  },
  'loginV6.unlockButton': { en: 'Sign In', beanie: 'sign in' },
  'loginV6.unlockMemberCount': {
    en: '{count} members in this family',
    beanie: '{count} beans in this pod',
  },
  'loginV6.unlockFooter': {
    en: "This password decrypts your local data. We don't store or recover it.",
    beanie: "this password decrypts your local data. we don't store or recover it.",
  },
  // Family picker view
  'familyPicker.title': { en: 'Which family?', beanie: 'which beanies?' },
  'familyPicker.subtitle': { en: 'Choose a family to sign into', beanie: 'pick your pod of beans' },
  'familyPicker.loadDifferent': { en: 'Load a different file', beanie: 'load a different file' },
  'familyPicker.noFamilies': {
    en: 'No families found on this device',
    beanie: 'no families found on this device',
  },
  'familyPicker.loadFile': { en: 'Load a family data file', beanie: 'load a family data file' },
  'familyPicker.providerLocal': { en: 'Local file', beanie: 'local file' },
  'familyPicker.providerDrive': { en: 'Google Drive', beanie: 'google drive' },
  'familyPicker.loadError': {
    en: "Couldn't load your file — please locate it again",
    beanie: "couldn't load your file — please locate it again",
  },

  // Fast login (single-family auto-select)
  'fastLogin.notYou': { en: 'Not you? Switch account', beanie: 'not you? switch account' },
  'fastLogin.welcomeBack': { en: 'Welcome back', beanie: 'welcome back' },
  'fastLogin.welcomeBackName': { en: 'Welcome back, {name}!', beanie: 'welcome back, {name}!' },
  'fastLogin.loadErrorLocal': {
    en: "We looked everywhere but can't find your file — please select it again",
    beanie: "we looked everywhere but can't find your file — please select it again",
  },
  'fastLogin.loadErrorDrive': {
    en: 'Your Google Drive credentials may have expired — please sign in again',
    beanie: 'your google drive credentials may have expired — please sign in again',
  },
  'loginV6.pickBeanTitle': { en: "Who's signing in?", beanie: 'which beanie are you?' },
  'loginV6.pickBeanSubtitle': { en: 'Pick your bean', beanie: 'pick your bean' },
  'loginV6.parentBean': { en: 'Parent / Adult', beanie: 'big beanie' },
  'loginV6.littleBean': { en: 'Child', beanie: 'little beanie' },
  'loginV6.setupNeeded': { en: 'Set up', beanie: 'set up' },
  'loginV6.signInAs': { en: 'Sign in as', beanie: 'sign in as' },
  'loginV6.createStep1': { en: 'You', beanie: 'you' },
  'loginV6.createStep2': { en: 'Save & Secure', beanie: 'save & secure' },
  'loginV6.createStep3': { en: 'Family', beanie: 'family' },
  'loginV6.createNext': { en: 'Next', beanie: 'next' },
  'loginV6.createButton': { en: 'Create Pod', beanie: 'create pod' },
  'loginV6.alreadyHavePod': { en: 'Already have a pod?', beanie: 'already have a pod?' },
  'loginV6.loadItLink': { en: 'Load it', beanie: 'load it' },
  'loginV6.storageTitle': {
    en: 'Where should we save your pod?',
    beanie: 'where should we save your pod?',
  },
  'loginV6.storageLocal': { en: 'Local file', beanie: 'local file' },
  'loginV6.storageLocalDesc': {
    en: 'Save a .beanpod file to your device',
    beanie: 'save a .beanpod file to your device',
  },
  'loginV6.addBeansTitle': { en: 'Add your family members', beanie: 'add your beanies' },
  'loginV6.addBeansSubtitle': {
    en: 'You can always add more later',
    beanie: 'more beans can join later!',
  },
  'loginV6.addMember': { en: 'Add Member', beanie: 'add beanie' },
  'loginV6.addAnotherBeanie': { en: 'Add another family member?', beanie: 'add another beanie?' },
  'loginV6.finish': { en: 'Finish', beanie: 'finish' },
  'loginV6.skip': { en: 'Skip for now', beanie: 'skip for now' },
  'loginV6.joinButton': { en: "Join My Family's Pod", beanie: 'join your pod!' },
  'loginV6.wantYourOwn': { en: 'Want your own?', beanie: 'want your own?' },
  'loginV6.createLink': { en: 'Create a new pod', beanie: 'create a new pod' },
  'loginV6.acceptsBeanpod': { en: 'Accepts .beanpod files', beanie: 'accepts .beanpod files' },
  'loginV6.recommended': { en: 'Recommended', beanie: 'recommended' },
  'loginV6.googleDriveCardDesc': {
    en: 'Load from your cloud storage',
    beanie: 'load from your cloud storage',
  },
  'loginV6.dropboxCardDesc': { en: 'Sync with Dropbox', beanie: 'sync with dropbox' },
  'loginV6.iCloudCardDesc': { en: 'Sync with iCloud', beanie: 'sync with icloud' },
  'loginV6.localFileCardDesc': {
    en: 'Open a .beanpod from your device',
    beanie: 'open a .beanpod from your device',
  },
  'loginV6.securityYourDataDesc': {
    en: 'Your pod file lives in your cloud storage. We never see it.',
    beanie: 'your pod file lives in your cloud storage. we never see it.',
  },
  'loginV6.securityEncryptedDesc': {
    en: 'Military-grade AES-256 encryption protects your data.',
    beanie: 'military-grade aes-256 encryption protects your data.',
  },
  'loginV6.securityZeroServersDesc': {
    en: 'No servers, no tracking, no data collection.',
    beanie: 'no servers, no tracking, no data collection.',
  },
  'loginV6.pickBeanInfoText': {
    en: 'Onboarded beans can sign in with their password. New beans need to create a password first.',
    beanie:
      'onboarded beans can sign in with their password. new beans need to create a password first.',
  },
  'loginV6.growPodTitle': { en: 'Grow a brand-new pod', beanie: 'grow a brand-new pod' },
  'loginV6.growPodSubtitle': {
    en: 'Name your family pod and create your sign-in password.',
    beanie: 'name your family pod and create your sign-in password.',
  },
  'loginV6.signInPasswordLabel': { en: 'Your sign-in password', beanie: 'your sign-in password' },
  'loginV6.signInPasswordHint': {
    en: "You'll use this password to sign into your bean profile",
    beanie: "you'll use this password to sign into your bean profile",
  },
  'loginV6.storageDescription': {
    en: "We don't store your data on any server or database \u2014 your family's finances stay entirely in your hands. Choose where your encrypted .beanpod file lives, and only you hold the key.",
    beanie:
      "we don't store your data on any server or database \u2014 your family's finances stay entirely in your hands. choose where your encrypted .beanpod file lives, and only you hold the key.",
  },
  'loginV6.storageSectionLabel': {
    en: 'Where should we save your pod?',
    beanie: 'where should we save your pod?',
  },
  'loginV6.step2Title': { en: 'Save & secure your pod', beanie: 'save & secure your pod' },
  'loginV6.step2Subtitle': {
    en: 'Choose where to store your encrypted data file.',
    beanie: 'choose where to store your encrypted data file.',
  },
  'loginV6.addMemberFailed': {
    en: 'Failed to add member. Please try again.',
    beanie: 'failed to add member. please try again.',
  },
  'loginV6.removeMember': { en: 'Remove', beanie: 'remove' },
  'loginV6.you': { en: 'You', beanie: 'you' },

  // Join flow (magic link invites)
  'join.verifyTitle': { en: 'Join your family', beanie: 'join your family pod!' },
  'join.verifySubtitle': {
    en: 'You need a magic joining link from a family member',
    beanie: 'you need a magic joining link from a family member',
  },
  'join.lookingUp': { en: 'Looking up your family...', beanie: 'finding your pod...' },
  'join.familyFound': { en: 'Family found!', beanie: 'found your pod!' },
  'join.familyNotFound': {
    en: 'Family not found. Check the code and try again.',
    beanie: 'your family pod could not be found. check the code and try again.',
  },
  'join.registryOffline': {
    en: "We couldn't reach the registry. You can still join by loading the shared file directly.",
    beanie:
      "we couldn't reach the registry. you can still join by loading the shared file directly.",
  },
  'join.needsFile': {
    en: 'You need the family data file',
    beanie: 'you need the family pod data file',
  },
  'join.needsFileDesc': {
    en: 'Ask the owner to share the .beanpod file with you via email, a shared cloud folder, or USB.',
    beanie:
      'ask the owner to share the .beanpod file with you via email, a shared cloud folder, or usb.',
  },
  'join.expectedFile': { en: 'Look for a file named:', beanie: 'look for a file named:' },
  'join.fileMismatch': {
    en: 'This file belongs to a different family. Please load the correct file.',
    beanie: 'this file belongs to a different pod. please load the correct file.',
  },
  'join.loadFileButton': { en: 'Load .beanpod file', beanie: 'load .beanpod file' },
  'join.dropZoneText': {
    en: 'Drop the shared .beanpod file here',
    beanie: 'drop the shared .beanpod file here',
  },
  'join.pickMemberTitle': { en: 'Which one is you?', beanie: 'pick your bean!' },
  'join.pickMemberSubtitle': {
    en: 'Select the profile created for you',
    beanie: 'select the profile created for you',
  },
  'join.noUnclaimedMembers': {
    en: 'No unclaimed profiles found. Ask the family owner to create your profile first.',
    beanie: 'no unclaimed beanies found. ask your pod owner to create your profile first.',
  },
  'join.inviteTokenInvalid': {
    en: 'This invite link is invalid. Ask the family owner for a new one.',
    beanie: 'this invite link is no good. ask your pod owner for a new one.',
  },
  'join.inviteTokenExpired': {
    en: 'This invite link has expired. Ask the family owner for a new one.',
    beanie: 'this invite link has expired. ask your pod owner for a new one.',
  },
  'join.generatingLink': {
    en: 'Generating secure invite link...',
    beanie: 'generating secure invite link...',
  },
  'join.setPasswordTitle': { en: 'Create your password', beanie: 'create your password' },
  'join.setPasswordSubtitle': {
    en: 'This password is just for you to sign in',
    beanie: 'this password is just for you to sign in',
  },
  'join.completing': { en: 'Joining your family...', beanie: 'joining your beanies...' },
  'join.success': { en: 'Welcome to the family!', beanie: 'welcome to your pod!' },
  'join.shareFileNote': {
    en: 'Important: also share the .beanpod file with them (email, cloud folder, or USB)',
    beanie: 'important: also share the .beanpod file with them (email, cloud folder, or usb)',
  },
  'join.shareFileNoteCloud': {
    en: 'Your family member will be prompted to sign in with Google to access the shared file automatically.',
    beanie:
      'Your family member will be prompted to sign in with your cloud provider to access the shared file. Please ensure they have access to the file with their account',
  },
  'join.cloudLoadFailed': {
    en: "Couldn't load the file from cloud storage. You can load it manually below.",
    beanie: "couldn't load the file from cloud storage. you can load it manually below.",
  },
  'join.loadingFromCloud': {
    en: 'Loading family data from Google Drive...',
    beanie: 'fetching your beans from the cloud...',
  },
  'join.howToJoinTitle': { en: 'How to join', beanie: 'how to join' },
  'join.howToJoinStep1': {
    en: 'Ask a parent or family admin to open the Family page',
    beanie: 'ask a big bean to open the family page',
  },
  'join.howToJoinStep2': {
    en: "They'll tap Invite to generate a magic link",
    beanie: "they'll tap invite to make a magic link",
  },
  'join.howToJoinStep3': {
    en: "Open the link on your device — that's it!",
    beanie: "open the link on your device — that's it!",
  },
  'join.linkExpiryNote': {
    en: 'Invite links expire after 24 hours for security',
    beanie: 'invite links expire after 24 hours for security',
  },

  // Google Picker join flow
  'join.pickerPrompt.description': {
    en: 'Select the shared .beanpod file from your Google Drive',
    beanie: "pick your family's bean pod from google drive",
  },
  'join.pickerPrompt.button': {
    en: 'Select File from Drive',
    beanie: 'pick from drive',
  },
  'join.pickerPrompt.orManual': {
    en: 'Or load a file from your device',
    beanie: 'or load from your device',
  },
  'join.pickerPrompt.error': {
    en: "Couldn't open file picker. Try loading the file manually.",
    beanie: "couldn't open the picker. try loading the file yourself",
  },

  // Invite modal — stepped flow
  'invite.step1.title': {
    en: 'Prepare the Family Data File',
    beanie: 'prepare the pod',
  },
  'invite.step1.desc': {
    en: "Your family member needs access to the family data file before they can join. If they don't already have access, share it with them now.",
    beanie:
      "your beanie needs access to the family pod before they can join. share it now if they don't have it yet.",
  },
  'invite.step1.encrypted': {
    en: "Don't worry — the file is encrypted. Only family members with the invite link can unlock it.",
    beanie: "don't worry — the pod is encrypted. only beanies with the magic link can open it.",
  },
  'invite.step1.childTip': {
    en: "Inviting a child? You can sign into your cloud provider with your own account on their device so they can access the file. They'll still only have permissions you authorize — no need to worry.",
    beanie:
      "inviting a little bean? share with their cloud storage account, or you can sign into your account on their device so they can reach the pod. they'll only see what you allow!",
  },
  'invite.step2.title': {
    en: 'Send the Magic Link',
    beanie: 'send the magic link',
  },
  'invite.whatNext.title': {
    en: 'What Happens Next?',
    beanie: 'what happens next?',
  },
  'invite.whatNext.desc': {
    en: 'They open the link, choose a password, and join the pod. Once in, they can sign in anytime with their own account.',
    beanie: 'they open the link, pick a password, and hop into the pod. easy peasy!',
  },
  // Invite modal — email sharing
  'invite.shareEmail.placeholder': {
    en: 'family.member@gmail.com',
    beanie: 'bean@example.com',
  },
  'invite.shareEmail.button': {
    en: 'Share',
    beanie: 'share',
  },
  'invite.shareEmail.success': {
    en: "File shared! They'll get an email from Google.",
    beanie: 'pod shared! google will email them',
  },
  'invite.shareEmail.error': {
    en: "Couldn't share the file. You can share it manually from Google Drive.",
    beanie: "couldn't share the pod. try sharing from google drive",
  },

  // Share invite modal
  'share.title': { en: 'Share Invite Link', beanie: 'share the magic link' },
  'share.subtitle': {
    en: 'Choose how to send the invite',
    beanie: 'pick a way to send the magic link',
  },
  'share.copyLink': { en: 'Copy Link', beanie: 'copy link' },
  'share.orShareVia': { en: 'or share via', beanie: 'or share via' },
  'share.messageBody': {
    en: "Hi! {member} has invited you to join the {family} family!\nClick here to join your family's bean pod: {link}",
    beanie:
      "hi! {member} has invited you to join the {family} pod!\nclick here to join your family's bean pod: {link}",
  },
  'share.emailSubject': {
    en: "You're invited to join {family} on beanies.family!",
    beanie: "you're invited to join {family} on beanies.family!",
  },
  'share.wechatHint': {
    en: 'Link copied! Open WeChat and paste it in a chat to share with your contact.',
    beanie: 'link copied! open wechat and paste it in a chat to share with your beanie.',
  },

  // PWA / Offline / Install
  'pwa.offlineBanner': {
    en: "You're offline — changes are saved locally",
    beanie: "you're offline — beans are safe in the pod",
  },
  'pwa.backOnline': {
    en: 'Back online',
    beanie: 'back online',
  },
  'pwa.installTitle': { en: 'Install beanies.family', beanie: 'install beanies.family' },
  'pwa.installDescription': {
    en: 'Add to your home screen for the best experience',
    beanie: 'plant the app on your home screen',
  },
  'pwa.installButton': { en: 'Install', beanie: 'plant it!' },
  'pwa.installDismiss': { en: 'Not now', beanie: 'not now' },
  'pwa.updateAvailable': {
    en: 'A new version is available',
    beanie: 'a new version is available!',
  },
  'pwa.updateButton': { en: 'Update now', beanie: 'gimme fresh beans!' },
  'pwa.updateDismiss': { en: 'Later', beanie: 'later' },
  'settings.installApp': { en: 'Install App', beanie: 'install app' },
  'settings.installAppDesc': {
    en: 'Install beanies.family on this device for quick access',
    beanie: 'install beanies.family app!',
  },
  'settings.installAppButton': { en: 'Install beanies.family', beanie: 'install beanies.family' },
  'settings.appInstalled': { en: 'App is installed', beanie: 'your beanies are installed!' },

  'settings.deleteFamily': { en: 'Delete Family & All Data', beanie: 'delete family & all data' },
  'settings.deleteFamilyDesc': {
    en: 'Permanently remove this family and all data from all systems. This cannot be undone.',
    beanie: 'permanently remove this family and all beans from everywhere. this cannot be undone.',
  },
  'settings.deleteFamilyWarning': {
    en: 'This will permanently delete all family data including members, accounts, transactions, activities, and settings. Data will be removed from this device, cloud storage, and all connected systems. This action cannot be undone.',
    beanie:
      'this will permanently delete all family beans including members, accounts, transactions, activities, and settings. beans will be removed from this device, cloud storage, and all connected systems. this cannot be undone.',
  },
  'settings.deleteFamilyExport': {
    en: 'Download all data as a readable file before deleting',
    beanie: 'download all beans as a readable file before deleting',
  },
  'settings.deleteFamilyDriveDelete': {
    en: 'Also delete the encrypted .beanpod file from Google Drive',
    beanie: 'also delete the encrypted .beanpod file from google drive',
  },
  'settings.deleteFamilyTypeConfirm': {
    en: 'Type "delete" to confirm',
    beanie: 'type "delete" to confirm',
  },
  'settings.deleteFamilyAuthDesc': {
    en: 'Enter your password to confirm deletion',
    beanie: 'enter your password to confirm deletion',
  },
  'settings.deleteFamilyFarewellTitle': { en: 'Goodbye', beanie: 'goodbye' },
  'settings.deleteFamilyFarewellMsg': {
    en: "Your family data has been deleted from all systems. We're sorry to see you go — every bean counts.",
    beanie:
      "your family beans have been deleted from everywhere. we're sorry to see you go — every bean counts.",
  },

  // Family To-Do
  'todo.title': { en: 'To-Do List', beanie: 'our to-do list' },
  'todo.subtitle': {
    en: 'Keep track of tasks for the whole family',
    beanie: 'what are your beanies busy with today?',
  },
  'todo.newTask': { en: 'New Task', beanie: 'new task' },
  'todo.quickAddPlaceholder': {
    en: 'What needs to be done?',
    beanie: 'what needs doing, my bean?',
  },
  'todo.editTask': { en: 'Edit Task', beanie: 'edit task' },
  'todo.deleteTask': { en: 'Delete Task', beanie: 'delete task' },
  'todo.deleteConfirm': {
    en: 'Are you sure you want to delete this task?',
    beanie: 'remove this task for good?',
  },
  'todo.noTodos': { en: 'No tasks yet', beanie: 'no tasks yet' },
  'todo.getStarted': {
    en: 'Add your first task to get started!',
    beanie: 'add a task to get your beans moving!',
  },
  'todo.filter.all': { en: 'All', beanie: 'all' },
  'todo.filter.open': { en: 'Open', beanie: 'open' },
  'todo.filter.done': { en: 'Done', beanie: 'done' },
  'todo.filter.scheduled': { en: 'Scheduled', beanie: 'scheduled' },
  'todo.filter.noDate': { en: 'No date', beanie: 'no date' },
  'todo.sort.newest': { en: 'Newest first', beanie: 'newest first' },
  'todo.sort.oldest': { en: 'Oldest first', beanie: 'oldest first' },
  'todo.sort.dueDate': { en: 'Due date', beanie: 'due date' },
  'todo.section.open': { en: 'Open Tasks', beanie: 'open tasks' },
  'todo.section.completed': { en: 'Completed', beanie: 'completed' },
  'todo.assignTo': { en: 'Assign to', beanie: 'assign to' },
  'todo.unassigned': { en: 'Unassigned', beanie: 'unassigned' },
  'todo.allBeans': { en: 'All Beans', beanie: 'all beans' },
  'todo.selectDueDate': { en: 'Due Date', beanie: 'due date' },
  'todo.who': { en: 'Who', beanie: 'who' },
  'todo.dueDate': { en: 'Due date', beanie: 'due date' },
  'todo.dueTime': { en: 'Time', beanie: 'time' },
  'todo.description': { en: 'Description', beanie: 'description' },
  'todo.onCalendar': { en: 'On calendar', beanie: 'on calendar' },
  'todo.doneBy': { en: 'Done by', beanie: 'done by' },
  'todo.undo': { en: 'Undo', beanie: 'undo' },
  'todo.taskTitle': { en: 'Task title', beanie: 'task title' },
  'todo.viewTask': { en: 'Task Details', beanie: 'task details' },
  'todo.noDescription': { en: 'No description', beanie: 'no description' },
  'todo.links': { en: 'Links', beanie: 'links' },
  'todo.createdBy': { en: 'Created by', beanie: 'created by' },
  'todo.status': { en: 'Status', beanie: 'status' },
  'todo.status.open': { en: 'Open', beanie: 'open' },
  'todo.status.completed': { en: 'Completed', beanie: 'completed' },
  'todo.reopenTask': { en: 'Reopen Task', beanie: 'reopen task' },
  'todo.noDueDate': { en: 'No due date', beanie: 'no due date' },
  'todo.noDateSet': { en: 'No date set', beanie: 'no date set' },
  'todo.addedToday': { en: 'Added today', beanie: 'added today' },
  'todo.addedYesterday': { en: 'Added yesterday', beanie: 'added yesterday' },
  'todo.addedDaysAgo': { en: 'Added {days} days ago', beanie: 'added {days} days ago' },
  'todo.sortLabel': { en: 'Sort:', beanie: 'sort:' },
  'todo.overdue': { en: 'Overdue', beanie: 'overdue!' },
  'confirm.deleteTodoTitle': { en: 'Delete Task', beanie: 'remove task' },
  'confirm.deleteLocalFamilyTitle': {
    en: 'Delete Local Family Data',
    beanie: 'delete local family data',
  },
  'confirm.deleteLocalFamily': {
    en: 'This will permanently remove all data, passkeys, and settings for this family from this device. The original file is not affected. This cannot be undone.',
    beanie:
      'this will permanently remove all data, passkeys, and settings for this family from this device. the original file is not affected. this cannot be undone.',
  },

  // Celebrations
  'celebration.setupComplete': {
    en: 'Setup complete — ready to start counting!',
    beanie: 'setup complete — ready to start counting your beans!',
  },
  'celebration.firstAccount': {
    en: 'Your first account is set up!',
    beanie: 'nice! your first bean is planted!',
  },
  'celebration.firstTransaction': {
    en: 'Every transaction counts!',
    beanie: 'yes! every beanie counts!',
  },
  'celebration.goalReached': {
    en: 'Task complete! Well done!',
    beanie: 'task complete! the beanies are proud!',
  },
  'celebration.firstSave': {
    en: 'Your data is safe and encrypted',
    beanie: 'all your beans are safely encrypted!',
  },
  'celebration.debtFree': {
    en: 'Debt-free! Time to celebrate!',
    beanie: 'debt-free! the beanies are celebrating!',
  },

  // Family Nook
  'nook.welcomeHome': { en: 'Welcome Home, {name}', beanie: 'welcome to your nook, {name}' },
  'nook.familyAtAGlance': {
    en: 'Your family at a glance',
    beanie: 'your bean pod at a glance',
  },
  'nook.motto0': {
    en: "Everyone's having a great week!",
    beanie: 'the beanies are thriving!',
  },
  'nook.motto1': {
    en: 'Together, anything is possible!',
    beanie: 'together, beans can do anything!',
  },
  'nook.motto2': {
    en: "Your family's doing amazing things!",
    beanie: 'your bean pod is sprouting magic!',
  },
  'nook.motto3': {
    en: 'Every little step counts!',
    beanie: 'every little bean counts!',
  },
  'nook.motto4': {
    en: "Look how far you've all come!",
    beanie: 'look how tall your beanstalk grew!',
  },
  'nook.motto5': {
    en: "What a wonderful crew you've got!",
    beanie: 'what a wonderful pod you have!',
  },
  'nook.motto6': {
    en: "Today's going to be a good one!",
    beanie: "today's a perfect day for beans!",
  },
  'nook.motto7': {
    en: 'Teamwork makes the dream work!',
    beanie: 'bean teamwork makes the dream sprout!',
  },
  'nook.motto8': {
    en: 'Small wins add up to big victories!',
    beanie: 'tiny beans grow into mighty stalks!',
  },
  'nook.motto9': {
    en: "Keep it up, you're all stars!",
    beanie: 'keep sprouting, little stars!',
  },
  'nook.motto10': {
    en: 'Home is where the heart is!',
    beanie: 'home is where the beans are!',
  },
  'nook.motto11': {
    en: "You're building something beautiful!",
    beanie: "you're growing something beautiful!",
  },
  'nook.motto12': {
    en: 'Another day, another adventure!',
    beanie: 'another day, another bean quest!',
  },
  'nook.motto13': {
    en: 'The best is yet to come!',
    beanie: 'the biggest harvest is yet to come!',
  },
  'nook.motto14': {
    en: 'Making memories, one day at a time!',
    beanie: 'planting memories, one bean at a time!',
  },
  'nook.motto15': {
    en: "Your family's strength is inspiring!",
    beanie: 'your bean pod is super strong!',
  },
  'nook.motto16': {
    en: 'Cheering for you all today!',
    beanie: 'cheering for every bean today!',
  },
  'nook.motto17': {
    en: "Happiness grows when it's shared!",
    beanie: 'happiness sprouts when beans share!',
  },
  'nook.motto18': {
    en: 'Great things happen together!',
    beanie: 'great things happen in the pod!',
  },
  'nook.motto19': {
    en: "You've got this, family!",
    beanie: "you've got this, beanies!",
  },
  'nook.motto20': {
    en: 'Beans, beans, good for your heart!',
    beanie: 'beans, beans, good for your heart!',
  },
  'nook.motto21': {
    en: 'First you get the beans, then you get the money, and then you get the women',
    beanie: 'first you get the beans, then you get the money, and then you get the womeeen',
  },
  'nook.motto22': {
    en: "Don't count your beans before they sprout!",
    beanie: "don't count your beans before they sprout!",
  },
  'nook.motto23': {
    en: 'Who let the beans out?!',
    beanie: 'who let the beans out?!',
  },
  'nook.motto24': {
    en: "You're one cool bean family!",
    beanie: "you're one cool bean pod!",
  },
  'nook.motto25': {
    en: 'Has anyone seen my beans?',
    beanie: 'has anyone seen my beans?',
  },
  'nook.motto26': {
    en: 'Life is what happens between bean counts!',
    beanie: 'life is what happens between bean counts!',
  },
  'nook.motto27': {
    en: 'Bean there, done that, got the family!',
    beanie: 'bean there, done that, got the pod!',
  },
  'nook.motto28': {
    en: 'Lonestar, I see your bean is as big as mine!',
    beanie: 'lonestar, I see your bean is as big as mine!',
  },
  'nook.motto29': {
    en: 'May the Schwartz be with your beans.',
    beanie: 'may the schwartz be with your beans.',
  },
  'nook.motto30': {
    en: "I am serious. And don't call me Shirley.",
    beanie: "i am serious. and don't call me beanie.",
  },
  'nook.motto31': {
    en: "So I got beans goin' for me, which is nice.",
    beanie: "so i got beans goin' for me, which is nice.",
  },
  'nook.motto32': {
    en: 'Be the bean, Danny.',
    beanie: 'be the bean, danny.',
  },
  'nook.motto33': {
    en: 'Fat, drunk, and counting beans is a great way to go through life.',
    beanie: 'fat, drunk, and counting beans is a great way to go through life.',
  },
  'nook.motto34': {
    en: "Today we're teaching beans how to fly!",
    beanie: "today we're teaching beans how to fly!",
  },
  'nook.motto35': {
    en: "Beans? Beans?? We don't need no stinking beans!!",
    beanie: "beans? beans?? we don't need no stinking beans!!",
  },
  'nook.motto36': {
    en: 'I picked the wrong week to quit counting beans.',
    beanie: 'i picked the wrong week to quit counting beans.',
  },
  'nook.statusSummary': {
    en: '{activities} activities planned today \u00B7 {tasks} tasks coming up',
    beanie: '{activities} activities today \u00B7 {tasks} tasks coming up!',
  },
  'nook.criticalPickup': {
    en: "Don't forget to pick up {child} from {activity} at {time} today!",
    beanie: "don't forget to pick up {child} from {activity} at {time} today!",
  },
  'nook.criticalPickupNoTime': {
    en: "Don't forget to pick up {child} from {activity} today!",
    beanie: "don't forget to pick up {child} from {activity} today!",
  },
  'nook.criticalDropoff': {
    en: 'Time to drop off {child} at {activity} at {time}!',
    beanie: 'time to drop {child} at {activity} at {time}!',
  },
  'nook.criticalDropoffNoTime': {
    en: 'Time to drop off {child} at {activity}!',
    beanie: 'time to drop {child} at {activity}!',
  },
  'nook.criticalActivity': {
    en: 'You have {activity} at {time} today!',
    beanie: 'you have {activity} at {time} today!',
  },
  'nook.criticalActivityNoTime': {
    en: "You have {activity} today — don't miss it!",
    beanie: "you have {activity} today — don't miss it!",
  },
  'nook.criticalTodoAssigned': {
    en: '{creator} asked you: {task} today!',
    beanie: '{creator} asked you: {task} today!',
  },
  'nook.criticalTodoSelf': {
    en: "Don't forget: {task} today!",
    beanie: "don't forget: {task} today!",
  },
  'nook.criticalTodoAssignedNoDue': {
    en: '{creator} asked you: {task}',
    beanie: '{creator} asked you: {task}',
  },
  'nook.criticalTodoSelfNoDue': {
    en: "Don't forget: {task}",
    beanie: "don't forget: {task}",
  },
  'nook.criticalTodoAssignedOverdue': {
    en: '{creator} asked you: {task} — it was due {date}, whenever you get a chance!',
    beanie: '{creator} asked you: {task} — was due {date}, no rush!',
  },
  'nook.criticalTodoSelfOverdue': {
    en: 'A gentle reminder: {task} — it was due {date}',
    beanie: 'a gentle nudge: {task} — was due {date}',
  },
  'nook.criticalMore': {
    en: 'more for you today',
    beanie: 'more beans for you today',
  },
  'nook.yourBeans': { en: 'Your Beans', beanie: 'your bean pod' },
  'nook.addBean': { en: 'Add Bean', beanie: 'add a beanie' },
  'nook.todaySchedule': { en: "Today's Schedule", beanie: "today's beanie schedule" },
  'nook.thisWeek': { en: 'This Week', beanie: 'this week' },
  'nook.fullCalendar': { en: 'Full Calendar', beanie: 'full calendar' },
  'nook.familyTodo': { en: 'Family To-Do', beanie: 'beanie to-do' },
  'nook.openCount': { en: '{count} open', beanie: '{count} open' },
  'nook.viewAll': { en: 'View All', beanie: 'view all' },
  'nook.moretasks': { en: 'more tasks', beanie: 'more beans to count' },
  'nook.addTaskPlaceholder': {
    en: 'Add a task for the family...',
    beanie: 'add a task for the beanies...',
  },
  'nook.milestones': { en: 'Family Milestones', beanie: 'beanie milestones' },
  'nook.upcoming': { en: 'Upcoming', beanie: 'sprouting soon' },
  'nook.daysAway': { en: '{days} days away', beanie: '{days} sleeps away' },
  'nook.completedRecently': { en: 'Completed recently!', beanie: 'beans counted!' },
  'nook.piggyBank': { en: 'The Piggy Bank', beanie: 'the piggy bank' },
  'nook.familyNetWorth': { en: 'Family Net Worth', beanie: 'alllllll your beans' },
  'nook.thisMonth': { en: 'this month', beanie: 'this moon' },
  'nook.monthlyBudget': { en: 'Monthly Budget', beanie: 'monthly bean budget' },
  'nook.showFigures': { en: 'Show Figures', beanie: 'show figures' },
  'nook.openPiggyBank': { en: 'Open The Piggy Bank', beanie: 'open the piggy bank' },
  'nook.recentActivity': { en: 'Recent Family Activity', beanie: 'recent beanie activity' },
  'nook.seeAll': { en: 'See All', beanie: 'see all' },
  'nook.noEvents': { en: 'No events scheduled', beanie: 'no beans on the calendar' },
  'nook.comingSoon': { en: 'Coming soon', beanie: 'coming soon' },
  'nook.moreItems': { en: 'more this week', beanie: 'more beans this week' },
  'nook.noMilestones': { en: 'No milestones yet', beanie: 'no milestones yet' },
  'nook.noActivity': { en: 'No recent activity', beanie: 'the beanies are resting' },
  'nook.birthday': { en: "{name}'s Birthday", beanie: "{name}'s bean day" },
  'nook.birthdayWithAge': { en: "{name}'s {age} Birthday!", beanie: "{name}'s {age} bean day!" },
  'nook.taskCompleted': { en: 'completed a task', beanie: 'task completed' },
  'nook.spent': { en: 'Spent', beanie: 'spent' },
  'nook.received': { en: 'Received', beanie: 'received' },

  // Mobile navigation
  'mobile.nook': { en: 'Nook', beanie: 'nook' },
  'mobile.todo': { en: 'To-Do', beanie: 'to-do' },
  'mobile.activities': { en: 'Activities', beanie: 'activities' },
  'mobile.travel': { en: 'Travel', beanie: 'travel' },
  'mobile.piggyBank': { en: 'Piggy Bank', beanie: 'piggy bank' },
  'mobile.budget': { en: 'Budget', beanie: 'budget' },
  'mobile.pod': { en: 'Family', beanie: 'your pod' },
  'mobile.menu': { en: 'Menu', beanie: 'menu' },
  'mobile.closeMenu': { en: 'Close menu', beanie: 'close menu' },
  'mobile.navigation': { en: 'Navigation', beanie: 'navigation' },
  'mobile.controls': { en: 'Controls', beanie: 'controls' },
  'mobile.viewingAll': { en: 'Viewing: All Members', beanie: 'viewing: all members' },

  // Google Drive integration
  'googleDrive.connecting': {
    en: 'Connecting to Google Drive...',
    beanie: 'connecting to google drive...',
  },
  'googleDrive.connected': { en: 'Connected to Google Drive', beanie: 'connected to google drive' },
  'googleDrive.disconnect': { en: 'Disconnect Google Drive', beanie: 'disconnect google drive' },
  'googleDrive.selectFile': {
    en: 'Select a pod from Google Drive',
    beanie: 'select a pod from google drive',
  },
  'googleDrive.noFilesFound': {
    en: 'No pod files found on Google Drive',
    beanie: 'no pod files found on google drive',
  },
  'googleDrive.reconnect': { en: 'Reconnect', beanie: 'reconnect' },
  'googleDrive.sessionExpired': {
    en: 'Google session expired. Reconnect to keep saving.',
    beanie: 'google session expired. reconnect to keep saving.',
  },
  'googleDrive.authFailed': {
    en: 'Google sign-in failed. Please try again.',
    beanie: 'google sign-in failed. please try again.',
  },
  'googleDrive.notConfigured': {
    en: 'Google Drive is not configured.',
    beanie: 'google drive is not configured.',
  },
  'googleDrive.offlineQueued': {
    en: 'Offline. Changes will save when you reconnect.',
    beanie: 'offline. changes will save when you reconnect.',
  },
  'googleDrive.loadError': {
    en: 'Failed to load from Google Drive',
    beanie: 'failed to load from google drive',
  },
  'googleDrive.filePickerTitle': {
    en: 'Your pods on Google Drive',
    beanie: 'your pods on google drive',
  },
  'googleDrive.lastModified': { en: 'Last modified', beanie: 'last modified' },
  'googleDrive.refresh': { en: 'Refresh', beanie: 'refresh' },
  'googleDrive.storageLabel': { en: 'Google Drive', beanie: 'google drive' },
  'googleDrive.fileCreated': {
    en: 'Your pod has been created on Google Drive.',
    beanie: 'your pod has been created on google drive.',
  },
  'googleDrive.fileLocation': {
    en: 'Location: beanies.family folder',
    beanie: 'location: beanies.family folder',
  },
  'googleDrive.shareHint': {
    en: 'To share with family members, open this file in Google Drive and share it with read & write access.',
    beanie:
      'to share with family members, open this file in google drive and share it with read & write access.',
  },
  'googleDrive.openInDrive': { en: 'Open in Google Drive', beanie: 'open in google drive' },
  'googleDrive.savedTo': { en: 'Saved to Google Drive', beanie: 'saved to google drive' },
  'googleDrive.connectedAs': { en: 'Connected as {email}', beanie: 'connected as {email}' },
  'googleDrive.saveFailureTitle': {
    en: "Your data isn't being saved",
    beanie: "your data isn't being saved",
  },
  'googleDrive.saveFailureBody': {
    en: "Recent changes haven't been saved to Google Drive. Reconnect to prevent data loss.",
    beanie: "recent changes haven't been saved to google drive. reconnect to prevent data loss.",
  },
  'googleDrive.saveFailureReconnect': {
    en: 'Reconnect to Google Drive',
    beanie: 'reconnect to google drive',
  },
  'googleDrive.downloadBackup': { en: 'Download backup', beanie: 'download backup' },
  'googleDrive.saveRetrying': {
    en: 'Save failed — retrying...',
    beanie: 'save failed — retrying...',
  },
  'googleDrive.fileNotFoundTitle': {
    en: 'Your data file was not found',
    beanie: "we can't find your beanpod",
  },
  'googleDrive.fileNotFoundBody': {
    en: 'The pod file on Google Drive may have been deleted or moved. Go to Settings to reconnect or choose a different file.',
    beanie: 'your beanpod might have been moved or deleted. head to settings to sort it out',
  },
  'googleDrive.goToSettings': { en: 'Go to Settings', beanie: 'go to settings' },
  'googleDrive.reconnectFailed': {
    en: 'Could not reconnect. Try again.',
    beanie: "couldn't reconnect. try again",
  },
  'googleDrive.reconnected': {
    en: 'Reconnected — all data saved',
    beanie: 'reconnected — all beans safe',
  },
  'googleDrive.noFilesHint': {
    en: 'Make sure the file is in a folder named "beanies.family" on this account.',
    beanie: 'check the beanies.family folder on this account',
  },
  'googleDrive.retrySearch': {
    en: 'Retry',
    beanie: 'try again',
  },
  'googleDrive.switchAccount': {
    en: 'Switch account',
    beanie: 'different account',
  },
  'sync.backgroundError': {
    en: 'Could not refresh from cloud. Using cached data.',
    beanie: 'beans got lost in the cloud... using fresh-ish beans',
  },
  'storage.localFile': { en: 'Local File', beanie: 'local file' },
  'storage.dropbox': { en: 'Dropbox', beanie: 'dropbox' },
  'storage.iCloud': { en: 'iCloud', beanie: 'icloud' },
  'storage.localFileWarning': {
    en: "Local files are great for security but don't sync with other family members. If you plan to use this app with your family, we recommend a storage provider (e.g. Google Drive) for your encrypted data file.",
    beanie:
      "local files are great for security but don't sync with other family members. if you plan to use this app with your family, we recommend a storage provider (e.g. google drive) for your encrypted data file.",
  },
  'storage.localFileWarningEncryption': {
    en: "Don't worry — your data is fully encrypted and only accessible to those you share the file with.",
    beanie:
      "don't worry — your data is fully encrypted and only accessible to those you share the file with.",
  },
  'storage.localFileContinue': {
    en: 'Continue with Local File',
    beanie: 'continue with local file',
  },
  'storage.comingSoon': { en: 'Coming Soon', beanie: 'coming soon' },
  'storage.recommended': { en: 'Recommended', beanie: 'recommended' },

  // Family Planner
  'planner.title': { en: 'Family Planner', beanie: 'beanie planner' },
  'planner.subtitle': {
    en: '{month} — {count} activities',
    beanie: '{month} — {count} activities',
  },
  'planner.addActivity': { en: '+ Add Activity', beanie: '+ new activity' },
  'planner.editActivity': { en: 'Edit Activity', beanie: 'edit activity' },
  'planner.editingOccurrence': {
    en: 'Editing occurrence on {date}',
    beanie: 'editing this bean on {date}',
  },
  'planner.newActivity': { en: 'New Activity', beanie: 'new beanie activity' },
  'planner.deleteActivity': { en: 'Delete Activity', beanie: 'delete activity' },
  'planner.deleteConfirm': {
    en: 'Are you sure you want to delete this activity?',
    beanie: 'are you sure you want to delete this activity?',
  },
  'planner.activityCreatedTitle': {
    en: 'Activity Created',
    beanie: 'activity created',
  },
  'planner.activityCreatedMessage': {
    en: 'Your activity has been created!',
    beanie: 'your activity has been created!',
  },
  'planner.noActivities': { en: 'No activities yet', beanie: 'no activities yet' },
  'planner.noActivitiesHint': {
    en: 'Add your first family activity to get started!',
    beanie: 'add your first family activity to get started!',
  },
  'planner.today': { en: 'Today', beanie: 'today' },
  'planner.upcoming': { en: 'Upcoming Activities', beanie: 'upcoming activities' },
  'planner.noUpcoming': { en: 'No upcoming activities', beanie: 'no upcoming activities' },
  'planner.todoPreview': { en: 'Family To-Do', beanie: 'family to-do' },
  'planner.viewAllTodos': { en: 'View all →', beanie: 'view all →' },
  'planner.onCalendar': { en: 'On calendar', beanie: 'on calendar' },
  'planner.viewMore': { en: 'View more', beanie: 'view more' },
  'planner.inactiveActivities': { en: 'Inactive Activities', beanie: 'inactive activities' },
  'planner.noInactive': { en: 'No inactive activities', beanie: 'no inactive activities' },
  'planner.showInactive': { en: 'Show inactive', beanie: 'show inactive' },
  'planner.comingSoon': { en: 'Coming soon', beanie: 'coming soon' },
  'planner.tasksDue': { en: 'Tasks Due', beanie: 'tasks due' },
  'planner.allDay': { en: 'All Day', beanie: 'all day' },
  'planner.allDayHint': {
    en: 'No specific start or end time',
    beanie: 'no specific start or end time',
  },
  'planner.agenda': { en: 'Agenda', beanie: 'agenda' },

  // Planner — View toggle
  'planner.view.month': { en: 'Month', beanie: 'month' },
  'planner.view.week': { en: 'Week', beanie: 'week' },
  'planner.view.day': { en: 'Day', beanie: 'day' },
  'planner.view.agenda': { en: 'Agenda', beanie: 'agenda' },

  // Planner — Activity Category Groups
  'planner.group.school': { en: 'School', beanie: 'school beans' },
  'planner.group.educational': { en: 'Educational', beanie: 'learning beans' },
  'planner.group.sports': { en: 'Sports', beanie: 'active beans' },
  'planner.group.competitions': { en: 'Competitions', beanie: 'competition beans' },
  'planner.group.lessons': { en: 'Lessons', beanie: 'lesson beans' },
  'planner.group.fun': { en: 'Fun', beanie: 'fun beans' },

  // Planner — Activity Categories
  'planner.category.after_school': { en: 'After School Activity', beanie: 'after school' },
  'planner.category.school_recital': {
    en: 'School Recital / Presentation',
    beanie: 'school recital',
  },
  'planner.category.other_school': { en: 'Other School Activity', beanie: 'other school' },
  'planner.category.tutoring': { en: 'Tutoring', beanie: 'tutoring' },
  'planner.category.math': { en: 'Math', beanie: 'math' },
  'planner.category.language': { en: 'Language', beanie: 'language' },
  'planner.category.science': { en: 'Science', beanie: 'science' },
  'planner.category.other_educational': { en: 'Other Educational', beanie: 'other educational' },
  'planner.category.tennis': { en: 'Tennis', beanie: 'tennis' },
  'planner.category.badminton': { en: 'Badminton', beanie: 'badminton' },
  'planner.category.golf_activity': { en: 'Golf', beanie: 'golf' },
  'planner.category.baseball': { en: 'Baseball', beanie: 'baseball' },
  'planner.category.gym_activity': { en: 'Training', beanie: 'training' },
  'planner.category.yoga_activity': { en: 'Yoga / Pilates', beanie: 'yoga' },
  'planner.category.gymnastics': { en: 'Gymnastics', beanie: 'gymnastics' },
  'planner.category.other_sports_activity': { en: 'Other Sports', beanie: 'other sports' },
  'planner.category.spelling_bee': { en: 'Spelling Bee', beanie: 'spelling bee' },
  'planner.category.math_competition': { en: 'Math Competition', beanie: 'math competition' },
  'planner.category.cubing': { en: 'Cubing Competition', beanie: 'cubing' },
  'planner.category.other_competition': { en: 'Other Competition', beanie: 'other competition' },
  'planner.category.piano': { en: 'Piano', beanie: 'piano' },
  'planner.category.guitar': { en: 'Guitar', beanie: 'guitar' },
  'planner.category.trumpet': { en: 'Trumpet', beanie: 'trumpet' },
  'planner.category.drum': { en: 'Drum', beanie: 'drum' },
  'planner.category.music': { en: 'Music', beanie: 'music' },
  'planner.category.art': { en: 'Art', beanie: 'art' },
  'planner.category.dance': { en: 'Dance / Ballet', beanie: 'dance' },
  'planner.category.swimming': { en: 'Swimming', beanie: 'swimming' },
  'planner.category.other_lesson': { en: 'Other Lesson', beanie: 'other lesson' },
  'planner.category.birthday': { en: 'Birthday Party', beanie: 'birthday party' },
  'planner.category.wedding': { en: 'Wedding', beanie: 'wedding' },
  'planner.category.bar_mitzvah': { en: 'Bar Mitzvah', beanie: 'bar mitzvah' },
  'planner.category.other_celebration': { en: 'Other Celebration', beanie: 'other celebration' },

  // Planner — Recurrence labels
  'planner.recurrence.weekly': { en: 'Weekly', beanie: 'weekly' },
  'planner.recurrence.daily': { en: 'Daily', beanie: 'daily' },
  'planner.recurrence.monthly': { en: 'Monthly', beanie: 'monthly' },
  'planner.recurrence.yearly': { en: 'Yearly', beanie: 'yearly' },
  'planner.recurrence.none': { en: 'One-time', beanie: 'one-time' },
  'planner.recurrence.biweekly': { en: 'Biweekly', beanie: 'biweekly' },

  // Planner — Fee schedule labels
  'planner.fee.none': { en: 'No fees', beanie: 'no fees' },
  'planner.fee.per_session': { en: 'Per Session', beanie: 'per session' },
  'planner.fee.weekly': { en: 'Weekly', beanie: 'weekly' },
  'planner.fee.monthly': { en: 'Monthly', beanie: 'monthly' },
  'planner.fee.quarterly': { en: 'Quarterly', beanie: 'quarterly' },
  'planner.fee.yearly': { en: 'Yearly', beanie: 'yearly' },
  'planner.fee.custom': { en: 'Custom', beanie: 'custom' },
  'planner.fee.termly': { en: 'Per Term', beanie: 'per term' },
  'planner.fee.calculatedMonthly': { en: 'Monthly Charge', beanie: 'monthly charge' },
  'planner.fee.monthlyCalcHint': {
    en: 'Calculated monthly equivalent based on your fee schedule. Linked transactions always use this monthly amount for consistent tracking.',
    beanie:
      'Calculated monthly equivalent based on your fee schedule. Linked transactions always use this monthly amount for consistent tracking.',
  },
  'planner.fee.customPeriod': { en: 'Every', beanie: 'every' },
  'planner.fee.weeks': { en: 'Weeks', beanie: 'weeks' },
  'planner.fee.months': { en: 'Months', beanie: 'months' },

  // Planner — Form fields
  'planner.field.title': { en: 'Activity Title', beanie: 'activity title' },
  'planner.field.date': { en: 'Start Date', beanie: 'start date' },
  'planner.field.dateOnly': { en: 'Date', beanie: 'date' },
  'planner.field.endDate': { en: 'End Date', beanie: 'end date' },
  'planner.field.startTime': { en: 'Start Time', beanie: 'start time' },
  'planner.field.endTime': { en: 'End Time', beanie: 'end time' },
  'planner.field.category': { en: 'Category', beanie: 'category' },
  'planner.field.recurrence': { en: 'Repeats', beanie: 'repeats' },
  'planner.field.dayOfWeek': { en: 'Day of Week', beanie: 'day of week' },
  'planner.field.assignee': { en: 'Who', beanie: 'who' },
  'planner.field.dropoff': { en: 'Drop Off Duty', beanie: 'drop off duty' },
  'planner.field.pickup': { en: 'Pick Up Duty', beanie: 'pick up duty' },
  'planner.field.location': { en: 'Location', beanie: 'location' },
  'planner.field.feeSchedule': { en: 'Fee Schedule', beanie: 'fee schedule' },
  'planner.field.feeAmount': { en: 'Fee Amount', beanie: 'fee amount' },
  'planner.field.feePayer': { en: 'Who Pays?', beanie: 'who pays?' },
  'planner.field.instructor': { en: 'Instructor / Coach', beanie: 'instructor / coach' },
  'planner.field.instructorContact': { en: 'Contact', beanie: 'contact' },
  'planner.field.reminder': { en: 'Reminder', beanie: 'reminder' },
  'planner.field.notes': { en: 'Notes', beanie: 'notes' },
  'planner.field.moreDetails': { en: 'Add more details', beanie: 'add more details' },
  'planner.field.color': { en: 'Highlight Color', beanie: 'highlight color' },
  'planner.field.active': { en: 'Active', beanie: 'active' },

  // Planner — Day Agenda Sidebar
  'planner.dayAgenda': { en: 'Day Agenda', beanie: 'day agenda' },
  'planner.noActivitiesForDay': {
    en: 'No activities scheduled',
    beanie: 'no activities scheduled',
  },
  'planner.upcomingAfterDay': { en: 'Coming Up', beanie: 'coming up' },

  // Planner — Legend
  'planner.legend': { en: 'Legend', beanie: 'legend' },

  // Planner — Days of week (short)
  'planner.day.sun': { en: 'Sun', beanie: 'sun' },
  'planner.day.mon': { en: 'Mon', beanie: 'mon' },
  'planner.day.tue': { en: 'Tue', beanie: 'tue' },
  'planner.day.wed': { en: 'Wed', beanie: 'wed' },
  'planner.day.thu': { en: 'Thu', beanie: 'thu' },
  'planner.day.fri': { en: 'Fri', beanie: 'fri' },
  'planner.day.sat': { en: 'Sat', beanie: 'sat' },

  // Planner — View modal
  'planner.viewActivity': { en: 'Activity Details', beanie: 'activity details' },
  'planner.noLocation': { en: 'No location', beanie: 'no location' },
  'planner.openInMaps': { en: 'Open in Google Maps', beanie: 'open in maps' },
  'planner.noNotes': { en: 'No notes', beanie: 'no notes' },
  'planner.cost': { en: 'Cost', beanie: 'cost' },
  'planner.transport': { en: 'Transport', beanie: 'transport' },
  'planner.createdBy': { en: 'Created By', beanie: 'created by' },
  'planner.reschedule': { en: 'Reschedule This Session', beanie: 'reschedule this session' },
  'planner.rescheduleHint': {
    en: 'Move to a different date or time',
    beanie: 'move to a new date or time',
  },
  'planner.rescheduleEditHint': {
    en: 'To change the recurring schedule, use Edit below',
    beanie: 'to change the recurring schedule, use edit below',
  },
  'planner.rescheduleTo': { en: 'New Date', beanie: 'new date' },
  'planner.rescheduleConfirm': { en: 'Reschedule', beanie: 'reschedule' },
  'planner.oneOff': { en: 'One-off', beanie: 'one-off' },

  // Transactions — View modal
  'transactions.viewTransaction': { en: 'Transaction Details', beanie: 'transaction details' },
  'transactions.reconciled': { en: 'Reconciled', beanie: 'reconciled' },
  'transactions.status': { en: 'Status', beanie: 'status' },

  // ───── Budget Page ─────
  'budget.title': { en: 'Budget', beanie: 'bean budget' },
  'budget.subtitle': {
    en: 'Track your spending against your plan',
    beanie: 'keep your beans in line',
  },
  'budget.addBudget': { en: '+ Set Up Budget', beanie: '+ plant a budget' },
  'budget.editBudget': { en: 'Edit Budget', beanie: 'edit budget' },
  'budget.deleteBudget': { en: 'Delete Budget', beanie: 'delete budget' },

  // Budget — Hero card
  'budget.hero.spent': { en: 'Spent', beanie: 'spent' },
  'budget.hero.of': { en: 'of', beanie: 'of' },
  'budget.hero.remaining': { en: 'remaining', beanie: 'remaining' },
  'budget.hero.over': { en: 'over budget', beanie: 'over budget' },
  'budget.hero.percentageMode': { en: '% of income', beanie: '% of income' },
  'budget.hero.fixedMode': { en: 'Fixed amount', beanie: 'fixed amount' },

  // Budget — Motivational messages
  'budget.pace.great': { en: 'Looking great! Well under budget', beanie: 'beans are thriving!' },
  'budget.pace.onTrack': { en: 'Right on track this month', beanie: 'steady bean growth' },
  'budget.pace.caution': {
    en: 'Spending is picking up — stay mindful',
    beanie: 'careful with those beans!',
  },
  'budget.pace.over': { en: 'Over budget — time to rein it in', beanie: 'too many beans spent!' },

  // Budget — Summary cards
  'budget.summary.monthlyIncome': { en: 'Monthly Income', beanie: 'beans earned' },
  'budget.summary.currentSpending': { en: 'Current Spending', beanie: 'beans spent' },
  'budget.summary.monthlySavings': { en: 'Monthly Savings', beanie: 'beans saved' },
  'budget.summary.savingsRate': { en: 'savings rate', beanie: 'savings rate' },
  'budget.summary.recurring': { en: 'Recurring', beanie: 'recurring' },
  'budget.summary.oneTime': { en: 'One-time', beanie: 'one-time' },

  // Budget — Sections
  'budget.section.upcomingTransactions': {
    en: 'Upcoming Transactions',
    beanie: 'upcoming transactions',
  },
  'budget.section.spendingByCategory': {
    en: 'Spending by Category',
    beanie: 'spending by category',
  },
  'budget.section.budgetSettings': { en: 'Budget Settings', beanie: 'budget settings' },
  'budget.section.addTransactions': { en: 'Add Transactions', beanie: 'add transactions' },
  'budget.section.viewAll': { en: 'View All', beanie: 'view all' },

  // Budget — Quick Add
  'budget.quickAdd.title': { en: 'Quick Add', beanie: 'quick add' },
  'budget.quickAdd.moneyIn': { en: 'Money In', beanie: 'beans in' },
  'budget.quickAdd.moneyOut': { en: 'Money Out', beanie: 'beans out' },
  'budget.quickAdd.description': { en: 'Description', beanie: 'description' },
  'budget.quickAdd.amount': { en: 'Amount', beanie: 'amount' },
  'budget.quickAdd.category': { en: 'Category', beanie: 'category' },
  'budget.quickAdd.date': { en: 'Date', beanie: 'date' },
  'budget.quickAdd.account': { en: 'Account', beanie: 'account' },

  // Budget — Batch / CSV (coming soon)
  'budget.batchAdd.title': { en: 'Batch Add', beanie: 'batch add' },
  'budget.csvUpload.title': { en: 'CSV Upload', beanie: 'csv upload' },
  'budget.comingSoon': { en: 'Coming Soon', beanie: 'coming soon' },

  // Budget — Settings modal
  'budget.settings.title': { en: 'Budget Settings', beanie: 'budget settings' },
  'budget.settings.mode': { en: 'Savings Goal', beanie: 'savings goal' },
  'budget.settings.percentageOfIncome': { en: '% of Income', beanie: '% of income' },
  'budget.settings.fixedAmount': { en: 'Fixed Amount', beanie: 'fixed amount' },
  'budget.settings.percentageLabel': {
    en: 'Savings goal (% of income)',
    beanie: 'savings goal (% of income)',
  },
  'budget.settings.fixedLabel': {
    en: 'Savings goal (fixed amount)',
    beanie: 'savings goal (fixed amount)',
  },
  'budget.settings.categoryAllocations': {
    en: 'Category Allocations',
    beanie: 'category allocations',
  },
  'budget.settings.categoryHint': {
    en: 'Set spending limits per category (optional)',
    beanie: 'set spending limits per category (optional)',
  },
  'budget.settings.effectiveBudget': {
    en: 'Spending budget',
    beanie: 'spending budget',
  },
  'budget.settings.perMonth': { en: 'per month', beanie: 'per month' },
  'budget.settings.infoPercentage': {
    en: 'Your savings goal is {savingsPercent}% of income. The remaining {spendingPercent}% ({amount}) is your spending budget, which auto-adjusts when income changes.',
    beanie:
      'your bean stash goal is {savingsPercent}% of income. the other {spendingPercent}% ({amount}) is your spending budget, which grows with your harvest.',
  },
  'budget.settings.infoFixed': {
    en: 'Your spending budget is set to {amount} per month. Everything above this flows to savings. Adjust anytime from the settings.',
    beanie:
      'your spending budget is {amount} every month. everything above goes to your bean stash. tweak it whenever you like!',
  },

  // Budget — Empty state
  'budget.empty.title': { en: 'No budget yet', beanie: 'no bean plan yet' },
  'budget.empty.description': {
    en: 'Set up a monthly budget to track your spending and savings goals',
    beanie: 'plant a budget and watch your beans grow',
  },

  // Budget — Confirm dialog
  'budget.confirm.deleteTitle': { en: 'Delete Budget?', beanie: 'delete budget?' },
  'budget.confirm.deleteMessage': {
    en: 'This will remove your budget configuration. Your transactions will not be affected.',
    beanie: 'this will remove your budget configuration. your transactions will not be affected.',
  },

  // Budget — Category status
  'budget.category.onTrack': { en: 'On track', beanie: 'on track' },
  'budget.category.warning': { en: 'Watch it', beanie: 'watch it' },
  'budget.category.over': { en: 'Over', beanie: 'over' },
  'budget.category.noBudget': { en: 'No limit set', beanie: 'no limit set' },
  'budget.category.overAmount': { en: 'over', beanie: 'over' },
  'budget.category.overEncouragement': {
    en: 'just a little more to go',
    beanie: 'keep those beans tight',
  },

  // Hero card v7
  'budget.hero.budgetProgress': { en: 'Budget Progress', beanie: 'bean progress' },
  'budget.hero.dayLabel': { en: 'Day', beanie: 'day' },
  'budget.hero.daysOf': { en: 'of', beanie: 'of' },
  'budget.hero.percentSpent': { en: 'spent', beanie: 'spent' },

  // Add Transactions
  'budget.addTransactions.subtitle': {
    en: 'One-time or recurring — add them your way',
    beanie: 'plant beans one at a time or in bunches',
  },
  'budget.quickAdd.subtitle': {
    en: 'Add an expense or income instantly',
    beanie: 'add an expense or income instantly',
  },
  'budget.batchAdd.subtitle': {
    en: 'Add multiple transactions at once',
    beanie: 'add multiple transactions at once',
  },
  'budget.csvUpload.subtitle': {
    en: 'Import from your bank statement',
    beanie: 'import from your bank statement',
  },

  // Upcoming transactions
  'budget.upcoming.today': { en: 'Today', beanie: 'today' },
  'budget.upcoming.tomorrow': { en: 'Tomorrow', beanie: 'tomorrow' },
  'budget.upcoming.inDays': { en: 'In {days} days', beanie: 'in {days} days' },
  'budget.upcoming.recurring': { en: 'recurring', beanie: 'recurring' },

  // Initialization error recovery
  'app.initError.title': { en: 'Something Went Wrong', beanie: 'oh no, the beans spilled' },
  'app.initError.description': {
    en: 'The app failed to start properly. You can try reloading, or clear your data and start fresh.',
    beanie:
      'the app failed to start properly. you can try reloading, or clear your data and start fresh.',
  },
  'app.initError.reload': { en: 'Reload', beanie: 'reload' },
  'app.initError.clearData': { en: 'Sign Out & Clear Data', beanie: 'sign out & clear data' },
  'app.initError.details': { en: 'Technical Details', beanie: 'technical details' },
  'app.initError.diagnostics': { en: 'Device Info', beanie: 'device info' },
  'app.initError.clearConfirm': {
    en: 'This will sign you out and delete all local data. Your cloud data (if any) will not be affected. Are you sure?',
    beanie:
      'this will sign you out and delete all local data. your cloud data (if any) will not be affected. are you sure?',
  },
  // ── Info Hints (summary card popovers) ─────────────────────────────────────
  'hints.transactionsIncome': {
    en: 'Total income for this month, including one-time and recurring transactions.',
    beanie: 'total income for this month, including one-time and recurring transactions.',
  },
  'hints.transactionsExpenses': {
    en: 'Total expenses for this month, including one-time and recurring transactions.',
    beanie: 'total expenses for this month, including one-time and recurring transactions.',
  },
  'hints.transactionsNet': {
    en: 'Income minus expenses for this month. Positive means you saved money.',
    beanie: 'income minus expenses for this month. positive means you saved money.',
  },
  'hints.dashboardIncome': {
    en: 'Total income this month from all accounts, including recurring items.',
    beanie: 'total income this month from all accounts, including recurring items.',
  },
  'hints.dashboardExpenses': {
    en: 'Total expenses this month from all accounts, including recurring items.',
    beanie: 'total expenses this month from all accounts, including recurring items.',
  },
  'hints.dashboardCashFlow': {
    en: 'Income minus expenses. A positive number means your family is saving money this month.',
    beanie: 'income minus expenses. a positive number means your family is saving this month.',
  },
  'hints.dashboardNetWorth': {
    en: 'Total value of all accounts and assets minus all liabilities (loans and credit cards).',
    beanie:
      'total value of all accounts and assets minus all liabilities (loans and credit cards).',
  },
  'hints.netWorthBreakdown': {
    en: 'How your net worth is distributed across cash, investments, crypto, retirement, and assets. Tap a category to see details.',
    beanie:
      'how your net worth is distributed across your accounts and assets. tap a category to see more.',
  },
  'hints.accountsAssets': {
    en: 'Sum of all non-liability accounts (checking, savings, investments, etc.) included in net worth.',
    beanie:
      'sum of all non-liability accounts (checking, savings, investments, etc.) included in net worth.',
  },
  'hints.accountsLiabilities': {
    en: 'Sum of all credit card balances and loan accounts, including asset-linked loans.',
    beanie: 'sum of all credit card balances and loan accounts, including asset-linked loans.',
  },
  'hints.assetsTotalValue': {
    en: 'Current market value of all your physical assets (property, vehicles, etc.).',
    beanie: 'current market value of all your physical assets (property, vehicles, etc.).',
  },
  'hints.assetsLoans': {
    en: 'Outstanding loan balances on your assets. These also appear as loan accounts.',
    beanie: 'outstanding loan balances on your assets. these also show up as loan accounts.',
  },
  'hints.assetsNetValue': {
    en: 'Asset value minus outstanding loans. Your equity in physical assets.',
    beanie: 'asset value minus outstanding loans. your equity in physical assets.',
  },
  'hints.assetsAppreciation': {
    en: 'Difference between current value and purchase price across all assets.',
    beanie: 'difference between current value and purchase price across all assets.',
  },
  'hints.nookNetWorth': {
    en: 'Your family net worth: all accounts and assets minus all liabilities.',
    beanie: 'your family net worth: all accounts and assets minus all liabilities.',
  },
  'hints.nookFiguresHidden': {
    en: 'Figures are hidden for privacy. You can also toggle them anytime by tapping the beanie icon in the header.',
    beanie:
      'figures are hidden for privacy. you can also toggle them anytime by tapping the beanie in the header.',
  },

  'hints.budgetPaceIntro': {
    en: 'Pace compares spending progress to time elapsed in the month.',
    beanie: 'pace compares spending progress to time elapsed in the month.',
  },
  'hints.budgetPaceGreat': {
    en: 'Great — spending is 15%+ below time elapsed.',
    beanie: 'great — spending is 15%+ below time elapsed.',
  },
  'hints.budgetPaceOnTrack': {
    en: 'On Track — spending is within 15% of time elapsed.',
    beanie: 'on track — spending is within 15% of time elapsed.',
  },
  'hints.budgetPaceCaution': {
    en: 'Caution — spending is 15%+ ahead of time elapsed.',
    beanie: 'caution — spending is 15%+ ahead of time elapsed.',
  },
  'hints.budgetPaceOver': {
    en: 'Over Budget — spending has exceeded 100% of budget.',
    beanie: 'over budget — spending has exceeded 100% of budget.',
  },

  // Homepage
  'homepage.getStarted': { en: 'Get Started', beanie: 'get started' },
  'homepage.about': { en: 'About', beanie: 'about' },
  'homepage.heroDescription': {
    en: 'The family hub that keeps everyone organised, on track, and growing together.',
    beanie: 'the family hub that keeps all your beanies organised, on track, and growing together.',
  },
  'homepage.aboutDescription': {
    en: 'beanies.family is a local-first, privacy-focused family planning app. Your data is encrypted and stays on your devices — no servers, no tracking, no compromises.',
    beanie:
      'beanies.family is a local-first, privacy-focused family planning app. your data is encrypted and stays on your devices — no servers, no tracking, no compromises.',
  },
  'homepage.featureFinance': { en: 'Family finances', beanie: 'family finances' },
  'homepage.featurePlanner': { en: 'Activity planner', beanie: 'activity planner' },
  'homepage.featureTodo': { en: 'Shared to-do lists', beanie: 'shared to-do lists' },
  'homepage.featurePrivacy': { en: 'End-to-end encrypted', beanie: 'end-to-end encrypted' },
  'homepage.betaBadge': { en: 'Beta', beanie: 'beta' },
  'homepage.viewOnGithub': { en: 'View on GitHub', beanie: 'view on github' },
  'homepage.signIn': { en: 'Sign In / Join', beanie: 'sign in / join' },
  'homepage.learnMore': {
    en: 'Back to Homepage',
    beanie: 'back to homepage',
  },

  // Invite gate
  'inviteGate.title': { en: 'Invite Only', beanie: 'invite only' },
  'inviteGate.description': {
    en: "We're still building! You need an exclusive invite to access beanies.family. If you're one of the lucky few, enter your invite bean below.",
    beanie:
      "we're still building! you need an exclusive invite to access beanies.family. if you're one of the lucky few, enter your invite bean below.",
  },
  'inviteGate.tokenLabel': { en: 'Invite Bean', beanie: 'invite bean' },
  'inviteGate.tokenPlaceholder': { en: 'Enter your token', beanie: 'enter your token' },
  'inviteGate.tokenRequired': { en: 'Please enter a token', beanie: 'please enter a token' },
  'inviteGate.tokenInvalid': {
    en: "That token doesn't look right. Check and try again.",
    beanie: "that token doesn't look right. check and try again.",
  },
  'inviteGate.unlock': { en: 'Unlock', beanie: 'unlock' },
  'inviteGate.noToken': { en: "Don't have one?", beanie: "don't have one?" },
  'inviteGate.requestOne': { en: 'Request an invite', beanie: 'request an invite' },
  'inviteGate.requestTitle': { en: 'Request an Invite', beanie: 'request an invite' },
  'inviteGate.requestDescription': {
    en: "Tell us a bit about yourself and we'll get back to you.",
    beanie: "tell us a bit about yourself and we'll get back to you.",
  },
  'inviteGate.nameLabel': { en: 'Name', beanie: 'name' },
  'inviteGate.namePlaceholder': { en: 'Your name', beanie: 'your name' },
  'inviteGate.emailLabel': { en: 'Email', beanie: 'email' },
  'inviteGate.emailPlaceholder': { en: 'you@example.com', beanie: 'you@example.com' },
  'inviteGate.messageLabel': { en: 'Message (optional)', beanie: 'message (optional)' },
  'inviteGate.messagePlaceholder': {
    en: 'Why are you interested?',
    beanie: 'why are you interested?',
  },
  'inviteGate.fieldsRequired': {
    en: 'Name and email are required',
    beanie: 'name and email are required',
  },
  'inviteGate.emailInvalid': {
    en: 'Please enter a valid email',
    beanie: 'please enter a valid email',
  },
  'inviteGate.sendRequest': { en: 'Send Request', beanie: 'send request' },
  'inviteGate.haveToken': { en: 'I have a token', beanie: 'i have a token' },
  'inviteGate.requestError': {
    en: 'Something went wrong. Please try again later.',
    beanie: 'something went wrong. please try again later.',
  },
  'inviteGate.confirmedTitle': { en: 'Request Sent!', beanie: 'request sent!' },
  'inviteGate.confirmedDescription': {
    en: "Thanks for your interest! We'll review your request and send you an invite bean soon.",
    beanie: "thanks for your interest! we'll review your request and send you an invite bean soon.",
  },
  'inviteGate.backToHome': { en: 'Back to Home', beanie: 'back to home' },

  // Linked asset accounts
  'accounts.linkedTo': { en: 'Linked to {asset}', beanie: 'linked to {asset}' },
  'accounts.editOnAssetsPage': {
    en: 'This loan is linked to an asset. Edit it on the Assets page.',
    beanie: 'this loan is linked to an asset. edit it on the assets page.',
  },

  // Onboarding wizard
  'onboarding.welcomePrefix': { en: 'Welcome to ', beanie: 'welcome to ' },
  'onboarding.welcomeBrand': { en: 'beanies' },
  'onboarding.welcomeDescription': {
    en: "Your family's cozy corner for managing the chaos \u2014 finances, schedules, activities, and everything in between. Less stress, more time for your little beans.",
    beanie:
      "your family's cozy corner for managing the chaos \u2014 finances, schedules, activities, and everything in between. less stress, more time for your little beans.",
  },
  'onboarding.pillarMoney': { en: 'Track money', beanie: 'track money' },
  'onboarding.pillarMoneyShort': { en: 'Money', beanie: 'money' },
  'onboarding.pillarPlan': { en: 'Plan life', beanie: 'plan life' },
  'onboarding.pillarPlanShort': { en: 'Plans', beanie: 'plans' },
  'onboarding.pillarFamily': { en: 'Grow together', beanie: 'grow together' },
  'onboarding.pillarFamilyShort': { en: 'Family', beanie: 'family' },
  'onboarding.currencyQuestion': {
    en: "What's your family's base currency?",
    beanie: "what's your family's base currency?",
  },
  'onboarding.welcomeCta': {
    en: "Let's Get This Pod Rolling \u{1F96B}",
    beanie: "let's get this pod rolling \u{1F96B}",
  },
  'onboarding.welcomeSubtitle': {
    en: 'just 3 quick steps \u00B7 takes about 2 minutes',
    beanie: 'just 3 quick steps \u00B7 takes about 2 minutes',
  },

  // Money step
  'onboarding.sectionAccount': { en: 'Drop in an account', beanie: 'drop in an account' },
  'onboarding.sectionAccountSub': {
    en: '\u2014 start with your main one',
    beanie: '\u2014 start with your main one',
  },
  'onboarding.bank': { en: 'Bank', beanie: 'bank' },
  'onboarding.bankPlaceholder': { en: 'Select bank...', beanie: 'select bank...' },
  'onboarding.accountName': { en: 'Account Name', beanie: 'account name' },
  'onboarding.accountNamePlaceholder': {
    en: 'e.g. Savings Account',
    beanie: 'e.g. savings account',
  },
  'onboarding.balance': { en: 'Balance', beanie: 'balance' },
  'onboarding.addAccount': { en: 'Add Account', beanie: 'add account' },
  'onboarding.added': { en: 'added', beanie: 'added' },
  'onboarding.addAnother': { en: '+ Add another', beanie: '+ add another' },
  'onboarding.sectionRecurring': {
    en: 'Add a regular transaction',
    beanie: 'add a regular transaction',
  },
  'onboarding.sectionRecurringSub': {
    en: '\u2014 tap a category to add details',
    beanie: '\u2014 tap a category to add details',
  },
  'onboarding.income': { en: '\u2191 Income', beanie: '\u2191 income' },
  'onboarding.expenses': { en: '\u2193 Expenses', beanie: '\u2193 expenses' },
  'onboarding.sectionSavings': {
    en: 'Set your savings goal each month',
    beanie: 'set your savings goal each month',
  },
  'onboarding.ofMyIncome': { en: 'of my income', beanie: 'of my income' },
  'onboarding.savingsNice': { en: 'Nice!', beanie: 'nice!' },
  'onboarding.savingsEncouragement': {
    en: "That's {amount}/month into your bean jar. \u{1F331}",
    beanie: "that's {amount}/month into your bean jar. \u{1F331}",
  },
  'onboarding.summaryIncome': { en: 'Income', beanie: 'income' },
  'onboarding.summaryFixedCosts': { en: 'Fixed costs', beanie: 'fixed costs' },
  'onboarding.summarySavingsBar': { en: 'Savings', beanie: 'savings' },
  'onboarding.summaryFlexible': { en: 'Flexible', beanie: 'flexible' },

  // Recurring modal
  'onboarding.addRecurring': { en: 'Add Regular Transaction', beanie: 'add regular transaction' },
  'onboarding.customTransaction': { en: 'Custom', beanie: 'custom' },
  'onboarding.direction': { en: 'Direction', beanie: 'direction' },
  'onboarding.directionExpense': {
    en: '\u2193 Expense',
    beanie: '\u2193 expense',
  },
  'onboarding.directionIncome': {
    en: '\u2191 Income',
    beanie: '\u2191 income',
  },
  'onboarding.transactionName': { en: 'Transaction Name', beanie: 'transaction name' },
  'onboarding.transactionNamePlaceholder': {
    en: 'e.g. Monthly Rent',
    beanie: 'e.g. monthly rent',
  },
  'onboarding.amount': { en: 'Amount', beanie: 'amount' },
  'onboarding.dayOfMonth': { en: 'Day of Month', beanie: 'day of month' },
  'onboarding.frequency': { en: 'Frequency', beanie: 'frequency' },
  'onboarding.account': { en: 'Account', beanie: 'account' },
  'onboarding.autoSelected': { en: 'Auto-selected', beanie: 'auto-selected' },
  'onboarding.addCategory': { en: 'Add {category}', beanie: 'add {category}' },

  // Family step
  'onboarding.sectionActivity': {
    en: 'What keeps your family busy?',
    beanie: 'what keeps your family busy?',
  },
  'onboarding.sectionActivitySub': {
    en: '\u2014 add a lesson or activity',
    beanie: '\u2014 add a lesson or activity',
  },
  'onboarding.assignee': { en: 'Who', beanie: 'who' },
  'onboarding.days': { en: 'Days', beanie: 'days' },
  'onboarding.time': { en: 'Time', beanie: 'time' },
  'onboarding.startTime': { en: 'Start Time', beanie: 'start time' },
  'onboarding.endTime': { en: 'End Time', beanie: 'end time' },
  'onboarding.costPerMonth': { en: 'Cost / Month', beanie: 'cost / month' },
  'onboarding.addActivity': { en: 'Add Activity', beanie: 'add activity' },
  'onboarding.addedToPlanner': {
    en: 'Added to planner & budget',
    beanie: 'added to planner & budget',
  },
  'onboarding.sectionDiscover': { en: 'More things to explore', beanie: 'more things to explore' },
  'onboarding.sectionDiscoverSub': {
    en: '\u2014 waiting in your Nook',
    beanie: '\u2014 waiting in your nook',
  },
  'onboarding.closingTitle': {
    en: 'We built beanies to help you.',
    beanie: 'we built beanies to help you.',
  },
  'onboarding.closingSubtitle': {
    en: "So you can spend your time on what's important \u2014 your little beans.",
    beanie: "so you can spend your time on what's important \u2014 your little beans.",
  },

  // Completion step
  'onboarding.completePrefix': { en: 'Your ', beanie: 'your ' },
  'onboarding.completeHighlight': { en: 'Bean Pod', beanie: 'bean pod' },
  'onboarding.completeSuffix': { en: ' is Ready!', beanie: ' is ready!' },
  'onboarding.completeDescription': {
    en: "That's it \u2014 you're all set. Explore, add more, and make beanies yours.",
    beanie: "that's it \u2014 you're all set. explore, add more, and make beanies yours.",
  },
  'onboarding.summaryAccount': { en: 'Account', beanie: 'account' },
  'onboarding.summaryRecurring': { en: 'Recurring', beanie: 'recurring' },
  'onboarding.summarySavings': { en: 'Savings', beanie: 'savings' },
  'onboarding.summaryActivity': { en: 'Activity', beanie: 'activity' },
  'onboarding.completeCta': {
    en: 'Enter The Nook \u{1F3E1}',
    beanie: 'enter the nook \u{1F3E1}',
  },
  'onboarding.completeSubtitle': {
    en: "go take care of your little beans \u2014 we'll take care of the rest. \u{1F96B}",
    beanie: "go take care of your little beans \u2014 we'll take care of the rest. \u{1F96B}",
  },

  // Navigation
  'onboarding.back': { en: '\u2190 Back', beanie: '\u2190 back' },
  'onboarding.skip': { en: 'Skip for now', beanie: 'skip for now' },
  'onboarding.nextFamily': { en: 'Next: Family Life \u2192', beanie: 'next: family life \u2192' },
  'onboarding.allDone': { en: 'All Done! \u{1F389}', beanie: 'all done! \u{1F389}' },

  // Settings
  'onboarding.restartOnboarding': {
    en: 'Restart Onboarding',
    beanie: 'restart onboarding',
  },
  'onboarding.restartOnboardingDescription': {
    en: 'Walk through the setup wizard again to add accounts, transactions, and activities.',
    beanie: 'walk through the setup wizard again to add accounts, transactions, and activities.',
  },
  // Help Center
  'help.title': { en: 'Help Center', beanie: 'help center' },
  'help.heroTitle': { en: 'how can we help?', beanie: 'how can we help?' },
  'help.heroBadge': {
    en: 'beanies.family help center',
    beanie: 'beanies.family help center',
  },
  'help.subtitle': {
    en: 'Everything you need to know about your family\u2019s favourite bean counter \u2014 from first pod to full financial planning.',
    beanie:
      'everything you need to know about your family\u2019s favourite bean counter \u2014 from first pod to full financial planning.',
  },
  'help.searchPlaceholder': {
    en: 'search for anything... encryption, budgets, activities...',
    beanie: 'search for anything... encryption, budgets, activities...',
  },
  'help.noResults': {
    en: 'No articles found. Try a different search term.',
    beanie: 'no articles found. try a different search term.',
  },
  'help.browseByTopic': { en: 'Browse by Topic', beanie: 'browse by topic' },
  'help.popularArticles': { en: 'Popular Reads', beanie: 'popular reads' },
  'help.viewAllArticles': { en: 'View all articles', beanie: 'view all articles' },
  'help.allArticles': { en: 'All Topics', beanie: 'all topics' },
  'help.securitySpotlightTitle': {
    en: 'Your beans are safe with us',
    beanie: 'your beans are safe with us',
  },
  'help.securitySpotlightDesc': {
    en: 'beanies.family uses bank-grade encryption that runs entirely in your browser. Your data never touches our servers unencrypted \u2014 because it never touches our servers at all.',
    beanie:
      'beanies.family uses bank-grade encryption that runs entirely in your browser. your data never touches our servers unencrypted \u2014 because it never touches our servers at all.',
  },
  'help.securityFeature1Title': { en: 'AES-256-GCM Encryption', beanie: 'AES-256-GCM encryption' },
  'help.securityFeature1Desc': {
    en: 'The same authenticated encryption used by governments and banks. Every byte of your family data is encrypted before it leaves memory.',
    beanie:
      'the same authenticated encryption used by governments and banks. every byte of your family data is encrypted before it leaves memory.',
  },
  'help.securityFeature2Title': { en: 'PBKDF2 Key Derivation', beanie: 'PBKDF2 key derivation' },
  'help.securityFeature2Desc': {
    en: 'Your password is strengthened through 100,000 rounds of PBKDF2-SHA256 before it becomes an encryption key.',
    beanie:
      'your password is strengthened through 100,000 rounds of PBKDF2-SHA256 before it becomes an encryption key.',
  },
  'help.securityFeature3Title': {
    en: 'Per-Member Key Wrapping',
    beanie: 'per-member key wrapping',
  },
  'help.securityFeature3Desc': {
    en: 'Each family member has their own wrapped copy of the family key. Change your password without re-encrypting the entire file.',
    beanie:
      'each family member has their own wrapped copy of the family key. change your password without re-encrypting the entire file.',
  },
  'help.securityFeature4Title': { en: 'Browser-Native Crypto', beanie: 'browser-native crypto' },
  'help.securityFeature4Desc': {
    en: 'All encryption uses the Web Crypto API built into your browser \u2014 no third-party libraries, no external dependencies.',
    beanie:
      'all encryption uses the Web Crypto API built into your browser \u2014 no third-party libraries, no external dependencies.',
  },
  'help.diagramTitle': {
    en: 'How your data is protected',
    beanie: 'how your data is protected',
  },
  'help.diagramStep1': {
    en: 'Your password + random salt',
    beanie: 'your password + random salt',
  },
  'help.diagramStep2': {
    en: 'PBKDF2 (100,000 rounds) \u2192 AES key',
    beanie: 'PBKDF2 (100,000 rounds) \u2192 AES key',
  },
  'help.diagramStep3': {
    en: 'AES-KW unwraps the family key',
    beanie: 'AES-KW unwraps the family key',
  },
  'help.diagramStep4': {
    en: 'Family key decrypts your .beanpod',
    beanie: 'family key decrypts your .beanpod',
  },
  'help.diagramCaption': {
    en: 'All of this happens in your browser. Nothing is sent anywhere.',
    beanie: 'all of this happens in your browser. nothing is sent anywhere.',
  },
  'help.learnMoreSecurity': {
    en: 'Learn more about security',
    beanie: 'learn more about security',
  },
  'help.chatbotTeaser': {
    en: 'Bean Assistant \u2014 Coming Soon',
    beanie: 'bean assistant \u2014 coming soon',
  },
  'help.chatbotTeaserDesc': {
    en: 'Ask anything about your finances, features, or how things work \u2014 and get instant answers from your personal bean assistant.',
    beanie:
      'ask anything about your finances, features, or how things work \u2014 and get instant answers from your personal bean assistant.',
  },
  'help.chatbotMockAnswer': {
    en: 'Net worth = (accounts + assets) \u2212 liabilities. All converted to your base currency!',
    beanie:
      'net worth = (accounts + assets) \u2212 liabilities. all converted to your base currency!',
  },
  'help.chatbotInputPlaceholder': {
    en: 'Ask me anything about beanies.family...',
    beanie: 'ask me anything about beanies.family...',
  },
  'help.onThisPage': { en: 'On This Page', beanie: 'on this page' },
  'help.wasHelpful': { en: 'Was this article helpful?', beanie: 'was this article helpful?' },
  'help.yes': { en: 'Yes', beanie: 'yes' },
  'help.no': { en: 'No', beanie: 'no' },
  'help.feedbackThanks': { en: 'Thanks for your feedback!', beanie: 'thanks for your feedback!' },
  'help.articleNotFound': { en: 'Article not found', beanie: 'article not found' },
  'help.backToHelp': { en: 'Back to Help Center', beanie: 'back to help center' },
  'help.noArticlesInCategory': {
    en: 'No articles in this category yet.',
    beanie: 'no articles in this category yet.',
  },

  // Help categories
  'help.category.gettingStarted': { en: 'Getting Started', beanie: 'getting started' },
  'help.category.gettingStartedDesc': {
    en: 'Create your first pod, add family members, and start tracking your beans.',
    beanie: 'create your first pod, add family members, and start tracking your beans.',
  },
  'help.category.features': { en: 'Features & How-To', beanie: 'features & how-to' },
  'help.category.featuresDesc': {
    en: 'Accounts, transactions, budgets, goals, activities, the planner, and everything in between.',
    beanie:
      'accounts, transactions, budgets, goals, activities, the planner, and everything in between.',
  },
  'help.category.security': { en: 'Security & Privacy', beanie: 'security & privacy' },
  'help.category.securityDesc': {
    en: 'How we encrypt your data, protect your keys, and keep your beans safe \u2014 with full transparency.',
    beanie:
      'how we encrypt your data, protect your keys, and keep your beans safe \u2014 with full transparency.',
  },
  'help.category.howItWorks': { en: 'How It Works', beanie: 'how it works' },
  'help.category.howItWorksDesc': {
    en: 'The logic behind the numbers \u2014 how calculations, summaries, and smart features work under the hood.',
    beanie:
      'the logic behind the numbers \u2014 how calculations, summaries, and smart features work under the hood.',
  },

  // Navigation
  'nav.beanstalk': { en: 'Beanstalk Blog', beanie: 'beanstalk blog' },
  'nav.help': { en: 'Help', beanie: 'help' },

  // ── Vacation Planner ──────────────────────────────────────────────────────

  // Toggle & entry
  'vacation.planningATrip': {
    en: 'Make It a Family Vacation!',
    beanie: 'make it a family vacation!',
  },
  'vacation.planningSubtitle': {
    en: 'Plan a trip with flights, hotels, ideas & more',
    beanie: 'plan a trip with flights, hotels, ideas & more',
  },

  // Wizard
  'vacation.wizardTitle': { en: 'Plan a Vacation', beanie: 'plan a vacation' },
  'vacation.wizardTitleEdit': { en: 'Edit Vacation', beanie: 'edit vacation' },
  'vacation.step.trip': { en: 'Trip', beanie: 'trip' },
  'vacation.step.travel': { en: 'Travel', beanie: 'travel' },
  'vacation.step.stay': { en: 'Stay', beanie: 'stay' },
  'vacation.step.gettingAround': { en: 'Getting Around', beanie: 'getting around' },
  'vacation.step.ideas': { en: 'Ideas', beanie: 'ideas' },

  // Step 1
  'vacation.step1.title': {
    en: 'Where Are the Beans Going?',
    beanie: 'where are the beans going?',
  },
  'vacation.step1.subtitle': {
    en: 'Pick your adventure type and give it a name!',
    beanie: 'pick your adventure type and give it a name!',
  },
  'vacation.field.vacationName': { en: 'Vacation Name', beanie: 'vacation name' },
  'vacation.field.vacationNamePlaceholder': {
    en: 'e.g. bali beach bonanza',
    beanie: 'e.g. bali beach bonanza',
  },
  'vacation.field.tripType': { en: 'Trip Type', beanie: 'trip type' },
  'vacation.field.whosGoing': { en: "Who's Going?", beanie: "who's going?" },

  // Trip types
  'vacation.type.fly_and_stay': { en: 'Fly & Stay', beanie: 'fly & stay' },
  'vacation.type.fly_and_stay.desc': {
    en: 'Flight + hotel',
    beanie: 'flight + hotel',
  },
  'vacation.type.cruise': { en: 'Cruise', beanie: 'cruise' },
  'vacation.type.cruise.desc': { en: 'Set sail, matey!', beanie: 'set sail, matey!' },
  'vacation.type.road_trip': { en: 'Road Trip', beanie: 'road trip' },
  'vacation.type.road_trip.desc': {
    en: 'Snacks & singalongs',
    beanie: 'snacks & singalongs',
  },
  'vacation.type.combo': { en: 'Combo Trip', beanie: 'combo trip' },
  'vacation.type.combo.desc': { en: 'Mix & match!', beanie: 'mix & match!' },
  'vacation.type.camping': { en: 'Camping', beanie: 'camping' },
  'vacation.type.camping.desc': { en: 'Under the stars', beanie: 'under the stars' },
  'vacation.type.adventure': { en: 'Adventure', beanie: 'adventure' },
  'vacation.type.adventure.desc': {
    en: 'Hiking, ski, explore',
    beanie: 'hiking, ski, explore',
  },

  // Step 2 - Travel
  'vacation.step2.title': {
    en: 'How Are We Getting There?',
    beanie: 'how are we getting there?',
  },
  'vacation.step2.subtitle': {
    en: 'Sorted by date \u2014 expand any card for full details',
    beanie: 'sorted by date \u2014 expand any card for full details',
  },
  'vacation.travel.addFlight': { en: 'Flight', beanie: 'flight' },
  'vacation.travel.addCruise': { en: 'Cruise', beanie: 'cruise' },
  'vacation.travel.addTrain': { en: 'Train', beanie: 'train' },
  'vacation.travel.addFerry': { en: 'Ferry', beanie: 'ferry' },
  'vacation.travel.addCar': { en: 'Car', beanie: 'car' },
  'vacation.field.arrivesNextDay': { en: 'Arrives next day', beanie: 'arrives next day' },
  'vacation.field.embarkationTime': { en: 'Departure Time', beanie: 'departure time' },
  'vacation.field.carType': { en: 'Car Type', beanie: 'car type' },
  'vacation.field.carLabel': { en: 'Car Name', beanie: 'car name' },
  'vacation.field.leavingTime': { en: 'Leaving Time', beanie: 'leaving time' },
  'vacation.carType.family_car': { en: 'Family Car', beanie: 'family car' },
  'vacation.carType.rental_car': { en: 'Rental Car', beanie: 'rental car' },
  'vacation.carType.other': { en: 'Other', beanie: 'other' },
  'vacation.segment.car': { en: 'Car', beanie: 'car' },
  'vacation.travel.outboundFlight': { en: 'Outbound Flight', beanie: 'outbound flight' },
  'vacation.travel.returnFlight': { en: 'Return Flight', beanie: 'return flight' },
  'vacation.travel.flights': { en: 'Flights', beanie: 'flights' },
  'vacation.travel.outbound': { en: 'Outbound', beanie: 'outbound' },
  'vacation.travel.return': { en: 'Return', beanie: 'return' },
  'vacation.travel.oneWay': { en: 'One-way', beanie: 'one-way' },

  // Travel fields
  'vacation.field.airline': { en: 'Airline', beanie: 'airline' },
  'vacation.field.flightNumber': { en: 'Flight Number', beanie: 'flight number' },
  'vacation.field.departureAirport': { en: 'From', beanie: 'from' },
  'vacation.field.arrivalAirport': { en: 'To', beanie: 'to' },
  'vacation.field.departureDate': { en: 'Departure Date', beanie: 'departure date' },
  'vacation.field.departureTime': { en: 'Departure Time', beanie: 'departure time' },
  'vacation.field.arrivalDate': { en: 'Arrival Date', beanie: 'arrival date' },
  'vacation.field.arrivalTime': { en: 'Arrival Time', beanie: 'arrival time' },
  'vacation.field.bookingReference': { en: 'Booking Reference', beanie: 'booking reference' },
  'vacation.field.cruiseLine': { en: 'Cruise Line', beanie: 'cruise line' },
  'vacation.field.shipName': { en: 'Ship Name', beanie: 'ship name' },
  'vacation.field.departurePort': { en: 'Departure Port', beanie: 'departure port' },
  'vacation.field.cabinNumber': { en: 'Cabin Number', beanie: 'cabin number' },
  'vacation.field.embarkationDate': { en: 'Embarkation', beanie: 'embarkation' },
  'vacation.field.disembarkationDate': { en: 'Disembarkation', beanie: 'disembarkation' },
  'vacation.field.operator': { en: 'Operator', beanie: 'operator' },
  'vacation.field.trainCompany': { en: 'Train Company', beanie: 'train company' },
  'vacation.field.route': { en: 'Route', beanie: 'route' },
  'vacation.field.trainNumber': { en: 'Train Number', beanie: 'train number' },
  'vacation.field.departureStation': { en: 'From Station', beanie: 'from station' },
  'vacation.field.arrivalStation': { en: 'To Station', beanie: 'to station' },

  // Step 3 - Accommodation
  'vacation.step3.title': { en: 'Pillow Fort HQ', beanie: 'pillow fort HQ' },
  'vacation.step3.subtitle': {
    en: 'Select what you need \u2014 add details for each',
    beanie: 'select what you need \u2014 add details for each',
  },
  'vacation.accommodation.hotel': { en: 'Hotel', beanie: 'hotel' },
  'vacation.accommodation.airbnb': { en: 'Airbnb / Rental', beanie: 'airbnb / rental' },
  'vacation.accommodation.campground': { en: 'Campground', beanie: 'campground' },
  'vacation.accommodation.family_friends': {
    en: 'Family / Friends',
    beanie: 'family / friends',
  },
  'vacation.field.hotelName': { en: 'Hotel Name', beanie: 'hotel name' },
  'vacation.field.propertyName': { en: 'Property Name', beanie: 'property name' },
  'vacation.field.campgroundName': { en: 'Campground Name', beanie: 'campground name' },
  'vacation.field.hostName': { en: 'Host Name', beanie: 'host name' },
  'vacation.field.breakfastIncluded': { en: 'Breakfast Included', beanie: 'breakfast included' },
  'vacation.field.address': { en: 'Address', beanie: 'address' },
  'vacation.field.checkIn': { en: 'Check-in', beanie: 'check-in' },
  'vacation.field.checkOut': { en: 'Check-out', beanie: 'check-out' },
  'vacation.field.confirmationNumber': {
    en: 'Confirmation Number',
    beanie: 'confirmation number',
  },
  'vacation.field.roomType': { en: 'Room Type', beanie: 'room type' },
  'vacation.field.contactPhone': { en: 'Contact Phone', beanie: 'contact phone' },
  'vacation.addAnotherStay': { en: 'Add Another Stay', beanie: 'add another stay' },

  // Step 4 - Transportation
  'vacation.step4.title': {
    en: 'Bean Transportation Dept.',
    beanie: 'bean transportation dept.',
  },
  'vacation.step4.subtitle': {
    en: 'Select what you need \u2014 skip the rest!',
    beanie: 'select what you need \u2014 skip the rest!',
  },
  'vacation.transport.airport_shuttle': { en: 'Airport Shuttle', beanie: 'airport shuttle' },
  'vacation.transport.rental_car': { en: 'Rental Car', beanie: 'rental car' },
  'vacation.transport.taxi_rideshare': { en: 'Taxi / Rideshare', beanie: 'taxi / rideshare' },
  'vacation.transport.train': { en: 'Train', beanie: 'train' },
  'vacation.transport.bus': { en: 'Bus', beanie: 'bus' },
  'vacation.field.pickupDate': { en: 'Pickup Date', beanie: 'pickup date' },
  'vacation.field.pickupTime': { en: 'Pickup Time', beanie: 'pickup time' },
  'vacation.field.returnDate': { en: 'Return Date', beanie: 'return date' },
  'vacation.field.returnTime': { en: 'Return Time', beanie: 'return time' },
  'vacation.field.agencyName': { en: 'Agency Name', beanie: 'agency name' },
  'vacation.field.agencyAddress': { en: 'Agency Address', beanie: 'agency address' },
  'vacation.addAnotherTransport': { en: 'Add Another Transport', beanie: 'add another transport' },

  // Step 5 - Ideas
  'vacation.step5.title': { en: 'Trip ideas!', beanie: 'beanie trip ideas!' },
  'vacation.step5.subtitle': {
    en: 'What do the beans want to see and do?',
    beanie: 'what do the beans want to see and do?',
  },
  'vacation.ideas.addPlaceholder': {
    en: 'Add an idea... what should we do?',
    beanie: 'add an idea... what should we do?',
  },
  'vacation.ideas.category.beach': { en: 'Beach', beanie: 'beach' },
  'vacation.ideas.category.activity': { en: 'Activity', beanie: 'activity' },
  'vacation.ideas.category.food': { en: 'Food', beanie: 'food' },
  'vacation.ideas.category.sightseeing': { en: 'Sightseeing', beanie: 'sightseeing' },
  'vacation.ideas.category.shopping': { en: 'Shopping', beanie: 'shopping' },
  'vacation.ideas.category.nightlife': { en: 'Nightlife', beanie: 'nightlife' },
  'vacation.ideas.category.other': { en: 'Other', beanie: 'other' },
  'vacation.ideas.estimatedCost': { en: 'Estimated Cost', beanie: 'estimated cost' },
  'vacation.ideas.free': { en: 'Free', beanie: 'free' },
  'vacation.ideas.paid': { en: 'Paid', beanie: 'paid' },
  'vacation.ideas.duration': { en: 'Duration', beanie: 'duration' },
  'vacation.ideas.needsBooking': { en: 'Needs Booking', beanie: 'needs booking' },
  'vacation.ideas.noBookingNeeded': { en: 'No Booking Needed', beanie: 'no booking needed' },
  'vacation.ideas.whosInterested': { en: "Who's Interested", beanie: "who's interested" },
  'vacation.ideas.votes': { en: 'Votes', beanie: 'votes' },
  'vacation.ideas.saveIdea': { en: 'Save Idea', beanie: 'save idea' },
  'vacation.ideas.descriptionPlaceholder': {
    en: "What's this idea about?",
    beanie: "what's this idea about?",
  },
  'vacation.ideas.category': { en: 'Category', beanie: 'category' },
  'vacation.ideas.whichDay': { en: 'Which Day?', beanie: 'which day?' },
  'vacation.ideas.bookingNeeded': { en: 'Booking Needed?', beanie: 'booking needed?' },
  'vacation.ideas.planned': { en: 'Status', beanie: 'status' },
  'vacation.ideas.plannedSection': { en: 'Planned', beanie: 'planned' },
  'vacation.ideas.addedBy': { en: 'Added by', beanie: 'added by' },

  // Segment statuses
  'vacation.status.booked': { en: 'Booked', beanie: 'booked' },
  'vacation.status.pending': { en: 'Pending', beanie: 'pending' },
  'vacation.status.not_booked': { en: 'Not Booked', beanie: 'not booked' },
  'vacation.status.researching': { en: 'Researching', beanie: 'researching' },

  // Wizard navigation
  'vacation.next': { en: 'Next', beanie: 'next' },
  'vacation.back': { en: 'Back', beanie: 'back' },
  'vacation.saveVacation': {
    en: 'Save Vacation!',
    beanie: 'save vacation!',
  },

  // Celebration
  'vacation.bonVoyage': { en: 'Bon Voyage, Beans!', beanie: 'bon voyage, beans!' },
  'vacation.savedMessage': {
    en: 'Your vacation is saved and ready to share with the family',
    beanie: 'your vacation is saved and ready to share with the family',
  },
  'vacation.daysUntil': { en: 'Days Until Takeoff', beanie: 'days until takeoff' },
  'vacation.celebration.trip': { en: 'Trip', beanie: 'trip' },
  'vacation.celebration.when': { en: 'When', beanie: 'when' },
  'vacation.celebration.who': { en: 'Who', beanie: 'who' },
  'vacation.celebration.booked': { en: 'Booked', beanie: 'booked' },
  'vacation.celebration.ideas': { en: 'Ideas', beanie: 'ideas' },
  'vacation.celebration.allBeans': { en: 'All Beans!', beanie: 'all beans!' },
  'vacation.celebration.going': { en: 'going', beanie: 'going' },
  'vacation.celebration.letsGo': { en: "Awesome, Let's Go!", beanie: "awesome, let's go!" },
  'vacation.celebration.daysToTakeoff': {
    en: 'days until takeoff!',
    beanie: 'days until takeoff!',
  },
  'vacation.celebration.todo': { en: 'To-Do', beanie: 'to-do' },
  'vacation.celebration.itemsNeedBooking': {
    en: 'items need booking',
    beanie: 'items need booking',
  },
  'vacation.celebration.onBucketList': {
    en: 'on the bucket list',
    beanie: 'on the bucket list',
  },

  // View modal
  'vacation.viewTitle': { en: 'Vacation Details', beanie: 'vacation details' },
  'vacation.timeline': { en: 'Your Trip Timeline', beanie: 'your trip timeline' },
  'vacation.timelineSortedBy': {
    en: 'Sorted by date \u2014 tap to copy \u2014 click fields to edit inline',
    beanie: 'sorted by date \u2014 tap to copy \u2014 click fields to edit inline',
  },
  'vacation.bucketList': { en: 'Trip Ideas!', beanie: 'breanie trip ideas!' },
  'vacation.editAll': { en: 'Edit Plans', beanie: 'edit plans' },
  'vacation.nightsNoAccommodation': {
    en: 'night(s) without accommodation',
    beanie: 'night(s) without accommodation',
  },
  'vacation.editInWizard': { en: 'Edit Plan', beanie: 'edit plan' },
  'vacation.editIdeas': { en: 'Edit Ideas', beanie: 'edit ideas' },
  'vacation.share': { en: 'Share', beanie: 'share' },
  'vacation.copied': { en: 'Copied!', beanie: 'copied!' },
  'vacation.progress': { en: 'Booked', beanie: 'booked' },
  'vacation.notBookedYet': {
    en: 'Not booked yet \u2014 we\u2019ll remind you later!',
    beanie: 'not booked yet \u2014 we\u2019ll remind you later!',
  },
  'vacation.stillDeciding': { en: 'Still deciding', beanie: 'still deciding' },

  // Sidebar
  'vacation.upcoming': { en: 'Upcoming Vacations', beanie: 'upcoming vacations' },
  'vacation.daysAway': { en: 'Days Away', beanie: 'days away' },
  'vacation.inProgress': { en: 'In Progress', beanie: 'in progress' },
  'vacation.itemsNeedBooking': {
    en: 'Items Need Booking',
    beanie: 'items need booking',
  },

  // Day agenda
  'vacation.dayContext': { en: 'Day', beanie: 'day' },
  'vacation.ofTrip': { en: 'of Trip', beanie: 'of trip' },

  // Duration options
  'vacation.duration.30min': { en: '30 Min', beanie: '30 min' },
  'vacation.duration.1hr': { en: '1 Hour', beanie: '1 hour' },
  'vacation.duration.2hrs': { en: '2 Hours', beanie: '2 hours' },
  'vacation.duration.half_day': { en: 'Half Day', beanie: 'half day' },
  'vacation.duration.full_day': { en: 'Full Day', beanie: 'full day' },

  // Schedule tab bar
  'vacation.scheduleRecurring': { en: 'Recurring', beanie: 'recurring' },
  'vacation.scheduleRecurringDesc': {
    en: 'Repeats weekly or monthly',
    beanie: 'repeats weekly or monthly',
  },
  'vacation.scheduleOneTime': { en: 'One-Time', beanie: 'one-time' },
  'vacation.scheduleOneTimeDesc': { en: 'Happens once', beanie: 'happens once' },

  // Segment type labels
  'vacation.segment.flight': { en: 'Flight', beanie: 'flight' },
  'vacation.segment.cruise': { en: 'Cruise', beanie: 'cruise' },
  'vacation.segment.train': { en: 'Train', beanie: 'train' },
  'vacation.segment.ferry': { en: 'Ferry', beanie: 'ferry' },
  'vacation.segment.activity': { en: 'Activity', beanie: 'activity' },
  'vacation.travel.addActivity': { en: 'Activity', beanie: 'activity' },
  'vacation.activityCategory.show_musical': { en: 'Show / Musical', beanie: 'show / musical' },
  'vacation.activityCategory.theme_park': { en: 'Theme Park', beanie: 'theme park' },
  'vacation.activityCategory.sporting_event': {
    en: 'Sporting Event',
    beanie: 'sporting event',
  },
  'vacation.activityCategory.concert': { en: 'Concert', beanie: 'concert' },
  'vacation.activityCategory.excursion': { en: 'Excursion / Tour', beanie: 'excursion / tour' },
  'vacation.activityCategory.other': { en: 'Other', beanie: 'other' },
  'vacation.field.activityCategory': {
    en: 'Activity Type',
    beanie: 'activity type',
  },
  'vacation.field.startTime': { en: 'Start Time', beanie: 'start time' },
  'vacation.field.duration': { en: 'Duration', beanie: 'duration' },

  // Ideas empty state
  'vacation.ideas.empty': {
    en: 'No ideas yet \u2014 add your first one above!',
    beanie: 'no ideas yet \u2014 add your first one above!',
  },

  // Notes placeholder
  'vacation.field.notesPlaceholder': { en: 'Add notes...', beanie: 'add notes...' },

  // Common vacation fields
  'vacation.field.description': { en: 'Description', beanie: 'description' },
  'vacation.field.location': { en: 'Location', beanie: 'location' },
  'vacation.field.link': { en: 'Link', beanie: 'link' },
  'vacation.field.notes': { en: 'Notes', beanie: 'notes' },
  'vacation.field.status': { en: 'Status', beanie: 'status' },
  'vacation.field.title': { en: 'Title', beanie: 'title' },
  'vacation.field.openInMaps': { en: 'Open in Google Maps', beanie: 'open in google maps' },

  // Delete
  'vacation.deleteTitle': { en: 'Delete Vacation?', beanie: 'delete vacation?' },
  'vacation.deleteMessage': {
    en: 'This will permanently remove this vacation and all its details.',
    beanie: 'this will permanently remove this vacation and all its details.',
  },
  'vacation.deleteSegmentTitle': { en: 'Delete This Item?', beanie: 'delete this item?' },
  'vacation.deleteSegmentMessage': {
    en: 'This will remove this item from your vacation plan.',
    beanie: 'this will remove this item from your vacation plan.',
  },
  // Travel Plans page
  'travel.title': { en: 'Travel Plans', beanie: 'travel plans' },
  'travel.subtitle': {
    en: 'where are the beans headed next?',
    beanie: 'where are the beans headed next?',
  },
  'travel.planATrip': { en: '+ Plan a Trip', beanie: '+ plan a trip' },
  'travel.empty': {
    en: 'No trips planned yet — time to start dreaming!',
    beanie: 'no trips planned yet — time to start dreaming!',
  },
  'travel.emptySubtitle': {
    en: 'Plan your next family adventure together.',
    beanie: 'plan your next family adventure together.',
  },
  'travel.pastTrips': { en: 'Past Trips', beanie: 'past trips' },
  'travel.daysUntil': { en: 'Days Until Takeoff', beanie: 'days until takeoff' },
  'travel.daysAgo': { en: 'Days Ago', beanie: 'days ago' },
  'travel.completed': { en: 'Completed', beanie: 'completed' },
  'travel.allTrips': { en: 'All Trips', beanie: 'all trips' },
  'travel.bookingProgress': { en: 'Booking Progress', beanie: 'booking progress' },
  'travel.needsBooking': { en: 'Needs Booking', beanie: 'needs booking' },
  'travel.editDetails': { en: 'Edit Details', beanie: 'edit details' },
  'travel.editTravelPlans': { en: 'Edit Travel Plans', beanie: 'edit travel plans' },
  'travel.addSegment': { en: '+ Add', beanie: '+ add' },
  'travel.countdown.fly_and_stay': { en: 'days until takeoff', beanie: 'days until takeoff' },
  'travel.countdown.cruise': { en: 'days until we set sail', beanie: 'days until we set sail' },
  'travel.countdown.road_trip': {
    en: 'days until we hit the road',
    beanie: 'days until we hit the road',
  },
  'travel.countdown.camping': { en: 'days until we rough it', beanie: 'days until we rough it' },
  'travel.countdown.adventure': {
    en: 'days until the adventure',
    beanie: 'days until the adventure',
  },
  'travel.countdown.combo': { en: 'days to go', beanie: 'days to go' },
  'travel.countdown.business': { en: 'days until your trip', beanie: 'days until your trip' },
  'travel.purpose.vacation': { en: 'Vacation', beanie: 'vacation' },
  'travel.purpose.business': { en: 'Business', beanie: 'business' },
  'travel.accommodationGap': {
    en: 'No accommodation booked for this night',
    beanie: 'no accommodation booked for this night',
  },
  'travel.hint': { en: 'Helpful Hint', beanie: 'helpful hint' },
  'travel.ideas': { en: 'Trip Ideas', beanie: 'beanie trip ideas' },
  'travel.ideasTeaser': { en: 'Ideas', beanie: 'ideas' },
  'travel.ideasTeaserHint': {
    en: 'View All Your Trip Ideas',
    beanie: 'view all your beanie trip ideas',
  },
  'travel.quickAddIdea': { en: 'Quick-add an idea...', beanie: 'quick-add an idea...' },
  'travel.timeline': { en: 'Timeline', beanie: 'timeline' },
  'travel.editSegment': { en: 'Edit Segment', beanie: 'edit segment' },
  'travel.editAccommodation': { en: 'Edit Accommodation', beanie: 'edit accommodation' },
  'travel.editTransportation': { en: 'Edit Transportation', beanie: 'edit transportation' },
} satisfies Record<string, StringEntry>;

/**
 * Plain English strings — unchanged shape, all existing imports continue to work.
 * Derived from STRING_DEFS at module load time.
 */
export const UI_STRINGS = Object.fromEntries(
  Object.entries(STRING_DEFS).map(([k, v]) => [k, v.en])
) as { [K in keyof typeof STRING_DEFS]: string };

/**
 * Beanie-themed overrides — only keys that have a beanie value.
 * Applied as a cosmetic overlay when language is English and beanie mode is on.
 * Never used as a source for translation.
 */
export const BEANIE_STRINGS = Object.fromEntries(
  Object.entries(STRING_DEFS)
    .filter(([, v]) => 'beanie' in v)
    .map(([k, v]) => [k, (v as { en: string; beanie: string }).beanie])
) as Partial<typeof UI_STRINGS>;

export type UIStringKey = keyof typeof STRING_DEFS;

/**
 * Get the English text for a UI string key.
 * This is the source text that gets translated.
 */
export function getSourceText(key: UIStringKey): string {
  return UI_STRINGS[key];
}

/**
 * Get all UI string keys.
 */
export function getAllKeys(): UIStringKey[] {
  return Object.keys(UI_STRINGS) as UIStringKey[];
}

/**
 * Get all UI strings as key-value pairs.
 */
export function getAllStrings(): Record<UIStringKey, string> {
  return { ...UI_STRINGS };
}

/**
 * Get the hash for a UI string key.
 * Hash is computed from the English text content.
 */
export function getStringHash(key: UIStringKey): string {
  return hashString(UI_STRINGS[key]);
}

/**
 * Get all UI string hashes.
 * Returns a map of key -> hash.
 */
export function getAllHashes(): Record<UIStringKey, string> {
  const hashes: Partial<Record<UIStringKey, string>> = {};
  for (const key of getAllKeys()) {
    hashes[key] = getStringHash(key);
  }
  return hashes as Record<UIStringKey, string>;
}

/**
 * Get UI strings with their hashes.
 * Returns array of { key, text, hash } objects.
 */
export function getAllStringsWithHashes(): Array<{ key: UIStringKey; text: string; hash: string }> {
  return getAllKeys().map((key) => ({
    key,
    text: UI_STRINGS[key],
    hash: getStringHash(key),
  }));
}

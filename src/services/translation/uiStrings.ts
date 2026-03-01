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

  // Common labels
  'common.totalAssets': { en: 'total assets', beanie: 'total assets' },
  'common.totalLiabilities': { en: 'total liabilities', beanie: 'total liabilities' },
  'common.totalValue': { en: 'total value', beanie: 'total value' },
  'common.netAssetValue': { en: 'net asset value', beanie: 'net asset value' },
  'common.appreciation': { en: 'appreciation', beanie: 'appreciation' },
  'common.depreciation': { en: 'depreciation', beanie: 'depreciation' },
  'common.assetLoans': { en: 'asset loans' },
  'common.loanOutstanding': { en: 'loan outstanding' },
  'common.purchaseValue': { en: 'purchase value', beanie: 'what you paid' },
  'common.currentValue': { en: 'current value', beanie: 'worth today' },
  'common.purchased': { en: 'purchased' },
  'common.save': { en: 'save' },
  'common.cancel': { en: 'cancel' },
  'common.delete': { en: 'delete' },
  'common.saving': { en: 'saving...', beanie: 'counting beans...' },
  'common.shared': { en: 'shared', beanie: 'everyone' },
  'common.all': { en: 'all' },
  'common.none': { en: 'none' },
  'common.family': { en: 'family', beanie: 'the pod' },

  // Modal shared labels
  'modal.selectCategory': { en: 'select a category' },
  'modal.selectSubcategory': { en: 'select a type' },
  'modal.selectTime': { en: 'select a time' },
  'modal.schedule': { en: 'schedule' },
  'modal.recurring': { en: 'recurring' },
  'modal.oneOff': { en: 'one-off' },
  'modal.oneTime': { en: 'one-time' },
  'modal.whichDays': { en: 'which days?' },
  'modal.howOften': { en: 'how often?' },
  'modal.customTime': { en: 'custom' },
  'modal.willShowOnCalendar': { en: 'will show on your calendar' },
  'modal.moneyIn': { en: 'money in' },
  'modal.moneyOut': { en: 'money out' },
  'modal.direction': { en: 'direction' },
  'modal.includeInNetWorth': { en: 'include in net worth' },
  'modal.includeInNetWorthDesc': { en: 'count this towards your family net worth' },
  'modal.linkToActivity': { en: 'link to activity' },
  'modal.selectActivity': { en: 'select an activity...' },
  'modal.noMoreActivities': { en: 'no activities yet' },
  'modal.parentBean': { en: 'parent bean', beanie: 'parent bean' },
  'modal.littleBean': { en: 'little bean', beanie: 'little bean' },
  'modal.bigBean': { en: 'big bean', beanie: 'big bean' },
  'modal.addToPod': { en: 'add to family', beanie: 'add to pod' },
  'modal.welcomeToPod': { en: 'welcome to the family!', beanie: 'welcome to the pod!' },
  'modal.moreDetails': { en: 'more details' },
  'modal.whatsTheActivity': { en: "what's the activity?" },
  'modal.whatNeedsDoing': { en: 'what needs doing?' },
  'modal.costPerSession': { en: 'cost' },
  'modal.whosGoing': { en: 'who?' },
  'modal.startTime': { en: 'start time' },
  'modal.endTime': { en: 'end time' },
  'modal.addActivity': { en: 'add activity', beanie: 'add activity' },
  'modal.saveActivity': { en: 'save activity' },
  'modal.addTask': { en: 'add task' },
  'modal.addToCalendar': { en: 'add to calendar' },
  'modal.saveTask': { en: 'save task' },
  'modal.addAccount': { en: 'add account', beanie: 'add account' },
  'modal.saveAccount': { en: 'save account' },
  'modal.addTransaction': { en: 'add transaction' },
  'modal.saveTransaction': { en: 'save transaction' },
  'modal.addGoal': { en: 'add goal', beanie: 'plant a goal' },
  'modal.saveGoal': { en: 'save goal' },
  'modal.addMember': { en: 'add member', beanie: 'add a bean' },
  'modal.saveMember': { en: 'save member' },
  'modal.accountName': { en: 'account name' },
  'modal.accountType': { en: 'account type' },
  'modal.balance': { en: 'current balance' },
  'modal.owner': { en: 'owner' },
  'modal.goalName': { en: 'goal name' },
  'modal.targetAmount': { en: 'target amount' },
  'modal.currentAmount': { en: 'current amount' },
  'modal.priority': { en: 'priority' },
  'modal.deadline': { en: 'deadline' },
  'modal.memberName': { en: 'name' },
  'modal.role': { en: 'role' },
  'modal.birthday': { en: 'birthday' },
  'modal.profileColor': { en: 'profile color' },
  'modal.permissions': { en: 'permissions' },
  'modal.canViewFinances': { en: 'can view finances' },
  'modal.canEditActivities': { en: 'can edit activities' },
  'modal.canManagePod': { en: 'can manage pod' },

  // Status labels
  'status.active': { en: 'active' },
  'status.inactive': { en: 'inactive', beanie: 'resting' },
  'status.excluded': { en: 'excluded' },
  'status.paused': { en: 'paused', beanie: 'snoozing' },
  'status.recurring': { en: 'recurring' },
  'status.completed': { en: 'completed', beanie: 'done!' },
  'status.overdue': { en: 'overdue' },

  // Navigation
  'nav.dashboard': { en: 'financial dashboard', beanie: 'finance corner' },
  'nav.accounts': { en: 'accounts', beanie: 'accounts' },
  'nav.transactions': { en: 'transactions', beanie: 'transactions' },
  'nav.assets': { en: 'assets', beanie: 'things' },
  'nav.goals': { en: 'goals', beanie: 'goals' },
  'nav.reports': { en: 'reports' },
  'nav.forecast': { en: 'forecast', beanie: 'finance forecast' },
  'nav.family': { en: 'family hub', beanie: 'my family' },
  'nav.settings': { en: 'settings', beanie: 'settings' },
  'nav.section.treehouse': { en: 'the treehouse', beanie: 'family treehouse' },
  'nav.section.piggyBank': { en: 'the piggy bank', beanie: 'piggy bank' },
  'nav.nook': { en: 'family dashboard', beanie: 'family nook' },
  'nav.planner': { en: 'family planner', beanie: 'our plans' },
  'nav.todo': { en: 'family to-do', beanie: 'to-do list' },
  'nav.overview': { en: 'overview', beanie: 'finance corner' },
  'nav.budgets': { en: 'budgets', beanie: 'budgets' },
  'nav.comingSoon': { en: 'soon!', beanie: 'soon!' },

  // Common actions
  'action.add': { en: 'add' },
  'action.edit': { en: 'edit' },
  'action.delete': { en: 'delete' },
  'action.save': { en: 'save' },
  'action.saveChanges': { en: 'save changes' },
  'action.cancel': { en: 'cancel' },
  'action.confirm': { en: 'confirm' },
  'action.close': { en: 'close' },
  'action.back': { en: 'back' },
  'action.change': { en: 'change' },
  'action.next': { en: 'next' },
  'action.submit': { en: 'submit' },
  'action.search': { en: 'search' },
  'action.filter': { en: 'filter' },
  'action.clear': { en: 'clear' },
  'action.refresh': { en: 'refresh' },
  'action.loading': { en: 'loading...', beanie: 'counting beans...' },
  'action.pause': { en: 'pause' },
  'action.resume': { en: 'resume' },
  'action.markCompleted': { en: 'mark as completed' },
  'action.export': { en: 'export' },
  'action.import': { en: 'import' },

  // Dashboard
  'dashboard.netWorth': { en: 'family net worth', beanie: 'alllllll your beans' },
  'dashboard.assets': { en: 'assets', beanie: 'your assets' },
  'dashboard.liabilities': { en: 'liabilities', beanie: 'beans owed' },
  'dashboard.monthlyIncome': { en: 'monthly income', beanie: 'beans coming in' },
  'dashboard.monthlyExpenses': { en: 'monthly expenses', beanie: 'beans going out' },
  'dashboard.netCashFlow': { en: 'net cash flow', beanie: 'net cash flow' },
  'dashboard.recentTransactions': { en: 'recent transactions', beanie: 'recent transactions' },
  'dashboard.upcomingTransactions': { en: 'upcoming transactions', beanie: 'coming up' },
  'dashboard.assetsSummary': { en: 'assets summary', beanie: 'assets summary' },
  'dashboard.activeGoals': { en: 'active goals', beanie: 'beanie goals' },
  'dashboard.noTransactions': {
    en: 'No transactions yet. Add your first transaction to get started.',
    beanie: 'Nothing yet — add your first one to get growing!',
  },
  'dashboard.noUpcoming': {
    en: 'No upcoming transactions in the next 30 days',
    beanie: 'No beans on the horizon for the next 30 days',
  },
  'dashboard.noAssets': {
    en: 'No assets yet. Add assets to track your property and valuables.',
    beanie: 'No big beans yet. Add your property and valuables to grow your patch.',
  },
  'dashboard.noGoals': {
    en: 'No active goals. Set a financial goal to track your progress.',
    beanie: 'No goals sprouting yet. Plant one and watch it grow!',
  },

  // Recurring
  'recurring.title': { en: 'recurring', beanie: 'recurring' },
  'recurring.items': { en: 'recurring items', beanie: 'recurring items' },
  'recurring.monthlyIncome': {
    en: 'monthly recurring income',
    beanie: 'beans coming in each month',
  },
  'recurring.monthlyExpenses': {
    en: 'monthly recurring expenses',
    beanie: 'beans going out each month',
  },
  'recurring.netMonthly': { en: 'monthly savings', beanie: 'beans saved each month' },
  'recurring.noItems': { en: 'No recurring items yet.', beanie: 'No recurring items yet.' },
  'recurring.getStarted': {
    en: 'Click "Add Recurring" to set up automatic transactions.',
    beanie: 'Click "Add Recurring" to plant some automatic moves.',
  },
  'recurring.addItem': { en: 'add recurring item', beanie: 'add recurring bean' },
  'recurring.editItem': { en: 'edit recurring item', beanie: 'edit recurring bean' },
  'recurring.deleteConfirm': {
    en: 'Are you sure you want to delete this recurring item? Existing transactions will not be affected.',
  },
  'recurring.next': { en: 'next' },
  'recurring.active': { en: 'active', beanie: 'active' },
  'recurring.paused': { en: 'paused', beanie: 'paused' },
  'recurring.pauseItem': { en: 'pause recurring', beanie: 'pause recurring' },
  'recurring.resumeItem': { en: 'resume recurring', beanie: 'resume recurring' },

  // Accounts
  'accounts.title': { en: 'accounts', beanie: 'bean jars' },
  'accounts.subtitle': {
    en: 'Manage your bank accounts and credit cards',
    beanie: 'Where your beans live',
  },
  'accounts.addAccount': { en: 'add account', beanie: 'add an account' },
  'accounts.editAccount': { en: 'edit account', beanie: 'edit an account' },
  'accounts.deleteAccount': { en: 'delete account', beanie: 'remove account' },
  'accounts.noAccounts': { en: 'no accounts yet', beanie: 'no accounts yet' },
  'accounts.getStarted': {
    en: 'Get started by adding your first account',
    beanie: 'Add your first bean jar to get growing!',
  },
  'accounts.totalBalance': { en: 'total balance', beanie: 'total beans' },
  'accounts.accountName': { en: 'account name', beanie: 'account name' },
  'accounts.accountType': { en: 'account type', beanie: 'account type' },
  'accounts.currentBalance': { en: 'current balance', beanie: 'beans today' },
  'accounts.type.checking': { en: 'checking account', beanie: 'checking account' },
  'accounts.type.savings': { en: 'savings account', beanie: 'savings account' },
  'accounts.type.credit_card': { en: 'credit card' },
  'accounts.type.investment': { en: 'investment account', beanie: 'investment account' },
  'accounts.type.crypto': { en: 'cryptocurrency', beanie: 'crypto account' },
  'accounts.type.cash': { en: 'cash', beanie: 'cash' },
  'accounts.type.loan': { en: 'loan', beanie: 'loan' },
  'accounts.type.other': { en: 'other' },
  'accounts.type.retirement_401k': { en: '401k' },
  'accounts.type.retirement_ira': { en: 'IRA' },
  'accounts.type.retirement_roth_ira': { en: 'roth ira' },
  'accounts.type.retirement_bene_ira': { en: 'bene ira' },
  'accounts.type.retirement_kids_ira': { en: 'kida ira' },
  'accounts.type.retirement': { en: 'retirement' },
  'accounts.type.education_529': { en: 'college fund (529)' },
  'accounts.type.education_savings': { en: 'education savings' },

  // Account categories & subtypes (used in AccountCategoryPicker)
  'accounts.cat.bank': { en: 'bank' },
  'accounts.cat.investment': { en: 'investment' },
  'accounts.cat.retirement': { en: 'retirement' },
  'accounts.cat.cash': { en: 'cash', beanie: 'cash' },
  'accounts.cat.loan': { en: 'loan', beanie: 'loan' },
  'accounts.cat.other': { en: 'other' },
  'accounts.subtype.savings': { en: 'savings' },
  'accounts.subtype.checking': { en: 'checking' },
  'accounts.subtype.creditCard': { en: 'credit card' },
  'accounts.subtype.brokerage': { en: 'brokerage' },
  'accounts.subtype.crypto': { en: 'crypto' },
  'accounts.subtype.retirement': { en: 'retirement' },
  'accounts.subtype.401k': { en: '401k' },
  'accounts.subtype.ira': { en: 'IRA' },
  'accounts.subtype.rothIra': { en: 'ROTH IRA' },
  'accounts.subtype.beneIra': { en: 'BENE IRA' },
  'accounts.subtype.kidsIra': { en: 'kids IRA' },
  'accounts.subtype.retirementGeneral': { en: 'retirement' },
  'accounts.subtype.education': { en: 'education' },
  'accounts.subtype.collegeFund529': { en: 'college fund (529)' },
  'accounts.subtype.educationSavings': { en: 'education savings' },
  'modal.accountOwner': { en: 'account owner' },

  'accounts.pageTitle': { en: 'our accounts', beanie: 'our bean jars' },
  'accounts.subtitleCounts': { en: '{members} members · {accounts} accounts' },
  'accounts.groupByMember': { en: 'member' },
  'accounts.groupByCategory': { en: 'category' },
  'accounts.addAnAccount': { en: 'add an account', beanie: 'add a bean jar' },
  'accounts.assetClass.cash': { en: 'cash' },
  'accounts.assetClass.investments': { en: 'investments' },
  'accounts.liabilityClass.creditCards': { en: 'credit cards' },
  'accounts.liabilityClass.loans': { en: 'loans' },

  // Transactions
  'transactions.title': { en: 'transactions', beanie: 'transaction' },
  'transactions.subtitle': {
    en: 'Track your income and expenses',
    beanie: 'Watch your beans come and go',
  },
  'transactions.addTransaction': { en: 'add transaction', beanie: 'add transaction' },
  'transactions.editTransaction': { en: 'edit transaction', beanie: 'edit transaction' },
  'transactions.deleteTransaction': { en: 'delete transaction', beanie: 'remove transaction' },
  'transactions.noTransactions': {
    en: 'No transactions recorded yet.',
    beanie: 'No bean moves recorded yet.',
  },
  'transactions.getStarted': {
    en: 'Click "Add Transaction" to get started.',
    beanie: 'Click "Add Bean Move" to start tracking.',
  },
  'transactions.allTransactions': { en: 'all transactions', beanie: 'all transactions' },
  'transactions.thisMonthIncome': { en: 'this month income', beanie: 'beans in this month' },
  'transactions.thisMonthExpenses': { en: 'this month expenses', beanie: 'beans out this month' },
  'transactions.netCashFlow': { en: 'net cash flow', beanie: 'net bean flow' },
  'transactions.oneTime': { en: 'one time transactions', beanie: 'one-off transaction' },
  'transactions.recurringTransactions': {
    en: 'recurring transactions',
    beanie: 'regular bean moves',
  },
  'transactions.addRecurring': { en: 'add recurring', beanie: 'add recurring' },
  'transactions.type.income': { en: 'income', beanie: 'income' },
  'transactions.type.expense': { en: 'expense', beanie: 'expense' },
  'transactions.type.transfer': { en: 'transfer', beanie: 'transfer' },

  // Assets
  'assets.title': { en: 'assets', beanie: 'big beans' },
  'assets.subtitle': {
    en: 'Track your property, vehicles, and valuables',
    beanie: 'Your biggest stuff — property, vehicles, and more',
  },
  'assets.addAsset': { en: 'add asset' },
  'assets.editAsset': { en: 'edit asset' },
  'assets.deleteAsset': { en: 'delete asset' },
  'assets.noAssets': { en: 'no assets yet', beanie: 'no stuff created yet' },
  'assets.getStarted': {
    en: 'Get started by adding your first asset',
    beanie: 'Add your first big bean!',
  },
  'assets.assetName': { en: 'asset name' },
  'assets.assetType': { en: 'asset type' },
  'assets.hasLoan': { en: 'this asset has a loan' },
  'assets.hasLoanDesc': { en: 'track mortgage, auto loan, or other financing' },
  'assets.loanDetails': { en: 'loan details' },
  'assets.originalLoanAmount': { en: 'original loan amount' },
  'assets.outstandingBalance': { en: 'outstanding balance' },
  'assets.interestRate': { en: 'interest rate (%)' },
  'assets.monthlyPayment': { en: 'monthly payment' },
  'assets.loanTerm': { en: 'loan term (months)' },
  'assets.lender': { en: 'lender' },
  'assets.loanStartDate': { en: 'loan start date' },
  'assets.purchaseDate': { en: 'purchase date' },
  'assets.type.real_estate': { en: 'real estate' },
  'assets.type.vehicle': { en: 'vehicle' },
  'assets.type.boat': { en: 'boat' },
  'assets.type.jewelry': { en: 'jewelry' },
  'assets.type.electronics': { en: 'electronics' },
  'assets.type.equipment': { en: 'equipment' },
  'assets.type.art': { en: 'art' },
  'assets.type.investment': { en: 'investment' },
  'assets.type.crypto': { en: 'cryptocurrency' },
  'assets.type.collectible': { en: 'collectible' },
  'assets.type.other': { en: 'other' },

  // Goals
  'goals.title': { en: 'goals', beanie: 'beanie goals' },
  'goals.subtitle': {
    en: 'Set and track your financial goals',
    beanie: 'Plant a goal and watch it grow',
  },
  'goals.addGoal': { en: 'add goal' },
  'goals.editGoal': { en: 'edit goal' },
  'goals.deleteGoal': { en: 'delete goal' },
  'goals.noGoals': { en: 'No goals set yet.', beanie: 'No goals planted yet.' },
  'goals.getStarted': {
    en: 'Click "Add Goal" to create your first financial goal.',
    beanie: 'Click "Add Goal" to plant your first bean dream!',
  },
  'goals.allGoals': { en: 'all goals' },
  'goals.activeGoals': { en: 'active goals', beanie: 'ongoing goals' },
  'goals.completedGoals': { en: 'completed goals', beanie: 'completed goals!' },
  'goals.overdueGoals': { en: 'overdue goals' },
  'goals.goalName': { en: 'goal name' },
  'goals.goalType': { en: 'goal type' },
  'goals.assignTo': { en: 'assign to' },
  'goals.familyWide': { en: 'family-wide goal', beanie: 'a goal for your whole pod' },
  'goals.deadlineOptional': { en: 'deadline (optional)' },
  'goals.type.savings': { en: 'savings', beanie: 'saving beans' },
  'goals.type.debt_payoff': { en: 'debt payoff' },
  'goals.type.investment': { en: 'investment' },
  'goals.type.purchase': { en: 'purchase', beanie: 'saving for' },
  'goals.priority.label': { en: 'priority' },
  'goals.priority.low': { en: 'low' },
  'goals.priority.medium': { en: 'medium' },
  'goals.priority.high': { en: 'high' },
  'goals.priority.critical': { en: 'critical' },
  'goals.progress': { en: 'progress', beanie: 'growth' },
  'goals.deadline': { en: 'deadline' },
  'goals.reopenGoal': { en: 'reopen goal', beanie: 'replant this beanie!' },
  'goals.noCompletedGoals': { en: 'No completed goals yet.', beanie: 'No goals completed yet.' },
  'goals.completedOn': { en: 'completed', beanie: 'done' },

  // Family
  'family.title': { en: 'family', beanie: 'the pod' },
  'family.addMember': { en: 'add member', beanie: 'add a beanie' },
  'family.editMember': { en: 'edit member', beanie: 'edit beanie' },
  'family.deleteMember': { en: 'delete member', beanie: 'remove beanie' },
  'family.noMembers': {
    en: 'No family members yet.',
    beanie: 'Your bean pod is empty — add your first beanie!',
  },
  'family.role.owner': { en: 'owner', beanie: 'head beanie' },
  'family.role.admin': { en: 'admin', beanie: 'admin beanie' },
  'family.role.member': { en: 'member', beanie: 'beanie' },
  'family.email': { en: 'email' },
  'family.gender': { en: 'gender' },
  'family.gender.male': { en: 'male', beanie: 'boy beanie' },
  'family.gender.female': { en: 'female', beanie: 'girl beanie' },
  'family.gender.other': { en: 'other' },
  'family.ageGroup': { en: 'age group' },
  'family.ageGroup.adult': { en: 'adult', beanie: 'big beanie' },
  'family.ageGroup.child': { en: 'child', beanie: 'little beanie' },
  'family.dateOfBirth': { en: 'date of birth', beanie: 'beanie birthday' },
  'family.dateOfBirth.month': { en: 'month' },
  'family.dateOfBirth.day': { en: 'day' },
  'family.dateOfBirth.year': { en: 'year (optional)' },
  'family.avatarPreview': { en: 'avatar preview', beanie: 'your beanie' },

  // Reports
  'reports.title': { en: 'reports', beanie: 'bean reports' },
  'reports.subtitle': {
    en: 'Visualize your financial data with charts and reports',
    beanie: 'See how your beanies are growing',
  },
  'reports.noData': {
    en: 'No data available for reports yet.',
    beanie: 'No beanies to make a report yet!',
  },
  'reports.familyMember': { en: 'family member' },
  'reports.netWorthOverTime': { en: 'net worth over time', beanie: 'net worth over time' },
  'reports.netWorthDescription': {
    en: 'Projected net worth based on current assets and recurring transactions',
    beanie: 'How your bean patch could grow',
  },
  'reports.currentNetWorth': { en: 'current net worth', beanie: 'net worth now' },
  'reports.projectedNetWorth': { en: 'projected net worth', beanie: 'net worth later' },
  'reports.projectedChange': { en: 'projected change' },
  'reports.incomeVsExpenses': { en: 'income vs expenses', beanie: 'beans in vs beans out' },
  'reports.incomeVsExpensesDescription': {
    en: 'Monthly breakdown of income and expenses by category',
    beanie: 'Monthly breakdown of beans coming in and going out',
  },
  'reports.totalIncome': { en: 'total income', beanie: 'total beans in' },
  'reports.totalExpenses': { en: 'total expenses', beanie: 'total beans out' },
  'reports.netCashFlow': { en: 'net cash flow', beanie: 'net bean flow' },

  // Forecast
  'forecast.title': { en: 'forecast', beanie: 'bean forecast' },
  'forecast.noData': {
    en: 'No data available for forecasting yet.',
    beanie: 'Plant some beans first — then we can forecast your harvest!',
  },
  'forecast.comingSoon': { en: 'coming soon to your bean patch' },
  'forecast.comingSoonDescription': {
    en: "We're growing something special. Financial forecasting will help you see where your beanies are headed.",
  },
  'forecast.feature.projections': { en: 'recurring transaction projections' },
  'forecast.feature.cashFlow': { en: 'cash flow forecast (3, 6, and 12 months)' },
  'forecast.feature.goals': { en: 'goal achievement projections' },
  'forecast.feature.scenarios': { en: '"What if" scenario simulation' },

  // Settings
  'settings.title': { en: 'settings' },
  'settings.subtitle': { en: 'configure your app preferences', beanie: 'tune your beanie patch' },
  'settings.general': { en: 'general' },
  'settings.baseCurrency': { en: 'base currency' },
  'settings.baseCurrencyHint': {
    en: 'Your primary currency for displaying totals and conversions',
  },
  'settings.displayCurrency': { en: 'display currency' },
  'settings.theme': { en: 'theme' },
  'settings.theme.light': { en: 'light' },
  'settings.theme.dark': { en: 'dark' },
  'settings.theme.system': { en: 'system' },
  'settings.themeHint': { en: 'choose your preferred color scheme' },
  'settings.language': { en: 'language' },
  'settings.beanieMode': { en: 'beanie mode' },
  'settings.beanieModeDescription': {
    en: 'Replace standard labels with friendly beanie-themed language',
  },
  'settings.beanieModeDisabled': { en: 'Beanie Mode is only available in English' },
  'settings.soundEffects': { en: 'sound effects' },
  'settings.soundEffectsDescription': { en: 'Play fun sounds for actions and celebrations' },
  'settings.sync': { en: 'sync' },
  'settings.fileSync': { en: 'file sync' },
  'settings.syncToFile': { en: 'sync to a file' },
  'settings.syncToFileDescription': {
    en: 'Save your data to a JSON file. Place it in Google Drive, Dropbox, or any synced folder for cloud backup.',
  },
  'settings.createNewSyncFile': { en: 'create new sync file' },
  'settings.loadFromExistingFile': { en: 'load from existing file' },
  'settings.syncEnabled': { en: 'sync enabled' },
  'settings.autoSync': { en: 'auto sync' },
  'settings.encryption': { en: 'encryption' },
  'settings.exchangeRates': { en: 'exchange rates' },
  'settings.aiInsights': { en: 'AI insights' },
  'settings.aiPoweredInsights': { en: 'AI-powered insights', beanie: 'bean advisor' },
  'settings.aiComingSoon': {
    en: 'Coming soon - Get personalized financial advice powered by AI',
    beanie: 'Coming soon — your very own bean advisor!',
  },
  'settings.dataManagement': { en: 'data management' },
  'settings.exportData': { en: 'export data', beanie: 'pack up your beans' },
  'settings.exportDataDescription': {
    en: 'Download all your data as a JSON file',
    beanie: 'Download all your beanies as a file',
  },
  'settings.clearAllData': { en: 'clear all data' },
  'settings.clearAllDataDescription': {
    en: 'Permanently delete all your data',
    beanie: 'Remove all your beanies from this device',
  },
  'settings.clearData': { en: 'clear data' },
  'settings.clearDataConfirmation': {
    en: 'Are you sure you want to delete all your data? This action cannot be undone.',
    beanie: 'This will clear ALL your beans. Are you really sure? This cannot be undone.',
  },
  'settings.yesDeleteEverything': {
    en: 'yes, delete everything',
    beanie: 'yes, clear my bean pod',
  },
  'settings.about': { en: 'about' },
  'settings.appName': { en: 'beanies.family' },
  'settings.version': { en: 'version 1.0.0 (MVP)' },
  'settings.appDescription': {
    en: 'A local-first, privacy-focused family finance application.',
    beanie: "A private, local-first home for your family's beanies.",
  },
  'settings.privacyNote': {
    en: 'Your data is encrypted and saved to a file you control. Nothing is stored on our servers — your financial data never leaves your device.',
    beanie:
      'Your beanies are fully encrypted and saved to a file only you control. They never leave your device.',
  },

  // Form labels
  'form.name': { en: 'name' },
  'form.email': { en: 'email' },
  'form.type': { en: 'type' },
  'form.amount': { en: 'amount' },
  'form.currency': { en: 'currency' },
  'form.balance': { en: 'balance' },
  'form.date': { en: 'date' },
  'form.category': { en: 'category' },
  'form.description': { en: 'description' },
  'form.account': { en: 'account' },
  'form.selectAccount': { en: 'select an account' },
  'form.fromAccount': { en: 'from account' },
  'form.toAccount': { en: 'to account' },
  'form.owner': { en: 'owner' },
  'form.institution': { en: 'financial institution', beanie: 'banks' },
  'form.country': { en: 'country' },
  'form.other': { en: 'other' },
  'form.searchInstitutions': { en: 'search institutions...', beanie: 'find your bank...' },
  'form.searchCountries': { en: 'search countries...' },
  'form.enterCustomName': { en: 'enter institution name' },
  'form.customBadge': { en: 'custom' },
  'form.frequency': { en: 'frequency' },
  'form.frequency.daily': { en: 'daily' },
  'form.frequency.weekly': { en: 'weekly' },
  'form.frequency.monthly': { en: 'monthly' },
  'form.frequency.yearly': { en: 'yearly' },
  'form.startDate': { en: 'start date' },
  'form.endDate': { en: 'end date' },
  'form.targetAmount': { en: 'target amount', beanie: 'target to reach' },
  'form.currentAmount': { en: 'current amount', beanie: 'beans so far' },
  'form.priority': { en: 'priority' },
  'form.notes': { en: 'notes' },
  'form.includeInNetWorth': {
    en: 'include in net worth',
    beanie: 'count this in my total net worth',
  },
  'form.isActive': { en: 'active' },
  'form.month': { en: 'month' },
  'form.required': { en: 'required' },

  // Validation messages
  'validation.required': { en: 'This field is required' },
  'validation.invalidEmail': { en: 'Please enter a valid email address' },
  'validation.invalidAmount': { en: 'Please enter a valid amount' },
  'validation.minLength': { en: 'Must be at least {min} characters' },

  // Confirmation dialogs
  'confirm.delete': {
    en: 'Are you sure you want to delete this item?',
    beanie: 'Remove this item for good?',
  },
  'confirm.deleteAccount': {
    en: 'Are you sure you want to delete this account? All associated transactions will also be deleted.',
    beanie: 'Remove this account? All the beans inside go with it.',
  },
  'confirm.deleteMember': {
    en: 'Are you sure you want to delete this family member?',
    beanie: 'Remove this beanie from your pod?',
  },
  'confirm.unsavedChanges': {
    en: 'You have unsaved changes. Are you sure you want to leave?',
    beanie: "You've got unsaved changes! Leave anyway?",
  },

  // Success messages
  'success.saved': { en: 'Changes saved successfully', beanie: 'Beanies saved!' },
  'success.created': { en: 'Created successfully', beanie: 'Beanie added!' },
  'success.deleted': { en: 'Deleted successfully', beanie: 'Gone!' },
  'success.updated': { en: 'Updated successfully', beanie: 'Beanies updated!' },

  // Error messages
  'error.generic': {
    en: 'Something went wrong. Please try again.',
    beanie: 'Hmm, a bean got stuck. Try again?',
  },
  'error.loadFailed': { en: 'Failed to load data', beanie: "Couldn't load your beanies" },
  'error.saveFailed': { en: 'Failed to save changes', beanie: "Hmm, couldn't save your beanies" },
  'error.deleteFailed': { en: 'Failed to delete', beanie: "Couldn't remove that beanie" },
  'error.networkError': {
    en: 'Network error. Please check your connection.',
    beanie: 'No connection — your beanies are still here though!',
  },

  // Not Found (404)
  'notFound.title': { en: 'not found' },
  'notFound.heading': { en: 'Oops! This bean got lost...' },
  'notFound.description': {
    en: "The page you're looking for has wandered off. Let's get you back to your beanies.",
  },
  'notFound.goHome': { en: 'back to dashboard' },

  // Empty states
  'empty.noData': { en: 'no data available', beanie: 'no beans here yet' },
  'empty.noResults': { en: 'no results found', beanie: 'no beans matched your search' },

  // Filter
  'filter.members': { en: 'members' },
  'filter.allMembers': { en: 'all members' },

  // Date/Time
  'date.today': { en: 'today' },
  'date.yesterday': { en: 'yesterday' },
  'date.thisWeek': { en: 'this week' },
  'date.thisMonth': { en: 'this month' },
  'date.thisYear': { en: 'this year' },
  'date.tomorrow': { en: 'tomorrow' },
  'date.days': { en: 'days' },
  'date.currentMonth': { en: 'current month' },
  'date.lastMonth': { en: 'last month' },
  'date.last3Months': { en: 'last 3 months' },
  'date.last6Months': { en: 'last 6 months' },
  'date.last12Months': { en: 'last 12 months' },
  'date.last2Years': { en: 'last 2 years' },
  'date.customRange': { en: 'custom range' },
  'date.allTime': { en: 'all time' },
  'date.previousMonth': { en: 'previous month' },

  // Months
  'month.january': { en: 'january' },
  'month.february': { en: 'february' },
  'month.march': { en: 'march' },
  'month.april': { en: 'april' },
  'month.may': { en: 'may' },
  'month.june': { en: 'june' },
  'month.july': { en: 'july' },
  'month.august': { en: 'august' },
  'month.september': { en: 'september' },
  'month.october': { en: 'october' },
  'month.november': { en: 'november' },
  'month.december': { en: 'december' },

  // Dashboard (additional)
  'dashboard.savingsGoals': { en: 'savings goals', beanie: 'your savings goals' },
  'dashboard.seeAll': { en: 'see all →' },
  'dashboard.yourBeans': { en: 'your family', beanie: 'your bean pod' },
  'dashboard.addBean': { en: 'add family member', beanie: 'add a beanie' },
  'dashboard.healthy': { en: 'healthy', beanie: 'growing strong' },
  'dashboard.savingsRate': { en: 'savings rate' },
  'dashboard.recurringSummary': { en: 'recurring summary', beanie: 'recurring summary' },
  'dashboard.netRecurring': { en: 'net recurring (monthly)', beanie: 'recurring (monthly)' },
  'dashboard.upcoming': { en: 'upcoming', beanie: 'coming up' },
  'dashboard.noRecurringItems': { en: 'no recurring items yet', beanie: 'no recurring beans yet' },
  'dashboard.roleParent': { en: 'parent', beanie: 'big bean' },
  'dashboard.roleLittleBean': { en: 'little bean' },
  'dashboard.chartHidden': { en: 'chart hidden' },
  'dashboard.noDataYet': { en: 'no data yet', beanie: 'no beans to chart yet' },

  // Greeting
  'greeting.morning': { en: 'good morning,' },
  'greeting.afternoon': { en: 'good afternoon,' },
  'greeting.evening': { en: 'good evening,' },

  // Header / Privacy
  'header.hideFinancialFigures': {
    en: 'hide financial figures',
    beanie: 'cover the beans',
  },
  'header.showFinancialFigures': {
    en: 'show financial figures',
    beanie: 'show the beans',
  },
  'header.financialFiguresVisible': { en: 'finances visible' },
  'header.financialFiguresHidden': { en: 'finances hidden' },
  'header.notifications': { en: 'notifications' },

  // Sidebar
  'sidebar.noDataFile': { en: 'no data file' },
  'sidebar.dataEncrypted': { en: 'data encrypted' },
  'sidebar.notEncrypted': { en: 'not encrypted' },
  'sidebar.noDataFileConfigured': { en: 'no data file configured' },
  'sidebar.dataEncryptedFull': { en: 'data encrypted (AES-256-GCM)' },
  'sidebar.dataFileNotEncrypted': { en: 'data file not encrypted' },

  // Transactions (additional)
  'transactions.showing': { en: 'showing:' },
  'transactions.income': { en: 'income', beanie: 'beans in' },
  'transactions.expenses': { en: 'expenses', beanie: 'beans out' },
  'transactions.net': { en: 'net' },
  'transactions.noTransactionsForPeriod': {
    en: 'No transactions found for this period',
    beanie: 'No transactions found for this period',
  },
  'transactions.tryDifferentRange': {
    en: 'Try selecting a different date range or add a new transaction.',
    beanie: 'Try a different date range or add a new transaction.',
  },
  'transactions.deleteConfirm': {
    en: 'Are you sure you want to delete this transaction?',
    beanie: 'Remove this transaction for good?',
  },
  'transactions.descriptionPlaceholder': {
    en: 'e.g., Grocery shopping',
  },
  'transactions.filterAll': { en: 'all', beanie: 'all beans' },
  'transactions.filterRecurring': { en: 'recurring', beanie: 'recurring' },
  'transactions.filterOneTime': { en: 'one-time', beanie: 'one-off' },
  'transactions.searchPlaceholder': {
    en: 'Search transactions...',
    beanie: 'Find a bean...',
  },
  'transactions.recurringCount': { en: 'recurring', beanie: 'recurring' },
  'transactions.oneTimeCount': { en: 'one-time', beanie: 'one-off' },
  'transactions.typeRecurring': { en: 'recurring', beanie: 'recurring' },
  'transactions.typeOneTime': { en: 'one-time', beanie: 'one-off' },
  'transactions.transactionCount': { en: 'transactions', beanie: 'beans' },
  'transactions.pageTitle': { en: 'all transactions', beanie: 'all beans' },
  'transactions.dayOfMonth': { en: 'day of month', beanie: 'day of month' },

  // Reports (additional)
  'reports.next3Months': { en: 'next 3 months' },
  'reports.next6Months': { en: 'next 6 months' },
  'reports.next1Year': { en: 'next 1 year' },
  'reports.next2Years': { en: 'next 2 years' },
  'reports.next5Years': { en: 'next 5 years' },
  'reports.next10Years': { en: 'next 10 years' },
  'reports.next15Years': { en: 'next 15 years' },
  'reports.next20Years': { en: 'next 20 years' },
  'reports.allFamilyMembers': { en: 'all family members' },
  'reports.allCategories': { en: 'all categories' },

  // Family (additional)
  'family.cannotDeleteOwner': { en: 'Cannot delete the owner account.' },
  'family.deleteConfirm': {
    en: 'Are you sure you want to remove this family member?',
    beanie: 'Remove this beanie from your pod?',
  },
  'family.editFamilyName': { en: 'edit family name' },
  'family.createLogin': { en: 'create login' },
  'family.enterName': { en: 'enter name' },
  'family.enterEmail': { en: 'enter email' },
  'family.emailNotSet': { en: 'no email yet' },
  'family.profileColor': { en: 'profile color' },
  'family.year': { en: 'year' },
  'family.status.waitingToJoin': {
    en: 'waiting to join',
    beanie: 'waiting to join',
  },
  'family.status.active': {
    en: 'active',
    beanie: 'active',
  },
  'family.lastSeen': { en: 'last seen {date}' },
  'family.neverLoggedIn': { en: 'never signed in' },
  'family.inviteMember': { en: 'invite {name}' },
  'family.linkCopied': {
    en: 'invite link copied!',
    beanie: 'magic bean link copied!',
  },
  'family.copyInviteLinkHint': {
    en: 'Copy and share your magic link with your family member',
    beanie: 'Copy the magic bean link for this beanie',
  },
  'family.inviteSection.title': {
    en: 'invite to join',
    beanie: 'invite this beanie',
  },
  'family.inviteSection.desc': {
    en: "This member hasn't joined yet. Share the link below so they can set up their account.",
    beanie: "This beanie hasn't joined yet! Share the magic link so they can join your pod.",
  },
  'family.inviteSection.step1': {
    en: 'Copy the invite link and send it to them',
    beanie: 'Copy the magic bean link and send it their way',
  },
  'family.inviteSection.step2': {
    en: 'They open the link and choose a password',
    beanie: 'They open the link and pick a secret password',
  },
  'family.inviteSection.step3': {
    en: "They're in! They can now sign in with their own account",
    beanie: "They're in! They can now sign into your family pod",
  },

  // Settings (additional)
  'settings.preferredCurrencies': { en: 'preferred currencies' },
  'settings.preferredCurrenciesHint': {
    en: 'Select up to 4 currencies to show in the header',
  },
  'settings.addCurrency': { en: 'add currency...' },
  'settings.familyDataOptions': { en: 'family data options' },
  'settings.familyDataDescription': {
    en: "Your family's financial data is encrypted and safely stored in a file you control.",
    beanie: 'Your beans are safe — encrypted and stored in a file only you control.',
  },
  'settings.saveDataToFile': { en: 'save your data to a file' },
  'settings.createOrLoadDataFile': {
    en: 'Create an encrypted data file or load an existing one.',
  },
  'settings.createNewDataFile': { en: 'create new family data file' },
  'settings.loadExistingDataFile': { en: 'load existing family data file' },
  'settings.loadFileConfirmation': {
    en: 'This will replace all local data with the contents of the selected file and set it as your data file. Continue?',
  },
  'settings.yesLoadFile': { en: 'yes, load file' },
  'settings.grantPermissionPrompt': {
    en: 'Click to grant permission to access your data file.',
  },
  'settings.grantPermission': { en: 'grant permission' },
  'settings.myFamilyData': { en: "my family's data" },
  'settings.saving': { en: 'saving...', beanie: 'saving beans...' },
  'settings.error': { en: 'error' },
  'settings.saved': { en: 'saved' },
  'settings.lastSaved': { en: 'last saved' },
  'settings.lastSyncNever': { en: 'never' },
  'settings.loadAnotherDataFile': { en: 'load another family data file' },
  'settings.switchDataFile': { en: 'switch to a different data file' },
  'settings.browse': { en: 'browse...' },
  'settings.switchFileConfirmation': {
    en: 'This will replace all local data with the contents of the selected file and switch to that file. Continue?',
  },
  'settings.dataLoadedSuccess': { en: 'data loaded successfully!' },
  'settings.encryptDataFile': { en: 'encrypt data file' },
  'settings.encrypted': { en: 'encrypted' },
  'settings.unencrypted': { en: 'unencrypted' },
  'settings.encryptionDescription': {
    en: 'Protect your data with password encryption',
    beanie: 'Lock your beans with a password',
  },
  'settings.disableEncryptionWarning': {
    en: 'Disabling encryption means your financial data will be stored as clear text and could be read by anyone with access to the file. Are you sure?',
  },
  'settings.yesDisableEncryption': { en: 'yes, disable encryption' },
  'settings.passwordNote': {
    en: "Note: You'll need to enter your password when you return to access your data.",
  },
  'settings.noAutoSyncWarning': {
    en: "Your browser doesn't support automatic file saving. Use manual export/import instead. For automatic saving, use Chrome or Edge.",
  },
  'settings.downloadYourData': { en: 'download your data' },
  'settings.downloadDataDescription': { en: 'download your data as a JSON file' },
  'settings.loadDataFile': { en: 'load data file' },
  'settings.loadDataFileDescription': { en: 'load data from a JSON file' },
  'settings.security': { en: 'security' },
  'settings.exportTranslationCache': { en: 'export translation cache' },
  'settings.exportTranslationCacheDescription': {
    en: 'Download cached translations as a JSON file to commit to the repository',
  },
  'settings.exportTranslations': { en: 'export translations' },

  // Password modal
  'password.setPassword': { en: 'set encryption password' },
  'password.setPasswordDescription': {
    en: "Choose a strong password to encrypt your data file. You'll need this password each time you open the app.",
  },
  'password.enableEncryption': { en: 'enable encryption' },
  'password.enterPassword': { en: 'enter password' },
  'password.enterPasswordDescription': {
    en: 'This file is encrypted. Enter your password to decrypt and load the data.',
  },
  'password.decryptAndLoad': { en: 'decrypt & load' },
  'password.encryptionError': { en: 'encryption error' },
  'password.password': { en: 'password' },
  'password.enterPasswordPlaceholder': { en: 'enter password' },
  'password.confirmPassword': { en: 'confirm password' },
  'password.confirmPasswordPlaceholder': { en: 'confirm password' },
  'password.required': { en: 'Password is required' },
  'password.mismatch': { en: 'Passwords do not match' },
  'password.decryptionError': { en: 'decryption error' },
  'password.setAndContinue': { en: 'set password & continue' },
  'password.strongPasswordDescription': {
    en: "Choose a strong password to protect your data file. You'll need this password each time you open the app.",
  },
  'password.encryptedFileDescription': {
    en: 'This file is encrypted. Enter your password to decrypt and load your data.',
  },

  // Setup (kept: keys used by CreatePodView.vue)
  'setup.yourName': { en: 'your name' },
  'setup.fileCreateFailed': {
    en: 'Failed to create file. Please try again.',
  },

  // Auth
  'auth.signingIn': { en: 'signing in...' },
  'auth.creatingAccount': { en: 'creating account...' },
  'auth.signOut': { en: 'sign out' },
  'auth.fillAllFields': { en: 'Please fill in all fields' },
  'auth.passwordsDoNotMatch': { en: 'Passwords do not match' },
  'auth.passwordMinLength': { en: 'Password must be at least 8 characters' },
  'auth.createPasswordPrompt': {
    en: 'Create a password for your account. You will use this to sign in next time.',
  },
  'auth.createPasswordPlaceholder': { en: 'Choose a password (min 8 characters)' },
  'auth.createAndSignIn': { en: 'create password & sign in' },
  'auth.familyName': { en: 'family name' },
  'auth.familyNamePlaceholder': { en: 'The Smith Family' },
  'auth.yourNamePlaceholder': { en: 'John Smith' },
  'auth.passwordPlaceholder': { en: 'at least 8 characters' },

  // Common actions (additional)
  'action.ok': { en: 'OK' },
  'action.continue': { en: 'continue' },
  'action.apply': { en: 'apply' },
  'action.download': { en: 'download' },
  'action.load': { en: 'load' },
  'action.seeAll': { en: 'see all' },
  'action.tryAgain': { en: 'try again' },

  // Confirmation dialog titles
  'confirm.deleteAccountTitle': { en: 'delete account', beanie: 'remove account' },
  'confirm.deleteTransactionTitle': { en: 'delete transaction', beanie: 'remove transaction' },
  'confirm.deleteRecurringTitle': { en: 'delete recurring item', beanie: 'remove recurring item' },
  'confirm.deleteAssetTitle': { en: 'delete asset', beanie: 'remove your asset' },
  'confirm.deleteGoalTitle': { en: 'delete goal', beanie: 'remove your goal' },
  'confirm.deleteMemberTitle': { en: 'remove family member', beanie: 'remove beanie' },
  'confirm.removePasskeyTitle': { en: 'remove passkey' },
  'confirm.cannotDeleteOwnerTitle': { en: 'cannot delete owner' },

  // Confirmation dialog messages
  'accounts.deleteConfirm': {
    en: 'Are you sure you want to delete this account?',
    beanie: 'Remove this bean jar for good?',
  },
  'assets.deleteConfirm': {
    en: 'Are you sure you want to delete this asset?',
    beanie: 'Remove this valuable bean?',
  },
  'goals.deleteConfirm': {
    en: 'Are you sure you want to delete this goal?',
    beanie: 'Remove this bean dream for good?',
  },
  'goals.deleteCompletedConfirm': {
    en: 'Are you sure you want to delete this completed goal?',
    beanie: 'Remove this finished bean dream?',
  },
  'passkey.removeConfirm': {
    en: 'Remove this passkey? You will no longer be able to sign in with it.',
  },

  // Passkey / biometric login
  'passkey.signInButton': { en: 'biometric sign in', beanie: 'beanie face sign in!' },
  'passkey.usePassword': { en: 'use password instead' },
  'passkey.authenticating': { en: 'verifying...' },
  'passkey.welcomeBack': { en: 'welcome back' },
  'passkey.promptTitle': { en: 'Unlock with your face or fingerprint?' },
  'passkey.promptDescription': {
    en: 'Next time you sign in, one tap is all it takes. No more typing passwords.',
  },
  'passkey.promptEnable': { en: 'enable biometric login' },
  'passkey.promptDecline': { en: 'not now' },
  'passkey.promptHint': { en: 'You can manage this in Settings at any time.' },
  'passkey.registerButton': { en: 'register new biometric' },
  'passkey.registerSuccess': { en: 'biometric login enabled!' },
  'passkey.registerError': { en: 'Failed to register biometric. Please try again.' },
  'passkey.signInError': { en: 'Biometric sign-in failed. Please try with your password.' },
  'passkey.crossDeviceNoCache': {
    en: 'This biometric was synced from another device. Sign in with your password once to enable it here.',
  },
  'passkey.wrongFamilyError': {
    en: 'This biometric does not belong to the current family. Please try again.',
  },
  'passkey.dekStale': {
    en: 'Your encryption key has changed since biometric was set up. Please sign in with your password and re-register biometric in Settings.',
  },
  'passkey.dekAndPasswordFailed': {
    en: 'Your encryption password has changed. Please sign in with your password and re-register biometric in Settings.',
  },
  'passkey.passwordChanged': {
    en: 'Your encryption password has changed since biometric was set up. Please sign in with your password and re-register biometric in Settings.',
  },
  'passkey.fileLoadError': {
    en: 'Could not load your data file. Please sign in with your password.',
  },
  'passkey.prfFull': { en: 'full unlock' },
  'passkey.prfCached': { en: 'cached password' },
  'passkey.lastUsed': { en: 'last used' },
  'passkey.neverUsed': { en: 'never used' },
  'passkey.noAuthenticator': {
    en: 'No biometric authenticator detected on this device.',
  },
  'passkey.registeredPasskeys': { en: 'registered biometrics' },
  'passkey.settingsTitle': { en: 'biometric login' },
  'passkey.settingsDescription': {
    en: 'Sign in with your fingerprint, face, or device PIN instead of a password.',
  },
  'passkey.enterEncryptionPassword': { en: 'enter your encryption password to register' },
  'passkey.noPasskeys': { en: 'No biometric logins registered yet.' },
  'passkey.unsupported': { en: 'Your browser does not support biometric login (WebAuthn).' },
  'passkey.needsEncryption': {
    en: 'Biometric login requires file encryption to be enabled.',
  },
  'passkey.rename': { en: 'rename' },
  'passkey.renameLabel': { en: 'device name' },

  // Trusted device
  'trust.title': { en: 'Do you trust this device?' },
  'trust.description': {
    en: 'If this is a trusted device (i.e. your personal phone or laptop), you can keep your data cached locally for instant access next time you sign in.',
  },
  'trust.trustButton': { en: 'yes, I trust this device' },
  'trust.notNow': { en: 'not now' },
  'trust.hint': {
    en: 'You can change this in Settings. Use "Sign Out / Clear Data" to remove cached data.',
  },
  'trust.settingsLabel': { en: 'trusted device' },
  'trust.settingsDesc': {
    en: 'Keep data cached locally (unecrypted) between sign-ins for faster access',
  },
  'auth.signOutClearData': { en: 'sign out & clear data' },

  // File-based auth
  'auth.selectMember': { en: 'select your profile' },
  'auth.enterPassword': { en: 'Please enter your password' },
  'auth.loadingFile': { en: 'counting beans...', beanie: 'counting beans...' },
  'auth.reconnectFile': {
    en: 'Your data file was found but needs permission to access. Click below to reconnect.',
  },
  'auth.reconnectButton': { en: 'reconnect to data file' },
  'auth.noMembersWithPassword': {
    en: 'No members have set a password yet. Please complete onboarding first.',
  },
  'auth.fileLoadFailed': { en: 'Failed to load file. Please try again.' },
  'auth.fileNotEncryptedWarning': {
    en: 'This data file is not encrypted. Anyone with access to the file can view your family data. You can enable encryption in Settings.',
  },
  'auth.password': { en: 'password' },
  'auth.enterYourPassword': { en: 'enter your password' },
  'auth.signInFailed': { en: 'sign in failed' },
  'auth.signUpFailed': { en: 'sign up failed' },
  'auth.createPassword': { en: 'create a password' },
  'auth.confirmPassword': { en: 'confirm password' },
  'auth.confirmPasswordPlaceholder': { en: 're-enter your password' },

  // Login — Page titles
  'login.welcome': { en: 'welcome' },
  'login.title': { en: 'login' },
  'join.title': { en: 'join family', beanie: 'join the pod' },

  // Login — Invite / Join
  'login.inviteAsParent': { en: 'parent', beanie: 'big bean' },
  'login.inviteAsChild': { en: 'child', beanie: 'little bean' },
  'login.inviteRoleLabel': { en: 'inviting as' },
  'login.familyCodePlaceholder': { en: 'enter the code from your family' },
  'login.inviteTitle': { en: 'invite family member', beanie: 'invite your beanies' },
  'login.inviteDesc': {
    en: 'Share this code with family members so they can join your pod',
  },
  'login.inviteCode': { en: 'family code' },
  'login.inviteLink': { en: 'or share this link' },
  'login.copied': { en: 'copied!' },
  'login.copyCode': { en: 'copy code' },
  'login.copyLink': { en: 'copy link' },

  // Login v6 redesign
  'loginV6.badgeEncrypted': { en: 'end-to-end encrypted' },
  'loginV6.badgeSecurity': { en: 'bank-grade security' },
  'loginV6.badgeLove': { en: 'built with love' },
  'loginV6.badgeZeroServers': { en: 'zero data on our servers' },
  'loginV6.welcomePrompt': { en: 'what would you like to do?' },
  'loginV6.signInTitle': { en: 'sign in', beanie: 'sign in to your bean pod' },
  'loginV6.signInSubtitle': { en: 'load your family data file' },
  'loginV6.createTitle': { en: 'create a new pod!', beanie: 'start a new bean pod!' },
  'loginV6.createSubtitle': {
    en: "start your family's financial journey",
    beanie: 'plant your first bean!',
  },
  'loginV6.joinTitle': { en: 'join an existing pod' },
  'loginV6.joinSubtitle': {
    en: 'your family is waiting for you',
    beanie: 'your family pod is waiting for you!',
  },
  'loginV6.loadPodTitle': { en: 'load your pod' },
  'loginV6.loadPodSubtitle': { en: 'your data stays on your device — always' },
  'loginV6.dropZoneText': { en: 'drop your .beanpod file here' },
  'loginV6.dropZoneBrowse': { en: 'or click to browse' },
  'loginV6.cloudComingSoon': { en: 'coming soon' },
  'loginV6.securityYourData': { en: 'your data, your cloud' },
  'loginV6.securityEncrypted': { en: 'AES-256 encrypted' },
  'loginV6.securityZeroServers': { en: 'zero servers, zero tracking' },
  'loginV6.fileLoaded': { en: 'loaded' },
  'loginV6.unlockTitle': { en: 'unlock your pod' },
  'loginV6.unlockSubtitle': { en: 'enter your pod password to decrypt your family data' },
  'loginV6.unlockButton': { en: 'unlock your pod' },
  'loginV6.unlockFooter': {
    en: "This password decrypts your local data. We don't store or recover it.",
  },
  // Family picker view
  'familyPicker.title': { en: 'which family?', beanie: 'which beanies?' },
  'familyPicker.subtitle': { en: 'choose a family to sign into', beanie: 'pick your pod of beans' },
  'familyPicker.loadDifferent': { en: 'load a different file' },
  'familyPicker.noFamilies': { en: 'no families found on this device' },
  'familyPicker.loadFile': { en: 'load a family data file' },
  'familyPicker.providerLocal': { en: 'local file' },
  'familyPicker.providerDrive': { en: 'Google Drive' },
  'familyPicker.loadError': { en: "Couldn't load your file — please locate it again" },

  // Fast login (single-family auto-select)
  'fastLogin.notYou': { en: 'not you? switch account' },
  'fastLogin.welcomeBack': { en: 'welcome back' },
  'fastLogin.welcomeBackName': { en: 'welcome back, {name}!' },
  'fastLogin.loadErrorLocal': {
    en: "We looked everywhere but can't find your file — please select it again",
  },
  'fastLogin.loadErrorDrive': {
    en: 'Your Google Drive credentials may have expired — please sign in again',
  },
  'loginV6.pickBeanTitle': { en: "who's signing in?", beanie: 'which beanie are you?' },
  'loginV6.pickBeanSubtitle': { en: 'pick your bean' },
  'loginV6.parentBean': { en: 'parent / adult', beanie: 'big beanie' },
  'loginV6.littleBean': { en: 'child', beanie: 'little beanie' },
  'loginV6.setupNeeded': { en: 'set up' },
  'loginV6.signInAs': { en: 'sign in as' },
  'loginV6.createStep1': { en: 'you' },
  'loginV6.createStep2': { en: 'save & secure' },
  'loginV6.createStep3': { en: 'family' },
  'loginV6.createNext': { en: 'next' },
  'loginV6.createButton': { en: 'create pod' },
  'loginV6.alreadyHavePod': { en: 'already have a pod?' },
  'loginV6.loadItLink': { en: 'load it' },
  'loginV6.passwordHint': { en: 'this encrypts your data file' },
  'loginV6.storageTitle': { en: 'where should we save your pod?' },
  'loginV6.storageLocal': { en: 'local file' },
  'loginV6.storageLocalDesc': { en: 'save a .beanpod file to your device' },
  'loginV6.addBeansTitle': { en: 'add your family members', beanie: 'add your beanies' },
  'loginV6.addBeansSubtitle': {
    en: 'you can always add more later',
    beanie: 'more beans can join later!',
  },
  'loginV6.addMember': { en: 'add member', beanie: 'add beanie' },
  'loginV6.finish': { en: 'finish' },
  'loginV6.skip': { en: 'skip for now' },
  'loginV6.joinInput': { en: 'family code or magic link' },
  'loginV6.whatsNext': { en: 'what happens next?' },
  'loginV6.joinStep1': { en: "We'll verify your family and load the data file" },
  'loginV6.joinStep2': { en: "You'll pick your profile and create a password" },
  'loginV6.joinStep3': { en: "Then you're in!", beanie: "Then you're a beanie!" },
  'loginV6.joinButton': { en: "join my family's pod", beanie: 'join your pod!' },
  'loginV6.joinNotAvailable': {
    en: 'Joining a pod isn\'t available yet. Ask your family to share their .beanpod file with you and use "Sign in to your pod" instead.',
  },
  'loginV6.wantYourOwn': { en: 'want your own?' },
  'loginV6.createLink': { en: 'create a new pod' },
  'loginV6.acceptsBeanpod': { en: 'accepts .beanpod files' },
  'loginV6.recommended': { en: 'recommended' },
  'loginV6.googleDriveCardDesc': { en: 'load from your cloud storage' },
  'loginV6.dropboxCardDesc': { en: 'sync with Dropbox' },
  'loginV6.iCloudCardDesc': { en: 'sync with iCloud' },
  'loginV6.localFileCardDesc': { en: 'open a .beanpod from your device' },
  'loginV6.securityYourDataDesc': {
    en: 'Your pod file lives in your cloud storage. We never see it.',
  },
  'loginV6.securityEncryptedDesc': {
    en: 'Military-grade AES-256 encryption protects your data.',
  },
  'loginV6.securityZeroServersDesc': {
    en: 'No servers, no tracking, no data collection.',
  },
  'loginV6.pickBeanInfoText': {
    en: 'Onboarded beans can sign in with their password. New beans need to create a password first.',
  },
  'loginV6.growPodTitle': { en: 'grow a brand-new pod' },
  'loginV6.growPodSubtitle': {
    en: 'Name your family pod and create your sign-in password.',
  },
  'loginV6.encryptionPasswordLabel': { en: 'pod data file encryption password' },
  'loginV6.signInPasswordLabel': { en: 'your sign-in password' },
  'loginV6.signInPasswordHint': {
    en: "You'll use this password to sign into your bean profile",
  },
  'loginV6.storageDescription': {
    en: "We don't store your data on any server or database \u2014 your family's finances stay entirely in your hands. Choose where your encrypted .beanpod file lives, and only you hold the key.",
  },
  'loginV6.storageSectionLabel': { en: 'where should we save your pod?' },
  'loginV6.step2Title': { en: 'save & secure your pod' },
  'loginV6.step2Subtitle': {
    en: 'Choose where to store your encrypted data file and set a password to protect it.',
  },
  'loginV6.podPasswordOptional': {
    en: 'Optional \u2014 you can enable encryption later in Settings',
  },
  'loginV6.confirmPodPassword': { en: 'confirm pod password' },
  'loginV6.addMemberFailed': { en: 'Failed to add member. Please try again.' },
  'loginV6.removeMember': { en: 'remove' },
  'loginV6.you': { en: 'you' },

  // Join flow (magic link invites)
  'join.verifyTitle': { en: 'join your family', beanie: 'join your family pod!' },
  'join.verifySubtitle': { en: "Let's find your family" },
  'join.lookingUp': { en: 'looking up your family...', beanie: 'finding your pod...' },
  'join.familyFound': { en: 'family found!', beanie: 'found your pod!' },
  'join.familyNotFound': {
    en: 'Family not found. Check the code and try again.',
    beanie: 'Your family pod could not be found. Check the code and try again.',
  },
  'join.registryOffline': {
    en: "We couldn't reach the registry. You can still join by loading the shared file directly.",
  },
  'join.needsFile': {
    en: 'You need the family data file',
    beanie: 'You need the family pod data file',
  },
  'join.needsFileDesc': {
    en: 'Ask the owner to share the .beanpod file with you via email, a shared cloud folder, or USB.',
  },
  'join.expectedFile': { en: 'look for a file named:' },
  'join.fileMismatch': {
    en: 'This file belongs to a different family. Please load the correct file.',
    beanie: 'This file belongs to a different pod. Please load the correct file.',
  },
  'join.loadFileButton': { en: 'load .beanpod file' },
  'join.dropZoneText': { en: 'drop the shared .beanpod file here' },
  'join.pickMemberTitle': { en: 'which one is you?', beanie: 'pick your bean!' },
  'join.pickMemberSubtitle': { en: 'select the profile created for you' },
  'join.noUnclaimedMembers': {
    en: 'No unclaimed profiles found. Ask the family owner to create your profile first.',
    beanie: 'No unclaimed beanies found. Ask your pod owner to create your profile first.',
  },
  'join.setPasswordTitle': { en: 'create your password' },
  'join.setPasswordSubtitle': { en: 'this password is just for you to sign in' },
  'join.completing': { en: 'joining your family...', beanie: 'joining your beanies...' },
  'join.success': { en: 'welcome to the family!', beanie: 'welcome to your pod!' },
  'join.shareFileNote': {
    en: 'Important: also share the .beanpod file with them (email, cloud folder, or USB)',
  },
  'join.shareFileNoteCloud': {
    en: 'Your family member will be prompted to sign in with Google to access the shared file automatically.',
  },
  'join.cloudLoadFailed': {
    en: "Couldn't load the file from cloud storage. You can load it manually below.",
  },
  'join.loadingFromCloud': {
    en: 'Loading family data from Google Drive...',
    beanie: 'Fetching your beans from the cloud...',
  },
  'join.enterCodeManually': { en: 'or enter a family code manually' },
  'join.codeInputLabel': { en: 'family code' },
  'join.codeInputHint': {
    en: 'Paste the family code or invite link shared by your family member',
    beanie: 'Paste the family pod code or invite link shared by your family member',
  },
  'join.next': { en: 'next' },

  // PWA / Offline / Install
  'pwa.offlineBanner': {
    en: "You're offline — changes are saved locally",
    beanie: "You're offline — beans are safe in the pod",
  },
  'pwa.installTitle': { en: 'install beanies.family', beanie: 'install beanies.family' },
  'pwa.installDescription': {
    en: 'Add to your home screen for the best experience',
    beanie: 'Plant the app on your home screen',
  },
  'pwa.installButton': { en: 'install', beanie: 'plant it!' },
  'pwa.installDismiss': { en: 'not now' },
  'pwa.updateAvailable': {
    en: 'A new version is available',
    beanie: 'A new version is available!',
  },
  'pwa.updateButton': { en: 'update now', beanie: 'gimme fresh beans!' },
  'pwa.updateDismiss': { en: 'later', beanie: 'later' },
  'settings.installApp': { en: 'install app', beanie: 'install app' },
  'settings.installAppDesc': {
    en: 'Install beanies.family on this device for quick access',
    beanie: 'install beanies.family app!',
  },
  'settings.installAppButton': { en: 'install beanies.family' },
  'settings.appInstalled': { en: 'app is installed', beanie: 'your beanies are installed!' },

  // Family To-Do
  'todo.title': { en: 'to-do list', beanie: 'our to-do list' },
  'todo.subtitle': {
    en: 'Keep track of tasks for the whole family',
    beanie: 'What are your beanies busy with today?',
  },
  'todo.newTask': { en: 'new task', beanie: 'new task' },
  'todo.quickAddPlaceholder': {
    en: 'What needs to be done?',
    beanie: 'what needs doing, my bean?',
  },
  'todo.editTask': { en: 'edit task' },
  'todo.deleteTask': { en: 'delete task' },
  'todo.deleteConfirm': {
    en: 'Are you sure you want to delete this task?',
    beanie: 'Remove this task for good?',
  },
  'todo.noTodos': { en: 'no tasks yet', beanie: 'no tasks yet' },
  'todo.getStarted': {
    en: 'Add your first task to get started!',
    beanie: 'Add a task to get your beans moving!',
  },
  'todo.filter.all': { en: 'all' },
  'todo.filter.open': { en: 'open' },
  'todo.filter.done': { en: 'done' },
  'todo.filter.scheduled': { en: 'scheduled' },
  'todo.filter.noDate': { en: 'no date' },
  'todo.sort.newest': { en: 'newest first' },
  'todo.sort.oldest': { en: 'oldest first' },
  'todo.sort.dueDate': { en: 'due date' },
  'todo.section.open': { en: 'open tasks' },
  'todo.section.completed': { en: 'completed' },
  'todo.assignTo': { en: 'assign to' },
  'todo.unassigned': { en: 'unassigned' },
  'todo.allBeans': { en: 'all beans', beanie: 'all beans' },
  'todo.dueDate': { en: 'due date' },
  'todo.dueTime': { en: 'time' },
  'todo.description': { en: 'description' },
  'todo.onCalendar': { en: 'on calendar' },
  'todo.doneBy': { en: 'done by' },
  'todo.undo': { en: 'undo' },
  'todo.taskTitle': { en: 'task title' },
  'todo.viewTask': { en: 'task details' },
  'todo.noDescription': { en: 'no description' },
  'todo.createdBy': { en: 'created by' },
  'todo.status': { en: 'status' },
  'todo.status.open': { en: 'open' },
  'todo.status.completed': { en: 'completed' },
  'todo.noDueDate': { en: 'no due date' },
  'todo.noDateSet': { en: 'no date set' },
  'todo.addedToday': { en: 'added today' },
  'todo.addedYesterday': { en: 'added yesterday' },
  'todo.addedDaysAgo': { en: 'added {days} days ago' },
  'todo.sortLabel': { en: 'sort:' },
  'todo.overdue': { en: 'overdue', beanie: 'overdue!' },
  'confirm.deleteTodoTitle': { en: 'delete task', beanie: 'remove task' },
  'confirm.deleteLocalFamilyTitle': { en: 'delete local family data' },
  'confirm.deleteLocalFamily': {
    en: 'This will permanently remove all data, passkeys, and settings for this family from this device. The original file is not affected. This cannot be undone.',
  },

  // Celebrations
  'celebration.setupComplete': {
    en: 'Setup complete — ready to start counting!',
    beanie: 'Setup complete — ready to start counting your beans!',
  },
  'celebration.firstAccount': {
    en: 'Your first account is set up!',
    beanie: 'Nice! Your first bean is planted!',
  },
  'celebration.firstTransaction': {
    en: 'Every transaction counts!',
    beanie: 'Yes! Every beanie counts!',
  },
  'celebration.goalReached': {
    en: 'Task complete! Well done!',
    beanie: 'Task complete! The beanies are proud!',
  },
  'celebration.firstSave': {
    en: 'Your data is safe and encrypted',
    beanie: 'All your beans are safely encrypted!',
  },
  'celebration.debtFree': {
    en: 'Debt-free! Time to celebrate!',
    beanie: 'Debt-free! The beanies are celebrating!',
  },

  // Family Nook
  'nook.welcomeHome': { en: 'welcome home, {name}', beanie: 'welcome to your nook, {name}' },
  'nook.familyAtAGlance': {
    en: 'your family at a glance',
    beanie: 'your bean pod at a glance',
  },
  'nook.statusGreatWeek': {
    en: "Everyone's having a great week!",
    beanie: 'The beanies are thriving!',
  },
  'nook.statusSummary': {
    en: '{tasks} completed \u00B7 {milestones} approaching',
    beanie: '{tasks} beans counted \u00B7 {milestones} goals sprouting',
  },
  'nook.yourBeans': { en: 'your beans', beanie: 'your bean pod' },
  'nook.addBean': { en: 'add bean', beanie: 'add a beanie' },
  'nook.todaySchedule': { en: "today's schedule", beanie: "today's beanie schedule" },
  'nook.thisWeek': { en: 'this week', beanie: 'this week' },
  'nook.fullCalendar': { en: 'full calendar', beanie: 'full calendar' },
  'nook.familyTodo': { en: 'family to-do', beanie: 'beanie to-do' },
  'nook.openCount': { en: '{count} open', beanie: '{count} open' },
  'nook.viewAll': { en: 'view all', beanie: 'view all' },
  'nook.moretasks': { en: 'more tasks', beanie: 'more beans to count' },
  'nook.addTaskPlaceholder': {
    en: 'Add a task for the family...',
    beanie: 'Add a task for the beanies...',
  },
  'nook.milestones': { en: 'family milestones', beanie: 'beanie milestones' },
  'nook.upcoming': { en: 'upcoming', beanie: 'sprouting soon' },
  'nook.daysAway': { en: '{days} days away', beanie: '{days} sleeps away' },
  'nook.completedRecently': { en: 'completed recently!', beanie: 'beans counted!' },
  'nook.piggyBank': { en: 'the piggy bank', beanie: 'the piggy bank' },
  'nook.familyNetWorth': { en: 'family net worth', beanie: 'alllllll your beans' },
  'nook.thisMonth': { en: 'this month', beanie: 'this moon' },
  'nook.monthlyBudget': { en: 'monthly budget', beanie: 'monthly bean budget' },
  'nook.openPiggyBank': { en: 'open the piggy bank', beanie: 'open the piggy bank' },
  'nook.recentActivity': { en: 'recent family activity', beanie: 'recent beanie activity' },
  'nook.seeAll': { en: 'see all', beanie: 'see all' },
  'nook.noEvents': { en: 'no events scheduled', beanie: 'no beans on the calendar' },
  'nook.comingSoon': { en: 'coming soon', beanie: 'coming soon' },
  'nook.noMilestones': { en: 'no milestones yet', beanie: 'no milestones yet' },
  'nook.noActivity': { en: 'no recent activity', beanie: 'the beanies are resting' },
  'nook.birthday': { en: "{name}'s Birthday", beanie: "{name}'s Bean Day" },
  'nook.taskCompleted': { en: 'completed a task', beanie: 'counted a bean' },
  'nook.spent': { en: 'spent', beanie: 'spent' },
  'nook.received': { en: 'received', beanie: 'received' },

  // Mobile navigation
  'mobile.nook': { en: 'nook', beanie: 'nook' },
  'mobile.planner': { en: 'planner', beanie: 'planner' },
  'mobile.piggyBank': { en: 'piggy bank', beanie: 'piggy bank' },
  'mobile.budget': { en: 'budget', beanie: 'budget' },
  'mobile.pod': { en: 'family', beanie: 'your pod' },
  'mobile.menu': { en: 'menu' },
  'mobile.closeMenu': { en: 'close menu' },
  'mobile.navigation': { en: 'navigation' },
  'mobile.controls': { en: 'controls' },
  'mobile.viewingAll': { en: 'viewing: all members' },

  // Google Drive integration
  'googleDrive.connecting': { en: 'connecting to Google Drive...' },
  'googleDrive.connected': { en: 'connected to Google Drive' },
  'googleDrive.disconnect': { en: 'disconnect Google Drive' },
  'googleDrive.selectFile': { en: 'select a pod from Google Drive' },
  'googleDrive.noFilesFound': { en: 'no pod files found on Google Drive' },
  'googleDrive.reconnect': { en: 'reconnect' },
  'googleDrive.sessionExpired': { en: 'Google session expired. Reconnect to keep saving.' },
  'googleDrive.authFailed': { en: 'Google sign-in failed. Please try again.' },
  'googleDrive.notConfigured': { en: 'Google Drive is not configured.' },
  'googleDrive.offlineQueued': { en: 'Offline. Changes will save when you reconnect.' },
  'googleDrive.loadError': { en: 'failed to load from Google Drive' },
  'googleDrive.filePickerTitle': { en: 'your pods on Google Drive' },
  'googleDrive.lastModified': { en: 'last modified' },
  'googleDrive.refresh': { en: 'refresh' },
  'googleDrive.storageLabel': { en: 'Google Drive' },
  'googleDrive.fileCreated': { en: 'your pod has been created on Google Drive.' },
  'googleDrive.fileLocation': { en: 'location: beanies.family folder' },
  'googleDrive.shareHint': {
    en: 'To share with family members, open this file in Google Drive and share it with read & write access.',
  },
  'googleDrive.openInDrive': { en: 'open in Google Drive' },
  'googleDrive.savedTo': { en: 'saved to Google Drive' },
  'googleDrive.connectedAs': { en: 'connected as {email}' },
  'googleDrive.saveFailureTitle': { en: "your data isn't being saved" },
  'googleDrive.saveFailureBody': {
    en: "Recent changes haven't been saved to Google Drive. Reconnect to prevent data loss.",
  },
  'googleDrive.saveFailureReconnect': { en: 'reconnect to Google Drive' },
  'googleDrive.downloadBackup': { en: 'download backup' },
  'googleDrive.saveRetrying': { en: 'save failed — retrying...' },
  'googleDrive.fileNotFoundTitle': {
    en: 'your data file was not found',
    beanie: "we can't find your beanpod",
  },
  'googleDrive.fileNotFoundBody': {
    en: 'The pod file on Google Drive may have been deleted or moved. Go to Settings to reconnect or choose a different file.',
    beanie: 'your beanpod might have been moved or deleted. head to settings to sort it out',
  },
  'googleDrive.goToSettings': { en: 'go to settings', beanie: 'go to settings' },
  'googleDrive.reconnectFailed': {
    en: 'Could not reconnect. Try again.',
    beanie: "couldn't reconnect. try again",
  },
  'googleDrive.noFilesHint': {
    en: 'Make sure the file is in a folder named "beanies.family" on this account.',
    beanie: 'check the beanies.family folder on this account',
  },
  'googleDrive.retrySearch': {
    en: 'retry',
    beanie: 'try again',
  },
  'googleDrive.switchAccount': {
    en: 'switch account',
    beanie: 'different account',
  },
  'storage.localFile': { en: 'local file' },
  'storage.dropbox': { en: 'Dropbox' },
  'storage.iCloud': { en: 'iCloud' },

  // Family Planner
  'planner.title': { en: 'family planner', beanie: 'beanie planner' },
  'planner.subtitle': { en: '{month} — {count} activities' },
  'planner.addActivity': { en: '+ add activity', beanie: '+ new activity' },
  'planner.editActivity': { en: 'edit activity' },
  'planner.newActivity': { en: 'new activity', beanie: 'new beanie activity' },
  'planner.deleteActivity': { en: 'delete activity' },
  'planner.deleteConfirm': { en: 'Are you sure you want to delete this activity?' },
  'planner.noActivities': { en: 'no activities yet' },
  'planner.noActivitiesHint': { en: 'Add your first family activity to get started!' },
  'planner.today': { en: 'today' },
  'planner.upcoming': { en: 'upcoming activities' },
  'planner.noUpcoming': { en: 'no upcoming activities' },
  'planner.todoPreview': { en: 'family to-do' },
  'planner.viewAllTodos': { en: 'view all →' },
  'planner.onCalendar': { en: 'on calendar' },
  'planner.viewMore': { en: 'view more' },
  'planner.inactiveActivities': { en: 'inactive activities' },
  'planner.noInactive': { en: 'no inactive activities' },
  'planner.showInactive': { en: 'show inactive' },
  'planner.comingSoon': { en: 'coming soon' },

  // Planner — View toggle
  'planner.view.month': { en: 'month' },
  'planner.view.week': { en: 'week' },
  'planner.view.day': { en: 'day' },
  'planner.view.agenda': { en: 'agenda' },

  // Planner — Categories
  'planner.category.lesson': { en: 'lesson', beanie: 'learning beans' },
  'planner.category.sport': { en: 'sport', beanie: 'active beans' },
  'planner.category.appointment': { en: 'appointment' },
  'planner.category.social': { en: 'social', beanie: 'social beans' },
  'planner.category.pickup': { en: 'pickup' },
  'planner.category.other': { en: 'other' },

  // Planner — Recurrence labels
  'planner.recurrence.weekly': { en: 'weekly' },
  'planner.recurrence.daily': { en: 'daily' },
  'planner.recurrence.monthly': { en: 'monthly' },
  'planner.recurrence.yearly': { en: 'yearly' },
  'planner.recurrence.none': { en: 'one-time' },
  'planner.recurrence.biweekly': { en: 'biweekly' },

  // Planner — Fee schedule labels
  'planner.fee.none': { en: 'no fees' },
  'planner.fee.per_session': { en: 'per session' },
  'planner.fee.weekly': { en: 'weekly' },
  'planner.fee.monthly': { en: 'monthly' },
  'planner.fee.termly': { en: 'per term' },
  'planner.fee.yearly': { en: 'yearly' },

  // Planner — Form fields
  'planner.field.title': { en: 'activity title' },
  'planner.field.date': { en: 'start date' },
  'planner.field.startTime': { en: 'start time' },
  'planner.field.endTime': { en: 'end time' },
  'planner.field.category': { en: 'category' },
  'planner.field.recurrence': { en: 'repeats' },
  'planner.field.dayOfWeek': { en: 'day of week' },
  'planner.field.assignee': { en: 'who' },
  'planner.field.dropoff': { en: 'drop off duty' },
  'planner.field.pickup': { en: 'pick up duty' },
  'planner.field.location': { en: 'location' },
  'planner.field.feeSchedule': { en: 'fee schedule' },
  'planner.field.feeAmount': { en: 'fee amount' },
  'planner.field.feePayer': { en: 'who pays?' },
  'planner.field.instructor': { en: 'instructor / coach' },
  'planner.field.instructorContact': { en: 'contact' },
  'planner.field.reminder': { en: 'reminder' },
  'planner.field.notes': { en: 'notes' },
  'planner.field.moreDetails': { en: 'add more details' },
  'planner.field.color': { en: 'highlight color' },
  'planner.field.active': { en: 'active' },

  // Planner — Day Agenda Sidebar
  'planner.dayAgenda': { en: 'day agenda' },
  'planner.noActivitiesForDay': { en: 'no activities scheduled' },
  'planner.upcomingAfterDay': { en: 'coming up' },

  // Planner — Legend
  'planner.legend': { en: 'legend' },

  // Planner — Days of week (short)
  'planner.day.sun': { en: 'sun' },
  'planner.day.mon': { en: 'mon' },
  'planner.day.tue': { en: 'tue' },
  'planner.day.wed': { en: 'wed' },
  'planner.day.thu': { en: 'thu' },
  'planner.day.fri': { en: 'fri' },
  'planner.day.sat': { en: 'sat' },

  // ───── Budget Page ─────
  'budget.title': { en: 'budget', beanie: 'bean budget' },
  'budget.subtitle': {
    en: 'Track your spending against your plan',
    beanie: 'Keep your beans in line',
  },
  'budget.addBudget': { en: 'set up budget', beanie: 'plant a budget' },
  'budget.editBudget': { en: 'edit budget' },
  'budget.deleteBudget': { en: 'delete budget' },

  // Budget — Hero card
  'budget.hero.spent': { en: 'spent' },
  'budget.hero.of': { en: 'of' },
  'budget.hero.remaining': { en: 'remaining' },
  'budget.hero.over': { en: 'over budget' },
  'budget.hero.percentageMode': { en: '% of income' },
  'budget.hero.fixedMode': { en: 'fixed amount' },

  // Budget — Motivational messages
  'budget.pace.great': { en: 'Looking great! Well under budget', beanie: 'Beans are thriving!' },
  'budget.pace.onTrack': { en: 'Right on track this month', beanie: 'Steady bean growth' },
  'budget.pace.caution': {
    en: 'Spending is picking up — stay mindful',
    beanie: 'Careful with those beans!',
  },
  'budget.pace.over': { en: 'Over budget — time to rein it in', beanie: 'Too many beans spent!' },

  // Budget — Summary cards
  'budget.summary.monthlyIncome': { en: 'monthly income', beanie: 'beans earned' },
  'budget.summary.currentSpending': { en: 'current spending', beanie: 'beans spent' },
  'budget.summary.monthlySavings': { en: 'monthly savings', beanie: 'beans saved' },
  'budget.summary.savingsRate': { en: 'savings rate' },
  'budget.summary.recurring': { en: 'recurring' },
  'budget.summary.oneTime': { en: 'one-time' },

  // Budget — Sections
  'budget.section.upcomingTransactions': { en: 'upcoming transactions' },
  'budget.section.spendingByCategory': { en: 'spending by category' },
  'budget.section.budgetSettings': { en: 'budget settings' },
  'budget.section.addTransactions': { en: 'add transactions' },
  'budget.section.viewAll': { en: 'view all' },

  // Budget — Quick Add
  'budget.quickAdd.title': { en: 'quick add' },
  'budget.quickAdd.moneyIn': { en: 'money in', beanie: 'beans in' },
  'budget.quickAdd.moneyOut': { en: 'money out', beanie: 'beans out' },
  'budget.quickAdd.description': { en: 'description' },
  'budget.quickAdd.amount': { en: 'amount' },
  'budget.quickAdd.category': { en: 'category' },
  'budget.quickAdd.date': { en: 'date' },
  'budget.quickAdd.account': { en: 'account' },

  // Budget — Batch / CSV (coming soon)
  'budget.batchAdd.title': { en: 'batch add' },
  'budget.csvUpload.title': { en: 'CSV upload' },
  'budget.comingSoon': { en: 'beanies in development', beanie: 'beans sprouting' },

  // Budget — Settings modal
  'budget.settings.title': { en: 'budget settings' },
  'budget.settings.mode': { en: 'budget mode' },
  'budget.settings.percentageOfIncome': { en: '% of income' },
  'budget.settings.fixedAmount': { en: 'fixed amount' },
  'budget.settings.percentageLabel': { en: 'percentage of monthly income' },
  'budget.settings.fixedLabel': { en: 'monthly budget amount' },
  'budget.settings.categoryAllocations': { en: 'category allocations' },
  'budget.settings.categoryHint': { en: 'set spending limits per category (optional)' },
  'budget.settings.effectiveBudget': { en: 'effective budget' },
  'budget.settings.owner': { en: 'budget owner' },
  'budget.settings.perMonth': { en: 'per month' },
  'budget.settings.infoPercentage': {
    en: 'Your budget is set to {percentage}% of combined income. It auto-adjusts when income changes. The remaining {remaining}% flows to savings goals.',
    beanie:
      'Your bean budget uses {percentage}% of your harvest. It grows with your income! The other {remaining}% goes to your bean stash.',
  },
  'budget.settings.infoFixed': {
    en: 'Your budget is set to a fixed amount of {amount} per month. Adjust anytime from the settings.',
    beanie: 'Your bean plan is a fixed pot of {amount} every month. Tweak it whenever you like!',
  },

  // Budget — Empty state
  'budget.empty.title': { en: 'no budget yet', beanie: 'no bean plan yet' },
  'budget.empty.description': {
    en: 'Set up a monthly budget to track your spending and savings goals',
    beanie: 'Plant a budget and watch your beans grow',
  },

  // Budget — Confirm dialog
  'budget.confirm.deleteTitle': { en: 'delete budget?' },
  'budget.confirm.deleteMessage': {
    en: 'This will remove your budget configuration. Your transactions will not be affected.',
  },

  // Budget — Category status
  'budget.category.onTrack': { en: 'on track' },
  'budget.category.warning': { en: 'watch it' },
  'budget.category.over': { en: 'over' },
  'budget.category.noBudget': { en: 'no limit set' },
  'budget.category.overAmount': { en: 'over', beanie: 'over' },
  'budget.category.overEncouragement': {
    en: 'just a little more to go',
    beanie: 'keep those beans tight',
  },

  // Hero card v7
  'budget.hero.budgetProgress': { en: 'budget progress', beanie: 'bean progress' },
  'budget.hero.dayLabel': { en: 'day' },
  'budget.hero.daysOf': { en: 'of' },
  'budget.hero.percentSpent': { en: 'spent' },

  // Add Transactions
  'budget.addTransactions.subtitle': {
    en: 'one-time or recurring — add them your way',
    beanie: 'plant beans one at a time or in bunches',
  },
  'budget.quickAdd.subtitle': { en: 'add an expense or income instantly' },
  'budget.batchAdd.subtitle': { en: 'add multiple transactions at once' },
  'budget.csvUpload.subtitle': { en: 'import from your bank statement' },

  // Upcoming transactions
  'budget.upcoming.today': { en: 'today' },
  'budget.upcoming.tomorrow': { en: 'tomorrow' },
  'budget.upcoming.inDays': { en: 'in {days} days' },
  'budget.upcoming.recurring': { en: 'recurring' },
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

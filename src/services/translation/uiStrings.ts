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
  'app.tagline': { en: 'Every bean counts' },
  'app.version': { en: 'v1.0.0 - MVP' },

  // Common labels
  'common.totalAssets': { en: 'Total Assets', beanie: 'Total Beans' },
  'common.totalLiabilities': { en: 'Total Liabilities', beanie: 'Beans Owed' },
  'common.totalValue': { en: 'Total Value', beanie: 'Total Bean Value' },
  'common.netAssetValue': { en: 'Net Asset Value', beanie: 'Net Bean Value' },
  'common.appreciation': { en: 'Appreciation', beanie: 'Bean Growth' },
  'common.depreciation': { en: 'Depreciation', beanie: 'Shrinking Beans' },
  'common.assetLoans': { en: 'Asset Loans' },
  'common.loanOutstanding': { en: 'Loan Outstanding' },
  'common.purchaseValue': { en: 'Purchase Value', beanie: 'What You Paid' },
  'common.currentValue': { en: 'Current Value', beanie: 'Worth Today' },
  'common.purchased': { en: 'Purchased' },

  // Status labels
  'status.active': { en: 'Active' },
  'status.inactive': { en: 'Inactive', beanie: 'Resting' },
  'status.excluded': { en: 'Excluded' },
  'status.paused': { en: 'Paused', beanie: 'Snoozing' },
  'status.recurring': { en: 'Recurring' },
  'status.completed': { en: 'Completed', beanie: 'Harvested!' },
  'status.overdue': { en: 'Overdue' },

  // Navigation
  'nav.dashboard': { en: 'Dashboard', beanie: 'Bean Counter' },
  'nav.accounts': { en: 'Accounts' },
  'nav.transactions': { en: 'Transactions' },
  'nav.assets': { en: 'Assets' },
  'nav.goals': { en: 'Goals' },
  'nav.reports': { en: 'Reports' },
  'nav.forecast': { en: 'Forecast', beanie: 'Bean Forecast' },
  'nav.family': { en: 'Family', beanie: 'The Pod' },
  'nav.settings': { en: 'Settings' },

  // Common actions
  'action.add': { en: 'Add' },
  'action.edit': { en: 'Edit' },
  'action.delete': { en: 'Delete' },
  'action.save': { en: 'Save' },
  'action.saveChanges': { en: 'Save Changes' },
  'action.cancel': { en: 'Cancel' },
  'action.confirm': { en: 'Confirm' },
  'action.close': { en: 'Close' },
  'action.back': { en: 'Back' },
  'action.next': { en: 'Next' },
  'action.submit': { en: 'Submit' },
  'action.search': { en: 'Search' },
  'action.filter': { en: 'Filter' },
  'action.clear': { en: 'Clear' },
  'action.refresh': { en: 'Refresh' },
  'action.loading': { en: 'Loading...', beanie: 'counting beans...' },
  'action.pause': { en: 'Pause' },
  'action.resume': { en: 'Resume' },
  'action.markCompleted': { en: 'Mark as completed' },
  'action.export': { en: 'Export' },
  'action.import': { en: 'Import' },

  // Dashboard
  'dashboard.netWorth': { en: 'Net Worth', beanie: 'Your Bean Count' },
  'dashboard.assets': { en: 'Assets', beanie: 'Your Beans' },
  'dashboard.liabilities': { en: 'Liabilities', beanie: 'Beans Owed' },
  'dashboard.monthlyIncome': { en: 'Monthly Income', beanie: 'Beans Coming In' },
  'dashboard.monthlyExpenses': { en: 'Monthly Expenses', beanie: 'Beans Going Out' },
  'dashboard.netCashFlow': { en: 'Net Cash Flow', beanie: 'Monthly Bean Flow' },
  'dashboard.recentTransactions': { en: 'Recent Transactions', beanie: 'Recent Bean Moves' },
  'dashboard.upcomingTransactions': { en: 'Upcoming Transactions', beanie: 'Coming Up' },
  'dashboard.assetsSummary': { en: 'Assets Summary', beanie: 'Bean Summary' },
  'dashboard.activeGoals': { en: 'Active Goals', beanie: 'Growing Goals' },
  'dashboard.noTransactions': {
    en: 'No transactions yet. Add your first transaction to get started.',
    beanie: 'No bean moves yet — add your first one to get growing!',
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
  'recurring.title': { en: 'Recurring', beanie: 'Regular Beans' },
  'recurring.items': { en: 'Recurring Items', beanie: 'Regular Bean Moves' },
  'recurring.monthlyIncome': {
    en: 'Monthly Recurring Income',
    beanie: 'Beans Coming In Each Month',
  },
  'recurring.monthlyExpenses': {
    en: 'Monthly Recurring Expenses',
    beanie: 'Beans Going Out Each Month',
  },
  'recurring.netMonthly': { en: 'Monthly Savings', beanie: 'Beans Saved Each Month' },
  'recurring.noItems': { en: 'No recurring items yet.', beanie: 'No regular bean moves yet.' },
  'recurring.getStarted': {
    en: 'Click "Add Recurring" to set up automatic transactions.',
    beanie: 'Click "Add Regular Bean" to plant some automatic moves.',
  },
  'recurring.addItem': { en: 'Add Recurring Item', beanie: 'Add Regular Bean' },
  'recurring.editItem': { en: 'Edit Recurring Item', beanie: 'Edit Regular Bean' },
  'recurring.deleteConfirm': {
    en: 'Are you sure you want to delete this recurring item? Existing transactions will not be affected.',
  },
  'recurring.next': { en: 'Next' },

  // Accounts
  'accounts.title': { en: 'Accounts', beanie: 'Bean Jars' },
  'accounts.subtitle': {
    en: 'Manage your bank accounts and credit cards',
    beanie: 'Where your beans live',
  },
  'accounts.addAccount': { en: 'Add Account', beanie: 'Add a Jar' },
  'accounts.editAccount': { en: 'Edit Account', beanie: 'Edit Jar' },
  'accounts.deleteAccount': { en: 'Delete Account', beanie: 'Remove Jar' },
  'accounts.noAccounts': { en: 'No accounts yet', beanie: 'No jars yet' },
  'accounts.getStarted': {
    en: 'Get started by adding your first account',
    beanie: 'Add your first bean jar to get growing!',
  },
  'accounts.totalBalance': { en: 'Total Balance', beanie: 'Total in Jars' },
  'accounts.accountName': { en: 'Account Name', beanie: 'Jar Name' },
  'accounts.accountType': { en: 'Account Type', beanie: 'Jar Type' },
  'accounts.currentBalance': { en: 'Current Balance', beanie: 'Beans in Jar' },
  'accounts.type.checking': { en: 'Checking Account', beanie: 'Spending Jar' },
  'accounts.type.savings': { en: 'Savings Account', beanie: 'Growing Jar' },
  'accounts.type.credit_card': { en: 'Credit Card' },
  'accounts.type.investment': { en: 'Investment Account', beanie: 'Growing Beans' },
  'accounts.type.crypto': { en: 'Cryptocurrency', beanie: 'Crypto Beans' },
  'accounts.type.cash': { en: 'Cash', beanie: 'Pocket Beans' },
  'accounts.type.loan': { en: 'Loan', beanie: 'Borrowed Beans' },
  'accounts.type.other': { en: 'Other' },

  // Transactions
  'transactions.title': { en: 'Transactions', beanie: 'Bean Moves' },
  'transactions.subtitle': {
    en: 'Track your income and expenses',
    beanie: 'Watch your beans come and go',
  },
  'transactions.addTransaction': { en: 'Add Transaction', beanie: 'Add Bean Move' },
  'transactions.editTransaction': { en: 'Edit Transaction', beanie: 'Edit Bean Move' },
  'transactions.deleteTransaction': { en: 'Delete Transaction', beanie: 'Remove Bean Move' },
  'transactions.noTransactions': {
    en: 'No transactions recorded yet.',
    beanie: 'No bean moves recorded yet.',
  },
  'transactions.getStarted': {
    en: 'Click "Add Transaction" to get started.',
    beanie: 'Click "Add Bean Move" to start tracking.',
  },
  'transactions.allTransactions': { en: 'All Transactions', beanie: 'All Bean Moves' },
  'transactions.thisMonthIncome': { en: 'This Month Income', beanie: 'Beans In This Month' },
  'transactions.thisMonthExpenses': { en: 'This Month Expenses', beanie: 'Beans Out This Month' },
  'transactions.netCashFlow': { en: 'Net Cash Flow', beanie: 'Bean Flow' },
  'transactions.oneTime': { en: 'One Time Transactions', beanie: 'One-off Bean Moves' },
  'transactions.recurringTransactions': {
    en: 'Recurring Transactions',
    beanie: 'Regular Bean Moves',
  },
  'transactions.addRecurring': { en: 'Add Recurring', beanie: 'Add Regular Bean' },
  'transactions.type.income': { en: 'Income', beanie: 'Beans In' },
  'transactions.type.expense': { en: 'Expense', beanie: 'Beans Out' },
  'transactions.type.transfer': { en: 'Transfer', beanie: 'Move Between Jars' },

  // Assets
  'assets.title': { en: 'Assets', beanie: 'Big Beans' },
  'assets.subtitle': {
    en: 'Track your property, vehicles, and valuables',
    beanie: 'Your biggest beans — property, vehicles, and more',
  },
  'assets.addAsset': { en: 'Add Asset' },
  'assets.editAsset': { en: 'Edit Asset' },
  'assets.deleteAsset': { en: 'Delete Asset' },
  'assets.noAssets': { en: 'No assets yet', beanie: 'No big beans yet' },
  'assets.getStarted': {
    en: 'Get started by adding your first asset',
    beanie: 'Add your first big bean!',
  },
  'assets.assetName': { en: 'Asset Name' },
  'assets.assetType': { en: 'Asset Type' },
  'assets.hasLoan': { en: 'This asset has a loan' },
  'assets.hasLoanDesc': { en: 'Track mortgage, auto loan, or other financing' },
  'assets.loanDetails': { en: 'Loan Details' },
  'assets.originalLoanAmount': { en: 'Original Loan Amount' },
  'assets.outstandingBalance': { en: 'Outstanding Balance' },
  'assets.interestRate': { en: 'Interest Rate (%)' },
  'assets.monthlyPayment': { en: 'Monthly Payment' },
  'assets.loanTerm': { en: 'Loan Term (months)' },
  'assets.lender': { en: 'Lender' },
  'assets.loanStartDate': { en: 'Loan Start Date' },
  'assets.purchaseDate': { en: 'Purchase Date' },
  'assets.type.real_estate': { en: 'Real Estate' },
  'assets.type.vehicle': { en: 'Vehicle' },
  'assets.type.boat': { en: 'Boat' },
  'assets.type.jewelry': { en: 'Jewelry' },
  'assets.type.electronics': { en: 'Electronics' },
  'assets.type.equipment': { en: 'Equipment' },
  'assets.type.art': { en: 'Art' },
  'assets.type.investment': { en: 'Investment' },
  'assets.type.crypto': { en: 'Cryptocurrency' },
  'assets.type.collectible': { en: 'Collectible' },
  'assets.type.other': { en: 'Other' },

  // Goals
  'goals.title': { en: 'Goals', beanie: 'Bean Dreams' },
  'goals.subtitle': {
    en: 'Set and track your financial goals',
    beanie: 'Plant a goal and watch it grow',
  },
  'goals.addGoal': { en: 'Add Goal' },
  'goals.editGoal': { en: 'Edit Goal' },
  'goals.deleteGoal': { en: 'Delete Goal' },
  'goals.noGoals': { en: 'No goals set yet.', beanie: 'No bean dreams planted yet.' },
  'goals.getStarted': {
    en: 'Click "Add Goal" to create your first financial goal.',
    beanie: 'Click "Add Goal" to plant your first bean dream!',
  },
  'goals.allGoals': { en: 'All Goals' },
  'goals.activeGoals': { en: 'Active Goals', beanie: 'Growing Goals' },
  'goals.completedGoals': { en: 'Completed Goals', beanie: 'Harvested Goals!' },
  'goals.overdueGoals': { en: 'Overdue Goals' },
  'goals.goalName': { en: 'Goal Name' },
  'goals.goalType': { en: 'Goal Type' },
  'goals.assignTo': { en: 'Assign to' },
  'goals.familyWide': { en: 'Family-wide goal', beanie: 'A goal for the whole pod' },
  'goals.deadlineOptional': { en: 'Deadline (Optional)' },
  'goals.type.savings': { en: 'Savings', beanie: 'Saving Beans' },
  'goals.type.debt_payoff': { en: 'Debt Payoff' },
  'goals.type.investment': { en: 'Investment' },
  'goals.type.purchase': { en: 'Purchase', beanie: 'Saving For' },
  'goals.priority.label': { en: 'priority' },
  'goals.priority.low': { en: 'Low' },
  'goals.priority.medium': { en: 'Medium' },
  'goals.priority.high': { en: 'High' },
  'goals.priority.critical': { en: 'Critical' },
  'goals.progress': { en: 'Progress', beanie: 'Growth' },
  'goals.deadline': { en: 'Deadline' },

  // Family
  'family.title': { en: 'Family', beanie: 'The Pod' },
  'family.addMember': { en: 'Add Member', beanie: 'Add a Beanie' },
  'family.editMember': { en: 'Edit Member', beanie: 'Edit Beanie' },
  'family.deleteMember': { en: 'Delete Member', beanie: 'Remove Beanie' },
  'family.noMembers': {
    en: 'No family members yet.',
    beanie: 'The pod is empty — add your first beanie!',
  },
  'family.role.owner': { en: 'Owner', beanie: 'Head Bean' },
  'family.role.admin': { en: 'Admin', beanie: 'Big Bean' },
  'family.role.member': { en: 'Member', beanie: 'Beanie' },

  // Reports
  'reports.title': { en: 'Reports', beanie: 'Bean Reports' },
  'reports.subtitle': {
    en: 'Visualize your financial data with charts and reports',
    beanie: 'See how your beans are growing',
  },
  'reports.noData': {
    en: 'No data available for reports yet.',
    beanie: 'Not enough beans to report yet!',
  },
  'reports.familyMember': { en: 'Family Member' },
  'reports.netWorthOverTime': { en: 'Net Worth Over Time', beanie: 'Bean Count Over Time' },
  'reports.netWorthDescription': {
    en: 'Projected net worth based on current assets and recurring transactions',
    beanie: 'How your bean patch could grow',
  },
  'reports.currentNetWorth': { en: 'Current Net Worth', beanie: 'Bean Count Today' },
  'reports.projectedNetWorth': { en: 'Projected Net Worth', beanie: 'Projected Bean Count' },
  'reports.projectedChange': { en: 'Projected Change' },
  'reports.incomeVsExpenses': { en: 'Income vs Expenses', beanie: 'Beans In vs Beans Out' },
  'reports.incomeVsExpensesDescription': {
    en: 'Monthly breakdown of income and expenses by category',
    beanie: 'Monthly breakdown of beans coming in and going out',
  },
  'reports.totalIncome': { en: 'Total Income', beanie: 'Total Beans In' },
  'reports.totalExpenses': { en: 'Total Expenses', beanie: 'Total Beans Out' },
  'reports.netCashFlow': { en: 'Net Cash Flow', beanie: 'Net Bean Flow' },

  // Forecast
  'forecast.title': { en: 'Forecast', beanie: 'Bean Forecast' },
  'forecast.noData': {
    en: 'No data available for forecasting yet.',
    beanie: 'Plant some beans first — then we can forecast your harvest!',
  },
  'forecast.comingSoon': { en: 'Coming soon to your bean patch' },
  'forecast.comingSoonDescription': {
    en: "We're growing something special. Financial forecasting will help you see where your beans are headed.",
  },
  'forecast.feature.projections': { en: 'Recurring transaction projections' },
  'forecast.feature.cashFlow': { en: 'Cash flow forecast (3, 6, and 12 months)' },
  'forecast.feature.goals': { en: 'Goal achievement projections' },
  'forecast.feature.scenarios': { en: '"What if" scenario simulation' },

  // Settings
  'settings.title': { en: 'Settings' },
  'settings.subtitle': { en: 'Configure your app preferences', beanie: 'Tune your bean patch' },
  'settings.general': { en: 'General' },
  'settings.baseCurrency': { en: 'Base Currency' },
  'settings.baseCurrencyHint': {
    en: 'Your primary currency for displaying totals and conversions',
  },
  'settings.displayCurrency': { en: 'Display Currency' },
  'settings.theme': { en: 'Theme' },
  'settings.theme.light': { en: 'Light' },
  'settings.theme.dark': { en: 'Dark' },
  'settings.theme.system': { en: 'System' },
  'settings.themeHint': { en: 'Choose your preferred color scheme' },
  'settings.language': { en: 'Language' },
  'settings.beanieMode': { en: 'Beanie Mode' },
  'settings.beanieModeDescription': {
    en: 'Replace standard labels with friendly beanie-themed language',
  },
  'settings.beanieModeDisabled': { en: 'Beanie Mode is only available in English' },
  'settings.soundEffects': { en: 'Sound Effects' },
  'settings.soundEffectsDescription': { en: 'Play fun sounds for actions and celebrations' },
  'settings.sync': { en: 'Sync' },
  'settings.fileSync': { en: 'File Sync' },
  'settings.syncToFile': { en: 'Sync to a File' },
  'settings.syncToFileDescription': {
    en: 'Save your data to a JSON file. Place it in Google Drive, Dropbox, or any synced folder for cloud backup.',
  },
  'settings.createNewSyncFile': { en: 'Create New Sync File' },
  'settings.loadFromExistingFile': { en: 'Load from Existing File' },
  'settings.syncEnabled': { en: 'Sync Enabled' },
  'settings.autoSync': { en: 'Auto Sync' },
  'settings.encryption': { en: 'Encryption' },
  'settings.exchangeRates': { en: 'Exchange Rates' },
  'settings.aiInsights': { en: 'AI Insights' },
  'settings.aiPoweredInsights': { en: 'AI-Powered Insights', beanie: 'Bean Advisor' },
  'settings.aiComingSoon': {
    en: 'Coming soon - Get personalized financial advice powered by AI',
    beanie: 'Coming soon — your very own bean advisor!',
  },
  'settings.dataManagement': { en: 'Data Management' },
  'settings.exportData': { en: 'Export Data', beanie: 'Pack Up Your Beans' },
  'settings.exportDataDescription': {
    en: 'Download all your data as a JSON file',
    beanie: 'Download all your beans as a file',
  },
  'settings.clearAllData': { en: 'Clear All Data' },
  'settings.clearAllDataDescription': {
    en: 'Permanently delete all your data',
    beanie: 'Remove all your beans from this device',
  },
  'settings.clearData': { en: 'Clear Data' },
  'settings.clearDataConfirmation': {
    en: 'Are you sure you want to delete all your data? This action cannot be undone.',
    beanie: 'This will clear ALL your beans. Are you really sure? This cannot be undone.',
  },
  'settings.yesDeleteEverything': { en: 'Yes, Delete Everything', beanie: 'Yes, Clear the Pod' },
  'settings.about': { en: 'About' },
  'settings.appName': { en: 'beanies.family' },
  'settings.version': { en: 'Version 1.0.0 (MVP)' },
  'settings.appDescription': {
    en: 'A local-first, privacy-focused family finance application.',
    beanie: "A private, local-first home for your family's beans.",
  },
  'settings.privacyNote': {
    en: 'Your data is encrypted and saved to a file you control. Nothing is stored on our servers — your financial data never leaves your device.',
    beanie:
      'Your beans are encrypted and saved to a file only you control. They never leave your device.',
  },

  // Form labels
  'form.name': { en: 'Name' },
  'form.email': { en: 'Email' },
  'form.type': { en: 'Type' },
  'form.amount': { en: 'Amount' },
  'form.currency': { en: 'Currency' },
  'form.balance': { en: 'Balance' },
  'form.date': { en: 'Date' },
  'form.category': { en: 'Category' },
  'form.description': { en: 'Description' },
  'form.account': { en: 'Account' },
  'form.selectAccount': { en: 'Select an account' },
  'form.fromAccount': { en: 'From Account' },
  'form.toAccount': { en: 'To Account' },
  'form.owner': { en: 'Owner' },
  'form.institution': { en: 'Institution' },
  'form.frequency': { en: 'Frequency' },
  'form.frequency.daily': { en: 'Daily' },
  'form.frequency.weekly': { en: 'Weekly' },
  'form.frequency.monthly': { en: 'Monthly' },
  'form.frequency.yearly': { en: 'Yearly' },
  'form.startDate': { en: 'Start Date' },
  'form.endDate': { en: 'End Date' },
  'form.targetAmount': { en: 'Target Amount', beanie: 'Target Beans' },
  'form.currentAmount': { en: 'Current Amount', beanie: 'Beans So Far' },
  'form.priority': { en: 'Priority' },
  'form.notes': { en: 'Notes' },
  'form.includeInNetWorth': { en: 'Include in Net Worth', beanie: 'Count in my bean total' },
  'form.isActive': { en: 'Active' },
  'form.required': { en: 'Required' },

  // Validation messages
  'validation.required': { en: 'This field is required' },
  'validation.invalidEmail': { en: 'Please enter a valid email address' },
  'validation.invalidAmount': { en: 'Please enter a valid amount' },
  'validation.minLength': { en: 'Must be at least {min} characters' },

  // Confirmation dialogs
  'confirm.delete': {
    en: 'Are you sure you want to delete this item?',
    beanie: 'Remove this bean for good?',
  },
  'confirm.deleteAccount': {
    en: 'Are you sure you want to delete this account? All associated transactions will also be deleted.',
    beanie: 'Remove this bean jar? All the beans inside go with it.',
  },
  'confirm.deleteMember': {
    en: 'Are you sure you want to delete this family member?',
    beanie: 'Remove this beanie from the pod?',
  },
  'confirm.unsavedChanges': {
    en: 'You have unsaved changes. Are you sure you want to leave?',
    beanie: "You've got unsaved beans! Leave anyway?",
  },

  // Success messages
  'success.saved': { en: 'Changes saved successfully', beanie: 'Beans saved!' },
  'success.created': { en: 'Created successfully', beanie: 'Bean added!' },
  'success.deleted': { en: 'Deleted successfully', beanie: 'Gone!' },
  'success.updated': { en: 'Updated successfully', beanie: 'Beans updated!' },

  // Error messages
  'error.generic': {
    en: 'Something went wrong. Please try again.',
    beanie: 'Hmm, a bean got stuck. Try again?',
  },
  'error.loadFailed': { en: 'Failed to load data', beanie: "Couldn't load your beans" },
  'error.saveFailed': { en: 'Failed to save changes', beanie: "Hmm, couldn't save your beans" },
  'error.deleteFailed': { en: 'Failed to delete', beanie: "Couldn't remove that bean" },
  'error.networkError': {
    en: 'Network error. Please check your connection.',
    beanie: 'No connection — your beans are still here though!',
  },

  // Not Found (404)
  'notFound.heading': { en: 'Oops! This bean got lost...' },
  'notFound.description': {
    en: "The page you're looking for has wandered off. Let's get you back to your beans.",
  },
  'notFound.goHome': { en: 'Back to Dashboard' },

  // Empty states
  'empty.noData': { en: 'No data available', beanie: 'No beans here yet' },
  'empty.noResults': { en: 'No results found', beanie: 'No beans matched your search' },

  // Filter
  'filter.members': { en: 'Members' },
  'filter.allMembers': { en: 'All Members' },

  // Date/Time
  'date.today': { en: 'Today' },
  'date.yesterday': { en: 'Yesterday' },
  'date.thisWeek': { en: 'This Week' },
  'date.thisMonth': { en: 'This Month' },
  'date.thisYear': { en: 'This Year' },
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
    .filter(([, v]) => v.beanie !== undefined)
    .map(([k, v]) => [k, v.beanie])
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

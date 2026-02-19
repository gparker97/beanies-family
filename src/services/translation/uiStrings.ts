/**
 * UI Strings Registry
 *
 * All user-facing text in the application should be defined here.
 * This enables dynamic translation of the UI.
 *
 * Each string is automatically hashed. When a string changes, its hash changes,
 * triggering re-translation of only that specific string.
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

export const UI_STRINGS = {
  // App branding
  'app.name': 'beanies.family',
  'app.tagline': 'Every bean counts',
  'app.version': 'v1.0.0 - MVP',

  // Common labels
  'common.totalAssets': 'Total Assets',
  'common.totalLiabilities': 'Total Liabilities',
  'common.totalValue': 'Total Value',
  'common.netAssetValue': 'Net Asset Value',
  'common.appreciation': 'Appreciation',
  'common.depreciation': 'Depreciation',
  'common.assetLoans': 'Asset Loans',
  'common.loanOutstanding': 'Loan Outstanding',
  'common.purchaseValue': 'Purchase Value',
  'common.currentValue': 'Current Value',
  'common.purchased': 'Purchased',

  // Status labels
  'status.active': 'Active',
  'status.inactive': 'Inactive',
  'status.excluded': 'Excluded',
  'status.paused': 'Paused',
  'status.recurring': 'Recurring',
  'status.completed': 'Completed',
  'status.overdue': 'Overdue',

  // Navigation
  'nav.dashboard': 'Dashboard',
  'nav.accounts': 'Accounts',
  'nav.transactions': 'Transactions',
  'nav.assets': 'Assets',
  'nav.goals': 'Goals',
  'nav.reports': 'Reports',
  'nav.forecast': 'Forecast',
  'nav.family': 'Family',
  'nav.settings': 'Settings',

  // Common actions
  'action.add': 'Add',
  'action.edit': 'Edit',
  'action.delete': 'Delete',
  'action.save': 'Save',
  'action.saveChanges': 'Save Changes',
  'action.cancel': 'Cancel',
  'action.confirm': 'Confirm',
  'action.close': 'Close',
  'action.back': 'Back',
  'action.next': 'Next',
  'action.submit': 'Submit',
  'action.search': 'Search',
  'action.filter': 'Filter',
  'action.clear': 'Clear',
  'action.refresh': 'Refresh',
  'action.loading': 'Loading...',
  'action.pause': 'Pause',
  'action.resume': 'Resume',
  'action.markCompleted': 'Mark as completed',
  'action.export': 'Export',
  'action.import': 'Import',

  // Dashboard
  'dashboard.netWorth': 'Net Worth',
  'dashboard.assets': 'Assets',
  'dashboard.liabilities': 'Liabilities',
  'dashboard.monthlyIncome': 'Monthly Income',
  'dashboard.monthlyExpenses': 'Monthly Expenses',
  'dashboard.netCashFlow': 'Net Cash Flow',
  'dashboard.recentTransactions': 'Recent Transactions',
  'dashboard.upcomingTransactions': 'Upcoming Transactions',
  'dashboard.assetsSummary': 'Assets Summary',
  'dashboard.activeGoals': 'Active Goals',
  'dashboard.noTransactions': 'No transactions yet. Add your first transaction to get started.',
  'dashboard.noUpcoming': 'No upcoming transactions in the next 30 days',
  'dashboard.noAssets': 'No assets yet. Add assets to track your property and valuables.',
  'dashboard.noGoals': 'No active goals. Set a financial goal to track your progress.',

  // Recurring
  'recurring.title': 'Recurring',
  'recurring.items': 'Recurring Items',
  'recurring.monthlyIncome': 'Monthly Recurring Income',
  'recurring.monthlyExpenses': 'Monthly Recurring Expenses',
  'recurring.netMonthly': 'Monthly Savings',
  'recurring.noItems': 'No recurring items yet.',
  'recurring.getStarted': 'Click "Add Recurring" to set up automatic transactions.',
  'recurring.addItem': 'Add Recurring Item',
  'recurring.editItem': 'Edit Recurring Item',
  'recurring.deleteConfirm':
    'Are you sure you want to delete this recurring item? Existing transactions will not be affected.',
  'recurring.next': 'Next',

  // Accounts
  'accounts.title': 'Accounts',
  'accounts.subtitle': 'Manage your bank accounts and credit cards',
  'accounts.addAccount': 'Add Account',
  'accounts.editAccount': 'Edit Account',
  'accounts.deleteAccount': 'Delete Account',
  'accounts.noAccounts': 'No accounts yet',
  'accounts.getStarted': 'Get started by adding your first account',
  'accounts.totalBalance': 'Total Balance',
  'accounts.accountName': 'Account Name',
  'accounts.accountType': 'Account Type',
  'accounts.currentBalance': 'Current Balance',
  'accounts.type.checking': 'Checking Account',
  'accounts.type.savings': 'Savings Account',
  'accounts.type.credit_card': 'Credit Card',
  'accounts.type.investment': 'Investment Account',
  'accounts.type.crypto': 'Cryptocurrency',
  'accounts.type.cash': 'Cash',
  'accounts.type.loan': 'Loan',
  'accounts.type.other': 'Other',

  // Transactions
  'transactions.title': 'Transactions',
  'transactions.subtitle': 'Track your income and expenses',
  'transactions.addTransaction': 'Add Transaction',
  'transactions.editTransaction': 'Edit Transaction',
  'transactions.deleteTransaction': 'Delete Transaction',
  'transactions.noTransactions': 'No transactions recorded yet.',
  'transactions.getStarted': 'Click "Add Transaction" to get started.',
  'transactions.allTransactions': 'All Transactions',
  'transactions.thisMonthIncome': 'This Month Income',
  'transactions.thisMonthExpenses': 'This Month Expenses',
  'transactions.netCashFlow': 'Net Cash Flow',
  'transactions.oneTime': 'One Time Transactions',
  'transactions.recurringTransactions': 'Recurring Transactions',
  'transactions.addRecurring': 'Add Recurring',
  'transactions.type.income': 'Income',
  'transactions.type.expense': 'Expense',
  'transactions.type.transfer': 'Transfer',

  // Assets
  'assets.title': 'Assets',
  'assets.subtitle': 'Track your property, vehicles, and valuables',
  'assets.addAsset': 'Add Asset',
  'assets.editAsset': 'Edit Asset',
  'assets.deleteAsset': 'Delete Asset',
  'assets.noAssets': 'No assets yet',
  'assets.getStarted': 'Get started by adding your first asset',
  'assets.assetName': 'Asset Name',
  'assets.assetType': 'Asset Type',
  'assets.hasLoan': 'This asset has a loan',
  'assets.hasLoanDesc': 'Track mortgage, auto loan, or other financing',
  'assets.loanDetails': 'Loan Details',
  'assets.originalLoanAmount': 'Original Loan Amount',
  'assets.outstandingBalance': 'Outstanding Balance',
  'assets.interestRate': 'Interest Rate (%)',
  'assets.monthlyPayment': 'Monthly Payment',
  'assets.loanTerm': 'Loan Term (months)',
  'assets.lender': 'Lender',
  'assets.loanStartDate': 'Loan Start Date',
  'assets.purchaseDate': 'Purchase Date',
  'assets.type.real_estate': 'Real Estate',
  'assets.type.vehicle': 'Vehicle',
  'assets.type.boat': 'Boat',
  'assets.type.jewelry': 'Jewelry',
  'assets.type.electronics': 'Electronics',
  'assets.type.equipment': 'Equipment',
  'assets.type.art': 'Art',
  'assets.type.investment': 'Investment',
  'assets.type.crypto': 'Cryptocurrency',
  'assets.type.collectible': 'Collectible',
  'assets.type.other': 'Other',

  // Goals
  'goals.title': 'Goals',
  'goals.subtitle': 'Set and track your financial goals',
  'goals.addGoal': 'Add Goal',
  'goals.editGoal': 'Edit Goal',
  'goals.deleteGoal': 'Delete Goal',
  'goals.noGoals': 'No goals set yet.',
  'goals.getStarted': 'Click "Add Goal" to create your first financial goal.',
  'goals.allGoals': 'All Goals',
  'goals.activeGoals': 'Active Goals',
  'goals.completedGoals': 'Completed Goals',
  'goals.overdueGoals': 'Overdue Goals',
  'goals.goalName': 'Goal Name',
  'goals.goalType': 'Goal Type',
  'goals.assignTo': 'Assign to',
  'goals.familyWide': 'Family-wide goal',
  'goals.deadlineOptional': 'Deadline (Optional)',
  'goals.type.savings': 'Savings',
  'goals.type.debt_payoff': 'Debt Payoff',
  'goals.type.investment': 'Investment',
  'goals.type.purchase': 'Purchase',
  'goals.priority.label': 'priority',
  'goals.priority.low': 'Low',
  'goals.priority.medium': 'Medium',
  'goals.priority.high': 'High',
  'goals.priority.critical': 'Critical',
  'goals.progress': 'Progress',
  'goals.deadline': 'Deadline',

  // Family
  'family.title': 'Family',
  'family.addMember': 'Add Member',
  'family.editMember': 'Edit Member',
  'family.deleteMember': 'Delete Member',
  'family.noMembers': 'No family members yet.',
  'family.role.owner': 'Owner',
  'family.role.admin': 'Admin',
  'family.role.member': 'Member',

  // Reports
  'reports.title': 'Reports',
  'reports.subtitle': 'Visualize your financial data with charts and reports',
  'reports.noData': 'No data available for reports yet.',
  'reports.familyMember': 'Family Member',
  'reports.netWorthOverTime': 'Net Worth Over Time',
  'reports.netWorthDescription':
    'Projected net worth based on current assets and recurring transactions',
  'reports.currentNetWorth': 'Current Net Worth',
  'reports.projectedNetWorth': 'Projected Net Worth',
  'reports.projectedChange': 'Projected Change',
  'reports.incomeVsExpenses': 'Income vs Expenses',
  'reports.incomeVsExpensesDescription': 'Monthly breakdown of income and expenses by category',
  'reports.totalIncome': 'Total Income',
  'reports.totalExpenses': 'Total Expenses',
  'reports.netCashFlow': 'Net Cash Flow',

  // Forecast
  'forecast.title': 'Forecast',
  'forecast.noData': 'No data available for forecasting yet.',

  // Settings
  'settings.title': 'Settings',
  'settings.subtitle': 'Configure your app preferences',
  'settings.general': 'General',
  'settings.baseCurrency': 'Base Currency',
  'settings.baseCurrencyHint': 'Your primary currency for displaying totals and conversions',
  'settings.displayCurrency': 'Display Currency',
  'settings.theme': 'Theme',
  'settings.theme.light': 'Light',
  'settings.theme.dark': 'Dark',
  'settings.theme.system': 'System',
  'settings.themeHint': 'Choose your preferred color scheme',
  'settings.language': 'Language',
  'settings.sync': 'Sync',
  'settings.fileSync': 'File Sync',
  'settings.syncToFile': 'Sync to a File',
  'settings.syncToFileDescription':
    'Save your data to a JSON file. Place it in Google Drive, Dropbox, or any synced folder for cloud backup.',
  'settings.createNewSyncFile': 'Create New Sync File',
  'settings.loadFromExistingFile': 'Load from Existing File',
  'settings.syncEnabled': 'Sync Enabled',
  'settings.autoSync': 'Auto Sync',
  'settings.encryption': 'Encryption',
  'settings.exchangeRates': 'Exchange Rates',
  'settings.aiInsights': 'AI Insights',
  'settings.aiPoweredInsights': 'AI-Powered Insights',
  'settings.aiComingSoon': 'Coming soon - Get personalized financial advice powered by AI',
  'settings.dataManagement': 'Data Management',
  'settings.exportData': 'Export Data',
  'settings.exportDataDescription': 'Download all your data as a JSON file',
  'settings.clearAllData': 'Clear All Data',
  'settings.clearAllDataDescription': 'Permanently delete all your data',
  'settings.clearData': 'Clear Data',
  'settings.clearDataConfirmation':
    'Are you sure you want to delete all your data? This action cannot be undone.',
  'settings.yesDeleteEverything': 'Yes, Delete Everything',
  'settings.about': 'About',
  'settings.appName': 'beanies.family',
  'settings.version': 'Version 1.0.0 (MVP)',
  'settings.appDescription': 'A local-first, privacy-focused family finance application.',
  'settings.privacyNote':
    'Your data is encrypted and saved to a file you control. Nothing is stored on our servers — your financial data never leaves your device.',

  // Form labels
  'form.name': 'Name',
  'form.email': 'Email',
  'form.type': 'Type',
  'form.amount': 'Amount',
  'form.currency': 'Currency',
  'form.balance': 'Balance',
  'form.date': 'Date',
  'form.category': 'Category',
  'form.description': 'Description',
  'form.account': 'Account',
  'form.selectAccount': 'Select an account',
  'form.fromAccount': 'From Account',
  'form.toAccount': 'To Account',
  'form.owner': 'Owner',
  'form.institution': 'Institution',
  'form.frequency': 'Frequency',
  'form.frequency.daily': 'Daily',
  'form.frequency.weekly': 'Weekly',
  'form.frequency.monthly': 'Monthly',
  'form.frequency.yearly': 'Yearly',
  'form.startDate': 'Start Date',
  'form.endDate': 'End Date',
  'form.targetAmount': 'Target Amount',
  'form.currentAmount': 'Current Amount',
  'form.priority': 'Priority',
  'form.notes': 'Notes',
  'form.includeInNetWorth': 'Include in Net Worth',
  'form.isActive': 'Active',
  'form.required': 'Required',

  // Validation messages
  'validation.required': 'This field is required',
  'validation.invalidEmail': 'Please enter a valid email address',
  'validation.invalidAmount': 'Please enter a valid amount',
  'validation.minLength': 'Must be at least {min} characters',

  // Confirmation dialogs
  'confirm.delete': 'Are you sure you want to delete this item?',
  'confirm.deleteAccount':
    'Are you sure you want to delete this account? All associated transactions will also be deleted.',
  'confirm.deleteMember': 'Are you sure you want to delete this family member?',
  'confirm.unsavedChanges': 'You have unsaved changes. Are you sure you want to leave?',

  // Success messages
  'success.saved': 'Changes saved successfully',
  'success.created': 'Created successfully',
  'success.deleted': 'Deleted successfully',
  'success.updated': 'Updated successfully',

  // Error messages
  'error.generic': 'Something went wrong. Please try again.',
  'error.loadFailed': 'Failed to load data',
  'error.saveFailed': 'Failed to save changes',
  'error.deleteFailed': 'Failed to delete',
  'error.networkError': 'Network error. Please check your connection.',

  // Empty states
  'empty.noData': 'No data available',
  'empty.noResults': 'No results found',

  // Filter
  'filter.members': 'Members',
  'filter.allMembers': 'All Members',

  // Date/Time
  'date.today': 'Today',
  'date.yesterday': 'Yesterday',
  'date.thisWeek': 'This Week',
  'date.thisMonth': 'This Month',
  'date.thisYear': 'This Year',
} as const;

export type UIStringKey = keyof typeof UI_STRINGS;

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

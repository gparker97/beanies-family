/**
 * UI Strings Registry
 *
 * All user-facing text in the application should be defined here.
 * This enables dynamic translation of the UI.
 *
 * Increment UI_STRINGS_VERSION when adding or modifying strings
 * to invalidate cached translations.
 */

export const UI_STRINGS_VERSION = 1;

export const UI_STRINGS = {
  // App branding
  'app.name': 'GP Finance',
  'app.tagline': 'Family Financial Planner',
  'app.version': 'v1.0.0 - MVP',

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

  // Dashboard
  'dashboard.netWorth': 'Net Worth',
  'dashboard.assets': 'Assets',
  'dashboard.liabilities': 'Liabilities',
  'dashboard.monthlyIncome': 'Monthly Income',
  'dashboard.monthlyExpenses': 'Monthly Expenses',
  'dashboard.netCashFlow': 'Net Cash Flow',
  'dashboard.recentTransactions': 'Recent Transactions',
  'dashboard.activeGoals': 'Active Goals',
  'dashboard.noTransactions': 'No transactions yet. Add your first transaction to get started.',
  'dashboard.noGoals': 'No active goals. Set a financial goal to track your progress.',

  // Recurring
  'recurring.title': 'Recurring',
  'recurring.monthlyIncome': 'Monthly Recurring Income',
  'recurring.monthlyExpenses': 'Monthly Recurring Expenses',
  'recurring.netMonthly': 'Net Monthly Recurring',
  'recurring.noItems': 'No recurring items yet.',
  'recurring.addItem': 'Add Recurring Item',

  // Accounts
  'accounts.title': 'Accounts',
  'accounts.addAccount': 'Add Account',
  'accounts.editAccount': 'Edit Account',
  'accounts.deleteAccount': 'Delete Account',
  'accounts.noAccounts': 'No accounts yet. Add your first account to get started.',
  'accounts.totalBalance': 'Total Balance',
  'accounts.type.checking': 'Checking',
  'accounts.type.savings': 'Savings',
  'accounts.type.credit_card': 'Credit Card',
  'accounts.type.investment': 'Investment',
  'accounts.type.crypto': 'Cryptocurrency',
  'accounts.type.cash': 'Cash',
  'accounts.type.loan': 'Loan',
  'accounts.type.other': 'Other',

  // Transactions
  'transactions.title': 'Transactions',
  'transactions.addTransaction': 'Add Transaction',
  'transactions.editTransaction': 'Edit Transaction',
  'transactions.deleteTransaction': 'Delete Transaction',
  'transactions.noTransactions': 'No transactions yet.',
  'transactions.type.income': 'Income',
  'transactions.type.expense': 'Expense',
  'transactions.type.transfer': 'Transfer',

  // Assets
  'assets.title': 'Assets',
  'assets.addAsset': 'Add Asset',
  'assets.editAsset': 'Edit Asset',
  'assets.deleteAsset': 'Delete Asset',
  'assets.noAssets': 'No assets yet. Add your first asset to track your wealth.',
  'assets.type.real_estate': 'Real Estate',
  'assets.type.vehicle': 'Vehicle',
  'assets.type.investment': 'Investment',
  'assets.type.crypto': 'Cryptocurrency',
  'assets.type.collectible': 'Collectible',
  'assets.type.other': 'Other',

  // Goals
  'goals.title': 'Goals',
  'goals.addGoal': 'Add Goal',
  'goals.editGoal': 'Edit Goal',
  'goals.deleteGoal': 'Delete Goal',
  'goals.noGoals': 'No goals yet. Set a financial goal to track your progress.',
  'goals.type.savings': 'Savings',
  'goals.type.debt_payoff': 'Debt Payoff',
  'goals.type.investment': 'Investment',
  'goals.type.purchase': 'Purchase',
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
  'reports.noData': 'No data available for reports yet.',

  // Forecast
  'forecast.title': 'Forecast',
  'forecast.noData': 'No data available for forecasting yet.',

  // Settings
  'settings.title': 'Settings',
  'settings.general': 'General',
  'settings.baseCurrency': 'Base Currency',
  'settings.displayCurrency': 'Display Currency',
  'settings.theme': 'Theme',
  'settings.theme.light': 'Light',
  'settings.theme.dark': 'Dark',
  'settings.theme.system': 'System',
  'settings.language': 'Language',
  'settings.sync': 'Sync',
  'settings.syncEnabled': 'Sync Enabled',
  'settings.autoSync': 'Auto Sync',
  'settings.encryption': 'Encryption',
  'settings.exchangeRates': 'Exchange Rates',
  'settings.about': 'About',

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
  'form.fromAccount': 'From Account',
  'form.toAccount': 'To Account',
  'form.owner': 'Owner',
  'form.institution': 'Institution',
  'form.frequency': 'Frequency',
  'form.frequency.daily': 'Daily',
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
  'confirm.deleteAccount': 'Are you sure you want to delete this account? All associated transactions will also be deleted.',
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

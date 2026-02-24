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
  'common.totalAssets': { en: 'Total Assets', beanie: 'All Your Assets' },
  'common.totalLiabilities': { en: 'Total Liabilities', beanie: 'Beans Owed' },
  'common.totalValue': { en: 'Total Value', beanie: 'Total Value' },
  'common.netAssetValue': { en: 'Net Asset Value', beanie: 'Net Asset Value' },
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
  'nav.dashboard': { en: 'Dashboard', beanie: 'Your Nook' },
  'nav.accounts': { en: 'Accounts' },
  'nav.transactions': { en: 'Transactions' },
  'nav.assets': { en: 'Assets' },
  'nav.goals': { en: 'Goals' },
  'nav.reports': { en: 'Reports' },
  'nav.forecast': { en: 'Forecast', beanie: 'Bean Forecast' },
  'nav.family': { en: 'Family Hub', beanie: 'Family Hub' },
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
  'action.change': { en: 'Change' },
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
  'dashboard.netWorth': { en: 'Family Net Worth', beanie: 'Alllllll Your Beans' },
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
  'goals.reopenGoal': { en: 'Reopen Goal', beanie: 'Replant This Bean!' },
  'goals.noCompletedGoals': { en: 'No completed goals yet.', beanie: 'No beans harvested yet.' },
  'goals.completedOn': { en: 'Completed', beanie: 'Harvested' },

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
  'family.gender': { en: 'Gender' },
  'family.gender.male': { en: 'Male', beanie: 'Boy Bean' },
  'family.gender.female': { en: 'Female', beanie: 'Girl Bean' },
  'family.gender.other': { en: 'Other' },
  'family.ageGroup': { en: 'Age Group' },
  'family.ageGroup.adult': { en: 'Adult', beanie: 'Big Bean' },
  'family.ageGroup.child': { en: 'Child', beanie: 'Little Bean' },
  'family.dateOfBirth': { en: 'Date of Birth', beanie: 'Bean Birthday' },
  'family.dateOfBirth.month': { en: 'Month' },
  'family.dateOfBirth.day': { en: 'Day' },
  'family.dateOfBirth.year': { en: 'Year (optional)' },
  'family.avatarPreview': { en: 'Avatar Preview', beanie: 'Your Beanie' },

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
  'form.institution': { en: 'Financial Institution', beanie: 'Bean Bank' },
  'form.country': { en: 'Country' },
  'form.other': { en: 'Other' },
  'form.searchInstitutions': { en: 'Search institutions...', beanie: 'Find a bean bank...' },
  'form.searchCountries': { en: 'Search countries...' },
  'form.enterCustomName': { en: 'Enter institution name' },
  'form.customBadge': { en: 'Custom' },
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
  'date.tomorrow': { en: 'Tomorrow' },
  'date.days': { en: 'days' },
  'date.currentMonth': { en: 'Current Month' },
  'date.lastMonth': { en: 'Last Month' },
  'date.last3Months': { en: 'Last 3 Months' },
  'date.last6Months': { en: 'Last 6 Months' },
  'date.last12Months': { en: 'Last 12 Months' },
  'date.last2Years': { en: 'Last 2 Years' },
  'date.customRange': { en: 'Custom Range' },
  'date.allTime': { en: 'All Time' },
  'date.previousMonth': { en: 'Previous Month' },

  // Months
  'month.january': { en: 'January' },
  'month.february': { en: 'February' },
  'month.march': { en: 'March' },
  'month.april': { en: 'April' },
  'month.may': { en: 'May' },
  'month.june': { en: 'June' },
  'month.july': { en: 'July' },
  'month.august': { en: 'August' },
  'month.september': { en: 'September' },
  'month.october': { en: 'October' },
  'month.november': { en: 'November' },
  'month.december': { en: 'December' },

  // Dashboard (additional)
  'dashboard.savingsGoals': { en: 'Savings Goals', beanie: 'Bean Dreams' },
  'dashboard.seeAll': { en: 'See All →' },
  'dashboard.yourBeans': { en: 'Your Family', beanie: 'The Pod' },
  'dashboard.addBean': { en: 'Add Family Member', beanie: 'Add a Beanie' },
  'dashboard.healthy': { en: 'Healthy', beanie: 'Growing Strong' },
  'dashboard.savingsRate': { en: 'savings rate' },
  'dashboard.recurringSummary': { en: 'Recurring Summary', beanie: 'Regular Bean Summary' },
  'dashboard.netRecurring': { en: 'Net Recurring (Monthly)', beanie: 'Net Beans (Monthly)' },
  'dashboard.upcoming': { en: 'Upcoming', beanie: 'Coming Up' },
  'dashboard.noRecurringItems': { en: 'No recurring items yet', beanie: 'No regular beans yet' },
  'dashboard.roleParent': { en: 'Parent', beanie: 'Big Bean' },
  'dashboard.roleLittleBean': { en: 'Little Bean' },
  'dashboard.chartHidden': { en: 'Chart hidden' },
  'dashboard.noDataYet': { en: 'No data yet', beanie: 'No beans to chart yet' },

  // Greeting
  'greeting.morning': { en: 'Good morning,' },
  'greeting.afternoon': { en: 'Good afternoon,' },
  'greeting.evening': { en: 'Good evening,' },

  // Header / Privacy
  'header.hideFinancialFigures': {
    en: 'Hide financial figures',
    beanie: 'Cover the beans',
  },
  'header.showFinancialFigures': {
    en: 'Show financial figures',
    beanie: 'Show the beans',
  },
  'header.financialFiguresVisible': { en: 'Financial figures visible' },
  'header.financialFiguresHidden': { en: 'Financial figures hidden' },
  'header.notifications': { en: 'Notifications' },

  // Sidebar
  'sidebar.noDataFile': { en: 'No data file' },
  'sidebar.dataEncrypted': { en: 'Data encrypted' },
  'sidebar.notEncrypted': { en: 'Not encrypted' },
  'sidebar.noDataFileConfigured': { en: 'No data file configured' },
  'sidebar.dataEncryptedFull': { en: 'Data encrypted (AES-256-GCM)' },
  'sidebar.dataFileNotEncrypted': { en: 'Data file not encrypted' },

  // Transactions (additional)
  'transactions.showing': { en: 'Showing:' },
  'transactions.income': { en: 'Income', beanie: 'Beans In' },
  'transactions.expenses': { en: 'Expenses', beanie: 'Beans Out' },
  'transactions.net': { en: 'Net' },
  'transactions.noTransactionsForPeriod': {
    en: 'No transactions found for this period',
    beanie: 'No bean moves found for this period',
  },
  'transactions.tryDifferentRange': {
    en: 'Try selecting a different date range or add a new transaction.',
    beanie: 'Try a different date range or add a new bean move.',
  },
  'transactions.deleteConfirm': {
    en: 'Are you sure you want to delete this transaction?',
    beanie: 'Remove this bean move for good?',
  },
  'transactions.descriptionPlaceholder': {
    en: 'e.g., Grocery shopping',
  },

  // Reports (additional)
  'reports.next3Months': { en: 'Next 3 Months' },
  'reports.next6Months': { en: 'Next 6 Months' },
  'reports.next1Year': { en: 'Next 1 Year' },
  'reports.next2Years': { en: 'Next 2 Years' },
  'reports.next5Years': { en: 'Next 5 Years' },
  'reports.next10Years': { en: 'Next 10 Years' },
  'reports.next15Years': { en: 'Next 15 Years' },
  'reports.next20Years': { en: 'Next 20 Years' },
  'reports.allFamilyMembers': { en: 'All Family Members' },
  'reports.allCategories': { en: 'All Categories' },

  // Family (additional)
  'family.cannotDeleteOwner': { en: 'Cannot delete the owner account.' },
  'family.deleteConfirm': {
    en: 'Are you sure you want to remove this family member?',
    beanie: 'Remove this beanie from the pod?',
  },
  'family.editFamilyName': { en: 'Edit family name' },
  'family.createLogin': { en: 'Create Login' },
  'family.enterName': { en: 'Enter name' },
  'family.enterEmail': { en: 'Enter email' },
  'family.emailNotSet': { en: 'No email yet' },
  'family.profileColor': { en: 'Profile Color' },
  'family.year': { en: 'Year' },
  'family.status.waitingToJoin': {
    en: 'Waiting to join',
    beanie: 'Waiting to sprout',
  },
  'family.status.active': {
    en: 'Active',
    beanie: 'Sprouted',
  },
  'family.lastSeen': { en: 'Last seen {date}' },
  'family.neverLoggedIn': { en: 'Never signed in' },
  'family.inviteMember': { en: 'Invite {name}' },
  'family.linkCopied': {
    en: 'Invite link copied!',
    beanie: 'Magic bean link copied!',
  },
  'family.copyInviteLinkHint': {
    en: 'Copy and share your magic link with your family member',
    beanie: 'Copy the magic bean link for this beanie',
  },
  'family.inviteSection.title': {
    en: 'Invite to join',
    beanie: 'Sprout this beanie',
  },
  'family.inviteSection.desc': {
    en: "This member hasn't joined yet. Share the link below so they can set up their account.",
    beanie: "This beanie hasn't sprouted yet! Share the magic link so they can join the pod.",
  },
  'family.inviteSection.step1': {
    en: 'Copy the invite link and send it to them',
    beanie: 'Copy the magic bean link and send it their way',
  },
  'family.inviteSection.step2': {
    en: 'They open the link and choose a password',
    beanie: 'They open the link and pick a secret bean code',
  },
  'family.inviteSection.step3': {
    en: "They're in! They can now sign in with their own account",
    beanie: "They've sprouted! They can now sign into the pod",
  },

  // Settings (additional)
  'settings.preferredCurrencies': { en: 'Preferred Currencies' },
  'settings.preferredCurrenciesHint': {
    en: 'Select up to 4 currencies to show in the header',
  },
  'settings.addCurrency': { en: 'Add currency...' },
  'settings.familyDataOptions': { en: 'Family Data Options' },
  'settings.familyDataDescription': {
    en: "Your family's financial data is encrypted and safely stored in a file you control.",
    beanie: 'Your beans are safe — encrypted and stored in a file only you control.',
  },
  'settings.saveDataToFile': { en: 'Save your data to a file' },
  'settings.createOrLoadDataFile': {
    en: 'Create an encrypted data file or load an existing one.',
  },
  'settings.createNewDataFile': { en: 'Create New Family Data File' },
  'settings.loadExistingDataFile': { en: 'Load Existing Family Data File' },
  'settings.loadFileConfirmation': {
    en: 'This will replace all local data with the contents of the selected file and set it as your data file. Continue?',
  },
  'settings.yesLoadFile': { en: 'Yes, Load File' },
  'settings.grantPermissionPrompt': {
    en: 'Click to grant permission to access your data file.',
  },
  'settings.grantPermission': { en: 'Grant Permission' },
  'settings.myFamilyData': { en: "My Family's Data" },
  'settings.saving': { en: 'Saving...', beanie: 'Saving beans...' },
  'settings.error': { en: 'Error' },
  'settings.saved': { en: 'Saved' },
  'settings.lastSaved': { en: 'Last Saved' },
  'settings.loadAnotherDataFile': { en: 'Load another Family Data File' },
  'settings.switchDataFile': { en: 'Switch to a different data file' },
  'settings.browse': { en: 'Browse...' },
  'settings.switchFileConfirmation': {
    en: 'This will replace all local data with the contents of the selected file and switch to that file. Continue?',
  },
  'settings.dataLoadedSuccess': { en: 'Data loaded successfully!' },
  'settings.encryptDataFile': { en: 'Encrypt data file' },
  'settings.encrypted': { en: 'Encrypted' },
  'settings.unencrypted': { en: 'Unencrypted' },
  'settings.encryptionDescription': {
    en: 'Protect your data with password encryption',
    beanie: 'Lock your beans with a password',
  },
  'settings.disableEncryptionWarning': {
    en: 'Disabling encryption means your financial data will be stored as clear text and could be read by anyone with access to the file. Are you sure?',
  },
  'settings.yesDisableEncryption': { en: 'Yes, Disable Encryption' },
  'settings.passwordNote': {
    en: "Note: You'll need to enter your password when you return to access your data.",
  },
  'settings.noAutoSyncWarning': {
    en: "Your browser doesn't support automatic file saving. Use manual export/import instead. For automatic saving, use Chrome or Edge.",
  },
  'settings.downloadYourData': { en: 'Download Your Data' },
  'settings.downloadDataDescription': { en: 'Download your data as a JSON file' },
  'settings.loadDataFile': { en: 'Load Data File' },
  'settings.loadDataFileDescription': { en: 'Load data from a JSON file' },
  'settings.security': { en: 'Security' },
  'settings.exportTranslationCache': { en: 'Export Translation Cache' },
  'settings.exportTranslationCacheDescription': {
    en: 'Download cached translations as a JSON file to commit to the repository',
  },
  'settings.exportTranslations': { en: 'Export Translations' },

  // Password modal
  'password.setPassword': { en: 'Set Encryption Password' },
  'password.setPasswordDescription': {
    en: "Choose a strong password to encrypt your data file. You'll need this password each time you open the app.",
  },
  'password.enableEncryption': { en: 'Enable Encryption' },
  'password.enterPassword': { en: 'Enter Password' },
  'password.enterPasswordDescription': {
    en: 'This file is encrypted. Enter your password to decrypt and load the data.',
  },
  'password.decryptAndLoad': { en: 'Decrypt & Load' },
  'password.encryptionError': { en: 'Encryption Error' },
  'password.password': { en: 'Password' },
  'password.enterPasswordPlaceholder': { en: 'Enter password' },
  'password.confirmPassword': { en: 'Confirm Password' },
  'password.confirmPasswordPlaceholder': { en: 'Confirm password' },
  'password.required': { en: 'Password is required' },
  'password.mismatch': { en: 'Passwords do not match' },
  'password.decryptionError': { en: 'Decryption Error' },
  'password.setAndContinue': { en: 'Set Password & Continue' },
  'password.strongPasswordDescription': {
    en: "Choose a strong password to protect your data file. You'll need this password each time you open the app.",
  },
  'password.encryptedFileDescription': {
    en: 'This file is encrypted. Enter your password to decrypt and load your data.',
  },

  // Setup (kept: keys used by CreatePodView.vue)
  'setup.yourName': { en: 'Your Name' },
  'setup.fileCreateFailed': {
    en: 'Failed to create file. Please try again.',
  },

  // Auth
  'auth.signingIn': { en: 'Signing in...' },
  'auth.creatingAccount': { en: 'Creating account...' },
  'auth.signOut': { en: 'Sign Out' },
  'auth.fillAllFields': { en: 'Please fill in all fields' },
  'auth.passwordsDoNotMatch': { en: 'Passwords do not match' },
  'auth.passwordMinLength': { en: 'Password must be at least 8 characters' },
  'auth.createPasswordPrompt': {
    en: 'Create a password for your account. You will use this to sign in next time.',
  },
  'auth.createPasswordPlaceholder': { en: 'Choose a password (min 8 characters)' },
  'auth.createAndSignIn': { en: 'Create Password & Sign In' },
  'auth.familyName': { en: 'Family Name' },
  'auth.familyNamePlaceholder': { en: 'The Smith Family' },
  'auth.yourNamePlaceholder': { en: 'John Smith' },
  'auth.passwordPlaceholder': { en: 'At least 8 characters' },

  // Common actions (additional)
  'action.ok': { en: 'OK' },
  'action.continue': { en: 'Continue' },
  'action.apply': { en: 'Apply' },
  'action.download': { en: 'Download' },
  'action.load': { en: 'Load' },
  'action.seeAll': { en: 'See All' },

  // Confirmation dialog titles
  'confirm.deleteAccountTitle': { en: 'Delete Account', beanie: 'Remove Bean Jar' },
  'confirm.deleteTransactionTitle': { en: 'Delete Transaction', beanie: 'Remove Bean Move' },
  'confirm.deleteRecurringTitle': { en: 'Delete Recurring Item', beanie: 'Remove Regular Bean' },
  'confirm.deleteAssetTitle': { en: 'Delete Asset', beanie: 'Remove Valuable Bean' },
  'confirm.deleteGoalTitle': { en: 'Delete Goal', beanie: 'Remove Bean Dream' },
  'confirm.deleteMemberTitle': { en: 'Remove Family Member', beanie: 'Remove Beanie' },
  'confirm.removePasskeyTitle': { en: 'Remove Passkey' },
  'confirm.cannotDeleteOwnerTitle': { en: 'Cannot Delete Owner' },

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

  // Trusted device
  'trust.title': { en: 'Do you trust this device?' },
  'trust.description': {
    en: 'If this is a trusted device (i.e. your personal phone or laptop), you can keep your data cached locally for instant access next time you sign in.',
  },
  'trust.trustButton': { en: 'Yes, I trust this device' },
  'trust.notNow': { en: 'Not now' },
  'trust.hint': {
    en: 'You can change this in Settings. Use "Sign out & clear data" to remove cached data.',
  },
  'trust.settingsLabel': { en: 'Trusted device' },
  'trust.settingsDesc': {
    en: 'Keep data cached locally (unecrypted) between sign-ins for faster access',
  },
  'auth.signOutClearData': { en: 'Sign out & clear data' },

  // File-based auth
  'auth.selectMember': { en: 'Select your profile' },
  'auth.enterPassword': { en: 'Please enter your password' },
  'auth.loadingFile': { en: 'counting beans...', beanie: 'counting beans...' },
  'auth.reconnectFile': {
    en: 'Your data file was found but needs permission to access. Click below to reconnect.',
  },
  'auth.reconnectButton': { en: 'Reconnect to data file' },
  'auth.noMembersWithPassword': {
    en: 'No members have set a password yet. Please complete onboarding first.',
  },
  'auth.fileLoadFailed': { en: 'Failed to load file. Please try again.' },
  'auth.fileNotEncryptedWarning': {
    en: 'This data file is not encrypted. Anyone with access to the file can view your family data. You can enable encryption in Settings.',
  },
  'auth.password': { en: 'Password' },
  'auth.enterYourPassword': { en: 'Enter your password' },
  'auth.signInFailed': { en: 'Sign in failed' },
  'auth.signUpFailed': { en: 'Sign up failed' },
  'auth.createPassword': { en: 'Create a password' },
  'auth.confirmPassword': { en: 'Confirm password' },
  'auth.confirmPasswordPlaceholder': { en: 'Re-enter your password' },

  // Login — Invite / Join
  'login.inviteAsParent': { en: 'Parent', beanie: 'Big Bean' },
  'login.inviteAsChild': { en: 'Child', beanie: 'Little Bean' },
  'login.inviteRoleLabel': { en: 'Inviting as' },
  'login.familyCodePlaceholder': { en: 'Enter the code from your family' },
  'login.inviteTitle': { en: 'Invite family member' },
  'login.inviteDesc': {
    en: 'Share this code with family members so they can join your pod',
  },
  'login.inviteCode': { en: 'Family code' },
  'login.inviteLink': { en: 'Or share this link' },
  'login.copied': { en: 'Copied!' },
  'login.copyCode': { en: 'Copy code' },
  'login.copyLink': { en: 'Copy link' },

  // Login v6 redesign
  'loginV6.badgeEncrypted': { en: 'End-to-End Encrypted' },
  'loginV6.badgeSecurity': { en: 'Bank-Grade Security' },
  'loginV6.badgeLove': { en: 'Built with Love' },
  'loginV6.badgeZeroServers': { en: 'Zero Data on Our Servers' },
  'loginV6.welcomePrompt': { en: 'What would you like to do?' },
  'loginV6.signInTitle': { en: 'Sign in', beanie: 'Sign in to your pod' },
  'loginV6.signInSubtitle': { en: 'Load your family data file' },
  'loginV6.createTitle': { en: 'Create a new pod!', beanie: 'Start a new pod!' },
  'loginV6.createSubtitle': {
    en: "Start your family's financial journey",
    beanie: 'Plant your first bean!',
  },
  'loginV6.joinTitle': { en: 'Join an existing pod' },
  'loginV6.joinSubtitle': { en: 'Your family is waiting for you', beanie: 'Your pod awaits!' },
  'loginV6.loadPodTitle': { en: 'Load your pod' },
  'loginV6.loadPodSubtitle': { en: 'Your data stays on your device — always' },
  'loginV6.dropZoneText': { en: 'Drop your .beanpod file here' },
  'loginV6.dropZoneBrowse': { en: 'or click to browse' },
  'loginV6.cloudComingSoon': { en: 'Coming soon' },
  'loginV6.securityYourData': { en: 'Your Data, Your Cloud' },
  'loginV6.securityEncrypted': { en: 'AES-256 Encrypted' },
  'loginV6.securityZeroServers': { en: 'Zero Servers, Zero Tracking' },
  'loginV6.fileLoaded': { en: 'loaded' },
  'loginV6.unlockTitle': { en: 'Unlock your pod' },
  'loginV6.unlockSubtitle': { en: 'Enter your pod password to decrypt your family data' },
  'loginV6.unlockButton': { en: 'Unlock Pod' },
  'loginV6.unlockFooter': {
    en: "This password decrypts your local data. We don't store or recover it.",
  },
  'loginV6.switchFamily': { en: 'Switch to a different family' },
  'loginV6.pickBeanTitle': { en: "Who's signing in?", beanie: 'Pick your bean!' },
  'loginV6.pickBeanSubtitle': { en: 'Pick your bean' },
  'loginV6.parentBean': { en: 'Parent Bean', beanie: 'Big Bean' },
  'loginV6.littleBean': { en: 'Little Bean' },
  'loginV6.setupNeeded': { en: 'Set up' },
  'loginV6.signInAs': { en: 'Sign in as' },
  'loginV6.createStep1': { en: 'You' },
  'loginV6.createStep2': { en: 'Save & Secure' },
  'loginV6.createStep3': { en: 'Family' },
  'loginV6.createNext': { en: 'Next' },
  'loginV6.createButton': { en: 'Create Pod' },
  'loginV6.alreadyHavePod': { en: 'Already have a pod?' },
  'loginV6.loadItLink': { en: 'Load it' },
  'loginV6.passwordHint': { en: 'This encrypts your data file' },
  'loginV6.storageTitle': { en: 'Where should we save your pod?' },
  'loginV6.storageLocal': { en: 'Local file' },
  'loginV6.storageLocalDesc': { en: 'Save a .beanpod file to your device' },
  'loginV6.addBeansTitle': { en: 'Add your family members', beanie: 'Add your beanies' },
  'loginV6.addBeansSubtitle': {
    en: 'You can always add more later',
    beanie: 'More beans can join later!',
  },
  'loginV6.addMember': { en: 'Add Member', beanie: 'Add Beanie' },
  'loginV6.finish': { en: 'Finish' },
  'loginV6.skip': { en: 'Skip for now' },
  'loginV6.joinInput': { en: 'Family code or magic link' },
  'loginV6.whatsNext': { en: 'What happens next?' },
  'loginV6.joinStep1': { en: "We'll verify your family and load the data file" },
  'loginV6.joinStep2': { en: "You'll pick your profile and create a password" },
  'loginV6.joinStep3': { en: "Then you're in!", beanie: "Then you're a bean!" },
  'loginV6.joinButton': { en: "Join My Family's Pod", beanie: 'Join the Pod!' },
  'loginV6.joinNotAvailable': {
    en: 'Joining a pod isn\'t available yet. Ask your family to share their .beanpod file with you and use "Sign in to your pod" instead.',
  },
  'loginV6.wantYourOwn': { en: 'Want your own?' },
  'loginV6.createLink': { en: 'Create a new pod' },
  'loginV6.acceptsBeanpod': { en: 'Accepts .beanpod files' },
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
  'loginV6.growPodTitle': { en: 'Grow a brand-new pod' },
  'loginV6.growPodSubtitle': {
    en: 'Name your family pod and create your sign-in password.',
  },
  'loginV6.encryptionPasswordLabel': { en: 'Pod data file encryption password' },
  'loginV6.signInPasswordLabel': { en: 'Your sign-in password' },
  'loginV6.signInPasswordHint': {
    en: "You'll use this password to sign into your bean profile",
  },
  'loginV6.storageDescription': {
    en: "We don't store your data on any server or database \u2014 your family's finances stay entirely in your hands. Choose where your encrypted .beanpod file lives, and only you hold the key.",
  },
  'loginV6.storageSectionLabel': { en: 'Where should we save your pod?' },
  'loginV6.step2Title': { en: 'Save & secure your pod' },
  'loginV6.step2Subtitle': {
    en: 'Choose where to store your encrypted data file and set a password to protect it.',
  },
  'loginV6.podPasswordOptional': {
    en: 'Optional \u2014 you can enable encryption later in Settings',
  },
  'loginV6.confirmPodPassword': { en: 'Confirm pod password' },
  'loginV6.addMemberFailed': { en: 'Failed to add member. Please try again.' },
  'loginV6.removeMember': { en: 'Remove' },
  'loginV6.you': { en: 'You' },

  // Join flow (magic link invites)
  'join.verifyTitle': { en: 'Join your family', beanie: 'Join your pod!' },
  'join.verifySubtitle': { en: "Let's find your family" },
  'join.lookingUp': { en: 'Looking up your family...', beanie: 'Finding your pod...' },
  'join.familyFound': { en: 'Family found!', beanie: 'Pod found!' },
  'join.familyNotFound': {
    en: 'Family not found. Check the code and try again.',
    beanie: 'Pod not found. Check the code and try again.',
  },
  'join.registryOffline': {
    en: "We couldn't reach the registry. You can still join by loading the shared file directly.",
  },
  'join.needsFile': { en: 'You need the family data file', beanie: 'You need the pod file' },
  'join.needsFileDesc': {
    en: 'Ask the owner to share the .beanpod file with you via email, a shared cloud folder, or USB.',
  },
  'join.expectedFile': { en: 'Look for a file named:' },
  'join.fileMismatch': {
    en: 'This file belongs to a different family. Please load the correct file.',
    beanie: 'This file belongs to a different pod. Please load the correct file.',
  },
  'join.loadFileButton': { en: 'Load .beanpod file' },
  'join.dropZoneText': { en: 'Drop the shared .beanpod file here' },
  'join.pickMemberTitle': { en: 'Which one is you?', beanie: 'Pick your bean!' },
  'join.pickMemberSubtitle': { en: 'Select the profile created for you' },
  'join.noUnclaimedMembers': {
    en: 'No unclaimed profiles found. Ask the family owner to create your profile first.',
    beanie: 'No unclaimed beans found. Ask the pod owner to plant your bean first.',
  },
  'join.setPasswordTitle': { en: 'Create your password' },
  'join.setPasswordSubtitle': { en: 'This password is just for you to sign in' },
  'join.completing': { en: 'Joining your family...', beanie: 'Planting your bean...' },
  'join.success': { en: 'Welcome to the family!', beanie: 'Welcome to the pod!' },
  'join.shareFileNote': {
    en: 'Important: also share the .beanpod file with them (email, cloud folder, or USB)',
  },
  'join.enterCodeManually': { en: 'Or enter a family code manually' },
  'join.codeInputLabel': { en: 'Family code' },
  'join.codeInputHint': {
    en: 'Paste the family code or invite link shared by your family member',
    beanie: 'Paste the pod code or invite link shared by your pod mate',
  },
  'join.next': { en: 'Next' },

  // PWA / Offline / Install
  'pwa.offlineBanner': {
    en: "You're offline — changes are saved locally",
    beanie: "You're offline — beans are safe in the pod",
  },
  'pwa.installTitle': { en: 'Install beanies.family', beanie: 'Install beanies.family' },
  'pwa.installDescription': {
    en: 'Add to your home screen for the best experience',
    beanie: 'Plant the app on your home screen',
  },
  'pwa.installButton': { en: 'Install', beanie: 'Plant it!' },
  'pwa.installDismiss': { en: 'Not now' },
  'pwa.updateAvailable': { en: 'A new version is available', beanie: 'Fresh beans are ready!' },
  'pwa.updateButton': { en: 'Update now', beanie: 'Get the fresh beans' },
  'pwa.updateDismiss': { en: 'Later' },
  'settings.installApp': { en: 'Install App' },
  'settings.installAppDesc': {
    en: 'Install beanies.family on this device for quick access',
    beanie: 'Plant beanies.family on this device',
  },
  'settings.installAppButton': { en: 'Install beanies.family' },
  'settings.appInstalled': { en: 'App is installed', beanie: 'App is planted!' },

  // Mobile navigation
  'mobile.nook': { en: 'Nook', beanie: 'Nook' },
  'mobile.pod': { en: 'Pod', beanie: 'Pod' },
  'mobile.menu': { en: 'Menu' },
  'mobile.closeMenu': { en: 'Close menu' },
  'mobile.navigation': { en: 'Navigation' },
  'mobile.controls': { en: 'Controls' },
  'mobile.viewingAll': { en: 'Viewing: All Members' },
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

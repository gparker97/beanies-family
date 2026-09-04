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
  // The single word in `app.tagline` rendered with the brand gradient on the
  // welcome page. Kept separate so the i18n value stays plain text.
  'app.taglineAccent': { en: 'bean' },

  // Global search
  // Blog
  'blog.title': {
    en: 'Welcome to the Beanie Beanstalk!',
    beanie: 'welcome to the beanie beanstalk!',
  },
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
  // Standard "created by + when" drawer footer (see CreatedMeta.vue). Reads as
  // a phrase ("Created by Greg · 21 Apr 2026 at 8:30am") so en uses Sentence case.
  'common.createdBy': { en: 'Created by', beanie: 'created by' },
  'common.purchased': { en: 'Purchased', beanie: 'purchased' },
  'common.save': { en: 'Save', beanie: 'save' },
  'common.beta': { en: 'Beta', beanie: 'beta' },
  'common.cancel': { en: 'Cancel', beanie: 'cancel' },
  'common.delete': { en: 'Delete', beanie: 'delete' },
  'common.saving': { en: 'Saving...', beanie: 'counting beans...' },
  'common.shared': { en: 'Shared', beanie: 'everyone' },
  'common.all': { en: 'All', beanie: 'all' },
  'common.none': { en: 'None', beanie: 'none' },
  'common.whatsThis': { en: "What's this?", beanie: "what's this?" },
  'common.family': { en: 'Family', beanie: 'the pod' },

  // BaseCombobox shared
  'combobox.showingHint': {
    en: 'Showing {visible} of {total} — keep typing to narrow',
    beanie: 'showing {visible} of {total} — keep typing to narrow',
  },

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
  // Transfers (move money between accounts; a credit-card payment is a transfer)
  'transfer.type': { en: 'Transfer', beanie: 'transfer' },
  'transfer.from': { en: 'From', beanie: 'from' },
  'transfer.to': { en: 'To', beanie: 'to' },
  'transfer.selectDestination': {
    en: 'Select destination account...',
    beanie: 'select destination account...',
  },
  'transfer.liabilityHint': {
    en: 'Paying this reduces what you owe on it.',
    beanie: 'paying this reduces what you owe on it.',
  },
  'transfer.youSend': { en: 'You send', beanie: 'you send' },
  'transfer.theyReceive': { en: 'They receive', beanie: 'they receive' },
  'transfer.convertedNote': {
    en: "Converted at today's exchange rate.",
    beanie: "converted at today's exchange rate.",
  },
  'transfer.noRate': {
    en: 'No exchange rate for {from} → {to}. Add one in Settings → Currencies.',
    beanie: 'no exchange rate for {from} → {to}. add one in settings → currencies.',
  },
  'transfer.filter': { en: 'Transfers', beanie: 'transfers' },
  // Account-picker groups + the "owed" prefix shown for liability balances
  'txn.owedLabel': { en: 'owed', beanie: 'owed' },
  'txn.accountGroup.cash': { en: 'Cash & Bank', beanie: 'cash & bank' },
  'txn.accountGroup.cards': { en: 'Credit Cards', beanie: 'credit cards' },
  'txn.accountGroup.investments': { en: 'Investments', beanie: 'investments' },
  'txn.accountGroup.loans': { en: 'Loans', beanie: 'loans' },
  'txn.accountGroup.other': { en: 'Other', beanie: 'other' },
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
  'modal.petBean': { en: 'Pet Bean', beanie: 'pet bean' },
  'modal.addPet': { en: 'Add Pet', beanie: 'add pet' },
  'modal.editPet': { en: 'Edit Pet', beanie: 'edit pet' },
  'modal.savePet': { en: 'Save Pet', beanie: 'save pet' },
  'modal.addPetToPod': { en: 'Add to Family', beanie: 'add to pod' },
  'modal.petHint': {
    en: "Pets are part of your pod, but don't ask them to sign in — they're notoriously bad at using computers.",
    beanie:
      "pets are part of your pod, but don't ask them to sign in — they're notoriously bad at using computers.",
  },
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
  'modal.remainingAmount': { en: 'Remaining Amount', beanie: 'remaining amount' },
  'modal.priority': { en: 'Priority', beanie: 'priority' },
  'modal.deadline': { en: 'Deadline', beanie: 'deadline' },
  'modal.memberName': { en: 'Name', beanie: 'name' },
  'modal.role': { en: 'Role', beanie: 'role' },
  'modal.birthday': { en: 'Birthday', beanie: 'birthday' },
  'modal.profileColor': { en: 'Profile Color', beanie: 'profile color' },
  'modal.permissions': { en: 'Permissions', beanie: 'permissions' },
  'modal.canViewFinances': {
    en: 'Can view and edit finances',
    beanie: 'can view and edit finances',
  },
  'modal.canEditActivities': {
    en: 'Can edit family activities and plans',
    beanie: 'can edit family activities and plans',
  },
  'modal.canManagePod': { en: 'Can manage family members', beanie: 'can manage family members' },

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
  'nav.pod': { en: 'The Pod', beanie: 'the pod' },
  'nav.pod.meetBeans': { en: 'Meet the Beans', beanie: 'meet the beans' },
  'nav.pod.scrapbook': { en: 'Family Scrapbook', beanie: 'family scrapbook' },
  'nav.pod.milestones': { en: 'Family Milestones', beanie: 'family milestones' },
  'nav.pod.cookbook': { en: 'Family Cookbook', beanie: 'family cookbook' },
  'nav.pod.safety': { en: 'Care & Safety', beanie: 'care & safety' },
  'nav.pod.contacts': { en: 'Emergency Contacts', beanie: 'emergency contacts' },
  'bean.detail.title': { en: 'Bean Detail', beanie: 'meet this bean' },
  'bean.backToPod': { en: 'Back to the Pod', beanie: 'back to the pod' },
  'bean.tab.overview': { en: 'Overview', beanie: 'overview' },
  'bean.tab.favorites': { en: 'Favorites', beanie: 'favorites' },
  'bean.tab.sayings': { en: 'Sayings', beanie: 'sayings' },
  'bean.tab.allergies': { en: 'Allergies', beanie: 'allergies' },
  'bean.tab.medications': { en: 'Medications', beanie: 'medications' },
  'bean.tab.notes': { en: 'Notes', beanie: 'notes' },
  'bean.hero.birthday': { en: 'Birthday', beanie: 'birthday' },
  'bean.hero.role.parent': { en: 'Adult', beanie: 'parent bean' },
  'bean.hero.role.child': { en: 'Child', beanie: 'little bean' },
  // Bean Detail → "Account access" panel — admin-only recovery surface.
  // Shown when the viewing admin can reset the bean's password (not self,
  // not owner, not pet, member has joined).
  'bean.account.title': { en: 'Account Access', beanie: 'account access' },
  'bean.account.description': {
    en: "{name} signs in with their 6-digit PIN. If they've forgotten it (or never had one), you can set a new PIN here and share it with them.",
    beanie:
      "{name} signs in with their 6-digit pin. if they've forgotten it (or never had one), set a new one here and share it.",
  },
  'bean.account.resetButton': { en: "Reset {name}'s PIN", beanie: "reset {name}'s pin" },
  'bean.notFound.title': { en: "We can't find this member", beanie: "can't find this bean" },
  'bean.notFound.body': {
    en: "This member isn't in your pod (or has been removed).",
    beanie: "this bean isn't in your pod",
  },
  'bean.overview.comingSoon': {
    en: 'More details about this member land here soon.',
    beanie: 'more details about this bean land here soon',
  },
  'bean.overview.favorites.empty': {
    en: 'No favorites yet',
    beanie: 'no favorites yet',
  },
  'bean.overview.sayings.empty': {
    en: 'No sayings yet',
    beanie: 'no sayings yet',
  },
  'bean.overview.notes.empty': {
    en: 'No notes yet',
    beanie: 'no notes yet',
  },
  'bean.overview.allergies.empty': {
    en: 'No allergies on file',
    beanie: 'no allergies on file',
  },
  'bean.overview.medications.empty': {
    en: 'No medications on file',
    beanie: 'no medications on file',
  },
  'bean.overview.milestones.empty': {
    en: 'No milestones yet',
    beanie: 'no milestones yet',
  },
  'bean.overview.viewAll': { en: 'View all →', beanie: 'view all →' },
  'bean.overview.about': { en: 'About', beanie: 'about' },
  'bean.stats.favorites': { en: 'favorites', beanie: 'favorites' },
  'bean.stats.sayings': { en: 'sayings', beanie: 'sayings' },
  'bean.stats.notes': { en: 'notes', beanie: 'notes' },
  'bean.stats.age': { en: 'years old', beanie: 'years old' },
  'bean.hero.edit': { en: 'Edit', beanie: 'edit' },
  'bean.hero.addSomething': { en: 'Add Something', beanie: 'add something' },
  'bean.hero.invite': { en: 'Invite {name}', beanie: 'invite {name}' },
  'bean.hero.add.favorite': { en: '💝 Favorite', beanie: '💝 favorite' },
  'bean.hero.add.saying': { en: '💬 Saying', beanie: '💬 saying' },
  'bean.hero.add.milestone': { en: '🌟 Milestone', beanie: '🌟 milestone' },
  'bean.hero.add.note': { en: '📝 Note', beanie: '📝 note' },
  'bean.hero.add.allergy': { en: '⚠️ Allergy', beanie: '⚠️ allergy' },
  'bean.hero.add.medication': { en: '💊 Medication', beanie: '💊 medication' },
  'bean.about.role': { en: 'Role', beanie: 'role' },
  'bean.about.birthday': { en: 'Birthday', beanie: 'birthday' },
  'bean.about.joined': { en: 'Joined The Pod', beanie: 'joined the pod' },
  'bean.about.ageOnly': { en: 'age {age}', beanie: 'age {age}' },
  'bean.about.joinedAgo.day': { en: '{n} day ago', beanie: '{n} day ago' },
  'bean.about.joinedAgo.days': { en: '{n} days ago', beanie: '{n} days ago' },
  'bean.about.joinedAgo.week': { en: '{n} week ago', beanie: '{n} week ago' },
  'bean.about.joinedAgo.weeks': { en: '{n} weeks ago', beanie: '{n} weeks ago' },
  'bean.about.joinedAgo.month': { en: '{n} month ago', beanie: '{n} month ago' },
  'bean.about.joinedAgo.months': { en: '{n} months ago', beanie: '{n} months ago' },
  'bean.about.joinedAgo.year': { en: '{n} year ago', beanie: '{n} year ago' },
  'bean.about.joinedAgo.years': { en: '{n} years ago', beanie: '{n} years ago' },
  // Favorites
  'favorites.addTitle': { en: 'Add a Favorite', beanie: 'add a favorite' },
  'favorites.editTitle': { en: 'Edit Favorite', beanie: 'edit favorite' },
  'favorites.addTile': { en: 'Add favorite', beanie: 'add favorite' },
  'favorites.field.category': { en: 'Category', beanie: 'category' },
  'favorites.field.name': { en: 'Name', beanie: 'name' },
  'favorites.field.description': { en: 'Why it matters', beanie: 'why it matters' },
  'favorites.placeholder.name': {
    en: 'e.g. Spaghetti carbonara',
    beanie: 'e.g. spaghetti carbonara',
  },
  'favorites.placeholder.description': {
    en: 'A short note — optional',
    beanie: 'a short note — optional',
  },
  'favorites.category.food': { en: 'Food', beanie: 'food' },
  'favorites.category.place': { en: 'Place', beanie: 'place' },
  'favorites.category.book': { en: 'Book', beanie: 'book' },
  'favorites.category.song': { en: 'Song', beanie: 'song' },
  'favorites.category.toy': { en: 'Toy', beanie: 'toy' },
  'favorites.category.other': { en: 'Other', beanie: 'other' },
  'favorites.empty': {
    en: 'No favorites for this member yet',
    beanie: 'no favorites for this bean yet',
  },
  'favorites.emptyCTA': { en: 'Add the first one', beanie: 'add the first one' },
  'favorites.deleteConfirm.title': {
    en: 'Delete this favorite?',
    beanie: 'delete this favorite?',
  },
  'favorites.deleteConfirm.body': {
    en: 'You can always add it again later.',
    beanie: 'you can always add it again later',
  },
  // Sayings
  'sayings.addTitle': { en: 'Add a Saying', beanie: 'add a saying' },
  'sayings.editTitle': { en: 'Edit Saying', beanie: 'edit saying' },
  'sayings.addTile': { en: 'Add saying', beanie: 'add saying' },
  'sayings.field.words': { en: 'What they said', beanie: 'what they said' },
  'sayings.field.saidOn': { en: 'Date', beanie: 'date' },
  'sayings.field.place': { en: 'Place', beanie: 'place' },
  'sayings.field.context': { en: 'Context', beanie: 'context' },
  'sayings.placeholder.words': {
    en: 'e.g. "I\'m the captain now"',
    beanie: 'e.g. "i\'m the captain now"',
  },
  'sayings.placeholder.place': { en: 'e.g. kitchen', beanie: 'e.g. kitchen' },
  'sayings.placeholder.context': {
    en: 'What led up to it — optional',
    beanie: 'what led up to it — optional',
  },
  'sayings.empty': {
    en: 'No sayings saved for this member yet',
    beanie: 'no sayings saved for this bean yet',
  },
  'sayings.emptyCTA': { en: 'Add the first one', beanie: 'add the first one' },
  'sayings.deleteConfirm.title': { en: 'Delete this saying?', beanie: 'delete this saying?' },
  'sayings.deleteConfirm.body': {
    en: "This can't be undone — the quote will be removed.",
    beanie: "this can't be undone — the quote will be removed",
  },
  // Member notes
  'memberNotes.addTitle': { en: 'Add a Note', beanie: 'add a note' },
  'memberNotes.editTitle': { en: 'Edit Note', beanie: 'edit note' },
  'memberNotes.addTile': { en: 'Add note', beanie: 'add note' },
  'memberNotes.field.title': { en: 'Title', beanie: 'title' },
  'memberNotes.field.body': { en: 'Note', beanie: 'note' },
  'memberNotes.placeholder.title': {
    en: 'e.g. Bedtime routine',
    beanie: 'e.g. bedtime routine',
  },
  'memberNotes.placeholder.body': {
    en: 'Anything worth remembering',
    beanie: 'anything worth remembering',
  },
  'memberNotes.empty': {
    en: 'No notes for this member yet',
    beanie: 'no notes for this bean yet',
  },
  'memberNotes.emptyCTA': { en: 'Add the first one', beanie: 'add the first one' },
  'memberNotes.deleteConfirm.title': { en: 'Delete this note?', beanie: 'delete this note?' },
  'memberNotes.deleteConfirm.body': {
    en: "This can't be undone.",
    beanie: "this can't be undone",
  },
  // Allergies
  'allergies.addTitle': { en: 'Add an Allergy', beanie: 'add an allergy' },
  'allergies.editTitle': { en: 'Edit Allergy', beanie: 'edit allergy' },
  'allergies.addTile': { en: 'Add allergy', beanie: 'add allergy' },
  'allergies.field.name': { en: 'What they are allergic to', beanie: 'what they are allergic to' },
  'allergies.field.type': { en: 'Type', beanie: 'type' },
  'allergies.field.severity': { en: 'Severity', beanie: 'severity' },
  'allergies.field.avoidList': { en: 'Things to avoid', beanie: 'things to avoid' },
  'allergies.field.reaction': { en: 'Reaction', beanie: 'reaction' },
  'allergies.field.emergencyResponse': {
    en: 'Emergency response',
    beanie: 'emergency response',
  },
  'allergies.field.diagnosedBy': { en: 'Diagnosed by', beanie: 'diagnosed by' },
  'allergies.field.reviewedOn': { en: 'Last reviewed', beanie: 'last reviewed' },
  'allergies.placeholder.name': { en: 'e.g. Peanuts', beanie: 'e.g. peanuts' },
  'allergies.placeholder.avoidList': {
    en: 'Specific foods, ingredients, etc.',
    beanie: 'specific foods, ingredients, etc.',
  },
  'allergies.placeholder.reaction': {
    en: 'e.g. Hives, swelling',
    beanie: 'e.g. hives, swelling',
  },
  'allergies.placeholder.emergencyResponse': {
    en: 'e.g. Use EpiPen, call 911',
    beanie: 'e.g. use epipen, call 911',
  },
  'allergies.placeholder.diagnosedBy': {
    en: 'e.g. Dr. Chen, pediatrician',
    beanie: 'e.g. dr. chen, pediatrician',
  },
  'allergies.type.food': { en: 'Food', beanie: 'food' },
  'allergies.type.medication': { en: 'Medication', beanie: 'medication' },
  'allergies.type.environmental': { en: 'Environmental', beanie: 'environmental' },
  'allergies.type.contact': { en: 'Contact', beanie: 'contact' },
  'allergies.type.insect': { en: 'Insect', beanie: 'insect' },
  'allergies.severity.severe': { en: 'Severe', beanie: 'severe' },
  'allergies.severity.moderate': { en: 'Moderate', beanie: 'moderate' },
  'allergies.severity.mild': { en: 'Mild', beanie: 'mild' },
  'allergies.empty': {
    en: 'No allergies on file for this member',
    beanie: 'no allergies on file for this bean',
  },
  'allergies.emptyCTA': { en: 'Add the first one', beanie: 'add the first one' },
  'allergies.deleteConfirm.title': { en: 'Delete this allergy?', beanie: 'delete this allergy?' },
  'allergies.deleteConfirm.body': {
    en: 'Safety info — deleting this removes it from the Care & Safety page too.',
    beanie: 'safety info — deletes from care & safety page too',
  },
  // Medications
  'medications.addTitle': { en: 'Add a Medication', beanie: 'add a medication' },
  'medications.editTitle': { en: 'Edit Medication', beanie: 'edit medication' },
  'medications.addTile': { en: 'Add medication', beanie: 'add medication' },
  'medications.field.name': { en: 'Name', beanie: 'name' },
  'medications.field.dose': { en: 'Dose', beanie: 'dose' },
  'medications.field.frequency': { en: 'Frequency', beanie: 'frequency' },
  'medications.field.dosesPerDay': {
    en: 'How often each day?',
    beanie: 'how often each day?',
  },
  'medications.dosesOption.once': { en: 'Once', beanie: 'once' },
  'medications.dosesOption.twice': { en: 'Twice', beanie: 'twice' },
  'medications.dosesOption.three': { en: '3×', beanie: '3×' },
  'medications.dosesOption.four': { en: '4×', beanie: '4×' },
  'medications.dosesOption.other': { en: 'Other / as needed', beanie: 'other / as needed' },
  'medications.frequencyAuto.onceDaily': { en: 'once daily', beanie: 'once daily' },
  'medications.frequencyAuto.twiceDaily': { en: 'twice daily', beanie: 'twice daily' },
  'medications.frequencyAuto.threeDaily': { en: '3 times daily', beanie: '3 times daily' },
  'medications.frequencyAuto.fourDaily': { en: '4 times daily', beanie: '4 times daily' },
  'medications.willDisplayAs': { en: 'Will display as:', beanie: 'will display as:' },
  'medications.frequencyDescribe': {
    en: 'Describe the schedule',
    beanie: 'describe the schedule',
  },
  'medications.field.startDate': { en: 'Start date', beanie: 'start date' },
  'medications.field.endDate': { en: 'End date', beanie: 'end date' },
  'medications.field.schedule': { en: 'Schedule', beanie: 'schedule' },
  'medications.schedule.ongoing': { en: 'Ongoing', beanie: 'ongoing' },
  'medications.schedule.hasEndDate': { en: 'Has an End Date', beanie: 'has an end date' },
  'medications.schedule.ongoingHint': {
    en: 'No end date — this stays on the active list until you remove it.',
    beanie: 'no end date — this stays on the active list until you remove it.',
  },
  'medications.field.notes': { en: 'Notes', beanie: 'notes' },
  'medications.field.photo': { en: 'Bottle photo', beanie: 'bottle photo' },
  'medications.placeholder.name': {
    en: 'e.g. Amoxicillin',
    beanie: 'e.g. amoxicillin',
  },
  'medications.placeholder.dose': {
    en: 'e.g. 5 ml, 1 tablet',
    beanie: 'e.g. 5 ml, 1 tablet',
  },
  'medications.placeholder.frequency': {
    en: 'e.g. 3 times a day',
    beanie: 'e.g. 3 times a day',
  },
  'medications.placeholder.notes': {
    en: 'Take with food, etc.',
    beanie: 'take with food, etc.',
  },
  'medications.empty': {
    en: 'No medications on file for this member',
    beanie: 'no medications on file for this bean',
  },
  'medications.emptyCTA': { en: 'Add the first one', beanie: 'add the first one' },
  'medications.active': { en: 'Active', beanie: 'active' },
  'medications.ended': { en: 'Ended', beanie: 'ended' },
  'medications.endedSection.title': {
    en: 'Ended medications',
    beanie: 'ended medications',
  },
  'medications.deleteConfirm.title': {
    en: 'Delete this medication?',
    beanie: 'delete this medication?',
  },
  'medications.deleteConfirm.body': {
    en: 'All dose history for this medication will also be removed. The bottle photo will be cleaned up after 24 hours.',
    beanie:
      'all dose history for this medication will also be removed. the bottle photo will be cleaned up after 24 hours',
  },
  // ── Milestones ───────────────────────────────────────────────────────────
  // Big-moment captures: lost a tooth, first day of school, graduation,
  // wedding, new home, etc. Per-bean by default with a family-wide toggle.
  // Voice: warm, simple. Beanie variants are all lowercase.
  'milestone.tab.label': { en: 'Milestones', beanie: 'milestones' },
  'milestone.addTile': { en: 'Add a milestone', beanie: 'add a milestone' },
  'milestone.empty': {
    en: 'No big moments yet',
    beanie: 'no big moments yet',
  },
  'milestone.emptyCTA': { en: 'Capture the first one', beanie: 'capture the first one' },
  'milestone.addTitle': { en: 'Add Milestone', beanie: 'add milestone' },
  'milestone.editTitle': { en: 'Edit Milestone', beanie: 'edit milestone' },
  'milestone.field.for': { en: 'For', beanie: 'for' },
  'milestone.field.milestone': { en: 'Milestone', beanie: 'milestone' },
  'milestone.field.title': { en: 'Title', beanie: 'title' },
  'milestone.field.date': { en: 'Date', beanie: 'date' },
  'milestone.field.description': { en: 'Description', beanie: 'description' },
  'milestone.field.photos': { en: 'Photos', beanie: 'photos' },
  'milestone.placeholder.title': {
    en: 'A few words to remember it by',
    beanie: 'a few words to remember it by',
  },
  'milestone.placeholder.description': {
    en: 'Anything else worth remembering...',
    beanie: 'anything else worth remembering...',
  },
  'milestone.familyPill': { en: 'Family', beanie: 'family' },
  'milestone.familyChip': { en: 'Family', beanie: 'family' },
  'milestone.unknownBean': { en: 'Unknown member', beanie: 'unknown bean' },
  'milestone.addPhotos': { en: 'Add photos', beanie: 'add photos' },
  'milestone.addPhotosHint': {
    en: 'Pick a member first, then add photos any time.',
    beanie: 'pick a bean first, then add photos any time.',
  },
  'milestone.group.firsts': { en: 'Firsts', beanie: 'firsts' },
  'milestone.group.achievements': { en: 'Achievements', beanie: 'achievements' },
  'milestone.group.family': { en: 'Family Events', beanie: 'family events' },
  'milestone.group.celebrations': { en: 'Celebrations', beanie: 'celebrations' },
  'milestone.invalidDate': {
    en: 'Please pick a valid date',
    beanie: 'please pick a valid date',
  },
  'milestone.deleteConfirm.title': {
    en: 'Delete this milestone?',
    beanie: 'delete this milestone?',
  },
  'milestone.deleteConfirm.body': {
    en: 'This will be removed from the timeline and the scrapbook. Photos will be cleaned up after 24 hours.',
    beanie:
      'this will be removed from the timeline and the scrapbook. photos will be cleaned up after 24 hours',
  },
  // ── Milestone categories ────────────────────────────────────────────────
  'milestone.cat.birthday': { en: 'Birthday', beanie: 'birthday' },
  'milestone.cat.lostTooth': { en: 'Lost a Tooth', beanie: 'lost a tooth' },
  'milestone.cat.firstWord': { en: 'First Word', beanie: 'first word' },
  'milestone.cat.firstStep': { en: 'First Step', beanie: 'first step' },
  'milestone.cat.firstDaySchool': { en: 'First Day of School', beanie: 'first day of school' },
  'milestone.cat.graduation': { en: 'Graduation', beanie: 'graduation' },
  'milestone.cat.bigTest': { en: 'Big Test', beanie: 'big test' },
  'milestone.cat.recital': { en: 'Recital', beanie: 'recital' },
  'milestone.cat.bigWin': { en: 'Big Win', beanie: 'big win' },
  'milestone.cat.newHome': { en: 'New Home', beanie: 'new home' },
  'milestone.cat.newJob': { en: 'New Job', beanie: 'new job' },
  'milestone.cat.newPet': { en: 'New Pet', beanie: 'new pet' },
  'milestone.cat.newLittleBean': { en: 'New Little Bean', beanie: 'new little bean' },
  'milestone.cat.wedding': { en: 'Wedding Day', beanie: 'wedding day' },
  'milestone.cat.anniversary': { en: 'Anniversary', beanie: 'anniversary' },
  'milestone.cat.bigTrip': { en: 'Big Trip', beanie: 'big trip' },
  'milestone.cat.license': { en: 'License', beanie: 'license' },
  'milestone.cat.custom': { en: 'Custom Milestone', beanie: 'custom milestone' },
  // ── Milestones page (cross-family chronological view) ───────────────────
  'milestones.pageTitle': { en: 'Milestones', beanie: 'milestones' },
  'milestones.pageSubtitle': {
    en: 'Big moments, year by year',
    beanie: 'big moments, year by year',
  },
  'milestones.empty': {
    en: 'No big moments yet',
    beanie: 'no big moments yet',
  },
  'milestones.emptyHint': {
    en: 'Tap + to capture the first one.',
    beanie: 'tap + to capture the first one.',
  },
  'milestones.filter.beans': { en: 'Beans', beanie: 'beans' },
  'milestones.filter.categories': { en: 'Categories', beanie: 'categories' },
  'milestones.filter.includeFamilyWide': {
    en: 'Include family-wide moments',
    beanie: 'include family-wide moments',
  },
  'milestones.filter.allBeans': { en: 'All beans', beanie: 'all beans' },
  'milestones.filter.allCategories': { en: 'All categories', beanie: 'all categories' },
  'milestones.add': { en: 'Add a milestone', beanie: 'add a milestone' },
  // ── Quick-add (FAB) wiring ──────────────────────────────────────────────
  'quickAdd.milestone.label': { en: 'Milestone', beanie: 'milestone' },
  'quickAdd.milestone.hint': {
    en: 'Capture a big moment',
    beanie: 'capture a big moment',
  },
  // ── Errors ─────────────────────────────────────────────────────────────
  'error.milestoneSaveFailed': {
    en: "Couldn't save your milestone",
    beanie: "couldn't save your milestone",
  },
  'error.milestoneSaveFailedHelp': {
    en: 'Check your connection and try again. Support has been notified.',
    beanie: 'check your connection and try again. support has been notified.',
  },
  // ── Scrapbook chip filter ──────────────────────────────────────────────
  'scrapbook.chip.milestones': { en: 'Milestones', beanie: 'milestones' },
  'scrapbook.add': { en: 'Add to scrapbook', beanie: 'add to scrapbook' },
  // ── Scrapbook spreads (v3 redesign — tabbed scrapbook of spreads) ──────
  'scrapbook.spine.everyone': { en: 'Everyone', beanie: 'everyone' },
  'scrapbook.everyone.title': {
    en: 'Our family scrapbook',
    beanie: 'our family scrapbook',
  },
  'scrapbook.everyone.familyMoments': {
    en: 'Family moments',
    beanie: 'family moments',
  },
  'scrapbook.everyone.lately': {
    en: "What's happening lately",
    beanie: "what's happening lately",
  },
  'scrapbook.everyone.empty': {
    en: 'no scraps yet — tap + to add the first one',
    beanie: 'no scraps yet — tap + to add the first one',
  },
  'scrapbook.bean.empty': {
    en: 'no scraps yet for {name} — tap + to start',
    beanie: 'no scraps yet for {name} — tap + to start',
  },
  'scrapbook.bean.subtitle.age': { en: 'age {age}', beanie: 'age {age}' },
  'scrapbook.bean.subtitle.joined': { en: 'joined {year}', beanie: 'joined {year}' },
  'scrapbook.bean.subtitle.both': {
    en: 'age {age} · joined {year}',
    beanie: 'age {age} · joined {year}',
  },
  'scrapbook.section.sayings': { en: 'Things they say', beanie: 'things they say' },
  'scrapbook.section.favorites': { en: 'Favorites', beanie: 'favorites' },
  'scrapbook.section.milestones': { en: 'Big moments', beanie: 'big moments' },
  'scrapbook.section.notes': { en: 'About them', beanie: 'about them' },
  'scrapbook.seeAll': { en: 'see all →', beanie: 'see all →' },
  // ── Medication administration log ────────────────────────────────────────
  // Log-entry creation, undo, confirmation, and delete strings.
  // Brand voice: friendly + factual. Heritage Orange for the confirm variant,
  // never Alert Red.
  'medicationLog.giveDose': {
    en: 'Log a dose',
    beanie: 'log a dose',
  },
  'medicationLog.doseLogged': {
    en: 'Dose logged',
    beanie: 'dose logged',
  },
  'medicationLog.undo': { en: 'Undo', beanie: 'undo' },
  'medicationLog.modalTitlePrefix': {
    en: 'Log a dose of',
    beanie: 'log a dose of',
  },
  'medicationLog.confirmLogDose': {
    en: 'Log dose',
    beanie: 'log dose',
  },
  'medicationLog.givenTodayHeader': {
    en: 'Given today',
    beanie: 'given today',
  },
  'medicationLog.noneYetToday': {
    en: 'No doses logged today yet.',
    beanie: 'no doses logged today yet.',
  },
  'medicationLog.whenHeader': {
    en: 'When was this dose given?',
    beanie: 'when was this dose given?',
  },
  'medicationLog.dateFieldLabel': { en: 'Date', beanie: 'date' },
  'medicationLog.timeFieldLabel': { en: 'Time', beanie: 'time' },
  'medicationLog.now': { en: 'Now', beanie: 'now' },
  'medicationLog.errors.futureNotAllowed': {
    en: "You can't log a dose in the future.",
    beanie: "you can't log a dose in the future.",
  },
  'medicationLog.recentHeader': {
    en: 'Recent doses',
    beanie: 'recent doses',
  },
  'medicationLog.empty': {
    en: 'No doses logged yet.',
    beanie: 'no doses logged yet.',
  },
  'medicationLog.lastDosePrefix': {
    en: 'last dose:',
    beanie: 'last dose:',
  },
  'medicationLog.lastDoseNever': {
    en: 'no doses logged yet',
    beanie: 'no doses logged yet',
  },
  'medicationLog.dose': { en: 'dose', beanie: 'dose' },
  'medicationLog.doses': { en: 'doses', beanie: 'doses' },
  'medicationLog.dosesTodaySuffix': {
    en: 'today',
    beanie: 'today',
  },
  'medicationLog.viewAll': {
    en: 'View all',
    beanie: 'view all',
  },
  'medicationLog.showLess': {
    en: 'Show less',
    beanie: 'show less',
  },
  'medicationLog.deleteConfirm.title': {
    en: 'Remove this entry?',
    beanie: 'remove this entry?',
  },
  'medicationLog.deleteConfirm.body': {
    en: "This dose will be removed from the log. This can't be undone.",
    beanie: "this dose will be removed from the log. this can't be undone.",
  },
  'medicationLog.medDeleted': {
    en: 'This medication was removed.',
    beanie: 'this medication was removed.',
  },
  'medicationLog.errors.noCurrentMember': {
    en: 'Pick a member to continue',
    beanie: 'pick a bean to continue',
  },
  'medicationLog.errors.noCurrentMember.detail': {
    en: 'Sign in as the family member giving the dose so we know who to credit.',
    beanie: 'sign in as the bean giving the dose so we know who to credit.',
  },
  'medicationLog.someone': { en: 'someone', beanie: 'someone' },
  // Over-limit copy. Heritage Orange, informative — never alarming. `{over}`,
  // `{limit}`, `{count}`, `{name}` are interpolated via `.replace()` in the
  // component (the translation layer has no built-in interpolation).
  'medicationLog.overNote': {
    en: '{over} more than the recommended {limit} a day.',
    beanie: '{over} more than the recommended {limit} a day.',
  },
  'medicationLog.overWarning.title': {
    en: '{count} doses in a single day',
    beanie: '{count} doses in a single day',
  },
  'medicationLog.overWarning.body': {
    en: "{name}'s recommended limit is {limit} a day. It's worth double-checking the spacing since the last dose — you can still log it if that's right.",
    beanie:
      "{name}'s recommended limit is {limit} a day. it's worth double-checking the spacing since the last dose — you can still log it if that's right.",
  },
  'family.discardChanges.title': {
    en: 'Discard your changes?',
    beanie: 'discard your changes?',
  },
  'family.discardChanges.body': {
    en: "You've edited this member but haven't saved. Close without saving?",
    beanie: "you've edited this bean but haven't saved — close without saving?",
  },
  // Care & Safety page
  'careSafety.title': { en: 'Care & Safety', beanie: 'care & safety' },
  'careSafety.subtitle': {
    en: 'Allergies, active medications, and key contacts — at a glance',
    beanie: 'allergies, meds, and key contacts — at a glance',
  },
  'careSafety.section.allergies': { en: 'Allergies', beanie: 'allergies' },
  'careSafety.section.medications': { en: 'Active Medications', beanie: 'active meds' },
  'careSafety.section.keyContacts': { en: 'Key Contacts', beanie: 'key contacts' },
  'careSafety.add.allergy': { en: 'Add Allergy', beanie: 'add allergy' },
  'careSafety.add.medication': { en: 'Add Medication', beanie: 'add medication' },
  'careSafety.add.contact': { en: 'Add Contact', beanie: 'add contact' },
  'careSafety.keyContacts.cta': {
    en: 'Open full Emergency Contacts →',
    beanie: 'open emergency contacts →',
  },
  'careSafety.empty.allergies': {
    en: 'No allergies on file across the family',
    beanie: 'no allergies on file across the family',
  },
  'careSafety.empty.medications': {
    en: 'No active medications across the family',
    beanie: 'no active meds across the family',
  },
  'careSafety.empty.keyContacts': {
    en: 'No emergency contacts yet — add some so sitters and grandparents always have a phonebook handy.',
    beanie:
      'no emergency contacts yet — add some so sitters and grandparents always have a phonebook',
  },
  'careSafety.stats.allergies': { en: 'allergies', beanie: 'allergies' },
  'careSafety.stats.severe': { en: 'severe', beanie: 'severe' },
  'careSafety.stats.activeMeds': { en: 'active meds', beanie: 'active meds' },
  // Cookbook page
  'cookbook.title': { en: 'Secret Family Recipes', beanie: 'secret family recipes' },
  'cookbook.subtitle': { en: "shhh… don't tell anyone 🤫", beanie: "shhh… don't tell anyone 🤫" },
  'cookbook.addRecipe': { en: 'Add a recipe', beanie: 'add a recipe' },
  'cookbook.empty': { en: 'No recipes in the family cookbook yet', beanie: 'no recipes yet' },
  'cookbook.emptyCTA': { en: 'Write the first one', beanie: 'write the first one' },
  'cookbook.stats.recipes': { en: 'Recipes', beanie: 'recipes' },
  'cookbook.stats.cooked': { en: 'Times cooked', beanie: 'times cooked' },
  'cookbook.stats.avgRating': { en: 'Avg rating', beanie: 'avg rating' },
  'cookbook.card.noPhoto': { en: 'no photo yet', beanie: 'no photo yet' },
  'cookbook.card.ingredients': { en: 'ingredients', beanie: 'ingredients' },
  // Recipe form modal
  'recipes.addTitle': { en: 'Add a Recipe', beanie: 'add a recipe' },
  'recipes.editTitle': { en: 'Edit Recipe', beanie: 'edit recipe' },
  'recipes.field.name': { en: 'Recipe name', beanie: 'recipe name' },
  'recipes.field.subtitle': { en: 'Subtitle', beanie: 'subtitle' },
  'recipes.field.prepTime': { en: 'Prep time', beanie: 'prep time' },
  'recipes.field.cookTime': { en: 'Cook time', beanie: 'cook time' },
  'recipes.field.servings': { en: 'Servings', beanie: 'servings' },
  'recipes.field.ingredients': { en: 'Ingredients', beanie: 'ingredients' },
  'recipes.field.steps': { en: 'Preparation steps', beanie: 'preparation steps' },
  'recipes.field.notes': { en: 'Family notes', beanie: 'family notes' },
  'recipes.field.photos': { en: 'Photos', beanie: 'photos' },
  'recipes.photos.saveFirst': {
    en: 'Add a recipe name above to attach photos',
    beanie: 'add a recipe name above to attach photos',
  },
  'medications.photos.saveFirst': {
    en: 'Fill in name, dose, and frequency to attach a photo',
    beanie: 'fill in name, dose, and frequency to attach a photo',
  },
  'cookLog.photos.saveFirst': {
    en: 'Add a rating to attach a photo',
    beanie: 'add a rating to attach a photo',
  },
  'recipes.placeholder.name': {
    en: "e.g. Grandma's Bolognese",
    beanie: "e.g. grandma's bolognese",
  },
  'recipes.placeholder.subtitle': {
    en: 'e.g. passed down from Mary, ~1972',
    beanie: 'e.g. passed down from mary, ~1972',
  },
  'recipes.placeholder.prepTime': { en: 'e.g. 4h', beanie: 'e.g. 4h' },
  'recipes.placeholder.cookTime': { en: 'e.g. 45 min', beanie: 'e.g. 45 min' },
  'recipes.placeholder.servings': { en: 'e.g. serves 6', beanie: 'e.g. serves 6' },
  'recipes.placeholder.ingredients': {
    en: 'One per line — 500g ground beef\\n3 carrots\\n…',
    beanie: 'one per line — 500g ground beef\\n3 carrots\\n…',
  },
  'recipes.placeholder.steps': {
    en: 'One step per line — brown the meat\\nsweat the mirepoix\\n…',
    beanie: 'one step per line',
  },
  'recipes.placeholder.notes': {
    en: 'e.g. Neil asks for this every Sunday. Eats it with a big spoon.',
    beanie: 'e.g. little notes passed down with the recipe',
  },
  'recipes.deleteConfirm.title': { en: 'Delete this recipe?', beanie: 'delete this recipe?' },
  'recipes.deleteConfirm.body': {
    en: 'This will also remove {count} cook-log {label} — this cannot be undone.',
    beanie: 'also removes {count} cook-log {label} — cannot be undone',
  },
  'recipes.deleteConfirm.bodyNoLogs': {
    en: 'You can always add it again later.',
    beanie: 'you can always add it again later',
  },
  'recipes.cookLogs.entries': { en: 'entries', beanie: 'entries' },
  'recipes.cookLogs.entry': { en: 'entry', beanie: 'entry' },
  // Recipe detail
  'recipes.detail.backToCookbook': {
    en: 'Back to the Cookbook',
    beanie: 'back to the cookbook',
  },
  'recipes.detail.openPhoto': {
    en: 'View recipe photo',
    beanie: 'view recipe photo',
  },
  'recipes.detail.ingredients': { en: 'Ingredients', beanie: 'ingredients' },
  'recipes.detail.steps': { en: 'How to make it', beanie: 'how to make it' },
  'recipes.detail.notes': { en: 'Family notes', beanie: 'family notes' },
  'recipes.detail.cookLog': { en: 'Cook Log', beanie: 'cook log' },
  'recipes.detail.iCooked': { en: 'I cooked this today', beanie: 'i cooked this today' },
  'recipes.detail.noIngredients': { en: 'No ingredients listed', beanie: 'no ingredients listed' },
  'recipes.detail.noSteps': { en: 'No steps listed', beanie: 'no steps listed' },
  'recipes.detail.notFound.title': {
    en: "We can't find this recipe",
    beanie: "can't find this recipe",
  },
  'recipes.detail.notFound.body': {
    en: 'It may have been removed from the cookbook.',
    beanie: 'it may have been removed from the cookbook',
  },
  // Cook log form + cards
  'cookLog.addTitle': { en: 'Log a cook', beanie: 'log a cook' },
  'cookLog.editTitle': { en: 'Edit cook log', beanie: 'edit cook log' },
  'cookLog.field.cookedOn': { en: 'Date', beanie: 'date' },
  'cookLog.field.cookedBy': { en: 'Who cooked', beanie: 'who cooked' },
  'cookLog.field.rating': { en: 'How was it?', beanie: 'how was it?' },
  'cookLog.field.servings': { en: 'Servings', beanie: 'servings' },
  'cookLog.field.wentWell': { en: 'What went well', beanie: 'what went well' },
  'cookLog.field.toImprove': { en: 'What to try next time', beanie: 'what to try next time' },
  'cookLog.field.photo': { en: 'Dish photo', beanie: 'dish photo' },
  'cookLog.placeholder.wentWell': {
    en: 'e.g. nailed the sauce reduction',
    beanie: 'e.g. nailed the sauce reduction',
  },
  'cookLog.placeholder.toImprove': {
    en: 'e.g. more salt, longer simmer',
    beanie: 'e.g. more salt, longer simmer',
  },
  'cookLog.empty': { en: 'No cook logs yet', beanie: 'no cook logs yet' },
  'cookLog.emptyCTA': { en: 'Log the first cook', beanie: 'log the first cook' },
  'cookLog.deleteConfirm.title': {
    en: 'Delete this cook log?',
    beanie: 'delete this cook log?',
  },
  'cookLog.deleteConfirm.body': {
    en: 'The entry and any dish photo will be removed.',
    beanie: 'the entry and any dish photo will be removed',
  },
  'cookLog.stats.times': { en: 'times cooked', beanie: 'times cooked' },
  'cookLog.stats.avg': { en: 'avg rating', beanie: 'avg rating' },
  'cookLog.stats.lastCooked': { en: 'last cooked', beanie: 'last cooked' },
  'cookLog.stats.daysSince': { en: '{n} days ago', beanie: '{n} days ago' },
  'cookLog.stats.never': { en: 'never cooked', beanie: 'never cooked' },
  'cookLog.stats.today': { en: 'today', beanie: 'today' },
  'cookLog.stats.yesterday': { en: 'yesterday', beanie: 'yesterday' },
  'cookLog.byline.cookedBy': { en: 'cooked by', beanie: 'cooked by' },
  'cookLog.byline.someone': { en: 'someone', beanie: 'someone' },
  'favorites.fromCookbook': {
    en: '🥘 From the Family Cookbook →',
    beanie: '🥘 from the family cookbook →',
  },
  'favorites.field.recipe': { en: 'Family recipe', beanie: 'family recipe' },
  'favorites.recipe.none': {
    en: '— Not from our cookbook —',
    beanie: 'not from our cookbook',
  },
  'favorites.recipe.addNew': {
    en: '＋ Add a new recipe…',
    beanie: '＋ add a new recipe…',
  },
  'favorites.food.detailsLabel': { en: 'Food details', beanie: 'food details' },
  'favorites.food.hint': {
    en: 'pick a family recipe, or just type one in 🍝',
    beanie: 'pick a family recipe, or just type one in 🍝',
  },
  'favorites.food.or': { en: 'or', beanie: 'or' },
  'favorites.field.typeItIn': { en: 'Type it in', beanie: 'type it in' },
  'favorites.placeholder.typeItIn': {
    en: "e.g. McDonald's Happy Meal, gelato di Rome…",
    beanie: "e.g. mcdonald's happy meal, gelato di rome…",
  },
  'favorites.field.why': { en: "Why it's a favorite", beanie: "why it's a favorite" },
  'favorites.placeholder.why': {
    en: 'e.g. asks for it every Sunday. eats it with a big spoon.',
    beanie: 'e.g. asks for it every sunday. eats it with a big spoon.',
  },
  // Family Scrapbook
  'scrapbook.title': { en: 'Family Scrapbook', beanie: 'family scrapbook' },
  'scrapbook.subtitle': {
    en: 'everything about your family, in one place',
    beanie: 'everything about your beans, in one place',
  },
  'scrapbook.filter.types': { en: 'Show', beanie: 'show' },
  'scrapbook.filter.members': { en: 'Members', beanie: 'beans' },
  'scrapbook.filter.all': { en: 'All', beanie: 'all' },
  'scrapbook.filter.favorites': { en: 'Favorites', beanie: 'favorites' },
  'scrapbook.filter.sayings': { en: 'Sayings', beanie: 'sayings' },
  'scrapbook.filter.notes': { en: 'Notes', beanie: 'notes' },
  'scrapbook.type.favorite': { en: 'Favorite', beanie: 'favorite' },
  'scrapbook.type.saying': { en: 'Saying', beanie: 'saying' },
  'scrapbook.type.note': { en: 'Note', beanie: 'note' },
  'scrapbook.empty': {
    en: 'Nothing in the scrapbook yet — add some favorites, sayings, or notes to see them here.',
    beanie: 'nothing in the scrapbook yet',
  },
  'scrapbook.noResults': {
    en: 'Nothing matches these filters. Try showing more types or beans.',
    beanie: 'nothing matches these filters',
  },
  'scrapbook.loadMore': { en: 'Load more', beanie: 'load more' },
  // Emergency contacts
  'contacts.title': { en: 'Emergency Contacts', beanie: 'emergency contacts' },
  'contacts.subtitleLead': {
    en: 'keep this where everyone can find it.',
    beanie: 'keep this where everyone can find it.',
  },
  'contacts.subtitle': {
    en: "Family phonebook — doctors, dentists, teachers, sitters, and anyone you'd want a babysitter or grandparent to reach in a pinch.",
    beanie: 'family phonebook — anyone a sitter or grandparent might need to reach',
  },
  'contacts.addContact': { en: 'Add contact', beanie: 'add contact' },
  'contacts.searchPlaceholder': {
    en: 'Search by name, role, or phone…',
    beanie: 'search by name, role, or phone…',
  },
  'contacts.filter.all': { en: 'All', beanie: 'all' },
  'contacts.empty': {
    en: 'No contacts yet — add the first one so sitters and grandparents always have a phonebook handy.',
    beanie: 'no contacts yet',
  },
  'contacts.emptyCTA': { en: 'Add the first contact', beanie: 'add the first contact' },
  'contacts.noResults': {
    en: 'No contacts match that search.',
    beanie: 'no contacts match that search',
  },
  'contacts.addTitle': { en: 'Add a Contact', beanie: 'add a contact' },
  'contacts.editTitle': { en: 'Edit Contact', beanie: 'edit contact' },
  'contacts.field.category': { en: 'Category', beanie: 'category' },
  'contacts.field.customCategory': {
    en: 'Custom label (optional)',
    beanie: 'custom label (optional)',
  },
  'contacts.field.name': { en: 'Name', beanie: 'name' },
  'contacts.field.role': { en: 'Role or relationship', beanie: 'role or relationship' },
  'contacts.field.phone': { en: 'Phone', beanie: 'phone' },
  'contacts.field.email': { en: 'Email', beanie: 'email' },
  'contacts.field.address': { en: 'Address', beanie: 'address' },
  'contacts.field.notes': { en: 'Notes', beanie: 'notes' },
  'contacts.placeholder.name': { en: 'e.g. Dr. Rachel Kim', beanie: 'e.g. dr. rachel kim' },
  'contacts.placeholder.role': {
    en: 'e.g. Pediatric allergist · for Neil',
    beanie: 'e.g. pediatric allergist · for neil',
  },
  'contacts.placeholder.phone': { en: '(415) 555-0182', beanie: '(415) 555-0182' },
  'contacts.placeholder.email': { en: 'name@example.com', beanie: 'name@example.com' },
  'contacts.placeholder.customCategory': {
    en: 'e.g. emergency pickup, hotline',
    beanie: 'e.g. emergency pickup, hotline',
  },
  'contacts.placeholder.notes': {
    en: 'Best times to call, quirks, insurance…',
    beanie: 'best times to call, quirks, insurance…',
  },
  'contacts.category.doctor': { en: 'Doctor', beanie: 'doctor' },
  'contacts.category.dentist': { en: 'Dentist', beanie: 'dentist' },
  'contacts.category.nurse': { en: 'Nurse', beanie: 'nurse' },
  'contacts.category.teacher': { en: 'Teacher', beanie: 'teacher' },
  'contacts.category.school': { en: 'School', beanie: 'school' },
  'contacts.category.other': { en: 'Other', beanie: 'other' },
  'contacts.deleteConfirm.title': { en: 'Delete this contact?', beanie: 'delete this contact?' },
  'contacts.deleteConfirm.body': {
    en: 'You can always add them again later.',
    beanie: 'you can always add them again later',
  },
  'contacts.action.call': { en: 'Call', beanie: 'call' },
  'contacts.action.email': { en: 'Email', beanie: 'email' },
  'nav.settings': { en: 'Settings', beanie: 'settings' },
  'nav.community': { en: 'Beanies Discord', beanie: 'beanies discord' },
  // ── Discord community (onboarding card, nudge, settings, open-failure) ──────
  'discord.openFailedTitle': { en: "Couldn't open Discord", beanie: "couldn't open discord" },
  'discord.openFailedBody': {
    en: 'Please try again, or visit beanies.family/discord in your browser.',
    beanie: 'please try again, or visit beanies.family/discord in your browser.',
  },
  'onboarding.discordEyebrow': { en: "You're an early bean 🫘", beanie: "you're an early bean 🫘" },
  'onboarding.discordTitle': { en: 'Help us grow beanies', beanie: 'help us grow beanies' },
  'onboarding.discordBody': {
    en: "We're still new, and you're one of our first families. Join the other beanies on Discord to swap tips, hear what's next, tell us what to build, and just have a chat.",
    beanie:
      "we're still new, and you're one of our first families. join the other beanies on discord to swap tips, hear what's next, tell us what to build, and just have a chat.",
  },
  'onboarding.discordPrimary': { en: 'Join us on Discord', beanie: 'join us on discord' },
  'onboarding.discordSkip': { en: 'Maybe later', beanie: 'maybe later' },
  'communityNudge.label': { en: 'From the beanstalk', beanie: 'from the beanstalk' },
  'communityNudge.join': { en: 'Join us on Discord', beanie: 'join us on discord' },
  'communityNudge.snooze': { en: 'Not now', beanie: 'not now' },
  'communityNudge.joined': { en: "I'm already there!", beanie: "i'm already there!" },
  // #45 — in-app feedback / NPS
  'feedback.shareEntry': { en: 'Share Feedback', beanie: 'share feedback 💬' },
  'feedback.form.title': { en: 'Share Your Feedback', beanie: 'share your feedback' },
  'feedback.form.send': { en: 'Send Feedback', beanie: 'send feedback' },
  'feedback.form.commentGeneric': {
    en: 'Anything you would like to add? (optional)',
    beanie: 'anything you want to add? (optional)',
  },
  'feedback.form.commentDetractor': {
    en: "What's letting you down? What would make it better? (optional)",
    beanie: "what's letting you down? what would make it better? (optional)",
  },
  'feedback.form.commentPassive': {
    en: 'What is one thing you wish beanies could do? (optional)',
    beanie: 'what is one thing you wish beanies could do? (optional)',
  },
  'feedback.form.commentPromoter': {
    en: 'What do you love most? (and anything you wish it did?) (optional)',
    beanie: 'what do you love most? (and anything you wish it did?) (optional)',
  },
  'feedback.form.contactToggle': {
    en: 'Want a reply? Add your contact (optional)',
    beanie: 'want a reply? add your contact (optional)',
  },
  'feedback.form.contactHelp': {
    en: 'Only used if you want us to get back to you. Never shared.',
    beanie: 'only used if you want us to get back to you. never shared.',
  },
  'feedback.form.anonymousLabel': { en: 'Send anonymously', beanie: 'send anonymously' },
  'feedback.form.anonymousHint': {
    en: "If ticked, we won't include your family name in the submission. But you also won't be able to get a reply from us (well... me).",
    beanie:
      "if ticked, we won't include your family name in the submission. but you also won't be able to get a reply from us (well... me).",
  },
  'feedback.form.contactNamePlaceholder': {
    en: 'Your name (optional)',
    beanie: 'your name (optional)',
  },
  'feedback.form.contactEmailPlaceholder': { en: 'Email (optional)', beanie: 'email (optional)' },
  'feedback.form.privacyNote': {
    en: 'No financial data is ever included — just your score and words.',
    beanie: 'no financial data is ever included, just your score and words.',
  },
  'feedback.nps.question': {
    en: 'How likely are you to recommend beanies.family to a friend?',
    beanie: 'how likely are you to recommend beanies.family to a friend?',
  },
  'feedback.nps.low': { en: 'Not likely', beanie: 'not likely' },
  'feedback.nps.high': { en: 'Very likely', beanie: 'very likely' },
  'feedback.nps.scoreAria': { en: 'Score {score} out of 10', beanie: 'score {score} out of 10' },
  'feedback.thanks.defaultTitle': { en: 'Thanks - we hear you', beanie: 'thanks - we hear you' },
  'feedback.thanks.defaultBody': {
    en: 'This is exactly the stuff that makes beanies better. If you would like to talk it through, the door is open.',
    beanie:
      'this is exactly the stuff that makes beanies better. if you want to talk it through, the door is open.',
  },
  'feedback.thanks.promoterTitle': {
    en: "Thanks - you've made our day!",
    beanie: "thanks - you've made our day!",
  },
  'feedback.thanks.promoterBody': {
    en: 'Every bit of what you told us helps the beanies grow. Want to help shape what comes next?',
    beanie:
      'every bit of what you told us helps the beanies grow. want to help shape what comes next?',
  },
  'feedback.thanks.discordCta': { en: 'Join Us on Discord', beanie: 'join us on discord' },
  'feedback.thanks.dismiss': { en: 'No thanks, maybe later', beanie: 'no thanks, maybe later' },
  'feedback.settings.toggleLabel': {
    en: 'Occasional Feedback Prompt',
    beanie: 'occasional feedback prompt',
  },
  'feedback.settings.toggleHint': {
    en: 'Once in a while, ask how likely you are to recommend beanies.family. You can turn this off any time.',
    beanie:
      'once in a while, ask how likely you are to recommend beanies.family. you can turn this off any time.',
  },
  'installNudge.label': { en: 'Install the app', beanie: 'plant beanies on your home screen' },
  'installNudge.tagline': {
    en: 'Keep your family data reliably connected.',
    beanie: 'keep your beans reliably connected.',
  },
  'installNudge.description': {
    en: 'Add beanies to your home screen and it stays reliably signed in to your data - no more being asked to reconnect after a while. Tap Share, then "Add to Home Screen".',
    beanie:
      'add beanies to your home screen and it stays reliably signed in to your beans - no more being asked to reconnect after a while. tap share, then "add to home screen".',
  },
  'installNudge.showHow': { en: 'Show me how', beanie: 'show me how!' },
  'installNudge.dismiss': { en: 'Not now', beanie: 'not now' },
  'installNudge.installed': { en: 'Already installed', beanie: "i've already done it!" },
  'nav.section.treehouse': { en: 'The Treehouse', beanie: 'family treehouse' },
  'nav.section.piggyBank': { en: 'The Piggy Bank', beanie: 'piggy bank' },
  'nav.nook': { en: 'Family Dashboard', beanie: 'family nook' },
  'nav.activities': { en: 'Family Activities', beanie: 'our activities' },
  'nav.travel': { en: 'Travel Plans', beanie: 'travel plans' },
  'nav.todo': { en: 'To-Dos', beanie: 'to-dos' },
  'nav.lists': { en: 'Beanie Lists', beanie: 'beanie lists' },
  // Meal Planner (#27)
  'common.previous': { en: 'Previous', beanie: 'previous' },
  'common.next': { en: 'Next', beanie: 'next' },
  'common.remove': { en: 'Remove', beanie: 'remove' },
  'nav.mealPlanner': { en: 'Meal Planner', beanie: 'meal planner' },
  'mobileNav.hint.mealPlanner': { en: "Plan the week's meals", beanie: "what's cooking this week" },
  'mealPlanner.title': { en: 'Meal Planner', beanie: 'meal planner' },
  'mealPlanner.welcome': {
    en: "what's cooking this week? 🌱",
    beanie: "what's cooking this week? 🌱",
  },
  'mealPlanner.thisWeek': { en: 'This week', beanie: 'this week' },
  'mealPlanner.pastWeeks': { en: 'Past weeks', beanie: 'past weeks' },
  'mealPlanner.copyLastWeek': { en: 'Copy last week', beanie: 'copy last week' },
  'mealPlanner.copyHere': { en: 'Copy to this week', beanie: 'copy to this week' },
  'mealPlanner.clearDay': { en: 'Clear day', beanie: 'clear day' },
  // Day-scoped. `mealPlanner.thisWeek` is week-scoped and stays in use for the
  // jump-to-this-week button, so the day badge needed its own word rather than a reword.
  'mealPlanner.today': { en: 'Today', beanie: 'today' },
  'mealPlanner.clearWeek': { en: 'Clear week', beanie: 'clear week' },
  'mealPlanner.clear.dayTitle': { en: 'Clear this day?', beanie: 'clear this day?' },
  'mealPlanner.clear.dayMessage': {
    en: 'This removes every meal planned for this day. Cook logs you already saved are kept.',
    beanie: 'this removes every meal planned for this day. cook logs you already saved are kept.',
  },
  'mealPlanner.clear.weekTitle': { en: 'Clear this week?', beanie: 'clear this week?' },
  'mealPlanner.clear.weekMessage': {
    en: 'This removes every meal planned this week. Cook logs you already saved are kept.',
    beanie: 'this removes every meal planned this week. cook logs you already saved are kept.',
  },
  'mealPlanner.clear.confirmLabel': { en: 'Clear', beanie: 'clear' },
  'mealPlanner.cookbook': { en: 'Cookbook', beanie: 'cookbook' },
  'mealPlanner.railHint': {
    en: 'drag a recipe onto a day 🍝',
    beanie: 'drag a recipe onto a day 🍝',
  },
  'mealPlanner.search': { en: 'Search recipes…', beanie: 'search recipes…' },
  'mealPlanner.newRecipe': { en: 'New recipe', beanie: 'new recipe' },
  'mealPlanner.removeHint': { en: 'Drop here to remove', beanie: 'drop here to remove' },
  'mealPlanner.removed': { en: 'Removed from the plan', beanie: 'removed from the plan' },
  'mealPlanner.duplicate': { en: 'Already on the menu', beanie: 'already on the menu' },
  'mealPlanner.duplicateHelp': {
    en: 'That one is already in this meal.',
    beanie: 'that one is already in this meal.',
  },
  'mealPlanner.addMeal': { en: 'Add a meal', beanie: 'add a meal' },
  'mealPlanner.addMealTo': {
    en: 'Add a meal to {slot} on {day}',
    beanie: 'add a meal to {slot} on {day}',
  },
  'mealPlanner.emptyWeek': {
    en: 'No meals planned this week yet — drop a recipe onto a day to start.',
    beanie: 'no meals planned this week yet — drop a recipe onto a day to start.',
  },
  'mealPlanner.slot.breakfast': { en: 'Breakfast', beanie: 'breakfast' },
  'mealPlanner.slot.lunch': { en: 'Lunch', beanie: 'lunch' },
  'mealPlanner.slot.dinner': { en: 'Dinner', beanie: 'dinner' },
  'mealPlanner.slot.snack': { en: 'Snacks', beanie: 'snacks' },
  'mealPlanner.kind.eat_out': { en: 'Eat out', beanie: 'eat out' },
  'mealPlanner.kind.leftovers': { en: 'Leftovers', beanie: 'leftovers' },
  'mealPlanner.kind.skip': { en: 'Skip', beanie: 'skip' },
  'mealPlanner.kind.other': { en: 'Other', beanie: 'other' },
  'mealPlanner.card.toCook': { en: 'to cook', beanie: 'to cook' },
  'mealPlanner.card.cooked': { en: 'cooked', beanie: 'cooked' },
  'mealPlanner.card.anyone': { en: 'anyone', beanie: 'anyone' },
  'mealPlanner.card.recipeRemoved': { en: 'Recipe removed', beanie: 'recipe removed' },
  'mealPlanner.card.guests': { en: '+{count} guests', beanie: '+{count} guests' },
  'mealPlanner.editor.addTitle': { en: 'Add a meal', beanie: 'add a meal' },
  'mealPlanner.editor.editTitle': { en: 'Edit meal', beanie: 'edit meal' },
  'mealPlanner.editor.plan': { en: "What's the plan?", beanie: "what's the plan?" },
  'mealPlanner.editor.recipe': { en: 'Recipe', beanie: 'recipe' },
  'mealPlanner.editor.choose': { en: 'Choose a recipe', beanie: 'choose a recipe' },
  'mealPlanner.editor.change': { en: 'Change', beanie: 'change' },
  'mealPlanner.editor.editRecipe': { en: 'Edit recipe', beanie: 'edit recipe' },
  'mealPlanner.editor.cook': { en: "Who's cooking?", beanie: "who's cooking?" },
  'mealPlanner.editor.cookHint': { en: 'shown on the card', beanie: 'shown on the card' },
  'mealPlanner.editor.anyone': { en: 'Anyone', beanie: 'anyone' },
  'mealPlanner.editor.eaters': { en: "Who's eating?", beanie: "who's eating?" },
  'mealPlanner.editor.addGuest': { en: 'Add a guest', beanie: 'add a guest' },
  'mealPlanner.editor.guestName': { en: 'Guest name', beanie: 'guest name' },
  'mealPlanner.editor.note': { en: 'Note', beanie: 'note' },
  'mealPlanner.editor.notePlaceholder': {
    en: 'e.g. double batch for leftovers',
    beanie: 'e.g. double batch for leftovers',
  },
  'mealPlanner.editor.serveTime': { en: 'Serve time', beanie: 'serve time' },
  'mealPlanner.editor.label': { en: 'Label', beanie: 'label' },
  'mealPlanner.editor.labelPlaceholder': { en: "e.g. Grandma's", beanie: "e.g. grandma's" },
  'mealPlanner.editor.markCooked': { en: 'Mark cooked', beanie: 'mark cooked' },
  'mealPlanner.editor.viewCookLog': { en: 'View cook log', beanie: 'view cook log' },
  'mealPlanner.editor.save': { en: 'Save meal', beanie: 'save meal' },
  'mealPlanner.editor.deleteConfirmTitle': { en: 'Remove this meal?', beanie: 'remove this meal?' },
  'mealPlanner.editor.deleteConfirmMessage': {
    en: 'This removes the meal from the plan. Any cook log you already saved is kept.',
    beanie: 'this removes the meal from the plan. any cook log you already saved is kept.',
  },
  'mealPlanner.picker.title': { en: 'Pick a meal', beanie: 'pick a meal' },
  'mealPlanner.picker.quickAddHint': {
    en: 'not in the cookbook? just name it 🍝',
    beanie: 'not in the cookbook? just name it 🍝',
  },
  'mealPlanner.picker.quickAddPlaceholder': { en: 'New recipe name', beanie: 'new recipe name' },
  'mealPlanner.picker.alternatives': { en: 'Or an alternative', beanie: 'or an alternative' },
  'mealPlanner.copy.confirmTitle': { en: 'Copy over this week?', beanie: 'copy over this week?' },
  'mealPlanner.copy.confirmMessage': {
    en: 'This week already has meals planned. Copying will replace them. Meals you have already cooked keep their history.',
    beanie:
      'this week already has meals planned. copying will replace them. meals you have already cooked keep their history.',
  },
  'mealPlanner.copy.confirmLabel': { en: 'Replace & copy', beanie: 'replace & copy' },
  'mealPlanner.copy.empty': { en: 'Nothing to copy', beanie: 'nothing to copy' },
  'mealPlanner.copy.emptyHelp': {
    en: 'That week has no meals planned.',
    beanie: 'that week has no meals planned.',
  },
  'mealPlanner.copy.done': { en: 'Week copied', beanie: 'week copied' },
  'mealPlanner.recipeDelete.title': { en: 'Delete this recipe?', beanie: 'delete this recipe?' },
  'mealPlanner.recipeDelete.message': {
    en: 'This recipe is used in {count} meal plan(s). Deleting it removes the recipe and marks those meals as "recipe removed". Cook logs are kept.',
    beanie:
      'this recipe is used in {count} meal plan(s). deleting it removes the recipe and marks those meals as "recipe removed". cook logs are kept.',
  },
  'mealPlanner.share.title': { en: 'Meal plan', beanie: 'meal plan' },
  'mealPlanner.export.share': { en: 'Share', beanie: 'share' },
  'mealPlanner.export.exportPdf': { en: 'Export as PDF', beanie: 'export as pdf' },
  'mealPlanner.export.building': { en: 'Preparing…', beanie: 'preparing…' },
  // The exported sheet's own copy (rendered into the picture/PDF).
  'mealPlanner.export.heading': { en: "This Week's Meals", beanie: "this week's meals" },
  'mealPlanner.export.accent': { en: "what's cooking? 🌱", beanie: "what's cooking? 🌱" },
  'mealPlanner.export.weekOf': { en: 'week of', beanie: 'week of' },
  'mealPlanner.export.cooksLabel': { en: 'Cooks', beanie: 'cooks' },
  // Split in two: the footer key now prints only the parts the sheet actually uses, so it
  // never explains a symbol that is not on the page.
  'mealPlanner.export.legendServeTime': { en: '⏰ serve time', beanie: '⏰ serve time' },
  'mealPlanner.export.legendGuests': { en: '👥 guests', beanie: '👥 guests' },
  'mealPlanner.export.failed': {
    en: "Couldn't create the file",
    beanie: "couldn't create the file",
  },
  'mealPlanner.export.failedHelp': {
    en: 'Something went wrong preparing your meal plan. Please try again.',
    beanie: 'something went wrong preparing your meal plan. please try again.',
  },
  'mealPlanner.share.copied': {
    en: 'Plan copied to clipboard',
    beanie: 'plan copied to clipboard',
  },
  'mealPlanner.share.copyFailed': {
    en: "Couldn't copy the plan",
    beanie: "couldn't copy the plan",
  },
  'mealPlanner.share.copyFailedHelp': {
    en: 'Copy is not available here — try selecting the text manually.',
    beanie: 'copy is not available here — try selecting the text manually.',
  },
  'mealPlanner.briefing.owner': { en: "You're cooking: {meal}", beanie: "you're cooking: {meal}" },
  'mealPlanner.briefing.forChild': {
    en: '{name} is cooking: {meal}',
    beanie: '{name} is cooking: {meal}',
  },
  'mealPlanner.briefing.unassigned': { en: 'Needs a cook: {meal}', beanie: 'needs a cook: {meal}' },
  'mealPlanner.nook.title': { en: "Today's meals", beanie: "today's meals" },
  'mealPlanner.nook.empty': {
    en: 'No meals planned for today.',
    beanie: 'no meals planned for today.',
  },
  'nav.overview': { en: 'Overview', beanie: 'finance corner' },
  'nav.budgets': { en: 'Budgets', beanie: 'budgets' },
  'nav.comingSoon': { en: 'Soon!', beanie: 'soon!' },
  'nav.aria.countAttention': {
    en: '{label}, {count} need attention',
    beanie: '{label}, {count} need attention',
  },
  'mobileNav.attentionBadge': {
    en: 'This section has items that need your attention',
    beanie: 'this section has items that need your attention',
  },

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
  'action.dismiss': { en: 'Dismiss', beanie: 'dismiss' },
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
  'action.move': { en: 'Move', beanie: 'move' },

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
  'accounts.type.credit_card': { en: 'Credit Card', beanie: 'credit card' },
  'accounts.type.investment': { en: 'Investment Account', beanie: 'investment account' },
  'accounts.type.crypto': { en: 'Cryptocurrency', beanie: 'crypto account' },
  'accounts.type.cash': { en: 'Cash', beanie: 'cash' },
  'accounts.type.loan': { en: 'Loan', beanie: 'loan' },
  'accounts.type.other': { en: 'Other', beanie: 'other' },
  'accounts.type.retirement_401k': { en: '401k', beanie: '401k' },
  'accounts.type.retirement_ira': { en: 'IRA', beanie: 'ira' },
  'accounts.type.retirement_roth_ira': { en: 'Roth IRA', beanie: 'roth ira' },
  'accounts.type.retirement_bene_ira': { en: 'Bene IRA', beanie: 'bene ira' },
  'accounts.type.retirement_kids_ira': { en: 'Kids IRA', beanie: 'kids ira' },
  'accounts.type.retirement': { en: 'Retirement', beanie: 'retirement' },
  'accounts.type.education_529': { en: 'College Fund (529)', beanie: 'college fund (529)' },
  'accounts.type.education_savings': { en: 'Education Savings', beanie: 'education savings' },

  // Account view modal (activity log, balance adjustments)
  'accountView.title': { en: 'Account', beanie: 'account' },
  'accountView.activity': { en: 'Activity', beanie: 'activity' },
  'accountView.noActivity': {
    en: 'No activity yet — manual balance updates and transactions will show here.',
    beanie: 'no beans have moved yet — updates and transactions will show up here.',
  },
  'accountView.viewAll': { en: 'View all →', beanie: 'view all →' },
  'accountView.notFound': {
    en: "Hmm, we couldn't find that account. It may have been deleted.",
    beanie: "hmm, we couldn't find that account — it may have been deleted.",
  },
  'accountView.filter.all': { en: 'All', beanie: 'all' },
  'accountView.filter.manual': { en: 'Manual', beanie: 'manual' },
  'accountView.filter.recurring': { en: 'Recurring', beanie: 'recurring' },
  'accountView.filter.loans': { en: 'Loans', beanie: 'loans' },
  'accountView.filter.goals': { en: 'Goals', beanie: 'goals' },
  'accountView.filter.transfers': { en: 'Transfers', beanie: 'transfers' },
  'accountView.adjustedBy': { en: 'Adjusted by {name}', beanie: 'adjusted by {name}' },
  'accountView.adjustedByYou': { en: 'Adjusted by you', beanie: 'adjusted by you' },
  'accountView.adjustError.noAuthor': {
    en: "Balance updated, but we couldn't record who made the change.",
    beanie: "balance updated — but we couldn't record who changed it.",
  },
  'accountView.adjustError.noAuthorHelp': {
    en: 'No signed-in family member was found. Sign in and try again.',
    beanie: 'no signed-in beanie was found. sign in and try again.',
  },
  'accountView.recurringLabel': { en: 'Recurring: {name}', beanie: 'recurring: {name}' },
  'accountView.loanLabel': { en: 'Loan payment', beanie: 'loan payment' },
  'accountView.goalLabel': { en: 'Goal allocation', beanie: 'goal allocation' },
  'accountView.transferTo': { en: 'Transfer → {account}', beanie: 'transfer → {account}' },
  'accountView.transferFrom': { en: 'Transfer ← {account}', beanie: 'transfer ← {account}' },

  // Transaction metadata used outside the account view
  'txn.balanceAdjusted': { en: 'Balance adjusted', beanie: 'balance adjusted' },
  'txn.accountColumn': { en: 'Account', beanie: 'account' },
  'txn.whoColumn': { en: 'Who', beanie: 'who' },
  'txn.filteredByAccount': { en: 'Filtered: {name}', beanie: 'filtered: {name}' },
  'txn.filteredByGoal': { en: 'Goal: {name}', beanie: 'goal: {name}' },
  'txn.clearFilter': { en: 'Clear filter', beanie: 'clear filter' },
  'txn.filter.accountNotFound': {
    en: "We couldn't find that account — the filter has been cleared.",
    beanie: "we couldn't find that account — the filter has been cleared.",
  },
  'txn.filter.goalNotFound': {
    en: "We couldn't find that goal — the filter has been cleared.",
    beanie: "we couldn't find that goal — the filter has been cleared.",
  },

  // Goal view modal (activity log)
  'goalView.title': { en: 'Goal', beanie: 'goal' },
  'goalView.activity': { en: 'Activity', beanie: 'activity' },
  'goalView.noActivity': {
    en: 'No contributions yet — automated transactions and manual contributions will show here.',
    beanie: 'no beans added yet — contributions will show up here.',
  },
  'goalView.viewAll': { en: 'View all →', beanie: 'view all →' },
  'goalView.notFound': {
    en: "Hmm, we couldn't find that goal. It may have been deleted.",
    beanie: "hmm, we couldn't find that goal — it may have been deleted.",
  },
  'goalView.progressLabel': { en: 'Progress', beanie: 'progress' },
  'goalView.deadlineLabel': { en: 'Target date', beanie: 'target date' },
  'goalView.priorityLabel': { en: 'Priority', beanie: 'priority' },
  'goalView.adjustedBy': { en: 'Contribution by {name}', beanie: 'contribution by {name}' },
  'goalView.adjustedByYou': { en: 'Your contribution', beanie: 'your contribution' },

  // Goal quick-contribute modal
  'goalContribute.title': { en: 'Contribute to goal', beanie: 'contribute to goal' },
  'goalContribute.amountLabel': { en: 'Amount', beanie: 'amount' },
  'goalContribute.amountPlaceholder': { en: 'e.g. 50', beanie: 'e.g. 50' },
  'goalContribute.noteLabel': { en: 'Note (optional)', beanie: 'note (optional)' },
  'goalContribute.notePlaceholder': {
    en: "e.g. mom's birthday money, bonus, savings from groceries",
    beanie: "e.g. mom's birthday money, bonus, savings from groceries",
  },
  'goalContribute.button': { en: 'Contribute', beanie: 'contribute' },
  'goalContribute.successToast': {
    en: '🎉 Contribution added!',
    beanie: '🎉 contribution added!',
  },
  'goalContribute.undoLabel': { en: 'Undo', beanie: 'undo' },
  'goalContribute.revertedToast': {
    en: 'Contribution reverted.',
    beanie: 'contribution reverted.',
  },
  'goalContribute.undoFailed': {
    en: "We couldn't undo that contribution — the goal may have been deleted.",
    beanie: "we couldn't undo that contribution — the goal may have been deleted.",
  },
  'goalContribute.error.noAuthor': {
    en: "We couldn't record who's contributing.",
    beanie: "we couldn't record who's contributing.",
  },
  'goalContribute.error.noAuthorHelp': {
    en: 'No signed-in family member was found. Sign in and try again.',
    beanie: 'no signed-in beanie was found. sign in and try again.',
  },
  'goalContribute.deleteConfirmTitle': {
    en: 'Delete this contribution?',
    beanie: 'delete this contribution?',
  },
  'goalContribute.deleteConfirmMessage': {
    en: "This will subtract it from your goal's progress.",
    beanie: "this will subtract it from your goal's progress.",
  },

  // Milestone celebration
  'celebration.goalMilestone': {
    en: 'Milestone reached — keep going!',
    beanie: 'milestone reached — keep going!',
  },

  // Generic fallbacks used by transactionLabel
  'family.unknownMember': { en: 'Unknown', beanie: 'unknown' },
  // Natural-reading inline variant — for messages where the member name
  // is interpolated into a sentence (e.g. "Don't forget: Antibiotics for
  // {member}"). "Unknown" reads awkwardly there; "a family member" keeps
  // the sentence flowing while still signalling the data is missing.
  'family.unknownMemberInline': {
    en: 'a family member',
    beanie: 'a family member',
  },
  'family.unknownAccount': { en: 'Unknown account', beanie: 'unknown account' },

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
  'transactions.type.balance_adjustment': {
    en: 'Balance adjustment',
    beanie: 'balance adjustment',
  },

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
  'recurringPrompt.createOneTimePayment': {
    en: 'Create One-Time Payment',
    beanie: 'create one-time payment',
  },
  'recurringPrompt.createOneTimePaymentHint': {
    en: 'Create a single expense transaction for the full amount on the start date. Use this for upfront payments that cover all sessions in the activity.',
    beanie:
      'create a single expense transaction for the full amount on the start date. use this for upfront payments that cover all sessions in the activity.',
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

  // Joint ownership + "for whom" (account form)
  'accounts.jointOwnerAdd': { en: 'Add joint owner', beanie: 'add joint owner' },
  'accounts.jointOwnerRemove': { en: 'Remove joint owners', beanie: 'remove joint owners' },
  'accounts.jointOwners': { en: 'Joint Owners', beanie: 'joint owners' },
  'accounts.forWhom': { en: 'For', beanie: 'for' },

  // Account details (optional reference info under "More Details")
  'accountDetails.section.caption': {
    en: 'Optional. Everything here is safe to leave blank — beanies stores it encrypted in your Family Data File.',
    beanie:
      'optional. everything here is safe to leave blank — beanies stores it encrypted in your family data file.',
  },
  'accountDetails.field.accountNumber': { en: 'Account Number', beanie: 'account number' },
  'accountDetails.field.onlineBankingUrl': {
    en: 'Online Banking URL',
    beanie: 'online banking url',
  },
  'accountDetails.field.onlineBankingUserId': {
    en: 'Online Banking User ID',
    beanie: 'online banking user id',
  },
  'accountDetails.field.notes': { en: 'Notes', beanie: 'notes' },
  'accountDetails.field.notesPlaceholder': {
    en: 'Anything worth remembering about this account…',
    beanie: 'anything worth remembering about this account…',
  },
  'accountDetails.bank.title': { en: 'Bank Details', beanie: 'bank details' },
  'accountDetails.field.routingNumber': {
    en: 'Routing / Sort Code',
    beanie: 'routing / sort code',
  },
  'accountDetails.field.iban': { en: 'IBAN', beanie: 'iban' },
  'accountDetails.field.swiftBic': { en: 'SWIFT / BIC', beanie: 'swift / bic' },
  'accountDetails.field.interestRate': { en: 'Interest Rate (%)', beanie: 'interest rate (%)' },
  'accountDetails.field.interestRateHint': {
    en: 'Annual % — savings accounts.',
    beanie: 'annual % — savings accounts.',
  },
  'accountDetails.card.title': { en: 'Credit Card Details', beanie: 'credit card details' },
  'accountDetails.field.cardNetwork': { en: 'Card Network', beanie: 'card network' },
  'accountDetails.field.cardLast4': { en: 'Last 4 Digits', beanie: 'last 4 digits' },
  'accountDetails.field.cardExpiry': { en: 'Expiry (MM/YY)', beanie: 'expiry (mm/yy)' },
  'accountDetails.field.creditLimit': { en: 'Credit Limit', beanie: 'credit limit' },
  'accountDetails.field.statementDay': { en: 'Statement Day', beanie: 'statement day' },
  'accountDetails.field.paymentDueDay': { en: 'Payment-Due Day', beanie: 'payment-due day' },
  'accountDetails.card.cvvNote': {
    en: 'Your CVV / security code is never stored — beanies keeps only what you need to recognise the card.',
    beanie:
      'your cvv / security code is never stored — beanies keeps only what you need to recognise the card.',
  },
  'accountDetails.crypto.title': { en: 'Wallets', beanie: 'wallets' },
  'accountDetails.crypto.publicOnly': {
    en: 'Public addresses only — never a seed phrase or private key.',
    beanie: 'public addresses only — never a seed phrase or private key.',
  },
  'accountDetails.wallets.walletLabel': { en: 'Wallet', beanie: 'wallet' },
  'accountDetails.wallets.labelField': { en: 'Label', beanie: 'label' },
  'accountDetails.wallets.labelPlaceholder': {
    en: 'e.g. Cold storage — Ledger',
    beanie: 'e.g. cold storage — ledger',
  },
  'accountDetails.wallets.address': { en: 'Public Address', beanie: 'public address' },
  'accountDetails.wallets.addressPlaceholder': { en: '0x… / bc1…', beanie: '0x… / bc1…' },
  'accountDetails.wallets.chain': { en: 'Chain', beanie: 'chain' },
  'accountDetails.wallets.chainOptional': { en: 'Chain (optional)', beanie: 'chain (optional)' },
  'accountDetails.wallets.add': { en: 'Add Wallet', beanie: 'add wallet' },
  'accountDetails.wallets.remove': { en: 'Remove wallet', beanie: 'remove wallet' },
  'accountDetails.err.last4': {
    en: 'Enter the last 4 digits (numbers only).',
    beanie: 'enter the last 4 digits (numbers only).',
  },
  'accountDetails.err.expiry': { en: 'Use MM/YY, e.g. 08/27.', beanie: 'use mm/yy, e.g. 08/27.' },
  'accountDetails.err.day': {
    en: 'Enter a day from 1 to 31.',
    beanie: 'enter a day from 1 to 31.',
  },
  'accountDetails.err.walletIncomplete': {
    en: 'Add both a label and an address, or remove this wallet.',
    beanie: 'add both a label and an address, or remove this wallet.',
  },
  'accountDetails.view.title': { en: 'Account Details', beanie: 'account details' },
  'accountDetails.view.card': { en: 'Card', beanie: 'card' },
  'accountDetails.view.expiry': { en: 'Expiry', beanie: 'expiry' },
  'accountDetails.view.statementDue': { en: 'Statement / Due Day', beanie: 'statement / due day' },
  'accountDetails.view.onlineBanking': { en: 'Online Banking', beanie: 'online banking' },
  'accountDetails.view.userId': { en: 'User ID', beanie: 'user id' },
  'accountDetails.copyAddress': { en: 'Copy address', beanie: 'copy address' },
  'accountDetails.copied': { en: 'Address copied', beanie: 'address copied' },
  'accountDetails.copyFailedTitle': { en: "Couldn't copy", beanie: "couldn't copy" },
  'accountDetails.copyFailedMsg': {
    en: 'Copy the address manually.',
    beanie: 'copy the address manually.',
  },

  // Family
  'family.title': { en: 'Family', beanie: 'the pod' },
  'family.addMember': { en: 'Add Member', beanie: 'add a beanie' },
  'family.editMember': { en: 'Edit Member', beanie: 'edit beanie' },
  'family.deleteMember': { en: 'Delete Member', beanie: 'remove beanie' },
  'family.noMembers': {
    en: 'No family members yet.',
    beanie: 'your bean pod is empty — add your first beanie!',
  },
  // Shown when a member without edit rights reaches a mutation another way — a quick-add
  // intent, the keyboard, or a view that went stale after their role changed. Info, not
  // error: nothing is broken and they have done nothing wrong.
  // Explicit .one/.other pair — the project's pluralization convention. This was a
  // hardcoded English 'night'/'nights' ternary inside a template EXPRESSION, which the
  // CI-blocking bare-string rule cannot see.
  'travel.gapNights.one': { en: '{count} night', beanie: '{count} night' },
  'travel.gapNights.other': { en: '{count} nights', beanie: '{count} nights' },
  'travel.addAPlan': { en: 'Add a Plan', beanie: 'add a plan' },
  'travel.calendarStale.title': {
    en: 'Trip Saved, Calendar May Lag',
    beanie: 'trip saved, calendar may lag',
  },
  'travel.calendarStale.message': {
    en: 'Your trip is safe. Refresh the page if the calendar looks out of date.',
    beanie: 'your trip is safe. refresh the page if the calendar looks out of date.',
  },
  'travel.jumpToIdeas': { en: 'Jump to trip ideas', beanie: 'jump to trip ideas' },
  'travel.openTrip': { en: 'Open trip: {name}', beanie: 'open trip: {name}' },
  'travel.segmentGone.title': { en: 'That Booking Is Gone', beanie: 'that booking is gone' },
  'travel.segmentGone.message': {
    en: 'Someone removed this booking while you had it open, so there was nothing to save it to.',
    beanie:
      'someone removed this booking while you had it open, so there was nothing to save it to.',
  },
  'permissions.readOnly.title': { en: 'View Only', beanie: 'view only' },
  'permissions.readOnly.message': {
    en: 'You can look around, but changes are down to the grown-ups who manage this pod.',
    beanie: 'you can look around, but changes are down to the beanies who manage this pod.',
  },
  'family.role.owner': { en: 'Owner', beanie: 'head beanie' },
  'family.role.admin': { en: 'Admin', beanie: 'admin beanie' },
  'family.role.member': { en: 'Member', beanie: 'beanie' },
  'family.role.pet': { en: '🐾 Pet Beanie', beanie: '🐾 pet beanie' },
  'family.role.ownerBadge': { en: 'Pod Owner', beanie: 'pod owner' },
  'family.normalizeRolesFailed': {
    en: 'Could not finish updating member roles. Reload the page to try again.',
    beanie: 'could not finish updating bean roles. reload to try again.',
  },

  // ── Change Password (Settings → Security & Privacy) ──────────────────────
  'changePassword.tileTitle': { en: 'Password', beanie: 'password' },
  'changePassword.tileDescription': {
    en: 'Change the password you use to unlock your beanpod and sign in.',
    beanie: 'change the password you use to unlock your beanpod and sign in.',
  },
  'changePassword.tileAction': { en: 'Change', beanie: 'change' },
  'changePassword.modalTitle': { en: 'Change Password', beanie: 'change password' },
  'changePassword.modalDescription': {
    en: 'Enter your current password, then choose a new one. Other devices will pick up the change next time they sync.',
    beanie:
      'enter your current password, then choose a new one. other devices will pick up the change next time they sync.',
  },
  'changePassword.currentPassword': { en: 'Current Password', beanie: 'current password' },
  'changePassword.currentPasswordPlaceholder': {
    en: 'Your current password',
    beanie: 'your current password',
  },
  'changePassword.newPassword': { en: 'New Password', beanie: 'new password' },
  'changePassword.newPasswordPlaceholder': {
    en: 'Choose a new password',
    beanie: 'choose a new password',
  },
  'changePassword.confirmNewPassword': {
    en: 'Confirm New Password',
    beanie: 'confirm new password',
  },
  'changePassword.confirmNewPasswordPlaceholder': {
    en: 'Re-enter the new password',
    beanie: 're-enter the new password',
  },
  'changePassword.submit': { en: 'Update Password', beanie: 'update password' },
  'changePassword.success': {
    en: 'Password updated.',
    beanie: 'password updated.',
  },
  'changePassword.error.required': {
    en: 'Please fill in all three fields.',
    beanie: 'please fill in all three fields.',
  },
  'changePassword.error.mismatch': {
    en: "New password and confirmation don't match.",
    beanie: "new password and confirmation don't match.",
  },
  'changePassword.error.sameAsCurrent': {
    en: 'New password must be different from your current one.',
    beanie: 'new password must be different from your current one.',
  },
  'changePassword.error.failed': {
    en: 'Could not update password. Please try again.',
    beanie: 'could not update password. please try again.',
  },
  'changePassword.error.saveFailed': {
    en: "Couldn't save your new password. Nothing changed — your current password still works. Please check your connection and try again.",
    beanie:
      "couldn't save your new password. nothing changed — your current password still works. please check your connection and try again.",
  },
  'changePassword.error.noConnection': {
    en: "You'll need a connection to change your password. Reconnect and try again.",
    beanie: "you'll need a connection to change your password. reconnect and try again.",
  },
  'changePassword.error.rollbackFailed': {
    en: "Something went wrong and we couldn't fully undo the change. Please sign out and back in to be safe, then try again.",
    beanie:
      "something went wrong and we couldn't fully undo the change. please sign out and back in to be safe, then try again.",
  },

  // ── Admin/owner reset of another member's password ────────────────────────
  // Used by ResetMemberPasswordModal. Error keys map 1:1 onto `ResetError`
  // in authStore — adding a new ResetError requires adding a key here.
  'family.resetPin.modalTitle': { en: "Reset {name}'s PIN", beanie: "reset {name}'s pin" },
  'family.resetPin.modalDescription': {
    en: 'Choose a new 6-digit PIN for {name}. They can change it themselves later in Settings.',
    beanie: 'choose a new 6-digit pin for {name}. they can change it later in settings.',
  },
  'family.resetPin.submit': { en: 'Reset PIN', beanie: 'reset pin' },
  'family.resetPin.success': {
    en: "{name}'s PIN has been reset.",
    beanie: "{name}'s pin has been reset.",
  },
  'family.resetPin.warning': {
    en: "{name}'s new PIN works on every family device. Their old PIN stops working on this device right away — other devices update the next time the family data syncs.",
    beanie: "{name}'s new pin works on every family device.",
  },
  'family.resetPassword.modalTitle': {
    en: 'Reset password for {name}',
    beanie: 'reset password for {name}',
  },
  'family.resetPassword.modalDescription': {
    en: 'Set a new temporary password. {name} can change it under Settings → Change Password after they sign in.',
    beanie:
      'set a new temporary password. {name} can change it under settings → change password after they sign in.',
  },
  'family.resetPassword.warning': {
    en: 'Share this password with {name} privately — anyone with it can sign in as them.',
    beanie: 'share this password with {name} privately — anyone with it can sign in as them.',
  },
  'family.resetPassword.submit': { en: 'Reset password', beanie: 'reset password' },
  'family.resetPassword.success': {
    en: 'Password reset. Share the new password with {name}.',
    beanie: 'password reset. share the new password with {name}.',
  },
  // Shared spinner label while a password change/reset blocks on the durable
  // Drive save (BeanieFormModal `submitting-label`). Used by both rotation modals.
  'auth.passwordRotation.savingLabel': {
    en: 'Saving your new password…',
    beanie: 'saving your new password…',
  },
  'family.resetPassword.error.required': {
    en: 'Please enter and confirm a new password.',
    beanie: 'please enter and confirm a new password.',
  },
  'family.resetPassword.error.mismatch': {
    en: 'Passwords do not match.',
    beanie: 'passwords do not match.',
  },
  'family.resetPassword.error.notAuthenticated': {
    en: 'Your session has expired. Sign in again and try.',
    beanie: 'your session has expired. sign in again and try.',
  },
  'family.resetPassword.error.memberNotFound': {
    en: "Couldn't find that family member.",
    beanie: "couldn't find that family member.",
  },
  'family.resetPassword.error.cannotResetSelf': {
    en: 'Change your own PIN from Settings → Account & Sign-In.',
    beanie: 'change your own pin from settings → account & sign-in.',
  },
  'family.resetPassword.error.isPet': {
    en: "Pets don't need a PIN.",
    beanie: "pets don't need a pin.",
  },
  'family.resetPassword.error.cannotResetOwner': {
    en: 'The pod owner changes their own PIN from Settings.',
    beanie: 'the pod owner changes their own pin from settings.',
  },
  'family.resetPassword.error.notAuthorized': {
    en: "You don't have permission to reset another member's PIN.",
    beanie: "you don't have permission to reset another member's pin.",
  },
  'family.resetPassword.error.familyKeyMissing': {
    en: 'Could not load family key — please sign out and back in, then try again.',
    beanie: 'could not load family key — please sign out and back in, then try again.',
  },
  'family.resetPassword.error.wrapFailed': {
    en: 'Failed to re-wrap the account key. Please try again.',
    beanie: 'failed to re-wrap the account key. please try again.',
  },
  'family.resetPassword.error.updateFailed': {
    en: "Couldn't update their password. Nothing was changed. Please try again.",
    beanie: "couldn't update their password. nothing was changed. please try again.",
  },
  'family.resetPassword.error.saveFailed': {
    en: "Couldn't save the new password. Nothing changed — their current password still works. Please check your connection and try again.",
    beanie:
      "couldn't save the new password. nothing changed — their current password still works. please check your connection and try again.",
  },
  'family.resetPassword.error.noConnection': {
    en: "You'll need a connection to reset their password. Reconnect and try again.",
    beanie: "you'll need a connection to reset their password. reconnect and try again.",
  },
  'family.resetPassword.error.rollbackFailed': {
    en: "Something went wrong and we couldn't fully undo the change. Please sign out and back in to be safe, then try again.",
    beanie:
      "something went wrong and we couldn't fully undo the change. please sign out and back in to be safe, then try again.",
  },
  'family.resetPassword.error.unexpected': {
    en: 'Something went wrong. Please try again.',
    beanie: 'something went wrong. please try again.',
  },

  // ── Transfer Ownership ────────────────────────────────────────────────────
  'transferOwnership.entryTitle': {
    en: 'Transfer Pod Ownership',
    beanie: 'transfer pod ownership',
  },
  'transferOwnership.entryDescription': {
    en: 'Hand the super-admin role to another adult in your pod.',
    beanie: 'hand the super-admin role to another adult in your pod.',
  },
  'transferOwnership.pickTitle': { en: 'Choose New Owner', beanie: 'choose new owner' },
  'transferOwnership.pickDescription': {
    en: 'Pick the adult who should become the pod owner. Children and pets cannot be owners.',
    beanie: 'pick the adult who should become the pod owner. children and pets cannot be owners.',
  },
  'transferOwnership.warning': {
    en: "You'll lose super-admin rights. The new owner can revoke any of your permissions, including transferring ownership back to you.",
    beanie:
      "you'll lose super-admin rights. the new owner can revoke any of your permissions, including transferring ownership back to you.",
  },
  'transferOwnership.noEligibleRecipients': {
    en: 'No eligible recipients. Adults must join your pod (set up their account) before they can become owner.',
    beanie:
      'no eligible recipients. adults must join your pod (set up their account) before they can become owner.',
  },
  'transferOwnership.continue': { en: 'Continue', beanie: 'continue' },
  // #80 step-up gate: action-neutral defaults for ReauthChallenge, which is no longer
  // transfer-ownership-only. TransferOwnership passes its own keys to keep its wording.
  'reauth.description': {
    en: 'Confirm it’s really you before continuing.',
    beanie: 'confirm it’s really you before continuing.',
  },
  'reauth.noCredential': {
    en: 'You need a PIN or a password set up before you can do this. Open Settings → Security to add one, then try again.',
    beanie:
      'you need a pin or a password set up before you can do this. open settings → security to add one, then try again.',
  },
  'settings.deleteFamilyExportFailed': {
    en: 'Nothing was deleted',
    beanie: 'nothing was deleted',
  },
  'settings.deleteFamilyExportFailedHelp': {
    en: "Your data couldn't be exported, so your family has been left exactly as it was. Try the export again, or untick it if you'd rather continue without a copy.",
    beanie:
      "your data couldn't be exported, so your family has been left exactly as it was. try the export again, or untick it if you'd rather continue without a copy.",
  },
  'settings.deleteFamilyExportCheckTitle': {
    en: 'Did your export save?',
    beanie: 'did your export save?',
  },
  'settings.deleteFamilyExportCheckMsg': {
    en: "Check your files and make sure the export is really there. Once you continue, your family is deleted and this copy is all you'll have.",
    beanie:
      "check your files and make sure the export is really there. once you continue, your beans are deleted and this copy is all you'll have.",
  },
  'settings.deleteFamilyExportCheckConfirm': {
    en: "Yes, it's saved",
    beanie: "yes, it's saved",
  },
  'settings.deleteFamilyFailed': {
    en: "Couldn't finish deleting",
    beanie: "couldn't finish deleting",
  },
  'settings.deleteFamilyFailedHelp': {
    en: 'Something went wrong part-way through. Check Settings to see what is left, and try again.',
    beanie:
      'something went wrong part-way through. check settings to see what is left, and try again.',
  },
  'settings.clearDataFailed': {
    en: 'Your data couldn’t be cleared. Nothing was removed — try again in a moment.',
    beanie: 'your data couldn’t be cleared. nothing was removed — try again in a moment.',
  },
  'family.deleteFailed': {
    en: 'That bean couldn’t be removed. Try again in a moment.',
    beanie: 'that bean couldn’t be removed. try again in a moment.',
  },
  'reauth.unavailableTitle': { en: 'Not Ready Yet', beanie: 'not ready yet' },
  'reauth.unavailable': {
    en: 'Your family is still loading, so we can’t check it’s you yet. Give it a moment and try again.',
    beanie: 'your beans are still loading, so we can’t check it’s you yet. try again in a moment.',
  },
  'transferOwnership.reauthTitle': { en: 'Verify Identity', beanie: 'verify identity' },
  'transferOwnership.reauthDescription': {
    en: 'Confirm it’s really you before transferring ownership.',
    beanie: 'confirm it’s really you before transferring ownership.',
  },
  'transferOwnership.reauthPasswordDescription': {
    en: 'Enter your password to confirm the transfer.',
    beanie: 'enter your password to confirm the transfer.',
  },
  'transferOwnership.reauthPasskeyButton': {
    en: 'Verify with Passkey',
    beanie: 'verify with passkey',
  },
  'transferOwnership.reauthPasswordButton': {
    en: 'Use Password Instead',
    beanie: 'use password instead',
  },
  'transferOwnership.reauthVerifyButton': { en: 'Verify', beanie: 'verify' },
  'transferOwnership.reauthPasskeyFailed': {
    en: 'Biometric verification failed. Try again or use your PIN.',
    beanie: 'biometric verification failed. try again or use your pin.',
  },
  'transferOwnership.reauthWrongPassword': {
    en: 'Incorrect password. Try again.',
    beanie: 'incorrect password. try again.',
  },
  'transferOwnership.reauthWrongMember': {
    en: 'That passkey belongs to a different member. Use yours.',
    beanie: 'that passkey belongs to a different member. use yours.',
  },
  'transferOwnership.reauthSessionMissing': {
    en: 'Your session expired. Sign in again to continue.',
    beanie: 'your session expired. sign in again to continue.',
  },
  'transferOwnership.reauthNoPassword': {
    en: 'This account has no password on file.',
    beanie: 'this account has no password on file.',
  },
  'transferOwnership.reauthNoCredential': {
    en: 'You need a passkey or a password set up to transfer ownership. Open Settings → Security to add one, then try again.',
    beanie:
      'you need a passkey or a password set up to transfer ownership. open settings → security to add one, then try again.',
  },
  'transferOwnership.confirmTitle': { en: 'Confirm Transfer', beanie: 'confirm transfer' },
  'transferOwnership.confirmMessage': {
    en: '{name} will become the pod owner. You will become a regular member.',
    beanie: '{name} will become the pod owner. you will become a regular member.',
  },
  'transferOwnership.confirmAction': { en: 'Transfer Ownership', beanie: 'transfer ownership' },
  'transferOwnership.success': {
    en: 'Ownership transferred to {name}.',
    beanie: 'ownership transferred to {name}.',
  },
  'transferOwnership.failed': {
    en: 'Could not transfer ownership. Please try again.',
    beanie: 'could not transfer ownership. please try again.',
  },
  'transferOwnership.invalidTarget': {
    en: 'That member can’t become the owner.',
    beanie: 'that bean can’t become the owner.',
  },
  'settings.transferOwnership': { en: 'Transfer Pod Ownership', beanie: 'transfer pod ownership' },
  'settings.transferOwnershipDesc': {
    en: 'Move the super-admin role to another adult.',
    beanie: 'move the super-admin role to another adult.',
  },
  'settings.podOwnershipSection': { en: 'Pod Ownership', beanie: 'pod ownership' },
  'settings.currentOwner': { en: 'Current owner', beanie: 'current owner' },
  'settings.transferOwnershipAction': {
    en: 'Transfer ownership…',
    beanie: 'transfer ownership…',
  },
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
    en: "We're growing something special. Financial forecasting will help you see where your family is headed.",
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
  // Discord moved out of the settings-card grid to a standalone CTA at the
  // bottom of the page — joining a community is an invitation, not a
  // preference to configure.
  'settings.discordCta': { en: 'Come say hello on Discord', beanie: 'come say hello on discord' },
  'settings.discordCtaDesc': {
    en: 'Meet other families, ask us anything, help decide what we build next',
    beanie: 'meet other families, ask us anything, help decide what we build next',
  },
  'settings.discordCtaAction': { en: 'Join', beanie: 'join' },
  'settings.card.reminders': { en: 'Reminders', beanie: 'reminders' },
  'settings.card.remindersDesc': {
    en: 'Notification timing for activities, travel & to-dos',
    beanie: 'when we nudge you',
  },
  'settings.card.appearance': { en: 'Appearance', beanie: 'appearance' },
  'settings.card.appearanceDesc': { en: 'Theme & display preferences', beanie: 'how things look' },
  'settings.card.currency': { en: 'Currency & Rates', beanie: 'currency & rates' },
  'settings.card.currencyDesc': {
    en: 'Base currency & exchange rates',
    beanie: 'your bean currency',
  },
  'settings.card.account': { en: 'Account & Sign-In', beanie: 'account & sign-in' },
  'settings.card.accountDesc': {
    en: 'Password, PIN, and biometrics',
    beanie: 'password, pin, biometrics',
  },
  'settings.card.security': { en: 'Security & Recovery', beanie: 'security & recovery' },
  'settings.card.securityDesc': {
    en: 'Device trust, recovery kit, emergencies',
    beanie: 'device trust, recovery kit, emergencies',
  },
  'settings.accountModal.title': { en: 'Account & Sign-In', beanie: 'account & sign-in' },
  'settings.card.familyMembers': { en: 'Family Members', beanie: 'family members' },
  'settings.card.familyMembersDesc': { en: 'Manage your family', beanie: 'manage your pod' },
  'settings.card.familyData': { en: 'Family Data', beanie: 'family data' },
  'settings.card.familyDataDesc': { en: 'Cloud storage & sync', beanie: 'your bean vault' },
  'settings.card.dataManagement': { en: 'Data Management', beanie: 'data management' },
  'settings.card.dataManagementDesc': { en: 'Export & clear data', beanie: 'export & clear beans' },
  'settings.card.countryHolidays': { en: 'Country & Holidays', beanie: 'country & holidays' },
  'settings.card.countryHolidaysDesc': {
    en: 'Where your family lives & public-holiday display',
    beanie: 'where your family lives & public-holiday display',
  },
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
  'settings.textSize': { en: 'Text Size', beanie: 'text size' },
  'settings.textSize.normal': { en: 'Normal', beanie: 'normal' },
  'settings.textSize.large': { en: 'Large', beanie: 'large' },
  'settings.textSizeHint': {
    en: 'Make text and buttons easier to read',
    beanie: 'make text and buttons easier to read',
  },
  'settings.persistFailed': {
    en: "Couldn't save your preference",
    beanie: "couldn't save your preference",
  },
  'common.retry': { en: 'Retry', beanie: 'retry' },
  'settings.weekStart': { en: 'Week Starts On', beanie: 'week starts on' },
  'settings.weekStart.sunday': { en: 'Sunday', beanie: 'sunday' },
  'settings.weekStart.monday': { en: 'Monday', beanie: 'monday' },
  'settings.weekStartHint': {
    en: 'Choose which day the calendar week starts on',
    beanie: 'choose which day the calendar week starts on',
  },
  'settings.country': { en: 'Country', beanie: 'country' },
  'settings.countryNotSet': { en: 'Not set', beanie: 'not set' },
  'settings.countryHelp': {
    en: "We'll show your country's public holidays on the Family Planner. Nothing about your location ever leaves your device.",
    beanie:
      "we'll show your country's public holidays on the family planner. nothing about your location ever leaves your device.",
  },
  'settings.showPublicHolidays': {
    en: 'Show public holidays on the planner',
    beanie: 'show public holidays on the planner',
  },
  'settings.showPublicHolidaysNeedsCountry': {
    en: 'Pick your country first',
    beanie: 'pick your country first',
  },
  'holiday.publicHolidaySuffix': { en: 'public holiday', beanie: 'public holiday' },
  'holiday.observanceNote': {
    en: 'Work and school are probably off — please check!',
    beanie: 'work and school are probably off — please check!',
  },
  'holiday.referenceNote': {
    en: "This is just reference info — it doesn't add anything to your calendar.",
    beanie: "this is just reference info — it doesn't add anything to your calendar.",
  },
  'holiday.upcomingHeading': { en: 'Upcoming holidays', beanie: 'upcoming holidays' },
  'holiday.loadFailedRetryHint': {
    en: "Couldn't load holidays right now — they'll appear once you're back online.",
    beanie: "couldn't load holidays right now — they'll show up once you're back online.",
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
  'settings.dailyTips': { en: 'Daily Tips', beanie: 'daily tips' },
  'settings.dailyTipsDescription': {
    en: 'One small tip per day in your notification bell',
    beanie: 'one small tip per day in your notification bell',
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
  'sync.durabilityBannerTitle': {
    en: "This device can't save locally right now",
    beanie: "this device can't save locally right now",
  },
  'sync.durabilityBanner': {
    en: 'Recent changes might not survive a refresh on this device. Your saved copy is safe.',
    beanie: 'recent changes might not survive a refresh on this device. your saved beans are safe.',
  },
  'sync.durabilityBannerCta': {
    en: "What's This?",
    beanie: "what's this?",
  },
  'settings.about': { en: 'About', beanie: 'about' },
  'settings.appName': { en: 'beanies.family', beanie: 'beanies.family' },
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

  // Self-host vs cloud-host indicator (Settings footer + cloud-only feature tooltips)
  'selfHost.badge.cloud': { en: 'Cloud-hosted version', beanie: 'cloud-hosted version' },
  'selfHost.badge.devBuild': {
    en: 'Self-hosted · Developer build',
    beanie: 'self-hosted · developer build',
  },
  'selfHost.badge.community': {
    en: 'Self-hosted · Community build',
    beanie: 'self-hosted · community build',
  },
  'selfHost.learnMore': { en: 'Learn more', beanie: 'learn more' },
  'selfHost.inviteUnavailableTooltip': {
    en: 'Inviting family members requires the cloud-hosted version of beanies.family.',
    beanie: 'inviting family members requires the cloud-hosted version of beanies.family.',
  },
  'selfHost.driveUnavailableTooltip': {
    en: 'Google Drive sync is not configured in this build. See SELF_HOSTING.md.',
    beanie: 'google drive sync is not configured in this build. see SELF_HOSTING.md.',
  },
  'selfHost.driveUnavailableNoProxyTooltip': {
    en: 'Google Drive sync needs an OAuth proxy. See SELF_HOSTING.md → Path B.',
    beanie: 'google drive sync needs an oauth proxy. see SELF_HOSTING.md → path b.',
  },
  'selfHost.notConfigured': { en: 'Not configured', beanie: 'not configured' },
  'selfHost.localUnsupported': {
    en: "This browser can't store a local file. Open beanies.family in Chrome or Edge on a computer to set up your pod.",
    beanie:
      "this browser can't store a local file. open beanies.family in chrome or edge on a computer to set up your pod.",
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
  'family.colorTakenBy': {
    en: "Already {name}'s colour",
    beanie: "already {name}'s colour",
  },
  'family.colorAllTaken': {
    en: 'All colours are taken — {name} will share with {other}.',
    beanie: 'all colours are taken — {name} will share with {other}.',
  },
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
  'error.backgroundRefreshFailed': {
    en: "Couldn't refresh your data",
    beanie: "couldn't refresh your beanies",
  },
  'error.backgroundRefreshFailedHelp': {
    en: 'Some data may be out of date. Try refreshing the app. If it keeps happening, sign out and sign back in.',
    beanie:
      'some beans may be out of date. try refreshing the app. if it keeps happening, sign out and sign back in.',
  },
  'docWorker.updateFailed': {
    en: "We couldn't update your data",
    beanie: "couldn't update your beans",
  },
  'error.refreshFailed': {
    en: 'Refresh failed',
    beanie: "couldn't refresh",
  },
  'error.refreshFailedHelp': {
    en: 'Try closing and reopening the app.',
    beanie: 'try closing and reopening the app.',
  },
  'error.supportNotified': {
    en: 'Support has been notified.',
    beanie: 'support has been notified.',
  },
  'error.travelSegmentNotFound': {
    en: "We couldn't open that travel segment",
    beanie: "couldn't open that travel segment",
  },
  'error.travelSegmentNotFoundHelp': {
    en: 'It may have just been removed. Try refreshing the calendar.',
    beanie: 'it may have just been removed. try refreshing the calendar.',
  },
  'error.travelSegmentVanished': {
    en: 'That travel segment was just removed',
    beanie: 'that travel segment was just removed',
  },
  'error.travelSegmentVanishedHelp': {
    en: 'Someone in your family deleted it on another device. We closed the editor.',
    beanie: 'someone in your family deleted it on another device. we closed the editor.',
  },
  'error.translationLoadFailed': {
    en: "We couldn't load translations",
    beanie: "couldn't load translations",
  },
  'error.translationLoadFailedHelp': {
    en: 'Check your connection and try again. The app stays in your previous language until then.',
    beanie:
      'check your connection and try again. the app stays in your previous language until then.',
  },
  'error.unexpectedFailure': {
    en: 'Something went wrong',
    beanie: 'a bean got stuck',
  },
  'error.unexpectedFailureHelp': {
    en: 'Please refresh and try again. Support has been notified.',
    beanie: 'please refresh and try again. support has been notified.',
  },

  // Not Found (404)
  'notFound.title': { en: 'Not Found', beanie: 'not found' },
  'notFound.heading': { en: 'Oops! This page got lost...', beanie: 'oops! this bean got lost...' },
  'notFound.description': {
    en: "The page you're looking for has wandered off. Let's get you back to your family.",
    beanie: "the page you're looking for has wandered off. let's get you back to your beanies.",
  },
  'notFound.goHome': { en: 'Back to Dashboard', beanie: 'back to dashboard' },

  // No Access (permission denied)
  'noAccess.title': { en: 'No Access', beanie: 'no access' },
  'noAccess.heading': {
    en: 'This area is off-limits',
    beanie: 'this area is off-limits, little bean',
  },
  'noAccess.description': {
    en: "You don't have permission to view this page. Ask a pod manager to update your access.",
    beanie: "you don't have permission to view this page. ask a pod manager to update your access.",
  },
  'noAccess.backToNook': { en: 'Back to the Nook', beanie: 'back to the nook' },
  'settings.adminOnly': {
    en: 'Only a family admin can change this. Ask one if it needs updating.',
    beanie: 'only a family admin can change this. ask one if it needs updating.',
  },

  // Empty states
  'empty.noData': { en: 'No data available', beanie: 'no beans here yet' },
  'empty.noResults': { en: 'No results found', beanie: 'no beans matched your search' },

  // Filter
  'filter.members': { en: 'Members', beanie: 'members' },
  'filter.allMembers': { en: 'All Members', beanie: 'all members' },
  'filter.filteredTo': { en: 'Filtered to: {names}', beanie: 'filtered to: {names}' },

  // Date/Time
  'date.today': { en: 'Today', beanie: 'today' },
  'date.yesterday': { en: 'Yesterday', beanie: 'yesterday' },
  'date.thisWeek': { en: 'This Week', beanie: 'this week' },
  'date.thisMonth': { en: 'This Month', beanie: 'this month' },
  'date.thisYear': { en: 'This Year', beanie: 'this year' },
  'date.tomorrow': { en: 'Tomorrow', beanie: 'tomorrow' },
  'date.pick': { en: 'Pick a Date', beanie: 'pick a date' },
  'date.jumpToToday': { en: 'Jump to Today', beanie: 'jump to today' },
  'date.clear': { en: 'Clear', beanie: 'clear' },
  'date.clearAriaLabel': { en: 'Clear date', beanie: 'clear date' },
  'time.hour': { en: 'Hour', beanie: 'hour' },
  'time.minute': { en: 'Min', beanie: 'min' },
  'time.period': { en: 'AM/PM', beanie: 'am/pm' },
  'time.now': { en: 'Now', beanie: 'now' },
  'time.clear': { en: 'Clear', beanie: 'clear' },
  'time.done': { en: 'Done', beanie: 'done' },
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
  'dashboard.rolePet': { en: 'Pet Beanie', beanie: 'pet beanie' },
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
  'header.accountMenu': { en: 'Your account', beanie: 'your account' },
  'header.settings': { en: 'Settings', beanie: 'settings' },
  'header.refreshAll': { en: 'Refresh All Data', beanie: 'refresh all beans' },
  'header.refreshSuccess': { en: 'Data refreshed', beanie: 'beans are fresh' },
  'header.refreshAuthFailed': {
    en: "Couldn't refresh. Your sign-in has expired, so you may not be seeing the latest.",
    beanie: "couldn't refresh. your sign-in has expired, so you may not be seeing the latest.",
  },
  'header.refreshNoSync': {
    en: 'No cloud sync configured',
    beanie: 'no cloud sync configured',
  },
  'header.newVersionReady': {
    en: 'A new version is ready',
    beanie: 'fresh beans are ready',
  },
  'header.reloadNow': { en: 'Reload Now', beanie: 'reload now' },

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

  // Save-status indicator (sidebar security cluster + mobile drawer)
  'saveStatus.saved': { en: 'Saved', beanie: 'saved' },
  'saveStatus.savedAgo': { en: 'Saved · {time}', beanie: 'saved · {time}' },
  'saveStatus.saving': { en: 'Saving…', beanie: 'saving…' },
  'saveStatus.degraded': { en: 'Having trouble saving', beanie: 'having trouble saving' },
  'saveStatus.rowAria': {
    en: 'Save status — tap for details',
    beanie: 'save status — tap for details',
  },
  'saveStatus.needsAttention': { en: 'save needs attention', beanie: 'save needs attention' },
  // Popover
  'saveStatus.titleSafe': { en: 'Your beans are safe', beanie: 'your beans are safe' },
  'saveStatus.connection': { en: 'Connection', beanie: 'connection' },
  'saveStatus.connected': { en: 'Connected', beanie: 'connected' },
  'saveStatus.reconnecting': { en: 'Reconnecting…', beanie: 'reconnecting…' },
  'saveStatus.lastSaved': { en: 'Last saved', beanie: 'last saved' },
  'saveStatus.lastGoodSave': { en: 'Last good save', beanie: 'last good save' },
  'saveStatus.never': { en: 'Not saved yet', beanie: 'not saved yet' },
  'saveStatus.manageConnection': { en: 'Manage connection', beanie: 'manage connection' },
  'saveStatus.reassuranceOk': {
    en: 'Everything is saving normally.',
    beanie: 'everything is saving normally.',
  },
  'saveStatus.reassuranceDegradedOwner': {
    en: 'Your recent changes are held safely on this device until the next save lands.',
    beanie: 'your recent changes are held safely on this device until the next save lands.',
  },
  'saveStatus.reassuranceDegradedMember': {
    en: 'Your changes are safe on this device. If it keeps up, let your family owner know.',
    beanie: 'your changes are safe on this device. if it keeps up, let your family owner know.',
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
  'family.addMemberFailed': {
    en: "Couldn't add that member — please try again.",
    beanie: "couldn't add that beanie — please try again",
  },
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
  'family.hub.title': { en: 'Meet the Beans', beanie: 'meet the beans' },
  'family.hub.kicker': { en: 'The Pod · Family Scrapbook', beanie: 'the pod · family scrapbook' },
  'family.hub.stats.summary': {
    en: '{beans} beans · {favorites} favorites · {sayings} sayings · {recipes} recipes · {meds} active meds · {allergies} allergies',
    beanie:
      '{beans} beans · {favorites} favorites · {sayings} sayings · {recipes} recipes · {meds} active meds · {allergies} allergies',
  },
  'family.hub.inviteBean': { en: 'Invite Beanie', beanie: 'invite beanie' },
  'family.hub.addBean': { en: 'Add Beanie', beanie: 'add beanie' },
  'family.hub.recentSayings': {
    en: 'Recent family sayings 💬',
    beanie: 'recent family sayings 💬',
  },
  'family.hub.recentSayings.viewAll': { en: 'See all →', beanie: 'see all →' },
  'family.hub.recentSayings.empty': {
    en: 'Capture a few sayings and they show up here.',
    beanie: 'capture a few sayings and they show up here',
  },
  'family.hub.cookbook.title': { en: 'Secret Family Recipes', beanie: 'secret family recipes' },
  'family.hub.cookbook.sub': {
    en: "shhh… don't tell anyone 🤫",
    beanie: "shhh… don't tell anyone 🤫",
  },
  'family.hub.cookbook.open': { en: 'Open cookbook →', beanie: 'open cookbook →' },
  'family.hub.cookbook.add': { en: 'Add a recipe', beanie: 'add a recipe' },
  'family.hub.cookbook.noPhoto': { en: 'no photo yet', beanie: 'no photo yet' },
  'family.hub.sidebar.allergies': { en: 'Heads up — allergies', beanie: 'heads up — allergies' },
  'family.hub.sidebar.todaysCare': { en: "Today's care", beanie: "today's care" },
  'family.hub.sidebar.noAllergies': {
    en: 'No allergies on file across the family.',
    beanie: 'no allergies on file across the family',
  },
  'family.hub.sidebar.noMeds': {
    en: 'No active medications across the family.',
    beanie: 'no active meds across the family',
  },
  'family.hub.sidebar.viewAllAllergies': {
    en: 'View all {count} →',
    beanie: 'view all {count} →',
  },
  'family.hub.sidebar.viewAllMeds': {
    en: 'View all {count} →',
    beanie: 'view all {count} →',
  },
  'family.card.fave': { en: 'Fave', beanie: 'fave' },
  'family.card.latestSaying': { en: 'Latest saying', beanie: 'latest saying' },
  'family.card.headsUp': { en: 'Heads up — Allergies', beanie: 'heads up — allergies' },
  'family.card.care': { en: 'Care', beanie: 'care' },
  'family.card.noteLabel': { en: 'Notes', beanie: 'notes' },
  'family.card.allergy': { en: 'allergy', beanie: 'allergy' },
  'family.card.allergies': { en: 'allergies', beanie: 'allergies' },
  'family.card.med': { en: 'med', beanie: 'med' },
  'family.card.meds': { en: 'meds', beanie: 'meds' },
  'family.card.view': { en: 'View {name} →', beanie: 'view {name} →' },
  'family.hub.subtitle': {
    en: '{count} Beans Growing Strong',
    beanie: '{count} beans growing strong',
  },
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
    en: 'Finish setting up your encrypted data file, or load an existing one.',
    beanie: 'finish setting up your encrypted data file, or load an existing one.',
  },
  'settings.resumeSetup': {
    en: 'Resume Setup',
    beanie: 'resume setup',
  },
  'settings.loadExistingDataFile': {
    en: 'Load Existing Family Data File',
    beanie: 'load existing family data file',
  },
  'settings.reconnectAndReload': {
    en: 'Reconnect and Reload My Data',
    beanie: 'reconnect and reload my data',
  },
  'settings.dataReconnecting': {
    en: 'Reconnecting your data…',
    beanie: 'reconnecting your data…',
  },
  'settings.dataReconnectingDesc': {
    en: 'Re-establishing the connection to your family data file. Your data is safe.',
    beanie: 're-establishing the connection to your family data file. your data is safe.',
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
  'password.decryptionError': {
    en: "That password didn't unlock the pod. If you're sure it's right, ask a family member to open the pod first — we'll automatically repair the issue on your next sign-in.",
    beanie:
      "that password didn't unlock the pod. if you're sure it's right, ask a family bean to open the pod first — we'll quietly fix it next time you sign in.",
  },
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
  'setup.localFileUnsupported': {
    en: "This browser can't save to a local file. Use Google Drive instead — it works here and syncs to your family. (On a computer, Chrome or Edge also support local files.)",
    beanie:
      "this browser can't save to a local file. use google drive instead — it works here and syncs to your family. (on a computer, chrome or edge also support local files.)",
  },

  // Create-pod failures — one key per `CreatePodFailureReason` so the user
  // sees a message they can act on rather than a generic "something broke".
  // Used by CreatePodView.handleStep2Next's switch on `result.reason`.
  'createPod.failedReasonWrite': {
    en: "We couldn't save your pod to your storage. Please check your connection and try again.",
    beanie:
      "we couldn't save your pod to your storage. please check your connection and try again.",
  },
  'createPod.failedReasonVerify': {
    en: "We saved your pod but couldn't verify it loaded correctly. Please try again — your previous attempt was set aside so it can't be loaded.",
    beanie:
      "we saved your pod but couldn't verify it loaded correctly. please try again - your previous attempt was set aside so it can't be loaded.",
  },
  'createPod.failedReasonPersist': {
    en: "We saved your pod, but couldn't cache it on this device. Please try again.",
    beanie: "we saved your pod, but couldn't cache it on this device. please try again.",
  },
  'createPod.failedReasonRegister': {
    en: "We saved your pod, but couldn't reach our family registry. Please check your connection and try again.",
    beanie:
      "we saved your pod, but couldn't reach our family registry. please check your connection and try again.",
  },
  'createPod.failedReasonPrecondition': {
    en: 'We hit a problem getting your pod ready. Please refresh the page and try again.',
    beanie: 'we hit a problem getting your pod ready. please refresh the page and try again.',
  },
  'createPod.failedReasonConcurrent': {
    en: 'Another pod setup is already in progress. Please wait a moment and try again.',
    beanie: 'another pod setup is already in progress. please wait a moment and try again.',
  },
  'createPod.failedReasonExistingPod': {
    en: "Your family already has a pod, so we didn't create a new one. Try loading your existing pod instead — your data is safe.",
    beanie:
      "your family already has a pod, so we didn't create a new one. try loading your existing pod instead — your data is safe.",
  },
  'createPod.duplicateFile': {
    en: "A pod file with this family name already exists in your Google Drive. Please pick a different family name and try again — we won't touch the existing file.",
    beanie:
      "a pod file with this family name already exists in your google drive. please pick a different family name and try again — we won't touch the existing file.",
  },
  'createPod.adoptExistingTitle': {
    en: 'Open your existing family file?',
    beanie: 'open your existing family file?',
  },
  'createPod.adoptExistingMessage': {
    en: 'We found a family file with this name already in your Google Drive. Would you like to open it instead of starting fresh?',
    beanie:
      'we found a family file with this name already in your google drive. would you like to open it instead of starting fresh?',
  },
  'createPod.adoptExistingConfirm': {
    en: 'Open it',
    beanie: 'open it',
  },
  'createPod.adoptExistingCancel': {
    en: 'Start fresh with a new name',
    beanie: 'start fresh with a new name',
  },
  'createPod.driveCheckUnavailable': {
    en: "We couldn't check your Google Drive just now, so we didn't create a file (to avoid duplicates). Please check your connection and try again.",
    beanie:
      "we couldn't check your google drive just now, so we didn't create a file (to avoid duplicates). please check your connection and try again.",
  },

  // Auth
  'auth.signingIn': { en: 'Signing in...', beanie: 'signing in...' },
  'auth.creatingAccount': { en: 'Creating account...', beanie: 'creating account...' },
  'auth.storageBlocked': {
    en: "Your browser is blocking local storage, so we couldn't create your family. This usually happens in Private Browsing — turn it off, or use a normal window, and try again.",
    beanie:
      "your browser is blocking local storage, so we couldn't create your family. this usually happens in private browsing — turn it off, or use a normal window, and try again.",
  },
  'oauth.storageErrorTitle': {
    en: "Sign-in couldn't finish",
    beanie: "sign-in couldn't finish",
  },
  'oauth.storageErrorBody': {
    en: "We couldn't finish connecting to Google. Please try signing in again.",
    beanie: "we couldn't finish connecting to google. please try signing in again.",
  },
  'auth.signOut': { en: 'Sign Out', beanie: 'sign out' },
  'auth.signingOut': { en: 'Signing out…', beanie: 'signing out…' },
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
  'settings.familyData.signedInAs': {
    en: 'Signed in with',
    beanie: 'signed in with',
  },
  'settings.familyData.switchAccount': {
    en: 'Switch Google account',
    beanie: 'switch google account',
  },
  'settings.familyData.switchAccountFailed': {
    en: "Couldn't switch accounts. Try again.",
    beanie: "couldn't switch accounts. try again",
  },
  // Move pod storage between local file and Google Drive
  'settings.familyData.migrate.moveToGoogleDrive': {
    en: 'Move to Google Drive',
    beanie: 'move to google drive',
  },
  'settings.familyData.migrate.moveToGoogleDriveDesc': {
    en: 'Save your pod to Google Drive for cross-device access.',
    beanie: 'save your pod to google drive for cross-device access',
  },
  'settings.familyData.migrate.moveToLocalFile': {
    en: 'Move to a local file',
    beanie: 'move to a local file',
  },
  'settings.familyData.migrate.moveToLocalFileDesc': {
    en: 'Save your pod to a file on this device.',
    beanie: 'save your pod to a file on this device',
  },
  'settings.familyData.migrate.confirmTitleToDrive': {
    en: 'Move your pod to Google Drive?',
    beanie: 'move your pod to google drive?',
  },
  'settings.familyData.migrate.confirmTitleToLocal': {
    en: 'Move your pod to a local file?',
    beanie: 'move your pod to a local file?',
  },
  'settings.familyData.migrate.confirmBodyToDrive': {
    en: "We'll create a new encrypted .beanpod file on your Google Drive and start saving there. The file you're using now stays where it is — it just stops updating, so keep it as a backup until you're happy with the move. Other devices signed in to this pod will need to load it again from Drive. Your password doesn't change.",
    beanie:
      "we'll create a new encrypted .beanpod file on your google drive and start saving there. the file you're using now stays where it is — it just stops updating, so keep it as a backup until you're happy with the move. other devices signed in to this pod will need to load it again from drive. your password doesn't change.",
  },
  'settings.familyData.migrate.confirmBodyToLocal': {
    en: "You'll pick a spot on this device for a new encrypted .beanpod file, and we'll start saving there. The Drive file you're using now stays where it is — it just stops updating, so keep it as a backup until you're happy with the move. Other devices signed in to this pod will need to load the new file. Your password doesn't change.",
    beanie:
      "you'll pick a spot on this device for a new encrypted .beanpod file, and we'll start saving there. the drive file you're using now stays where it is — it just stops updating, so keep it as a backup until you're happy with the move. other devices signed in to this pod will need to load the new file. your password doesn't change.",
  },
  'settings.familyData.migrate.confirmAction': {
    en: 'Move my pod',
    beanie: 'move my pod',
  },
  'settings.familyData.migrate.cancelledTitle': {
    en: 'Move cancelled',
    beanie: 'move cancelled',
  },
  'settings.familyData.migrate.cancelledBody': {
    en: 'Your pod is still saved to {source}.',
    beanie: 'your pod is still saved to {source}',
  },
  'settings.familyData.migrate.successTitle': {
    en: 'Your pod moved',
    beanie: 'your pod moved',
  },
  'settings.familyData.migrate.successBody': {
    en: 'Now saving to {dest}. {source} is still where it was — keep it as a backup if you like.',
    beanie:
      'now saving to {dest}. {source} is still where it was — keep it as a backup if you like',
  },
  'settings.familyData.migrate.failedTitle': {
    en: "Couldn't move your pod",
    beanie: "couldn't move your pod",
  },
  'settings.familyData.migrate.failedBody': {
    en: '{reason} Your pod is still saved to {source}.',
    beanie: '{reason} your pod is still saved to {source}',
  },
  'settings.familyData.migrate.recoveryNeededTitle': {
    en: 'Storage needs attention',
    beanie: 'storage needs attention',
  },
  'settings.familyData.migrate.recoveryNeededBody': {
    en: "The move failed and we couldn't fully switch back to your previous storage. Sign out and sign back in to recover — your data is safe in your file.",
    beanie:
      "the move failed and we couldn't fully switch back to your previous storage. sign out and sign back in to recover — your data is safe in your file.",
  },
  'auth.fillAllFields': { en: 'Please fill in all fields', beanie: 'please fill in all fields' },
  // Self-heal toast strings — defensive paths that only fire on bugs. Visible
  // user-facing text on the rare case that the heal flow itself crashes.
  'auth.signinHeal.unexpectedError': {
    en: "Couldn't re-sync your account key",
    beanie: "couldn't re-sync your account key",
  },
  'auth.signinHeal.unexpectedErrorHint': {
    en: 'Sign in worked, but the cross-device key sync needs attention. Try signing out and back in. Details in console.',
    beanie:
      'sign-in worked, but the cross-device key sync needs attention. try signing out and back in. details in console.',
  },
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
  'confirm.notAllowedTitle': { en: 'Not Allowed', beanie: 'not allowed' },
  'family.removeNotAllowed': {
    en: 'Only a pod manager can remove a bean. Ask an owner or manager to do it.',
    beanie: 'only a pod manager can remove a bean. ask an owner or manager to do it.',
  },

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
    en: 'Biometric sign-in failed. Please try with your PIN.',
    beanie: 'biometric sign-in failed. please try with your pin.',
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
  // Right family, different bean. Deliberately NOT the re-enrol copy: this bean simply
  // has no biometric on this device, which is the normal case for everyone else in the
  // family — telling them their biometrics changed would be both wrong and alarming.
  'passkey.wrongMemberError': {
    en: 'That biometric belongs to a different bean. Use your PIN to sign in.',
    beanie: 'that biometric belongs to a different bean. use your pin to sign in.',
  },
  'passkey.dekStale': {
    en: 'Your encryption key has changed since biometric was set up. Please sign in with your PIN and re-register biometric in Settings.',
    beanie:
      'your encryption key has changed since biometric was set up. please sign in with your pin and re-register biometric in settings.',
  },
  'passkey.fileLoadError': {
    en: 'Could not load your data file. Please sign in with your PIN.',
    beanie: 'could not load your data file. please sign in with your pin.',
  },
  'passkey.errEnableFailed': {
    en: "Biometric unlock couldn't be set up on this device right now. You can still sign in with your PIN.",
    beanie:
      "biometric unlock couldn't be set up on this device right now. you can still sign in with your pin.",
  },
  'passkey.errNotReadable': {
    en: 'Your device could not complete this request. Please make sure your device biometrics (fingerprint or face unlock) are set up, then try again.',
    beanie:
      'your device could not complete this request. please make sure your device biometrics (fingerprint or face unlock) are set up, then try again.',
  },
  'passkey.errNotSupported': {
    en: "Biometric unlock isn't available on this device right now. You can sign in with your PIN.",
    beanie:
      "biometric unlock isn't available on this device right now. you can sign in with your pin.",
  },
  'passkey.errSecurity': {
    en: 'A security error occurred. Please make sure you are on a secure (HTTPS) connection.',
    beanie: 'a security error occurred. please make sure you are on a secure (https) connection.',
  },
  'passkey.errGeneric': {
    en: 'Something went wrong with biometric unlock. You can sign in with your PIN.',
    beanie: 'something went wrong with biometric unlock. you can sign in with your pin.',
  },
  // Native (installed app) hardware-Keystore biometric copy. See nativeBiometric.ts.
  'biometric.cancelled': {
    en: 'Biometric was cancelled. You can sign in with your password.',
    beanie: 'biometric was cancelled. you can sign in with your password.',
  },
  'biometric.reEnroll': {
    en: 'Biometric unlock was turned off because your device biometrics changed. Sign in with your password, then turn it back on in Settings.',
    beanie:
      'biometric unlock was turned off because your device biometrics changed. sign in with your password, then turn it back on in settings.',
  },
  'biometric.lockout': {
    en: 'Too many attempts. Please sign in with your password and try biometric again later.',
    beanie: 'too many attempts. please sign in with your password and try biometric again later.',
  },
  'biometric.notEnrolled': {
    en: "Set up your device's fingerprint or face unlock first, then you can enable biometric unlock.",
    beanie:
      "set up your device's fingerprint or face unlock first, then you can enable biometric unlock.",
  },
  'biometric.errGeneric': {
    en: 'Something went wrong with biometric unlock. You can sign in with your password.',
    beanie: 'something went wrong with biometric unlock. you can sign in with your password.',
  },
  'passkey.prfFull': { en: 'Full unlock', beanie: 'full unlock' },
  'passkey.prfCached': { en: 'Cached password', beanie: 'cached password' },
  'passkey.lastUsed': { en: 'Last used', beanie: 'last used' },
  'passkey.neverUsed': { en: 'Never used', beanie: 'never used' },
  'passkey.noAuthenticator': {
    en: 'No biometric authenticator is set up on this device yet. Your PIN signs you in meanwhile.',
    beanie:
      'no biometric authenticator is set up on this device yet. your pin signs you in meanwhile.',
  },
  'passkey.registeredPasskeys': { en: 'Registered biometrics', beanie: 'registered biometrics' },
  'passkey.settingsTitle': { en: 'Biometric Login', beanie: 'biometric login' },
  'passkey.settingsDescription': {
    en: 'Unlock beanies with your fingerprint or face — quicker than typing your PIN.',
    beanie: 'unlock beanies with your fingerprint or face — quicker than typing your pin.',
  },
  'passkey.noPasskeys': {
    en: 'No biometric logins registered yet.',
    beanie: 'no biometric logins registered yet.',
  },
  'passkey.unsupported': {
    en: "Biometric unlock isn't available on this device. Your PIN signs you in.",
    beanie: "biometric unlock isn't available on this device. your pin signs you in.",
  },
  'passkey.webRetired': {
    en: 'Face ID and fingerprint unlock live in the beanies app for iPhone and Android. In your browser, your 6-digit PIN is the quick way in — nothing to set up here.',
    beanie:
      'face id and fingerprint unlock live in the beanies app for iphone and android. in your browser, your 6-digit pin is the quick way in — nothing to set up here.',
  },
  'passkey.webLeftoverNote': {
    en: 'Browser passkeys from before no longer sign you in — your PIN replaces them. You can remove these old entries.',
    beanie:
      'browser passkeys from before no longer sign you in — your pin replaces them. you can remove these old entries.',
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
  'auth.subscribeNewsletter': {
    en: 'Keep me updated with product news and features',
    beanie: 'keep me updated with product news and features',
  },
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
  'create.title': { en: 'Create Family', beanie: 'start your pod' },

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
  'loginV6.welcomeEyebrow': {
    en: 'Welcome home',
    beanie: 'welcome home',
  },
  'loginV6.welcomePrompt': {
    en: 'Where would you like to begin?',
    beanie: 'where would you like to begin?',
  },
  // The single word in the welcomePrompt that renders with the brand gradient.
  // Kept separate so it can be styled inline without HTML in the i18n value.
  'loginV6.welcomePromptAccent': {
    en: 'begin',
    beanie: 'begin',
  },
  'loginV6.orDivider': { en: 'Or', beanie: 'or' },
  'loginV6.openSavedFileLabel': {
    en: 'Load a saved family file',
    beanie: 'load a saved family file',
  },
  'loginV6.openSavedFileDesc': {
    en: "From another account, or a backup you've restored",
    beanie: "from another account, or a backup you've restored",
  },
  // C8: shown as the disabled reason when neither a local-file backend nor the Google
  // Picker can run here (a self-hosted build on Firefox/Safari). Honestly-scoped
  // guidance instead of silently hiding the affordance.
  'loginV6.openSavedFileUnavailableHint': {
    en: 'To open a saved file here, use Chrome or Edge, or set up Google Drive',
    beanie: 'to open a saved file here, use chrome or edge, or set up google drive',
  },
  'loginV6.signInTitle': { en: 'Welcome back', beanie: 'welcome back' },
  'loginV6.signInSubtitle': {
    en: 'Sign in with your .beanpod file',
    beanie: 'sign in with your .beanpod file',
  },
  'loginV6.createPill': { en: 'Start here', beanie: 'start here' },
  'loginV6.createTagline': { en: 'New to beanies?', beanie: 'new to beanies?' },
  'loginV6.createTitle': { en: 'Plant a new pod', beanie: 'plant a new pod' },
  'loginV6.createSubtitle': {
    en: "Start your family's bean pod - encrypted, yours to keep.",
    beanie: "start your family's bean pod - encrypted, yours to keep.",
  },
  'loginV6.joinTitle': { en: 'Join your family', beanie: 'join your family' },
  'loginV6.joinSubtitle': {
    en: 'Someone sent you a join link',
    beanie: 'someone sent you a join link',
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
  'loginV6.unlockNoPasswordTitle': {
    en: "Don't have the password?",
    beanie: "don't have the password?",
  },
  'loginV6.unlockNoPasswordHint': {
    en: 'This file contains another family’s encrypted data. To join, ask the family owner to send you an invite link. You’ll set up your own account through that flow, no password needed up front.',
    beanie:
      'this file is another family’s encrypted data. to join, ask the family owner for an invite link. you’ll set up your own bean through that flow.',
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
  // Shown only when two or more beans have enrolled biometric on the same device.
  'fastLogin.whoIsSigningIn': { en: "Who's signing in?", beanie: 'which bean is this?' },
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
  'loginV6.pickBeanSubtitle': { en: 'Pick your profile', beanie: 'pick your bean' },
  'loginV6.parentBean': { en: 'Adult', beanie: 'adult beanie' },
  'loginV6.littleBean': { en: 'Child', beanie: 'child beanie' },
  'loginV6.setupNeeded': { en: 'Set up', beanie: 'set up' },
  'loginV6.signInAs': { en: 'Sign in as', beanie: 'sign in as' },
  'loginV6.createStep1': { en: 'You', beanie: 'you' },
  'loginV6.createStep2': { en: 'Save & Secure', beanie: 'save & secure' },
  'loginV6.createStep3': { en: 'Family', beanie: 'family' },
  'loginV6.createNext': { en: 'Next', beanie: 'next' },
  'loginV6.createButton': { en: 'Create Pod', beanie: 'create pod' },
  // Resume-setup recovery screen — shown when an authenticated session exists
  // but no `.beanpod` file was ever written (a half-finished onboarding, or
  // an iOS Drive redirect mid-flight).
  'resumeSetup.title': {
    en: 'Finish setting up your pod',
    beanie: 'finish setting up your pod',
  },
  'resumeSetup.subtitle': {
    en: 'One last step: set your password to finish. We never store it, so your data stays encrypted end-to-end.',
    beanie:
      'one last step: set your password to finish. we never store it, so your beans stay encrypted end-to-end.',
  },
  'resumeSetup.subtitleRecovery': {
    en: "Your last setup didn't quite finish. Re-enter your password to wrap things up — we never store it, so your data stays encrypted end-to-end.",
    beanie:
      "your last setup didn't quite finish. re-enter your password to wrap things up — we never store it, so your beans stay encrypted end-to-end.",
  },
  'resumeSetup.storagePrompt': {
    en: 'Where should your pod live?',
    beanie: 'where should your pod live?',
  },
  'resumeSetup.finishing': {
    en: 'Finishing up your pod…',
    beanie: 'finishing up your pod…',
  },
  'resumeSetup.startOver': {
    en: 'Start over instead',
    beanie: 'start over instead',
  },

  // Auto-load (non-destructive) recovery — shown when the family registry
  // confirms the user already has a pod we can fetch. Replaces the
  // destructive "rebuild from scratch" path that produced the 2026-05-15
  // data loss for Shaun. See `attemptResumeFromRegistry` in syncStore.
  'resumeSetup.checking': {
    en: 'Looking for your pod…',
    beanie: 'looking for your pod…',
  },
  'resumeSetup.foundPod': {
    en: "We found your family's pod. Enter your password to unlock it.",
    beanie: "we found your family's pod. enter your password to unlock it.",
  },
  'resumeSetup.lastSaved': {
    en: 'Last saved:',
    beanie: 'last saved:',
  },
  'resumeSetup.unlockPod': {
    en: 'Unlock my pod',
    beanie: 'unlock my pod',
  },
  'resumeSetup.couldNotFindPod': {
    en: "We couldn't auto-load your pod — please pick where it lives below.",
    beanie: "we couldn't auto-load your pod — please pick where it lives below.",
  },
  'resumeSetup.registryError': {
    en: "We couldn't reach our family servers right now — please pick where your pod lives below, or try again in a moment.",
    beanie:
      "we couldn't reach our family servers right now — please pick where your pod lives below, or try again in a moment.",
  },
  'resumeSetup.retryBody': {
    en: "We found your family but couldn't reach your pod file just now. This is usually temporary — let's try again.",
    beanie:
      "we found your family but couldn't reach your pod file just now. this is usually temporary — let's try again.",
  },
  'resumeSetup.retryCta': {
    en: 'Try again',
    beanie: 'try again',
  },
  'resumeSetup.startNewCta': {
    en: 'Start a new pod instead',
    beanie: 'start a new pod instead',
  },
  'resumeSetup.startNewConfirmTitle': {
    en: 'Set up your family?',
    beanie: 'set up your family?',
  },
  'resumeSetup.startNewConfirmMessage': {
    en: "We'll set up your family now. If you already have a family file with this name, we'll find and open it instead — your data is safe.",
    beanie:
      "we'll set up your family now. if you already have a family file with this name, we'll find and open it instead — your data is safe.",
  },
  'resumeSetup.startNewConfirmCta': {
    en: 'Set up my family',
    beanie: 'set up my family',
  },
  'resumeSetup.driveConsentDenied': {
    en: 'Google needs permission to access your family file. Please reconnect Google Drive and allow file access when prompted.',
    beanie:
      'google needs permission to access your family file. please reconnect google drive and allow file access when prompted.',
  },
  'resumeSetup.podCorrupted': {
    en: "Your pod file appears damaged and can't be opened. Please contact support@beanies.family with the diagnostic details below — we may be able to help.",
    beanie:
      "your pod file appears damaged and can't be opened. please contact support@beanies.family with the diagnostic details below — we may be able to help.",
  },

  // Generic "wrong password" prompt — used by ResumePodSetup auto-load too.
  'auth.passwordIncorrect': {
    en: "That password didn't unlock the pod. Please try again.",
    beanie: "that password didn't unlock the pod. please try again.",
  },
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
  'loginV6.addBeansTitle': { en: 'Add your family 🫘', beanie: 'add your family 🫘' },
  'loginV6.addMember': { en: 'Add member', beanie: 'add bean' },
  'loginV6.addAnotherBeanie': { en: 'Add another family member?', beanie: 'add another beanie?' },
  'loginV6.addAnAdult': { en: 'Add an adult', beanie: 'add an adult' },
  'loginV6.addALittleBean': { en: 'Add a child', beanie: 'add a little bean' },
  'loginV6.finish': {
    en: 'Finish · take me to the nook 🏡',
    beanie: 'finish · take me to the nook 🏡',
  },
  'loginV6.skip': { en: 'Skip — just me for now', beanie: 'skip — just me for now' },
  'loginV6.joinButton': { en: "Join My Family's Pod", beanie: 'join your pod!' },
  'loginV6.wantYourOwn': { en: 'Want your own?', beanie: 'want your own?' },
  'loginV6.createLink': { en: 'Create a new pod', beanie: 'create a new pod' },
  'loginV6.acceptsBeanpod': { en: 'Accepts .beanpod files', beanie: 'accepts .beanpod files' },
  'loginV6.reconnectToLoad': {
    en: 'Reconnect to Google to load {familyName}',
    beanie: 'reconnect to google to load {familyName}',
  },
  'loginV6.recommended': { en: 'Recommended', beanie: 'recommended' },
  // ── Login-flow recovery panel (2026-08-28 login rethink) ──
  'loginFlow.recoveryTitle': { en: "You're Verified", beanie: "you're in — almost!" },
  'loginFlow.recoveryAuthBody': {
    en: 'We just need to reconnect to Google to fetch your family data. Your sign-in is done — one tap and your beans are back.',
    beanie:
      'we just need to reconnect to google to fetch your beans. your sign-in is done — one tap and they are back.',
  },
  'loginFlow.recoveryPermissionBody': {
    en: 'Your browser needs permission to read your family data file again. Grant it once and your beans are back.',
    beanie:
      'your browser needs permission to read your family file again. grant it once and your beans are back.',
  },
  'loginFlow.recoveryNotFoundBody': {
    en: "We couldn't find your family data file where it used to be. It may have moved — you can pick it again.",
    beanie:
      "we couldn't find your family file where it used to be. it may have moved — you can pick it again.",
  },
  'loginFlow.recoveryErrorBody': {
    en: "Something got in the way of loading your family data. It's usually temporary — try again.",
    beanie: "something got in the way of loading your beans. it's usually temporary — try again.",
  },
  // ── Logout tiers + Google disconnect (login rethink Phase 5) ──
  'auth.switchMember': { en: 'Switch Member', beanie: 'switch bean' },
  'auth.switchMemberHint': {
    en: 'Hand the app to another family member — your family data stays open, they just sign in as themselves.',
    beanie:
      'hand the app to another bean — your family stays open, they just sign in as themselves.',
  },
  'googleDisconnect.title': {
    en: 'Disconnect Google Everywhere',
    beanie: 'disconnect google everywhere',
  },
  'googleDisconnect.description': {
    en: "For emergencies — if you think this device or your tokens were stolen. Cuts beanies' Google access for EVERY device and family member using this Google account; each will need to reconnect. For a normal sign-out, just use Sign Out.",
    beanie:
      "for emergencies — if you think this device or your tokens were stolen. cuts beanies' google access for every device on this google account.",
  },
  'googleDisconnect.action': { en: 'Disconnect Everywhere', beanie: 'disconnect everywhere' },
  'googleDisconnect.confirmTitle': {
    en: 'Disconnect Google Everywhere?',
    beanie: 'disconnect google everywhere?',
  },
  'googleDisconnect.confirmMessage': {
    en: 'Every device and family member using this Google account with beanies will lose access until they reconnect. Continue?',
    beanie:
      'every device and bean using this google account with beanies will lose access until they reconnect. continue?',
  },
  // ── Recovery kit + passphrase (login rethink Phase 3) ──
  'deviceLink.title': { en: 'Link a Device', beanie: 'link a device' },
  'deviceLink.description': {
    en: 'Signing in on a new phone or computer? Show this QR code to it (or send the link) — then sign in there with your PIN. The other device needs beanies 0.14 or later.',
    beanie:
      'signing in on a new phone or computer? show this qr code to it (or send the link) — then sign in there with your pin.',
  },
  'deviceLink.mint': { en: 'Create Link', beanie: 'create link' },
  'deviceLink.mintFailed': {
    en: "Couldn't create the device link. Check your connection and try again.",
    beanie: "couldn't create the device link. check your connection and try again.",
  },
  'deviceLink.publishFailed': {
    en: "The link couldn't be published to your family file — check your connection and try again.",
    beanie:
      "the link couldn't be published to your family file — check your connection and try again.",
  },
  'deviceLink.expiryNote': {
    en: 'This link works for 15 minutes and can only be used with a family PIN.',
    beanie: 'this link works for 15 minutes and can only be used with a family pin.',
  },
  'recovery.podNotOpen': {
    en: 'Your family data must be open to do this.',
    beanie: 'your beans must be open to do this.',
  },
  'recovery.sectionTitle': { en: 'Recovery & Backup', beanie: 'recovery & backup' },
  'recovery.kitTitle': { en: 'Recovery Kit', beanie: 'recovery kit' },
  'recovery.kitDescription': {
    en: "A one-page backup key that unlocks your family data if every password and PIN is forgotten. Keep it somewhere safe — beanies can't recover your data without it.",
    beanie:
      'a one-page backup key that unlocks your beans if every password and pin is forgotten. keep it somewhere safe.',
  },
  'recovery.kitGenerate': { en: 'Create Recovery Kit', beanie: 'create recovery kit' },
  'recovery.kitRegenerate': { en: 'Create a New Kit', beanie: 'create a new kit' },
  'recovery.kitCount': { en: '{count} kit(s) on file', beanie: '{count} kit(s) on file' },
  'recovery.kitNone': {
    en: 'No recovery kit yet — we recommend creating one.',
    beanie: 'no recovery kit yet — we recommend creating one.',
  },
  'recovery.kitModalTitle': { en: 'Your Recovery Kit', beanie: 'your recovery kit' },
  'recovery.kitCodeLabel': { en: 'Recovery Code', beanie: 'recovery code' },
  'recovery.kitIdLabel': { en: 'Kit ID', beanie: 'kit id' },
  'recovery.kitStoreWarning': {
    en: "Save or print this now — it's shown only once. Keep it somewhere safe that you can reach if you ever lose your PIN.",
    beanie:
      "save or print this now — it's shown only once. keep it somewhere safe you can reach if you ever lose your pin.",
  },
  'recovery.kitDownloadPdf': { en: 'Save as PDF', beanie: 'save as pdf' },
  'recovery.kitShare': { en: 'Share', beanie: 'share' },
  'recovery.kitScanPhoto': {
    en: 'Load your kit PDF or a photo of it',
    beanie: 'load your kit pdf or a photo of it',
  },
  'recovery.kitScanReading': { en: 'reading your kit...', beanie: 'reading your kit...' },
  'recovery.kitScanFailed': {
    en: "Couldn't read a QR code in that file — try the saved PDF or a clearer picture, or type the code.",
    beanie:
      "couldn't read a qr code in that file — try the saved pdf or a clearer picture, or type the code.",
  },
  'recovery.kitCopyCode': { en: 'Copy Code', beanie: 'copy code' },
  'recovery.kitCopied': { en: 'Copied!', beanie: 'copied!' },
  'recovery.kitConfirmStored': {
    en: "I've stored my kit somewhere safe",
    beanie: "i've stored my kit somewhere safe",
  },
  'recovery.kitPdfFailed': {
    en: "Couldn't create the PDF — copy the code above instead, or try again.",
    beanie: "couldn't make the pdf — copy the code above instead, or try again.",
  },
  'recovery.passphraseTitle': { en: 'Recovery Passphrase', beanie: 'recovery passphrase' },
  'recovery.passphraseDescription': {
    en: 'An optional memorable phrase that can unlock your family data on any device — sign in to Google, type the phrase, done. Anyone who knows it can open your data, so make it strong and keep it private.',
    beanie:
      'an optional memorable phrase that unlocks your beans on any device. anyone who knows it can open your data, so keep it private.',
  },
  'recovery.passphraseSet': { en: 'Set Passphrase', beanie: 'set passphrase' },
  'recovery.passphraseChange': { en: 'Change Passphrase', beanie: 'change passphrase' },
  'recovery.passphraseIsSet': {
    en: 'A recovery passphrase is set for this family.',
    beanie: 'a recovery passphrase is set for this family.',
  },
  'recovery.passphraseNotSet': {
    en: 'No recovery passphrase set.',
    beanie: 'no recovery passphrase set.',
  },
  'recovery.passphraseSuggestion': { en: 'Suggested Passphrase', beanie: 'suggested passphrase' },
  'recovery.passphraseRegenerate': { en: 'Suggest Another', beanie: 'suggest another' },
  'recovery.passphraseUseOwn': { en: 'Use my own phrase', beanie: 'use my own phrase' },
  'recovery.passphraseRules': {
    en: "At least 14 characters and 3 different words — spaces or dashes between words are fine, and any characters are allowed. Your family or member names are too easy to guess and won't be accepted.",
    beanie:
      'at least 14 characters and 3 different words — spaces or dashes are fine, any characters allowed. family or bean names are too easy to guess.',
  },
  'recovery.passphraseTooWeak': {
    en: 'That phrase is too easy to guess — use at least 14 characters and 3 different words.',
    beanie: 'that phrase is too easy to guess — use at least 14 characters and 3 different words.',
  },
  'recovery.passphraseMatchesName': {
    en: "Your family or a member's name is too easy to guess — pick something else.",
    beanie: "your family or a bean's name is too easy to guess — pick something else.",
  },
  'recovery.passphraseSaved': {
    en: 'Recovery passphrase saved. It works on any device from the next sync.',
    beanie: 'recovery passphrase saved. it works on any device from the next sync.',
  },
  'recovery.useKitLink': { en: 'Use a recovery kit', beanie: 'use a recovery kit' },
  'recovery.kitEnterTitle': { en: 'Enter Your Recovery Code', beanie: 'enter your recovery code' },
  'recovery.kitEnterBody': {
    en: 'Type the code from your recovery kit (the dashes are optional).',
    beanie: 'type the code from your recovery kit (dashes optional).',
  },
  'recovery.kitWrongCode': {
    en: "That code doesn't match this family's recovery kit.",
    beanie: "that code doesn't match this family's recovery kit.",
  },
  'recovery.kitNoKits': {
    en: "This family doesn't have a recovery kit on file.",
    beanie: "this family doesn't have a recovery kit on file.",
  },
  'recovery.unlock': { en: 'Unlock', beanie: 'unlock' },
  'recovery.resetPinTitle': { en: 'Set a New PIN', beanie: 'set a new pin' },
  'recovery.resetPinBody': {
    en: "You're in with your recovery key — set a fresh 6-digit PIN to use from now on.",
    beanie: "you're in with your recovery key — set a fresh 6-digit pin to use from now on.",
  },
  'recovery.resetPinAction': { en: 'Set PIN & Sign In', beanie: 'set pin & sign in' },
  'recovery.passphraseHint': {
    en: 'Your password — or your family recovery passphrase, if one was set.',
    beanie: 'your password — or your family recovery passphrase, if one was set.',
  },
  'recovery.passphraseAcceptedProve': {
    en: 'Recovery passphrase accepted — your family data is open. Now confirm who you are to sign in.',
    beanie:
      'recovery passphrase accepted — your beans are open. now confirm who you are to sign in.',
  },
  // ── Member PIN (login rethink Phase 2) ──
  'pin.invalidFormat': {
    en: 'Your PIN must be exactly 6 digits.',
    beanie: 'your pin must be exactly 6 digits.',
  },
  'pin.currentRequired': {
    en: 'Enter your current PIN to change it.',
    beanie: 'enter your current pin to change it.',
  },
  'pin.notSet': {
    en: "This member hasn't set a PIN yet.",
    beanie: "this bean hasn't set a pin yet.",
  },
  'pin.incorrect': { en: "That PIN isn't right.", beanie: "that pin isn't right." },
  'pin.tooManyAttempts': {
    en: 'Too many tries. Wait {seconds}s and have another go.',
    beanie: 'too many tries. wait {seconds}s and have another go.',
  },
  'pin.attemptsLeft': {
    en: "That PIN isn't right — {count} attempts left before PIN unlock is turned off on this device.",
    beanie: "that pin isn't right — {count} tries left before pin unlock turns off on this device.",
  },
  'pin.lockedOut': {
    en: 'PIN unlock is turned off on this device after too many attempts. Sign in another way, then set it up again.',
    beanie:
      'pin unlock turned off on this device after too many tries. sign in another way, then set it up again.',
  },
  'pin.changedElsewhere': {
    en: 'Your PIN was changed on another device — enter your current PIN.',
    beanie: 'your pin changed on another device — enter your current pin.',
  },
  'pin.enterPin': { en: 'Enter Your PIN', beanie: 'enter your pin' },
  'pin.backspace': { en: 'Delete last digit', beanie: 'delete last digit' },
  'pin.signInWithPin': { en: 'Sign In with PIN', beanie: 'sign in with pin' },
  'pin.setTitle': { en: 'Set a PIN', beanie: 'set a pin' },
  'pin.changeTitle': { en: 'Change Your PIN', beanie: 'change your pin' },
  'pin.newPin': { en: 'New PIN', beanie: 'new pin' },
  'pin.confirmPin': { en: 'Confirm PIN', beanie: 'confirm pin' },
  'pin.currentPin': { en: 'Current PIN', beanie: 'current pin' },
  'pin.mismatch': { en: "Those PINs don't match.", beanie: "those pins don't match." },
  'pin.setSuccess': {
    en: 'PIN set! You can now sign in with it on any of your devices.',
    beanie: 'pin set! you can now sign in with it on any of your devices.',
  },
  'pin.settingsDescription': {
    en: 'A 6-digit PIN signs you in on any device where your family is set up — quicker than a password, and it never leaves your family data file.',
    beanie:
      'a 6-digit pin signs you in on any device where your family is set up — quicker than a password.',
  },
  'setup.choosePinLabel': { en: 'Choose Your PIN', beanie: 'choose your pin' },
  'setup.choosePinHint': {
    en: 'A 6-digit PIN unlocks beanies on your devices. Your recovery kit (next step) is the master key.',
    beanie:
      'a 6-digit pin unlocks beanies on your devices. your recovery kit (next step) is the master key.',
  },
  'setup.kitStepIntro': {
    en: 'Your family pod is ready! One last thing — save your recovery kit somewhere safe.',
    beanie: 'your family pod is ready! one last thing — save your recovery kit somewhere safe.',
  },
  'recovery.kitPromptTitle': { en: 'Save Your Recovery Kit', beanie: 'save your recovery kit' },
  'recovery.kitPromptBody': {
    en: "Your recovery kit is the master key to your family's data — if every device and PIN is lost, it's the only way back in. Create it now and keep it somewhere safe.",
    beanie:
      "your recovery kit is the master key to your family's data — if every device and pin is lost, it's the only way back in. create it now and keep it somewhere safe.",
  },
  'pin.promptTitle': { en: 'Set Up a PIN?', beanie: 'set up a pin?' },
  'pin.promptBody': {
    en: 'Sign in with a quick 6-digit PIN instead of your password. You can set one up now or later in Settings.',
    beanie:
      'sign in with a quick 6-digit pin instead of your password. set one up now or later in settings.',
  },
  'loginFlow.recoveryOnlyBody': {
    en: 'No sign-in method is set up on this device yet — use your recovery kit, your recovery passphrase, or a device link from another family device.',
    beanie:
      'no sign-in method is set up on this device yet — use your recovery kit, passphrase, or a link from another family device.',
  },
  'loginFlow.inviteNeededBody': {
    en: "This grown-up bean needs its own invite before it can be opened. Ask someone in your family to invite you from The Pod, and they'll send you a link that lets you set your own PIN.",
    beanie:
      "this grown-up bean needs its own invite first. ask someone in your family to invite you from the pod, and they'll send you a link so you can set your own pin.",
  },
  'loginFlow.recoveryTitleUnproven': { en: "Let's Reconnect", beanie: "let's reconnect" },
  'loginFlow.recoveryAuthBodyUnproven': {
    en: 'We need to reconnect to Google before you can sign in — one tap, then pick up right where you were.',
    beanie:
      'we need to reconnect to google before you can sign in — one tap, then right back to your beans.',
  },
  'loginFlow.recoveryCorruptBody': {
    en: "Your family data file couldn't be read — the file may be damaged. Try again, or load a different copy of your family file.",
    beanie:
      "your family file couldn't be read — it may be damaged. try again, or load a different copy.",
  },
  'auth.memberNotFound': { en: 'Member not found.', beanie: 'that bean is not here.' },
  'auth.memberHasPassword': {
    en: 'This member has a password — please sign in with it.',
    beanie: 'this bean has a password — please sign in with it.',
  },
  'auth.memberNeedsInvite': {
    en: 'This grown-up bean needs an invite before it can be opened. Ask someone in your family to invite you from The Pod.',
    beanie:
      'this grown-up bean needs an invite first. ask someone in your family to invite you from the pod.',
  },
  'loginFlow.recoveryReconnect': { en: 'Reconnect Google', beanie: 'reconnect google' },
  'loginFlow.recoveryGrant': { en: 'Grant Access', beanie: 'grant access' },
  'loginFlow.recoveryUseBootstrap': {
    en: 'Load a family file instead',
    beanie: 'load a family file instead',
  },
  'loginV6.googleDriveCardDesc': {
    en: 'Load from your cloud storage',
    beanie: 'load from your cloud storage',
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
    en: 'Onboarded members can sign in with their password. New members need to create a password first.',
    beanie:
      'onboarded beans can sign in with their password. new beans need to create a password first.',
  },
  'loginV6.growPodTitle': {
    en: 'Start your pod \ud83c\udf31',
    beanie: 'start your pod \ud83c\udf31',
  },
  'loginV6.signInPasswordLabel': { en: 'Your sign-in password', beanie: 'your sign-in password' },
  'loginV6.signInPasswordHint': {
    en: '8+ characters. Used to sign into your profile.',
    beanie: '8+ characters. used to sign into your bean profile.',
  },
  'loginV6.storageSectionLabel': {
    en: 'Where should we save it?',
    beanie: 'where should we save it?',
  },
  'loginV6.howThisWorks.toggle': { en: 'How this works', beanie: 'how this works' },
  'loginV6.howThisWorks.lead': {
    en: "beanies.family doesn't run any server or database \u2014 your encrypted .beanpod file lives in your own storage.",
    beanie:
      "beanies.family doesn't run any server or database \u2014 your encrypted .beanpod file lives in your own storage.",
  },
  'loginV6.howThisWorks.bullet1': {
    en: 'AES-256 encryption. Only your password unlocks it.',
    beanie: 'aes-256 encryption. only your password unlocks it.',
  },
  'loginV6.howThisWorks.bullet2': {
    en: 'No tracking. No analytics on your finances.',
    beanie: 'no tracking. no analytics on your finances.',
  },
  'loginV6.howThisWorks.bullet3': {
    en: 'Open source. Audit the code on GitHub anytime.',
    beanie: 'open source. audit the code on github anytime.',
  },
  'loginV6.howThisWorks.leadStrong': {
    en: 'Your data stays yours.',
    beanie: 'your data stays yours.',
  },
  'loginV6.moreProvidersComingSoon': {
    en: 'More providers coming soon',
    beanie: 'more providers coming soon',
  },
  'loginV6.pickStorageToContinue': {
    en: 'Pick a storage to continue',
    beanie: 'pick a storage to continue',
  },
  'loginV6.addMemberFailed': {
    en: 'Failed to add member. Please try again.',
    beanie: 'failed to add member. please try again.',
  },
  'loginV6.removeMemberFailed': {
    en: 'Failed to remove member. Please try again.',
    beanie: 'failed to remove member. please try again.',
  },
  'loginV6.removeMember': { en: 'Remove', beanie: 'remove' },
  'loginV6.you': { en: 'You', beanie: 'you' },

  // "No pod yet on this account" empty-state panel — replaces the storage cards
  // when a Google Drive lookup confirms zero .beanpod files. Redirect framing,
  // not error: the most likely correct path is Create.
  'loginV6.noPodOnAccount.title': {
    en: 'No pod yet on this Google account',
    beanie: 'no pod yet on this google account',
  },
  'loginV6.noPodOnAccount.body': {
    en: "Pods are created once, then everyone in your family signs in to the same one. If this is your first time here, you'll want to create one.",
    beanie:
      "pods are created once, then everyone in your family signs in to the same one. if this is your first time here, you'll want to create one.",
  },
  'loginV6.noPodOnAccount.createCta': {
    en: 'Create a new pod',
    beanie: 'create a new pod',
  },
  'loginV6.noPodOnAccount.createDesc': {
    en: "Set up your family's encrypted file",
    beanie: "set up your family's encrypted file",
  },
  'loginV6.noPodOnAccount.switchCta': {
    en: 'Try a different Google account',
    beanie: 'try a different google account',
  },
  'loginV6.noPodOnAccount.loadLocalCta': {
    en: 'I have a .beanpod file to load',
    beanie: 'i have a .beanpod file to load',
  },
  'loginV6.noPodOnAccount.joinHint': {
    en: 'Already a family member? Ask for a join link →',
    beanie: 'already a family member? ask for a join link →',
  },
  'loginV6.noPodOnAccount.retryHint': {
    en: 'Just added a pod to this account? Check again →',
    beanie: 'just added a pod to this account? check again →',
  },
  'loginV6.checkedNothingFound': {
    en: 'Checked — nothing found',
    beanie: 'checked — nothing found',
  },

  // Join flow (magic link invites)
  'join.verifyTitle': { en: 'Join your family', beanie: 'join your family pod!' },
  'join.verifySubtitle': {
    en: 'You need a magic joining link from a family member',
    beanie: 'you need a magic joining link from a family member',
  },
  'join.verifyInvited': {
    en: "You've been invited to join {family}!",
    beanie: "you've been invited to join {family}!",
  },
  'join.verifyInvitedGeneric': {
    en: "You've been invited to join your family!",
    beanie: "you've been invited to join your family!",
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
  'join.setPasswordTitle': { en: 'Choose Your PIN', beanie: 'choose your pin' },
  'join.setPasswordSubtitle': {
    en: 'This 6-digit PIN is just for you — it signs you in on any of your family devices.',
    beanie: 'this 6-digit pin is just for you — it signs you in on any of your family devices.',
  },
  'join.choosePinLabel': { en: 'Your PIN', beanie: 'your pin' },
  'join.pinHint': {
    en: 'To sign in on a brand-new device later, use a device link or your family recovery kit — this device needs beanies 0.14 or later.',
    beanie:
      'to sign in on a brand-new device later, use a device link or your family recovery kit.',
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

  // Join flow — error registry. One entry per JoinErrorCode in
  // src/composables/useJoinFlow.ts. Adding a new code without a matching
  // i18n key fails the build via `t(messageKey)` strict typing.
  // FILE_READ_FAILED interpolates {hintEmail} and {actualEmail} at render
  // time when both are present in the error context; FILE_FAMILY_MISMATCH
  // interpolates {expected} and {actual}.
  'join.error.oauthRedirect': {
    en: "Couldn't finish signing in to Google. Please try again.",
    beanie: "couldn't finish signing in to google. please try again.",
  },
  'join.error.scopeDenied': {
    en: 'beanies.family needs permission to access the shared file. Please try again and allow Drive access.',
    beanie:
      'beanies needs permission to access the shared file. please try again and allow drive access.',
  },
  'join.error.popupBlocked': {
    en: 'Your browser blocked the sign-in popup. Allow popups for app.beanies.family or try again on a different device.',
    beanie:
      'your browser blocked the sign-in popup. allow popups for app.beanies.family or try again on a different device.',
  },
  'join.error.pickerScript': {
    en: "Couldn't load the Google file picker. Check your internet connection and try again.",
    beanie: "couldn't load the google file picker. check your internet and try again.",
  },
  'join.error.pickerFailed': {
    en: "The Google file picker couldn't open. This is a known iPhone limitation — try again, sign in with a different Google account, or continue on another device (computer or Android).",
    beanie:
      "the google file picker couldn't open. this is a known iphone hiccup — try again, sign in with a different google account, or continue on another device.",
  },
  'join.error.pickerTimeout': {
    en: "The Google file picker isn't responding. Please try again.",
    beanie: "the google file picker isn't responding. please try again.",
  },
  'join.error.fileRead': {
    en: "Couldn't read the data file with {actualEmail}. The invite was sent to {hintEmail} — try signing in with that account.",
    beanie:
      "couldn't read the data file with {actualEmail}. the invite was sent to {hintEmail} — try signing in with that account.",
  },
  'join.error.fileDecrypt': {
    en: "Couldn't unlock your family's data. Ask the inviter for a new invite link.",
    beanie: "couldn't unlock your family's data. ask the inviter for a new invite link.",
  },
  'join.error.familyMismatch': {
    en: 'This file belongs to a different family. Sign in with a different account or ask for a new invite.',
    beanie:
      'this file belongs to a different family. sign in with a different account or ask for a new invite.',
  },
  'join.error.tokenExpired': {
    en: 'This invite has expired. Ask the inviter for a new link.',
    beanie: 'this invite has expired. ask the inviter for a new link.',
  },
  'join.error.tokenInvalid': {
    en: "This invite link isn't recognized. Ask the inviter for a new one.",
    beanie: "this invite link isn't recognized. ask the inviter for a new one.",
  },
  'join.error.noUnclaimed': {
    en: 'Every member in this family has already been claimed. Ask a family admin to add you.',
    beanie: 'every bean in this pod has already been claimed. ask a family admin to add you.',
  },

  // Recovery action button labels.
  'join.recovery.retry': { en: 'Try again', beanie: 'try again' },
  'join.recovery.signInDifferentAccount': {
    en: 'Sign in with a different account',
    beanie: 'sign in with a different account',
  },
  'join.recovery.tryAnotherDevice': {
    en: 'Continue on another device',
    beanie: 'continue on another device',
  },
  'join.recovery.pickDifferentBean': {
    en: 'Pick a different member',
    beanie: 'pick a different bean',
  },

  // ── Pod access — reaching your family's data file ────────────────────────
  // Shown when the app can read your data but can't confirm it can SAVE to your
  // family's file. Tone rule for this whole block: never suggest making another
  // copy. Every message points back at the one file the family shares.
  'podAccess.bannerTitle': {
    en: 'Your family data file needs attention',
    beanie: 'your family data file needs attention',
  },
  'podAccess.error.offline': {
    en: "You're offline, so we couldn't check your family data file. Your changes are safe on this device and will save when you're back online.",
    beanie:
      "you're offline, so we couldn't check your family data file. your changes are safe on this device and will save when you're back online.",
  },
  'podAccess.error.permissionDenied': {
    en: "You no longer have permission to edit your family's data file. Ask whoever set up your family to share it with you again, then try again.",
    beanie:
      "you no longer have permission to edit your family's data file. ask whoever set up your family to share it with you again, then try again.",
  },
  'podAccess.error.consentExpired': {
    en: "Your Google connection has expired, so we can't save to your family's data file. Reconnect to carry on.",
    beanie:
      "your google connection has expired, so we can't save to your family's data file. reconnect to carry on.",
  },
  'podAccess.error.fileNotFound': {
    en: "We couldn't find your family's data file — it may have been moved, renamed, or put in the bin. Find it again to carry on saving.",
    beanie:
      "we couldn't find your family's data file — it may have been moved, renamed, or put in the bin. find it again to carry on saving.",
  },
  'podAccess.error.verifyUnavailable': {
    en: "We couldn't check your family's data file just now. Your changes are held safely on this device — try again in a moment.",
    beanie:
      "we couldn't check your family's data file just now. your changes are held safely on this device — try again in a moment.",
  },
  // The incident copy. Must not promise data loss, and must not promise a merge
  // in absolute terms — switching brings this device's changes across and leaves
  // the other file in place.
  'podAccess.error.canonicalMismatch': {
    en: "You're working on a copy of your family's data file, so your changes aren't reaching the rest of your family. Switch back to your family's file — the changes on this device will come with you.",
    beanie:
      "you're working on a copy of your family's data file, so your changes aren't reaching the rest of your family. switch back to your family's file — the changes on this device will come with you.",
  },
  'podAccess.error.noHome': {
    en: "This family isn't connected to a data file yet, so nothing is being saved. Choose your family's file to connect it.",
    beanie:
      "this family isn't connected to a data file yet, so nothing is being saved. choose your family's file to connect it.",
  },
  'podAccess.recovery.retry': { en: 'Try again', beanie: 'try again' },
  'podAccess.recovery.reconnectAccount': {
    en: 'Reconnect Google',
    beanie: 'reconnect google',
  },
  'podAccess.recovery.pickFamilyFile': {
    en: "Choose your family's file",
    beanie: "choose your family's file",
  },
  'podAccess.recovery.switchToCanonical': {
    en: "Switch to your family's file",
    beanie: "switch to your family's file",
  },
  // Diagnostic-info copy modal — shown from a small link below the error
  // block. The body is a JSON blob the user can paste back to support.
  'join.diagnostic.link': {
    en: 'Copy diagnostic info',
    beanie: 'copy diagnostic info',
  },
  'join.diagnostic.title': {
    en: 'Diagnostic info',
    beanie: 'diagnostic info',
  },
  'join.diagnostic.subtitle': {
    en: 'Paste this when asking for help — it tells us what your device saw.',
    beanie: 'paste this when asking for help — it tells us what your device saw.',
  },
  'join.diagnostic.copy': { en: 'Copy', beanie: 'copy' },
  'join.diagnostic.copied': { en: 'Copied!', beanie: 'copied!' },

  // Share-invite-modal title override when opened as the "Continue on
  // another device" recovery path on the join screen.
  'join.shareFallback.title': {
    en: 'Continue on another device',
    beanie: 'continue on another device',
  },
  'join.shareFallback.subtitle': {
    en: "Send the link to yourself and open it on a computer or Android phone — that's the most reliable way to finish first-load.",
    beanie:
      "send the link to yourself and open it on a computer or android phone — that's the most reliable way to finish first-load.",
  },

  // Google Picker join flow
  'join.pickerPrompt.description': {
    en: "One last step to join: open your family's data file from Google Drive so you have access.",
    beanie:
      "one last step to join: open your family's bean pod from google drive so you have access.",
  },
  'join.pickerPrompt.fileHint': {
    en: 'After you tap, pick this file:',
    beanie: 'after you tap, pick this file:',
  },
  'join.pickerPrompt.button': {
    en: 'Open Your Family File',
    beanie: 'open your family file',
  },
  'join.pickerPrompt.orManual': {
    en: 'Or load a file from your device',
    beanie: 'or load from your device',
  },
  'join.pickerPrompt.error': {
    en: "Couldn't open file picker. Try loading the file manually.",
    beanie: "couldn't open the picker. try loading the file yourself",
  },
  'join.pickerPrompt.noBeanpodInFolder': {
    en: "That folder doesn't contain a beanies.family pod. Pick the folder your family member shared with you — it should be named 'beanies.family'.",
    beanie: "that folder doesn't have a pod inside. pick the beanies.family folder shared with you",
  },

  // Invite — reused from prior modal, still consumed by the new wizard
  'invite.shareEmail.placeholder': {
    en: 'family.member@gmail.com',
    beanie: 'bean@example.com',
  },
  'invite.shareEmail.error': {
    en: "Couldn't share the file. You can share it manually from Google Drive.",
    beanie: "couldn't share the pod. try sharing from google drive",
  },

  // Invite Wizard — 2-step wizard for inviting beanies
  'inviteWizard.step1.label': {
    en: 'Confirm Email',
    beanie: 'confirm email',
  },
  'inviteWizard.step2.label': {
    en: 'Send Invite',
    beanie: 'send invite',
  },
  'inviteWizard.step1.title': {
    en: 'Invite a Beanie',
    beanie: 'invite a beanie',
  },
  'inviteWizard.step1.titlePrefilled': {
    en: 'Sharing with {name}?',
    beanie: 'sharing with {name}?',
  },
  'inviteWizard.step1.subhead': {
    en: "Use the email they sign in to Google with — it's how they'll open the family pod.",
    beanie: "use the email they sign in to google with — it's how they'll open the family pod",
  },
  'inviteWizard.step1.confirmLabel.empty': {
    en: 'This is their Google account email for the family pod',
    beanie: 'this is their google account email for the family pod',
  },
  'inviteWizard.step1.confirmLabel.withEmail': {
    en: '{email} is their Google account email for the family pod',
    beanie: '{email} is their google account email for the family pod',
  },
  'inviteWizard.step1.cta.empty': {
    en: 'Enter an Email to Share',
    beanie: 'enter an email to share',
  },
  'inviteWizard.step1.cta.unconfirmed': {
    en: 'Confirm to Continue',
    beanie: 'confirm to continue',
  },
  'inviteWizard.step1.cta.share': {
    en: 'Share & Get Invite Link',
    beanie: 'share & get invite link',
  },
  'inviteWizard.step1.cta.confirm': {
    en: 'Confirm {email}',
    beanie: 'confirm {email}',
  },
  'inviteWizard.step1.nextHint': {
    en: "Next, you'll get a link + QR to send them - that's how they join.",
    beanie: "next, you'll get a link + qr to send them - that's how they join.",
  },
  'inviteWizard.step1.faq.toggle': {
    en: "You've got questions? We've got answers",
    beanie: "you've got questions? we've got answers",
  },
  'inviteWizard.step1.faq.q1': {
    en: 'Is this safe?',
    beanie: 'is this safe?',
  },
  'inviteWizard.step1.faq.a1': {
    en: "Yes. The family data file is encrypted with a key only you and your family members have. Google can't read what's inside — they're just storing the locked file for you.",
    beanie:
      "yes. the family pod is encrypted with a key only you and your beanies have. google can't read what's inside — they're just storing the locked pod for you",
  },
  'inviteWizard.step1.faq.q2': {
    en: 'What about the children?',
    beanie: 'what about the little beanies?',
  },
  'inviteWizard.step1.faq.a2': {
    en: 'If they don\'t have their own Google account yet, share with one of your own emails — you can sign them in on their device with that account, and they\'ll see the family pod. When they\'re ready for their own, you can set up a free, parent-supervised Gmail through <a href="https://families.google/familylink/" target="_blank" rel="noopener" class="wizard-faq-link">Google Family Link</a>.',
    beanie:
      'if they don\'t have their own google account yet, share with one of your own emails — you can sign them in on their device with that account, and they\'ll see the family pod. when they\'re ready for their own, you can set up a free, parent-supervised gmail through <a href="https://families.google/familylink/" target="_blank" rel="noopener" class="wizard-faq-link">google family link</a>',
  },
  'inviteWizard.step1.faq.q3': {
    en: "What if they don't use Google?",
    beanie: "what if they don't use google?",
  },
  'inviteWizard.step1.faq.a3': {
    en: 'They\'ll need a free Google account to access the family pod — it lives in Google Drive. Setting one up takes about a minute at <a href="https://accounts.google.com" target="_blank" rel="noopener" class="wizard-faq-link">accounts.google.com</a>. For kids, <a href="https://families.google/familylink/" target="_blank" rel="noopener" class="wizard-faq-link">Google Family Link</a> creates a free, parent-supervised Gmail.',
    beanie:
      'they\'ll need a free google account to access the family pod — it lives in google drive. setting one up takes about a minute at <a href="https://accounts.google.com" target="_blank" rel="noopener" class="wizard-faq-link">accounts.google.com</a>. for kids, <a href="https://families.google/familylink/" target="_blank" rel="noopener" class="wizard-faq-link">google family link</a> creates a free, parent-supervised gmail',
  },
  'inviteWizard.step2.title': {
    en: 'Invite Link Ready',
    beanie: 'invite link ready',
  },
  'inviteWizard.step2.useThisLink': {
    en: "Send them this link or QR - it's how they join your family pod.",
    beanie: "send them this link or qr - it's how they join your family pod.",
  },
  'inviteWizard.step2.caption': {
    en: "Set up for {email} — they'll land in the right Google account automatically.",
    beanie: "set up for {email} — they'll land in the right google account automatically",
  },
  'inviteWizard.step2.qr.title': {
    en: 'In the Same Room?',
    beanie: 'in the same room?',
  },
  'inviteWizard.step2.qr.accent': {
    en: 'scan to join.',
    beanie: 'scan to join.',
  },
  'inviteWizard.step2.qr.help': {
    en: "Point a family member's camera at this — they'll be in the pod in seconds.",
    beanie: "point a beanie's camera at this — they'll be in the pod in seconds",
  },
  'inviteWizard.step2.qr.unavailable': {
    en: 'QR code unavailable — share via link instead.',
    beanie: 'qr code unavailable — share via link instead',
  },
  'inviteWizard.step2.orSendLink': {
    en: 'Or Send a Link',
    beanie: 'or send a link',
  },
  'inviteWizard.step2.useDifferent': {
    en: 'Use a Different Email',
    beanie: 'use a different email',
  },
  'inviteWizard.local.reminder': {
    en: "You'll send the .beanpod separately.",
    beanie: "you'll send the .beanpod separately",
  },
  'inviteWizard.error.invalidEmail': {
    en: 'Enter a valid email address.',
    beanie: 'enter a valid email address',
  },
  'inviteWizard.error.driveShareFailed': {
    en: "Couldn't share with Google Drive. Try again or use a different email.",
    beanie: "couldn't share with google drive. try again or use a different email",
  },
  'inviteWizard.error.invalidGoogleEmail': {
    en: "Sorry, we couldn't share with that email! Please double-check and use a valid Google account email.",
    beanie:
      "sorry, we couldn't share with that email! please double-check and use a valid google account email.",
  },
  'inviteWizard.error.linkGenerationFailed': {
    en: "Couldn't create the invite link. Please try again.",
    beanie: "couldn't create the invite link. please try again",
  },
  'inviteWizard.error.tryAgain': {
    en: 'Try Again',
    beanie: 'try again',
  },
  'inviteWizard.error.couldntCopy': {
    en: "Couldn't copy — try long-pressing the link.",
    beanie: "couldn't copy — try long-pressing the link",
  },
  'inviteWizard.error.channelOpenFailed': {
    en: "Couldn't open {channel}. Try Copy Link or another option.",
    beanie: "couldn't open {channel}. try copy link or another option",
  },
  'inviteWizard.picker.title': {
    en: "Who's joining the pod?",
    beanie: "who's joining the pod?",
  },
  'inviteWizard.picker.subhead': {
    en: 'Pick a family member to invite, or add someone new.',
    beanie: 'pick a beanie to invite, or add someone new',
  },
  'inviteWizard.picker.statusOwner': {
    en: '★ pod owner',
    beanie: '★ pod owner',
  },
  'inviteWizard.picker.statusJoined': {
    en: '✓ joined',
    beanie: '✓ joined',
  },
  'inviteWizard.picker.tileNoEmail': {
    en: 'no email yet',
    beanie: 'no email yet',
  },
  'inviteWizard.picker.addBean': {
    en: 'Add a new member',
    beanie: 'add a new beanie',
  },
  'inviteWizard.picker.empty': {
    en: 'No members waiting yet — add one to send your first invite.',
    beanie: 'no beanies waiting yet — add one to send your first invite',
  },
  'inviteWizard.invitee.label': {
    en: 'For',
    beanie: 'for',
  },
  'inviteWizard.invitee.change': {
    en: 'change',
    beanie: 'change',
  },
  'inviteWizard.step1.noEmailChip': {
    en: 'No default email on file — enter the Google account email {name} will sign in with.',
    beanie: 'no default email on file — enter the google account email {name} will sign in with',
  },
  'inviteWizard.step1.cta.addEmail': {
    en: 'Add an Email First',
    beanie: 'add an email first',
  },
  'inviteWizard.step1.childHint.toggle': {
    en: "What if my child doesn't have an email?",
    beanie: "what if my child doesn't have an email?",
  },
  'inviteWizard.step1.childHint.body1': {
    en: "That's fine — share with one of your own emails. You can sign them in on their device with that account, and they'll see the family pod. When they're ready for their own, you can set up a free, parent-supervised Gmail through",
    beanie:
      "that's fine — share with one of your own emails. you can sign them in on their device with that account, and they'll see the family pod. when they're ready for their own, you can set up a free, parent-supervised gmail through",
  },
  'inviteWizard.step1.childHint.linkLabel': {
    en: 'Google Family Link',
    beanie: 'google family link',
  },
  'inviteWizard.step1.childHint.body2': {
    en: '— then switch them over from settings.',
    beanie: '— then switch them over from settings',
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
  'pwa.updated': {
    en: "You're on the latest version",
    beanie: 'you have fresh beans!',
  },
  'pwa.updatedMessage': {
    en: "We're always improving your beanies.family experience",
    beanie: "you're on the latest version - we're always improving",
  },
  'pwa.whatChanged': { en: 'What changed?', beanie: 'what changed?' },
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
  'todo.someday': { en: 'Someday · Maybe', beanie: 'someday · maybe' },
  'todo.somedayHint': {
    en: 'Things you might do — no pressure, no due date.',
    beanie: 'things you might do — no pressure, no due date.',
  },
  // #40: Helpful Hints — section, badges, actions, and per-type titles ({name},
  // {date} are filled via fillTemplate at generation time).
  'todo.hint.section': { en: 'Helpful Hints', beanie: 'helpful hints' },
  'todo.hint.sectionHint': {
    en: "Gentle nudges before what's coming up. Keep the ones you want, or dismiss them.",
    beanie: "gentle nudges before what's coming up. keep the ones you want, or dismiss them.",
  },
  'todo.hint.badge': { en: 'Hint', beanie: 'hint' },
  'todo.hint.whatsThis': {
    en: 'A gentle suggestion beanies added ahead of an upcoming birthday, party, or trip. Keep it to make it your own to-do, or dismiss it.',
    beanie:
      'a gentle suggestion beanies added ahead of an upcoming birthday, party, or trip. keep it to make it your own to-do, or dismiss it.',
  },
  'todo.hint.learnMore': { en: 'Learn more', beanie: 'learn more' },
  'todo.hint.keep': { en: 'Keep', beanie: 'keep' },
  'todo.hint.dismiss': { en: 'Dismiss', beanie: 'dismiss' },
  'todo.hint.title.birthdayPresent': {
    en: 'Plan a birthday present for {name} ({date})',
    beanie: 'plan a birthday present for {name} ({date})',
  },
  'todo.hint.title.birthdayPartyGift': {
    en: 'Get a present for {name} ({date})',
    beanie: 'get a present for {name} ({date})',
  },
  'todo.hint.title.celebrationGift': {
    en: 'Get a gift or card for {name} ({date})',
    beanie: 'get a gift or card for {name} ({date})',
  },
  'todo.hint.title.anniversaryPlan': {
    en: 'Plan something for {name} ({date})',
    beanie: 'plan something for {name} ({date})',
  },
  'todo.hint.title.tripPacking': {
    en: 'Start packing for {name} ({date})',
    beanie: 'start packing for {name} ({date})',
  },
  'todo.hint.title.tripDocuments': {
    en: 'Check passports and documents for {name} ({date})',
    beanie: 'check passports and documents for {name} ({date})',
  },
  'todo.kind': { en: 'Track as', beanie: 'track as' },
  'todo.kind.todo': { en: 'To-do', beanie: 'to-do' },
  'todo.moveToSomeday': { en: 'Move to Someday', beanie: 'move to someday' },
  'todo.makeActive': { en: 'Make active', beanie: 'make active' },
  'todo.assignTo': { en: 'Assign to', beanie: 'assign to' },
  'todo.unassigned': { en: 'Unassigned', beanie: 'unassigned' },
  'todo.allBeans': { en: 'All Beans', beanie: 'all beanies' },
  'todo.selectDueDate': { en: 'Due Date', beanie: 'due date' },
  'todo.who': { en: 'Who', beanie: 'who' },
  'todo.assign': { en: 'Assign', beanie: 'assign' },
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
  'todo.showingLabel': { en: 'Showing', beanie: 'showing' },
  'todo.filterEveryone': { en: 'Everyone', beanie: 'everyone' },
  'todo.filterGroupLabel': {
    en: 'Filter to-dos by member',
    beanie: 'filter to-dos by member',
  },

  // Beanie Lists (#33) — categorized family checklists
  'lists.title': { en: 'Beanie Lists', beanie: 'beanie lists' },
  'lists.welcomeSubtitle': {
    en: 'What are we tackling together?',
    beanie: 'what are we tackling together? 🌱',
  },
  'lists.newList': { en: 'New List', beanie: 'new list' },
  'lists.empty.title': { en: 'No lists yet', beanie: 'no lists yet' },
  'lists.empty.body': {
    en: 'Start your first family list to get organized.',
    beanie: 'start your first list and get your beans in a row!',
  },
  'lists.shelf.dueSoon': { en: 'Due soon', beanie: 'due soon' },
  'lists.shelf.completed': { en: 'Completed', beanie: 'completed' },
  'lists.filter.all': { en: 'All', beanie: 'all' },
  'lists.progress': { en: '{done}/{total}', beanie: '{done}/{total}' },
  // Categories (8)
  'lists.category.home': { en: 'Home & Household', beanie: 'home & household' },
  'lists.category.out': { en: 'Out & Errands', beanie: 'out & errands' },
  'lists.category.kids': { en: 'Kids & School', beanie: 'kids & school' },
  'lists.category.health': { en: 'Health & Safety', beanie: 'health & safety' },
  'lists.category.celebrations': {
    en: 'Celebrations & Traditions',
    beanie: 'celebrations & traditions',
  },
  'lists.category.trips': { en: 'Trips & Packing', beanie: 'trips & packing' },
  'lists.category.projects': { en: 'Projects & Honey-dos', beanie: 'projects & honey-dos' },
  'lists.category.me': { en: 'Just for Me', beanie: 'just for me' },
  // Short category labels — used in filter chips + new-list pills (full names stay on tiles/meta)
  'lists.categoryShort.home': { en: 'Home', beanie: 'home' },
  'lists.categoryShort.out': { en: 'Out', beanie: 'out' },
  'lists.categoryShort.kids': { en: 'Kids', beanie: 'kids' },
  'lists.categoryShort.health': { en: 'Health', beanie: 'health' },
  'lists.categoryShort.celebrations': { en: 'Celebrate', beanie: 'celebrate' },
  'lists.categoryShort.trips': { en: 'Trips', beanie: 'trips' },
  'lists.categoryShort.projects': { en: 'Projects', beanie: 'projects' },
  'lists.categoryShort.me': { en: 'Just for Me', beanie: 'just for me' },
  // Status pills
  'lists.status.due': { en: 'Due {date}', beanie: 'due {date}' },
  'lists.status.overdue': { en: 'Overdue', beanie: 'overdue' },
  'lists.status.resets': { en: 'Resets {day}', beanie: 'resets {day}' },
  'lists.status.repeats.daily': { en: 'Repeats daily', beanie: 'repeats daily' },
  'lists.status.repeats.weekly': { en: 'Repeats weekly', beanie: 'repeats weekly' },
  'lists.status.repeats.monthly': { en: 'Repeats monthly', beanie: 'repeats monthly' },
  'lists.status.linked': { en: 'Linked', beanie: 'linked' },
  // Detail modal
  'lists.detail.title': { en: 'List', beanie: 'list' },
  'lists.detail.owner': { en: 'Owner', beanie: 'owner' },
  'lists.detail.addItem': { en: 'Add an item…', beanie: 'add an item…' },
  'lists.detail.itemPlaceholder': { en: 'What needs doing?', beanie: 'what needs doing?' },
  'lists.detail.dragHandle': { en: 'Drag to reorder', beanie: 'drag to reorder' },
  'lists.detail.editTitle': { en: 'Edit list name', beanie: 'edit list name' },
  'lists.detail.editItem': { en: 'Edit item', beanie: 'edit item' },
  'lists.detail.repeatsLabel': { en: 'Repeats?', beanie: 'repeats?' },
  'lists.detail.oneoff': { en: 'One-off', beanie: 'one-off' },
  'lists.detail.recurring': { en: 'Repeats', beanie: 'repeats' },
  'lists.detail.freq.daily': { en: 'Daily', beanie: 'daily' },
  'lists.detail.freq.weekly': { en: 'Weekly', beanie: 'weekly' },
  'lists.detail.freq.monthly': { en: 'Monthly', beanie: 'monthly' },
  'lists.detail.dueDateLabel': { en: 'Due date', beanie: 'due date' },
  'lists.detail.setDueDate': { en: 'Set a due date', beanie: 'set a due date' },
  'lists.detail.linkLabel': { en: 'Link', beanie: 'link' },
  'lists.detail.linkTrip': { en: 'Link to a trip', beanie: 'link to a trip' },
  'lists.detail.linkActivity': { en: 'Link to an activity', beanie: 'link to an activity' },
  'lists.detail.linkedToTrip': { en: 'On trip: {name}', beanie: 'on trip: {name}' },
  'lists.detail.linkedToActivity': { en: 'On activity: {name}', beanie: 'on activity: {name}' },
  'lists.detail.unlink': { en: 'Unlink', beanie: 'unlink' },
  'lists.detail.linkSearch': { en: 'Search…', beanie: 'search…' },
  'lists.detail.noMatches': { en: 'No matches', beanie: 'no matches' },
  'lists.detail.noUpcomingTrips': { en: 'No upcoming trips', beanie: 'no upcoming trips' },
  'lists.detail.noUpcomingActivities': {
    en: 'No upcoming activities',
    beanie: 'no upcoming activities',
  },
  // Embedded linked list (rendered on a trip page or an activity drawer)
  'lists.embed.section': { en: 'Checklists', beanie: 'checklists' },
  'lists.embed.provenance': { en: 'Beanie list', beanie: 'beanie list' },
  'lists.embed.open': { en: 'Open list', beanie: 'open list' },
  'lists.embed.openShort': { en: 'Open', beanie: 'open' },
  'lists.embed.allDone': { en: 'All done', beanie: 'all done' },
  'lists.embed.empty': { en: 'No items yet', beanie: 'no items yet' },
  'lists.embed.more': { en: '+{count} more', beanie: '+{count} more' },
  'lists.detail.recurringHint': {
    en: 'Unchecks itself each cycle so you start fresh — no due date needed.',
    beanie: 'unchecks itself each cycle so you start fresh — no due date needed.',
  },
  'lists.detail.titlePlaceholder': { en: 'List name', beanie: 'list name' },
  'lists.detail.delete': { en: 'Delete List', beanie: 'delete list' },
  'lists.detail.deleteConfirm.title': { en: 'Delete this list?', beanie: 'delete this list?' },
  'lists.detail.deleteConfirm.message': {
    en: 'This removes the list and all its items for everyone.',
    beanie: 'this removes the whole list for everyone — sure?',
  },
  // New-list sheet
  'lists.new.title': { en: 'Start a New List', beanie: 'start a new list' },
  'lists.new.subtitle': {
    en: 'Pick a category, then a template — or start blank.',
    beanie: 'pick a category, then a template — or start fresh!',
  },
  'lists.new.categoryLabel': { en: 'Category', beanie: 'category' },
  'lists.new.templatesLabel': { en: 'Start from a Template', beanie: 'start from a template' },
  'lists.new.blank': { en: 'Start Blank List', beanie: 'start a blank list' },
  'lists.new.blankTitle': { en: 'My List', beanie: 'my list' },
  // Templates (name + desc × 6)
  'lists.template.grocery.name': { en: 'Grocery list', beanie: 'grocery list' },
  'lists.template.grocery.desc': { en: 'Weekly · auto-resets', beanie: 'weekly · auto-resets' },
  'lists.template.vacationPacking.name': { en: 'Vacation packing', beanie: 'vacation packing' },
  'lists.template.vacationPacking.desc': {
    en: 'Link it to a trip',
    beanie: 'link it to a trip',
  },
  'lists.template.honeydo.name': { en: 'Honey-do list', beanie: 'honey-do list' },
  'lists.template.honeydo.desc': { en: 'For your partner', beanie: 'for your partner' },
  'lists.template.kidsChores.name': { en: "Kids' chores", beanie: "kids' chores" },
  'lists.template.kidsChores.desc': { en: 'Weekly reset', beanie: 'weekly reset' },
  'lists.template.beforeSchool.name': { en: 'Before-school', beanie: 'before-school' },
  'lists.template.beforeSchool.desc': { en: 'Daily checklist', beanie: 'daily checklist' },
  'lists.template.partyPrep.name': { en: 'Party prep', beanie: 'party prep' },
  'lists.template.partyPrep.desc': { en: 'One-off · pick a date', beanie: 'one-off · pick a date' },
  // Quick-Add (under the quickAdd.* namespace, per the quick-add invariant) + celebration
  'quickAdd.list.label': { en: 'New list', beanie: 'new list' },
  'quickAdd.list.hint': {
    en: 'Start a categorized family checklist',
    beanie: 'start a family checklist',
  },
  'lists.celebrate': { en: 'List complete! 🎉', beanie: 'all done — every bean counts! 🎉' },
  // Daily briefing (whole lists, never items) — owner / for-child / unassigned × due-state
  'lists.briefing.owner.today': {
    en: 'Your list “{list}” is due today',
    beanie: 'your list “{list}” is due today',
  },
  'lists.briefing.owner.overdue': {
    en: 'Your list “{list}” is overdue ({date})',
    beanie: 'your list “{list}” is overdue ({date})',
  },
  'lists.briefing.owner.noDue': {
    en: 'Your list “{list}” has {remaining} left',
    beanie: 'your list “{list}” has {remaining} left',
  },
  'lists.briefing.forChild.today': {
    en: '{children}’s list “{list}” is due today',
    beanie: '{children}’s list “{list}” is due today',
  },
  'lists.briefing.forChild.overdue': {
    en: '{children}’s list “{list}” is overdue ({date})',
    beanie: '{children}’s list “{list}” is overdue ({date})',
  },
  'lists.briefing.forChild.noDue': {
    en: '{children}’s list “{list}” has {remaining} left',
    beanie: '{children}’s list “{list}” has {remaining} left',
  },
  'lists.briefing.unassigned.today': {
    en: 'Family list “{list}” is due today',
    beanie: 'family list “{list}” is due today',
  },
  'lists.briefing.unassigned.overdue': {
    en: 'Family list “{list}” is overdue ({date})',
    beanie: 'family list “{list}” is overdue ({date})',
  },
  'lists.briefing.unassigned.noDue': {
    en: 'Family list “{list}” has {remaining} left',
    beanie: 'family list “{list}” has {remaining} left',
  },
  // Derived "list completed" notification
  'lists.notif.finishedBy': { en: 'Finished by {finisher}', beanie: 'finished by {finisher}' },

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
  // ── file delivery ───────────────────────────────────────────────────────
  // The shared failure copy for every export, share and download. One block, so
  // it does not get scattered the way per-feature error copy has been before.
  'fileDelivery.failed': { en: "That file didn't save", beanie: "that file didn't save" },
  'fileDelivery.failedHelp': {
    en: 'Nothing was saved to your device. Check you have space free, then try again.',
    beanie: 'nothing was saved to your device. check you have space free, then try again.',
  },

  // ── beanie wall ─────────────────────────────────────────────────────────
  // One contiguous block: uiStrings.ts is ~9.6k lines and a feature's copy
  // scattered through it is unfindable. Keep new wall copy HERE.
  'wall.name': { en: 'Beanie Wall', beanie: 'beanie wall' },
  'wall.tooNarrow.title': {
    en: 'The wall needs a wider screen',
    beanie: 'the wall needs a wider screen',
  },
  'wall.tooNarrow.body': {
    en: 'The beanie wall is built for a tablet on the kitchen wall, so the whole family can read it from across the room. Open it on a tablet (either way up), or in a bigger window, and it will be here.',
    beanie:
      'the beanie wall is built for a tablet on the kitchen wall, so the whole family can read it from across the room. open it on a tablet (either way up), or in a bigger window, and it will be here.',
  },
  'wall.tooNarrow.back': { en: 'Take Me Back', beanie: 'take me back' },
  'wall.view.days': { en: 'The week', beanie: 'the week' },
  'wall.view.lanes': { en: 'Each bean', beanie: 'each bean' },
  'wall.view.today': { en: 'Today', beanie: 'today' },
  'wall.view.jobs': { en: 'The chore board', beanie: 'the chore board' },
  'wall.jobsBoard.title': { en: 'The chore board', beanie: 'the chore board' },
  'wall.jobsBoard.back': { en: 'Back to {view}', beanie: 'back to {view}' },
  'wall.jobsBoard.progress': {
    en: '{done} of {total} done today',
    beanie: '{done} of {total} done today',
  },
  'wall.jobs.heading': { en: 'To-Dos', beanie: 'to-dos' },
  'wall.chores.heading': { en: 'Chores', beanie: 'chores' },
  'wall.sheet.todos': { en: 'Family To-Dos', beanie: 'family to-dos' },
  'wall.sheet.noTodos': { en: 'Nothing due today', beanie: 'nothing due today 🫘' },
  'wall.doneAt': { en: 'Done {time}', beanie: 'done {time}' },
  'wall.jobs.none': { en: 'Nothing today', beanie: 'free as a bean 🫘' },
  'wall.jobs.allDone': { en: 'All done!', beanie: 'all done!' },
  'wall.sharedLists': { en: 'Beanie Lists', beanie: 'beanie lists' },
  'wall.day.nothingOn': { en: 'Nothing on', beanie: 'nothing on 🫘' },
  'wall.tonight': { en: 'Tonight', beanie: 'tonight' },
  'wall.trip': { en: 'The trip', beanie: 'the trip' },
  'wall.trip.booked': { en: '{booked} of {total} booked', beanie: '{booked} of {total} booked' },
  'wall.trip.allBooked': { en: 'All booked', beanie: 'all booked' },
  'wall.trip.unbookedLeg': { en: 'Not booked', beanie: 'not booked' },
  'wall.trip.gaps.one': {
    en: '{count} night without a bed',
    beanie: '{count} night without a bed',
  },
  'wall.trip.gaps.other': {
    en: '{count} nights without a bed',
    beanie: '{count} nights without a bed',
  },
  'wall.lock.locked': { en: 'The wall is locked', beanie: 'the wall is locked' },
  'wall.lock.unlock': { en: 'Unlock editing', beanie: 'unlock editing' },
  'wall.lock.relock': { en: 'Lock the wall again', beanie: 'lock the wall again' },
  'wall.lock.nightNow': { en: 'Start night mode now', beanie: 'start night mode now' },
  'wall.lock.leave': { en: 'Leave the beanie wall', beanie: 'leave the beanie wall' },
  'wall.lock.unlocked': { en: 'Editing unlocked', beanie: 'editing unlocked' },
  'wall.exiting': { en: 'Leaving the wall…', beanie: 'leaving the wall…' },
  'wall.night.wake': { en: 'Touch to wake the wall', beanie: 'touch to wake the wall' },
  'wall.night.tomorrow.one': {
    en: '{count} thing on tomorrow',
    beanie: '{count} thing on tomorrow',
  },
  'wall.night.tomorrow.other': {
    en: '{count} things on tomorrow',
    beanie: '{count} things on tomorrow',
  },
  'wall.header.weekOf': { en: 'Week of {date}', beanie: 'week of {date}' },
  'wall.header.things.one': { en: '{count} thing on today', beanie: '{count} thing on today' },
  'wall.header.things.other': { en: '{count} things on today', beanie: '{count} things on today' },
  'wall.card.chores': { en: 'Chores', beanie: 'chores' },
  'wall.card.choresProgress': {
    en: '{done} of {total} done · tap for the board',
    beanie: '{done} of {total} done · tap for the board',
  },
  'wall.card.todos': { en: 'Family To-Dos', beanie: 'family to-dos' },
  'wall.card.todosProgress': {
    en: '{done} of {total} done today',
    beanie: '{done} of {total} done today',
  },
  'wall.card.more': { en: '+{count} more', beanie: '+{count} more' },
  'wall.card.cooking': { en: '{name} is cooking', beanie: '{name} is cooking' },
  'wall.list.repeats': { en: 'Repeats', beanie: 'repeats' },
  'wall.list.ownerList': { en: "{name}'s list", beanie: "{name}'s list" },
  'wall.list.progress': { en: '{done} of {total} done', beanie: '{done} of {total} done' },
  'wall.lane.today': { en: '{count} today', beanie: '{count} today' },
  'wall.lane.tomorrow': { en: '{count} tomorrow', beanie: '{count} tomorrow' },
  'lists.cycle.archiveFailed': {
    en: 'Couldn’t save this list’s history. It’ll try again next time you open the app.',
    beanie: 'couldn’t save this list’s history. it’ll try again next time you open beanies.',
  },
  'lists.history.retention': { en: 'Kept for 3 months', beanie: 'kept for 3 months' },
  'lists.history.title': { en: 'Repeating list history', beanie: 'repeating list history' },
  'lists.completed.thisWeek': { en: 'This week', beanie: 'this week' },
  'lists.completed.lastWeek': { en: 'Last week', beanie: 'last week' },
  'lists.completed.earlier': { en: 'Earlier', beanie: 'earlier' },
  'wall.today.today': { en: 'Today', beanie: 'today' },
  'wall.today.backToToday': { en: 'Back to today', beanie: 'back to today' },
  // ── the time grid (the concertina axis) ──────────────────────────────
  'wall.grid.quietUntil': { en: 'Quiet until {time}', beanie: 'quiet until {time}' },
  'wall.grid.allDay': { en: 'All day', beanie: 'all day' },
  'wall.grid.everyone': { en: 'Everyone', beanie: 'everyone' },
  // Deliberately NOT `wall.today.now` ('Happening now'): the block marker has
  // room for one word and the today-view heading has room for two, so sharing
  // one key would degrade whichever surface lost the argument.
  'wall.grid.runningNow': { en: 'Now', beanie: 'now' },
  'wall.grid.nowAt': { en: 'Now {time}', beanie: 'now {time}' },
  'wall.grid.fallback': {
    en: 'Showing a simple list — the time grid could not be drawn',
    beanie: 'showing a simple list — the time grid could not be drawn 🫘',
  },
  'wall.filter.everyone': { en: 'Everyone', beanie: 'everyone' },
  'wall.sheet.activity': { en: 'Activity', beanie: 'the activity' },
  'wall.sheet.meals': { en: "Today's meals", beanie: "today's meals" },
  'wall.sheet.noMeals': { en: 'Nothing planned', beanie: 'nothing planned yet 🫘' },
  'wall.unlock.title': { en: "Enter {name}'s PIN", beanie: "enter {name}'s PIN" },
  'wall.unlock.anyGrownUp': { en: "Enter a grown-up's PIN", beanie: "enter a grown-up's pin" },
  'wall.unlock.leaveHint': {
    en: 'Leaving reopens the app as you, so this one has to be your own PIN.',
    beanie: 'leaving reopens the app as you, so this one has to be your own pin.',
  },
  'wall.unlock.tooMany': {
    en: 'Too many tries — wait {seconds}s',
    beanie: 'too many tries — wait {seconds}s',
  },
  'wall.unlock.failed': {
    en: "That didn't work — try again",
    beanie: "that didn't work — try again",
  },
  'wall.leave.busy': {
    en: 'Still saving. Give it a moment, then try leaving again.',
    beanie: 'still saving. give it a moment, then try leaving again.',
  },
  'wall.cheer.1': { en: 'Nice one!', beanie: 'nice one!' },
  'wall.cheer.2': { en: 'Boom 💥', beanie: 'boom 💥' },
  'wall.cheer.3': { en: 'Get in!', beanie: 'get in!' },
  'wall.cheer.4': { en: 'Look at you go', beanie: 'look at you go' },
  'wall.cheer.5': { en: 'One down!', beanie: 'one down!' },
  'wall.status.saved': { en: 'Saved {when}', beanie: 'saved {when}' },
  'wall.status.offline': {
    en: 'Offline — showing last known',
    beanie: 'offline — showing last known',
  },
  'wall.status.stale': { en: 'Last updated {when}', beanie: 'last updated {when}' },
  'wall.status.blocked': {
    en: "Can't reach your family file",
    beanie: "can't reach your family file",
  },
  'wall.jobFailed.title': { en: "That didn't save", beanie: "that didn't save" },
  'wall.jobFailed.message': {
    en: 'It may have been changed on another device. The wall will catch up on the next sync.',
    beanie: 'it may have been changed on another device. the wall will catch up on the next sync.',
  },
  'wall.addFailed.title': { en: "That didn't get added", beanie: "that didn't get added" },
  'wall.addFailed.message': {
    en: 'The list may have changed on another device. Try again in a moment.',
    beanie: 'the list may have changed on another device. try again in a moment.',
  },
  'wall.hero.when': { en: 'When', beanie: 'when' },
  'wall.orphanLists': { en: 'Other lists', beanie: 'other lists' },
  'wall.todo.overdue': { en: 'Late', beanie: 'late' },
  'wall.todo.today': { en: 'Today', beanie: 'today' },
  'wall.todo.upcoming': { en: 'Coming up', beanie: 'coming up' },
  'wall.todo.undated': { en: 'No date', beanie: 'no date' },
  'wall.todo.anyone': { en: 'Anyone', beanie: 'anyone' },
  'wall.notes': { en: 'Notes', beanie: 'notes' },
  'wall.card.choresAndLists': { en: 'Chores & Lists', beanie: 'chores & lists' },
  'wall.meals.slot.breakfast': { en: 'Breakfast', beanie: 'breakfast' },
  'wall.meals.slot.lunch': { en: 'Lunch', beanie: 'lunch' },
  'wall.meals.slot.dinner': { en: 'Dinner', beanie: 'dinner' },
  'wall.meals.slot.snack': { en: 'Snack', beanie: 'snack' },
  'wall.todoAddFailed.message': {
    en: 'That to-do was not saved. Try again in a moment.',
    beanie: 'that to-do was not saved. try again in a moment.',
  },
  'wall.list.addItem': { en: 'Add an item', beanie: 'add an item' },
  'wall.todo.add': { en: 'Add a to-do', beanie: 'add a to-do' },
  'wall.setup.title': { en: 'Beanie Wall', beanie: 'beanie wall' },
  'wall.setup.description': {
    en: "Turn a spare tablet into the family wall display: the week at a glance and everyone's jobs, ready to tap.",
    beanie:
      "turn a spare tablet into the family wall display: the week at a glance and everyone's jobs, ready to tap.",
  },
  'wall.setup.start': { en: 'Start the wall', beanie: 'start the wall' },
  'wall.setup.setPinAndStart': { en: 'Set a PIN and start', beanie: 'set a pin and start' },
  'wall.setup.needsPin.title': { en: 'Set a PIN first', beanie: 'set a PIN first' },
  'wall.setup.needsPin.message': {
    en: 'Leaving the wall asks for your PIN, so you need one before you start. Set it up in Account.',
    beanie:
      'leaving the wall asks for your PIN, so you need one before you start. set it up in account.',
  },
  'celebration.listComplete': {
    en: 'Whole list done! The beanies are cheering!',
    beanie: 'whole list done! the beanies are going wild!',
  },
  'celebration.firstSave': {
    en: 'Your data is safe and encrypted',
    beanie: 'all your beans are safely encrypted!',
  },
  'celebration.debtFree': {
    en: 'Debt-free! Time to celebrate!',
    beanie: 'debt-free! the beanies are celebrating!',
  },
  'celebration.recipe5Star': {
    en: '5-star meal! The whole pod approves.',
    beanie: '5-star meal! the whole pod approves',
  },

  // Setup Progress Modal
  'setupProgress.title': {
    en: 'setting up the {name} pod',
    beanie: 'setting up the {name} pod',
  },
  'setupProgress.subtitle': {
    en: "hang tight — we're getting everything ready",
    beanie: "hang tight — we're planting your beans",
  },
  'setupProgress.step0.label': { en: 'planting your beans', beanie: 'planting your beans' },
  'setupProgress.step0.active': {
    en: 'creating family profile...',
    beanie: 'creating family profile...',
  },
  'setupProgress.step0.done': { en: 'family profile created', beanie: 'family profile created' },
  'setupProgress.step1.label': { en: 'sealing the pod', beanie: 'sealing the pod' },
  'setupProgress.step1.active': {
    en: 'generating encryption keys...',
    beanie: 'generating encryption keys...',
  },
  'setupProgress.step1.done': {
    en: 'pod sealed with AES-256',
    beanie: 'pod sealed with AES-256',
  },
  'setupProgress.step2.label': { en: 'gathering the family', beanie: 'gathering the beanies' },
  'setupProgress.step2.active': {
    en: 'setting up member profiles...',
    beanie: 'setting up beanie profiles...',
  },
  'setupProgress.step2.done': { en: 'members added', beanie: 'beanies gathered' },
  'setupProgress.step3.label': { en: 'saving your beanpod', beanie: 'saving your beanpod' },
  'setupProgress.step3.active': { en: 'saving to storage...', beanie: 'saving to storage...' },
  'setupProgress.step3.done': { en: 'beanpod saved', beanie: 'beanpod saved' },
  'setupProgress.step4.label': { en: 'finishing touches', beanie: 'finishing touches' },
  'setupProgress.step4.active': {
    en: 'preparing your home...',
    beanie: 'preparing your nook...',
  },
  'setupProgress.step4.done': { en: 'home is ready', beanie: 'nook is ready' },
  'setupProgress.msg0': {
    en: 'every bean counts — yours are being counted right now',
    beanie: 'every bean counts — yours are being counted right now',
  },
  'setupProgress.msg1': {
    en: "your data is yours — we're making sure it stays that way",
    beanie: "your beans are yours — we're making sure it stays that way",
  },
  'setupProgress.msg2': {
    en: 'the more beans, the merrier',
    beanie: 'the more beanies, the merrier',
  },
  'setupProgress.msg3': {
    en: "almost there — writing your family's story",
    beanie: "almost there — writing your beanies' story",
  },
  'setupProgress.msg4': {
    en: 'just a moment — putting the finishing touches on your home',
    beanie: 'just a moment — putting the finishing touches on your nook',
  },
  'setupProgress.error.title': {
    en: 'almost there — one last step hiccuped',
    beanie: 'almost there — one last bean tripped',
  },
  'setupProgress.error.description': {
    en: "Your pod is created and your data is safe — we just couldn't finish a background step (a final save / arming auto-sync). Try again, continue (it'll retry next time you open the app), or go back.",
    beanie:
      "your pod is created and your beans are safe — we just couldn't finish a background step (a final save / arming auto-sync). try again, continue (it'll retry next time you open the app), or go back.",
  },
  'setupProgress.error.retry': { en: 'Try Again', beanie: 'try again' },
  'setupProgress.error.continue': { en: 'Continue', beanie: 'continue' },
  'setupProgress.error.back': { en: 'Go Back', beanie: 'go back' },
  'setupProgress.success.title': { en: 'welcome home!', beanie: 'welcome to the nook!' },
  'setupProgress.success.subtitle': {
    en: 'the {name} pod is ready to go',
    beanie: 'the {name} beanpod is ready to go',
  },
  'setupProgress.success.cta': {
    en: "let's count some beans",
    beanie: "let's count some beans",
  },

  // Family Nook
  'nook.welcomeHome': { en: 'Welcome Home, {name}', beanie: 'welcome to your nook, {name}' },
  'nook.familyAtAGlance': {
    en: 'Your family at a glance',
    beanie: 'your bean pod at a glance',
  },
  'nook.todayCaption': {
    en: "It's {date} · Your family at a glance",
    beanie: "it's {date} · your bean pod at a glance",
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
    en: 'In America, first you get the beans, then you get the money, and then you get the women',
    beanie:
      'in america, first you get the beans, then you get the money, and then you get the women',
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
  'nook.motto37': {
    en: "There's more to life than being really, really, ridiculously beanie looking.",
    beanie: "there's more to life than being really, really, ridiculously beanie looking.",
  },
  'nook.briefingLabel': {
    en: 'Your Daily Briefing',
    beanie: 'your daily briefing',
  },
  'nook.statusSummary': {
    en: '{activities} activities planned today · {tasks} tasks coming up',
    beanie: '{activities} activities today · {tasks} tasks coming up!',
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
  'nook.criticalMedReminder': {
    en: "Don't forget: {medication} for {member} ({remaining} more today)",
    beanie: "don't forget: {medication} for {member} ({remaining} more today)",
  },
  'nook.criticalMedReminderOne': {
    en: "Don't forget: {medication} for {member} (1 more today)",
    beanie: "don't forget: {medication} for {member} (1 more today)",
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
  'nook.criticalDropoffPickup': {
    en: 'Drop off & pick up {child} at {activity} ({startTime} → {endTime})',
    beanie: 'drop off & pick up {child} at {activity} ({startTime} → {endTime})',
  },
  'nook.criticalDropoffPickupStartOnly': {
    en: 'Drop off {child} at {activity} at {startTime} & pick up later!',
    beanie: 'drop off {child} at {activity} at {startTime} & pick up later!',
  },
  'nook.criticalDropoffPickupEndOnly': {
    en: 'Drop off & pick up {child} from {activity} at {endTime}!',
    beanie: 'drop off & pick up {child} from {activity} at {endTime}!',
  },
  'nook.criticalDropoffPickupNoTime': {
    en: 'Drop off & pick up {child} at {activity} today!',
    beanie: 'drop off & pick up {child} at {activity} today!',
  },
  // A to-do assigned only to a child (no adult assignee): shown to every adult,
  // framed by the child's name. {children} is one or more names ("Neil" / "Neil & Sam").
  'nook.criticalTodoForChild': {
    en: '{children}: {task} today!',
    beanie: '{children}: {task} today!',
  },
  'nook.criticalTodoForChildNoDue': {
    en: '{children}: {task}',
    beanie: '{children}: {task}',
  },
  'nook.criticalTodoForChildOverdue': {
    en: '{children}: {task} — it was due {date}',
    beanie: '{children}: {task} — was due {date}, no rush!',
  },
  // A to-do with no assignee: shown to everyone — "whoever's free".
  'nook.criticalTodoUnassigned': {
    en: '{task} today (anyone can do this)',
    beanie: '{task} today (anyone can do this)',
  },
  'nook.criticalTodoUnassignedNoDue': {
    en: '{task} (anyone can do this)',
    beanie: '{task} (anyone can do this)',
  },
  'nook.criticalTodoUnassignedOverdue': {
    en: 'A gentle reminder: {task} — it was due {date} (anyone can do this)',
    beanie: 'a gentle nudge: {task} — was due {date} (anyone can do this)',
  },
  // An activity assigned only to a child (no adult assignee): shown to every adult.
  'nook.criticalActivityForChild': {
    en: '{children}: {activity} at {time} today!',
    beanie: '{children}: {activity} at {time} today!',
  },
  'nook.criticalActivityForChildNoTime': {
    en: '{children}: {activity} today!',
    beanie: '{children}: {activity} today!',
  },
  'nook.dutyDone': {
    en: 'Done',
    beanie: 'done',
  },
  'nook.dutyMarkDone': {
    en: 'Mark done',
    beanie: 'mark done',
  },
  'nook.yourBeans': { en: 'Your Beans', beanie: 'your bean pod' },
  'nook.addBean': { en: 'Add Beanie', beanie: 'add a beanie' },
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

  // Holiday briefing — day-of greetings (allowlist) + tomorrow heads-up.
  'nook.holiday.greeting.christmas': {
    en: 'Merry Christmas, beans',
    beanie: 'merry christmas, beans',
  },
  'nook.holiday.greeting.newYear': {
    en: 'Happy New Year, beans',
    beanie: 'happy new year, beans',
  },
  'nook.holiday.greeting.lunarNewYear': {
    en: 'Happy Lunar New Year, beans',
    beanie: 'happy lunar new year, beans',
  },
  'nook.holiday.greeting.easter': { en: 'Happy Easter, beans', beanie: 'happy easter, beans' },
  'nook.holiday.greeting.mothersDay': {
    en: "Happy Mother's Day, beans",
    beanie: "happy mother's day, beans",
  },
  'nook.holiday.greeting.fathersDay': {
    en: "Happy Father's Day, beans",
    beanie: "happy father's day, beans",
  },
  'nook.holiday.greeting.thanksgiving': {
    en: 'Happy Thanksgiving, beans',
    beanie: 'happy thanksgiving, beans',
  },
  'nook.holiday.greeting.diwali': {
    en: 'Happy Diwali, beans',
    beanie: 'happy diwali, beans',
  },
  'nook.holiday.greeting.eid': { en: 'Eid Mubarak, beans', beanie: 'eid mubarak, beans' },
  'nook.holiday.greeting.birthday': {
    en: 'Happy birthday, {name}!',
    beanie: 'happy birthday, {name}!',
  },
  'nook.holiday.birthday.caption': {
    en: "It's your special day",
    beanie: "it's your special day",
  },
  'nook.birthday.overlay': {
    en: 'Happy Birthday, {name}!',
    beanie: 'happy birthday, {name}!',
  },
  'nook.holiday.greeting.default': {
    en: 'Today is {holidayName}',
    beanie: 'today is {holidayName}',
  },
  'nook.holiday.banner.caption': {
    en: 'School and work may be off today',
    beanie: 'school and work may be off today',
  },
  'nook.holiday.tomorrow.message': {
    en: 'Tomorrow is {holidayName}',
    beanie: 'heads up: tomorrow is {holidayName}',
  },
  'nook.holiday.tomorrow.caption': {
    en: 'School and work may be off',
    beanie: 'school and work may be off',
  },

  // Mobile navigation — v3 bottom nav: 5 slots (Nook, Planning, Calendar,
  // Money, Pod). Calendar is the raised center one-tap leaf → /activities.
  'mobile.nook': { en: 'Nook', beanie: 'nook' },
  'mobile.planning': { en: 'Planning', beanie: 'planning' },
  'mobile.calendar': { en: 'Calendar', beanie: 'calendar' },
  'mobile.money': { en: 'Money', beanie: 'money' },
  'mobile.pod': { en: 'Pod', beanie: 'your pod' },
  'mobile.budget': { en: 'Budget', beanie: 'budget' },
  // v3 side-card hint copy. Each line is a one-line preview of what the
  // user finds on the route, capped at ~22 chars to never wrap on a
  // 360px phone. See docs/mockups/mobile-nav-bean-jar-v3.html.
  'mobileNav.hint.activities': { en: 'calendar & plans', beanie: 'calendar & plans' },
  'mobileNav.hint.todo': { en: 'shared family tasks', beanie: 'shared family tasks' },
  'mobileNav.hint.lists': { en: 'categorized family checklists', beanie: 'family checklists' },
  'mobileNav.hint.travel': { en: 'trips & ideas', beanie: 'trips & ideas' },
  'mobileNav.hint.overview': { en: 'your bottom line', beanie: 'your bottom line' },
  'mobileNav.hint.accounts': {
    en: 'checking, savings, cards',
    beanie: 'checking, savings, cards',
  },
  'mobileNav.hint.budgets': { en: 'tracked monthly', beanie: 'tracked monthly' },
  'mobileNav.hint.transactions': { en: 'income & expenses', beanie: 'income & expenses' },
  'mobileNav.hint.goals': { en: 'savings targets', beanie: 'savings targets' },
  'mobileNav.hint.assets': { en: 'home, cars, and more', beanie: 'home, cars, and more' },
  'mobileNav.hint.meetBeans': { en: 'everyone in the pod', beanie: 'everyone in the pod' },
  'mobileNav.hint.scrapbook': { en: 'photos & memories', beanie: 'photos & memories' },
  'mobileNav.hint.milestones': { en: 'big moments by year', beanie: 'big moments by year' },
  'mobileNav.hint.cookbook': { en: 'family recipes', beanie: 'family recipes' },
  'mobileNav.hint.safety': { en: 'meds, allergies, doses', beanie: 'meds, allergies, doses' },
  'mobileNav.hint.contacts': { en: 'contacts & info', beanie: 'contacts & info' },
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
  // Unified Google reconnect prompt (tracker #62, commit 5) — one toast that
  // names what's disconnected (Drive, Calendar, or both) and reconnects in one
  // consent where possible.
  'reconnectPrompt.both.title': {
    en: 'Google Drive + Calendar disconnected',
    beanie: 'google drive + calendar disconnected',
  },
  'reconnectPrompt.both.body': {
    en: 'Reconnect once to restore saving and calendar sync.',
    beanie: 'reconnect once to restore saving and calendar sync.',
  },
  'reconnectPrompt.both.bodyMulti': {
    en: 'Reconnect to restore saving and calendar sync.',
    beanie: 'reconnect to restore saving and calendar sync.',
  },
  'reconnectPrompt.drive.title': {
    en: 'Google session expired',
    beanie: 'google session expired',
  },
  'reconnectPrompt.drive.body': {
    en: 'Reconnect to keep saving your family data.',
    beanie: 'reconnect to keep saving your family data.',
  },
  'reconnectPrompt.calendar.title': {
    en: 'Google Calendar disconnected',
    beanie: 'google calendar disconnected',
  },
  'reconnectPrompt.calendar.body': {
    en: 'Reconnect to keep your activities in sync.',
    beanie: 'reconnect to keep your activities in sync.',
  },
  'reconnectPrompt.action': { en: 'Reconnect', beanie: 'reconnect' },
  'reconnectPrompt.error': {
    en: "Reconnect didn't finish. Please try again.",
    beanie: "reconnect didn't finish. please try again.",
  },
  'reconnectPrompt.reconnected': {
    en: 'Reconnected to Google.',
    beanie: 'reconnected to google.',
  },
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

  // Drive "Open with beanies.family" landing page (/open). Reached when the
  // user clicks "Open with" on a .beanpod file in Google Drive — see
  // OpenFromDrivePage.vue.
  'openFromDrive.title': { en: 'Opening from Drive', beanie: 'opening from drive' },
  'openFromDrive.loading': {
    en: 'counting beans from your drive...',
    beanie: 'counting beans from your drive...',
  },
  'openFromDrive.loadingHint': {
    en: "We're getting your family pod ready.",
    beanie: "we're getting your family pod ready.",
  },
  'openFromDrive.errorTitle': {
    en: "Couldn't open this pod",
    beanie: "couldn't open this pod",
  },
  'openFromDrive.invalidState': {
    en: "We couldn't read the file information from Drive. Try again from Drive's right-click menu, or sign in directly.",
    beanie:
      "we couldn't read the file information from drive. try again from drive's right-click menu, or sign in directly.",
  },
  'openFromDrive.loadFailed': {
    en: "We couldn't load this pod. The file may have been moved, deleted, or you may not have access to it.",
    beanie:
      "we couldn't load this pod. the file may have been moved, deleted, or you may not have access to it.",
  },
  'openFromDrive.driveNotConfigured': {
    en: "This build of beanies.family doesn't have Google Drive sync enabled. Sign in directly to use a local file instead.",
    beanie:
      "this build of beanies.family doesn't have google drive sync enabled. sign in directly to use a local file instead.",
  },
  'openFromDrive.unsupportedTitle': {
    en: "Can't open from Drive",
    beanie: "can't open from drive",
  },
  'openFromDrive.tryAgain': { en: 'Try again', beanie: 'try again' },
  'openFromDrive.continueWithGoogle': {
    en: 'Continue with Google',
    beanie: 'continue with google',
  },
  'openFromDrive.useDifferentFile': {
    en: 'or pick a different pod →',
    beanie: 'or pick a different pod →',
  },
  'openFromDrive.signIn': { en: 'Sign in to beanies.family', beanie: 'sign in to beanies.family' },
  'openFromDrive.popupBlockedTitle': {
    en: 'One more click to continue',
    beanie: 'one more click to continue',
  },
  'openFromDrive.popupBlockedHint': {
    en: "Your browser blocked the Google sign-in popup because it didn't follow a click. Tap Continue to bring it back.",
    beanie:
      "your browser blocked the google sign-in popup because it didn't follow a click. tap continue to bring it back.",
  },

  'googleDrive.filePickerTitle': {
    en: 'Your pods on Google Drive',
    beanie: 'your pods on google drive',
  },
  'googleDrive.lastModified': { en: 'Last modified', beanie: 'last modified' },
  'googleDrive.refresh': { en: 'Refresh', beanie: 'refresh' },
  'googleDrive.storageLabel': { en: 'Google Drive', beanie: 'google drive' },
  'googleDrive.fileCreated': {
    en: 'Your pod is planted! 🌱',
    beanie: 'your pod is planted! 🌱',
  },
  'googleDrive.fileCreatedSubtitle': {
    en: "Saved safely — let's add your family next.",
    beanie: "saved safely — let's add your family next.",
  },
  'googleDrive.fileLocation': {
    en: 'Location: beanies.family folder',
    beanie: 'location: beanies.family folder',
  },
  'googleDrive.openInDrive': { en: 'Open in Google Drive', beanie: 'open in google drive' },
  'googleDrive.savedTo': { en: 'Saved to Google Drive', beanie: 'saved to google drive' },
  'googleDrive.connectedAs': { en: 'Connected as {email}', beanie: 'connected as {email}' },
  'googleDrive.saveFailureTitle': {
    en: "Your data isn't being saved",
    beanie: "your data isn't being saved",
  },
  'googleDrive.saveFailureBody': {
    en: "Recent changes haven't been saved to Google Drive. Try refreshing the app.",
    beanie: "recent changes haven't been saved to google drive. try refreshing the app.",
  },
  'googleDrive.saveFailureRefresh': {
    en: 'Refresh app',
    beanie: 'refresh app',
  },
  'googleDrive.saveRetrying': {
    en: 'Save failed — retrying...',
    beanie: 'save failed — retrying...',
  },
  'googleDrive.fileNotFoundTitle': {
    en: 'Your data file was not found',
    beanie: "we can't find your beanpod",
  },
  'googleDrive.fileNotFoundBody': {
    en: "We couldn't find your data file in {email}'s Drive. It may have been deleted, moved, or you may be signed in with a different account.",
    beanie:
      "we couldn't find your beanpod in {email}'s drive. it may have been moved, deleted, or you may be signed in with a different account",
  },
  'googleDrive.thisAccount': {
    en: 'this account',
    beanie: 'this account',
  },
  'googleDrive.goToSettings': { en: 'Go to Settings', beanie: 'go to settings' },
  'googleDrive.fileNotFoundReselect': {
    en: 'Pick file from Drive',
    beanie: 'pick from drive',
  },
  'googleDrive.fileNotFoundReselectFailed': {
    en: "Couldn't load the picked file.",
    beanie: "couldn't load that file",
  },
  'googleDrive.reconnectFailed': {
    en: 'Could not reconnect. Try again.',
    beanie: "couldn't reconnect. try again",
  },
  'googleDrive.reconnected': {
    en: 'Reconnected — all data saved',
    beanie: 'reconnected — all beanies safe & sound',
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
  'storage.localFileWarningTitle': {
    en: "Heads up — local files don't sync",
    beanie: "heads up — local files don't sync",
  },
  'storage.localFileWarning': {
    en: 'Your data stays on this device. To share with other family members, you will need to manually share the data file.',
    beanie:
      'your data stays on this device. to share with other family members, you will need to manually share the data file.',
  },
  'storage.localFileWarningEncryption': {
    en: 'Your data is encrypted either way — only the people you share the file with can open it.',
    beanie:
      'your data is encrypted either way — only the people you share the file with can open it.',
  },
  'storage.localFileContinue': {
    en: 'Use a local file',
    beanie: 'use a local file',
  },
  'storage.useGoogleDriveInstead': {
    en: 'Use Google Drive instead',
    beanie: 'use google drive instead',
  },
  'storage.driveSyncsWithFamily': {
    en: 'Syncs with your whole family — on every device, automatically. Same encryption as a local file.',
    beanie:
      'syncs with your whole family — on every device, automatically. same encryption as a local file.',
  },
  'storage.connectGoogleDrive': {
    en: 'Connect Google Drive',
    beanie: 'connect google drive',
  },
  'storage.preferLocal': {
    en: 'Prefer to store your data locally on this device?',
    beanie: 'prefer to store your data locally on this device?',
  },
  'storage.useLocalInstead': {
    en: 'Use a local file instead',
    beanie: 'use a local file instead',
  },
  'storage.savingToLocalFile': {
    en: 'Saving to a local file on this device',
    beanie: 'saving to a local file on this device',
  },
  // Classified errors from LocalStorageProvider (see classifyFileError).
  // Kept generic so they apply equally to read and write paths.
  'storage.localFilePermissionLost': {
    en: 'Browser revoked file access. Please re-select your .beanpod file.',
    beanie: 'browser revoked file access. please re-select your .beanpod file.',
  },
  'storage.localFileDiskFull': {
    en: 'Your disk is full. Free up space and try again.',
    beanie: 'your disk is full. free up space and try again.',
  },
  'storage.localFileCorrupted': {
    en: "Couldn't read the file — it may be corrupted or another app is editing it.",
    beanie: "couldn't read the file — it may be corrupted or another app is editing it.",
  },
  'storage.localFileWriteFailed': {
    en: "Couldn't save your data file. Try again, or check the browser console for details.",
    beanie: "couldn't save your data file. try again, or check the browser console for details.",
  },
  'storage.localFileConflictDetected': {
    en: 'This file looks like a conflict copy from your cloud-storage provider. Beanies will merge it on load — you can delete the duplicate after.',
    beanie:
      'this file looks like a conflict copy from your cloud-storage provider. beanies will merge it on load — you can delete the duplicate after.',
  },
  'storage.localFileBestOnDesktop': {
    en: 'Local files only work in Chrome or Edge on a computer. On a phone, or in Safari or Firefox, choose Google Drive instead.',
    beanie:
      'local files only work in chrome or edge on a computer. on a phone, or in safari or firefox, choose google drive instead.',
  },
  'storage.comingSoon': { en: 'Coming Soon', beanie: 'coming soon' },
  'storage.recommended': { en: 'Recommended', beanie: 'recommended' },

  // Family Planner
  'planner.title': { en: 'Family Planner', beanie: 'beanie planner' },
  'planner.subtitle': {
    en: '{month} — {count} activities',
    beanie: '{month} — {count} activities',
  },
  'planner.addActivity': { en: 'Add Activity', beanie: 'new activity' },
  'planner.calendarNudge.title': {
    en: 'See these in Google Calendar too',
    beanie: 'see these in google calendar too',
  },
  'planner.calendarNudge.subtitle': {
    en: "Link your calendar and your family's plans show up there automatically.",
    beanie: "link your calendar and your family's plans show up there automatically.",
  },
  'planner.calendarNudge.connect': { en: 'Connect', beanie: 'connect' },
  'planner.calendarNudge.dismiss': { en: 'Dismiss', beanie: 'dismiss' },
  'planner.segmentDeparture': { en: 'Departure', beanie: 'departure' },
  'planner.segmentArrival': { en: 'Arrival', beanie: 'arrival' },
  'planner.segmentDepartureShort': { en: 'Dep', beanie: 'dep' },
  'planner.segmentArrivalShort': { en: 'Arr', beanie: 'arr' },
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
  // Delete a single session of a recurring activity (cancel this occurrence — never restore).
  'planner.deleteSession.title': { en: 'Delete this session?', beanie: 'delete this session?' },
  'planner.deleteSession.message': {
    en: 'Only this one is removed; the rest of the series stays.',
    beanie: 'only this one is removed; the rest of the series stays.',
  },
  // Context banner + reset-to-series action on a moved/edited single occurrence.
  'planner.override.movedFrom': { en: 'Moved from {date}.', beanie: 'moved from {date}.' },
  'planner.override.editedOnly': {
    en: 'Edited just for this session.',
    beanie: 'edited just for this session.',
  },
  'planner.reset.label': { en: 'Reset to series', beanie: 'reset to series' },
  'planner.reset.labelMoved': { en: 'Reset to series time', beanie: 'reset to series time' },
  'planner.reset.title': { en: 'Reset this session?', beanie: 'reset this session?' },
  'planner.reset.message': { en: 'Undo this one-off change.', beanie: 'undo this one-off change.' },
  'planner.reset.detailMoved': {
    en: 'It goes back to {date} and your one-off change is removed.',
    beanie: 'it goes back to {date} and your one-off change is removed.',
  },
  'planner.reset.detailEdited': {
    en: 'It goes back to the series default and your changes to it are removed.',
    beanie: 'it goes back to the series default and your changes to it are removed.',
  },
  'planner.reset.confirm': { en: 'Reset', beanie: 'reset' },
  'planner.sessionActionFailed.title': {
    en: 'Couldn’t update this session',
    beanie: 'couldn’t update this session',
  },
  'planner.sessionActionFailed.message': {
    en: 'Something went wrong — please try again.',
    beanie: 'something went wrong — please try again.',
  },
  'planner.scopeEditFailed.title': {
    en: "Couldn't move that",
    beanie: "couldn't move that",
  },
  'planner.scopeEditFailed.message': {
    en: "This plan's series couldn't be found, so the new date wasn't saved. Close and reopen the plan, then try again.",
    beanie:
      "this plan's series couldn't be found, so the new date wasn't saved. close and reopen the plan, then try again.",
  },
  'planner.multiDayMoveBlocked.title': {
    en: 'Pick a different option to move this',
    beanie: 'pick a different option to move this',
  },
  'planner.multiDayMoveBlocked.message': {
    en: 'This activity repeats on more than one day each week, so moving one session can’t be applied to the whole series. Choose “This occurrence only” to move just this one, or edit the days it repeats on.',
    beanie:
      'this bean sprouts on more than one day each week, so moving one session can’t change the whole series. choose “this occurrence only” to move just this one, or change the days it repeats on.',
  },
  'planner.addAnotherActivity': {
    en: '+ add another activity',
    beanie: '+ add another activity',
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
  'planner.prevPeriod': { en: 'Previous period', beanie: 'previous period' },
  'planner.nextPeriod': { en: 'Next period', beanie: 'next period' },
  'planner.openAgenda': { en: 'Open agenda view', beanie: 'open agenda view' },
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

  // Planner — Month grid chip overflow + mobile legend + week separators
  'planner.moreEvents': { en: '{count} more activities', beanie: '{count} more activities' },
  'planner.moreEventsShort': { en: 'more', beanie: 'more' },
  'planner.weekThis': { en: 'This week', beanie: 'this week' },
  'planner.weekNext': { en: 'Next week', beanie: 'next week' },
  'planner.weekUpcoming': { en: 'Upcoming', beanie: 'upcoming' },
  'planner.weekLast': { en: 'Last week', beanie: 'last week' },
  'planner.weekEarlier': { en: 'Earlier', beanie: 'earlier' },

  // Planner — View toggle
  'planner.view.month': { en: 'Month', beanie: 'month' },
  'planner.view.week': { en: 'Week', beanie: 'week' },
  'planner.view.day': { en: 'Day', beanie: 'day' },
  'planner.view.agenda': { en: 'Agenda', beanie: 'agenda' },
  'planner.nothingPlanned': { en: 'Nothing planned', beanie: 'nothing planned' },
  'planner.tripRibbonLabel': { en: 'Coming up', beanie: 'coming up' },
  'planner.tripRibbonHide': { en: 'Hide upcoming trips', beanie: 'hide trips' },
  'planner.tripRibbonShow': { en: 'Show upcoming trips', beanie: 'show trips' },
  'planner.tripsOne': { en: '1 trip', beanie: '1 trip' },
  'planner.tripsMany': { en: '{n} trips', beanie: '{n} trips' },
  'planner.peekNextWeek': { en: 'Peek next week', beanie: 'peek next week' },

  // Planner — Activity Category Groups
  'planner.group.appointments': { en: 'Appointments', beanie: 'appointments' },
  'planner.group.competitions': { en: 'Competitions', beanie: 'competitions' },
  'planner.group.educational': { en: 'Educational', beanie: 'educational' },
  'planner.group.food': { en: 'Food', beanie: 'food' },
  'planner.group.fun': { en: 'Fun', beanie: 'fun' },
  'planner.group.lessons': { en: 'Lessons', beanie: 'lessons' },
  'planner.group.party': { en: 'Party', beanie: 'party' },
  'planner.group.pets': { en: 'Pets', beanie: 'pets' },
  'planner.group.religious': { en: 'Religious', beanie: 'religious' },
  'planner.group.school': { en: 'School', beanie: 'school' },
  'planner.group.social': { en: 'Social', beanie: 'social' },
  'planner.group.sports': { en: 'Sports', beanie: 'sports' },
  'planner.group.work': { en: 'Work', beanie: 'work' },
  'planner.group.other': { en: 'Other', beanie: 'other' },

  // Planner — Activity Categories
  'planner.category.dentist': { en: 'Dentist', beanie: 'dentist' },
  'planner.category.doctor': { en: 'Doctor', beanie: 'doctor' },
  'planner.category.eye_exam': { en: 'Eye Exam', beanie: 'eye exam' },
  'planner.category.haircut': { en: 'Haircut', beanie: 'haircut' },
  'planner.category.therapy': { en: 'Therapy', beanie: 'therapy' },
  'planner.category.other_appointment': { en: 'Other Appointment', beanie: 'other appointment' },
  'planner.category.cubing': { en: 'Cubing Competition', beanie: 'cubing competition' },
  'planner.category.gymnastics_competition': {
    en: 'Gymnastics Competition',
    beanie: 'gymnastics competition',
  },
  'planner.category.math_competition': { en: 'Math Competition', beanie: 'math competition' },
  'planner.category.spelling_bee': { en: 'Spelling Bee', beanie: 'spelling bee' },
  'planner.category.swimming_competition': {
    en: 'Swimming Competition',
    beanie: 'swimming competition',
  },
  'planner.category.track_field': { en: 'Track & Field', beanie: 'track & field' },
  'planner.category.other_competition': { en: 'Other Competition', beanie: 'other competition' },
  'planner.category.language': { en: 'Language', beanie: 'language' },
  'planner.category.math': { en: 'Math', beanie: 'math' },
  'planner.category.science': { en: 'Science', beanie: 'science' },
  'planner.category.tutoring': { en: 'Tutoring', beanie: 'tutoring' },
  'planner.category.other_educational': { en: 'Other Educational', beanie: 'other educational' },
  'planner.category.brunch': { en: 'Brunch', beanie: 'brunch' },
  'planner.category.coffee': { en: 'Coffee', beanie: 'coffee' },
  'planner.category.dining_out': { en: 'Dining Out', beanie: 'dining out' },
  'planner.category.drinks': { en: 'Drinks', beanie: 'drinks' },
  'planner.category.picnic': { en: 'Picnic', beanie: 'picnic' },
  'planner.category.other_food': { en: 'Other Food', beanie: 'other food' },
  'planner.category.arcade': { en: 'Arcade', beanie: 'arcade' },
  'planner.category.beach': { en: 'Beach', beanie: 'beach' },
  'planner.category.bowling': { en: 'Bowling', beanie: 'bowling' },
  'planner.category.concert': { en: 'Concert', beanie: 'concert' },
  'planner.category.festival': { en: 'Festival / Fair', beanie: 'festival / fair' },
  'planner.category.movie': { en: 'Movie', beanie: 'movie' },
  'planner.category.museum': { en: 'Museum', beanie: 'museum' },
  'planner.category.playground': { en: 'Playground / Park', beanie: 'playground / park' },
  'planner.category.pool': { en: 'Pool / Swim', beanie: 'pool / swim' },
  'planner.category.show': { en: 'Show / Musical', beanie: 'show / musical' },
  'planner.category.sporting_event': { en: 'Sporting Event', beanie: 'sporting event' },
  'planner.category.theme_park': { en: 'Theme Park', beanie: 'theme park' },
  'planner.category.zoo': { en: 'Zoo / Aquarium', beanie: 'zoo / aquarium' },
  'planner.category.other_entertainment': { en: 'Other Fun Thing', beanie: 'other fun thing' },
  'planner.category.art': { en: 'Art', beanie: 'art' },
  'planner.category.chess': { en: 'Chess', beanie: 'chess' },
  'planner.category.coding': { en: 'Coding / Robotics', beanie: 'coding / robotics' },
  'planner.category.dance': { en: 'Dance / Ballet', beanie: 'dance / ballet' },
  'planner.category.drama': { en: 'Drama / Acting', beanie: 'drama / acting' },
  'planner.category.drum': { en: 'Drum', beanie: 'drum' },
  'planner.category.guitar': { en: 'Guitar', beanie: 'guitar' },
  'planner.category.music': { en: 'Music', beanie: 'music' },
  'planner.category.piano': { en: 'Piano', beanie: 'piano' },
  'planner.category.voice': { en: 'Singing / Voice', beanie: 'singing / voice' },
  'planner.category.swimming': { en: 'Swimming', beanie: 'swimming' },
  'planner.category.trumpet': { en: 'Trumpet', beanie: 'trumpet' },
  'planner.category.other_lesson': { en: 'Other Lesson', beanie: 'other lesson' },
  'planner.category.anniversary': { en: 'Anniversary', beanie: 'anniversary' },
  'planner.category.baby_shower': { en: 'Baby Shower', beanie: 'baby shower' },
  'planner.category.bar_mitzvah': { en: 'Bar Mitzvah', beanie: 'bar mitzvah' },
  'planner.category.birthday': { en: 'Birthday Party', beanie: 'birthday party' },
  'planner.category.graduation': { en: 'Graduation', beanie: 'graduation' },
  'planner.category.wedding': { en: 'Wedding', beanie: 'wedding' },
  'planner.category.other_celebration': { en: 'Other Celebration', beanie: 'other celebration' },
  'planner.category.pet_grooming': { en: 'Grooming', beanie: 'grooming' },
  'planner.category.vet': { en: 'Vet', beanie: 'vet' },
  'planner.category.other_pet': { en: 'Other Pet', beanie: 'other pet' },
  'planner.category.religious_class': { en: 'Religious Class', beanie: 'religious class' },
  'planner.category.worship': { en: 'Worship / Service', beanie: 'worship / service' },
  'planner.category.other_religious': { en: 'Other Religious', beanie: 'other religious' },
  'planner.category.after_school': { en: 'After School Activity', beanie: 'after school activity' },
  'planner.category.field_trip': { en: 'Field Trip', beanie: 'field trip' },
  'planner.category.school_recital': {
    en: 'School Recital / Presentation',
    beanie: 'school recital / presentation',
  },
  'planner.category.other_school': { en: 'Other School Activity', beanie: 'other school activity' },
  'planner.category.date_night': { en: 'Date Night', beanie: 'date night' },
  'planner.category.family_visit': { en: 'Family Visit', beanie: 'family visit' },
  'planner.category.playdate': { en: 'Playdate', beanie: 'playdate' },
  'planner.category.other_social': { en: 'Other Social', beanie: 'other social' },
  'planner.category.badminton': { en: 'Badminton', beanie: 'badminton' },
  'planner.category.baseball': { en: 'Baseball', beanie: 'baseball' },
  'planner.category.basketball': { en: 'Basketball', beanie: 'basketball' },
  'planner.category.football': { en: 'Football', beanie: 'football' },
  'planner.category.golf_activity': { en: 'Golf', beanie: 'golf' },
  'planner.category.gymnastics': { en: 'Gymnastics', beanie: 'gymnastics' },
  'planner.category.mma': { en: 'MMA', beanie: 'mma' },
  'planner.category.multi_sport': { en: 'Multi Sport', beanie: 'multi sport' },
  'planner.category.rugby': { en: 'Rugby', beanie: 'rugby' },
  'planner.category.soccer': { en: 'Soccer', beanie: 'soccer' },
  'planner.category.taekwondo': { en: 'Taekwondo', beanie: 'taekwondo' },
  'planner.category.tennis': { en: 'Tennis', beanie: 'tennis' },
  'planner.category.gym_activity': { en: 'Training', beanie: 'training' },
  'planner.category.yoga_activity': { en: 'Yoga / Pilates', beanie: 'yoga / pilates' },
  'planner.category.other_sports_activity': { en: 'Other Sports', beanie: 'other sports' },
  'planner.category.conference': { en: 'Conference', beanie: 'conference' },
  'planner.category.networking': { en: 'Networking', beanie: 'networking' },
  'planner.category.work_party': { en: 'Office Party', beanie: 'office party' },
  'planner.category.team_building': {
    en: 'Team Building / Outing',
    beanie: 'team building / outing',
  },
  'planner.category.work_dinner': { en: 'Work Dinner', beanie: 'work dinner' },
  'planner.category.work_drinks': { en: 'Work Drinks', beanie: 'work drinks' },
  'planner.category.other_work': { en: 'Other Work', beanie: 'other work' },
  'planner.category.other_activity': { en: 'Other Activity', beanie: 'other activity' },

  // Planner — Recurrence labels
  'planner.recurrence.weekly': { en: 'Weekly', beanie: 'weekly' },
  'planner.recurrence.daily': { en: 'Daily', beanie: 'daily' },
  'planner.recurrence.monthly': { en: 'Monthly', beanie: 'monthly' },
  'planner.recurrence.yearly': { en: 'Yearly', beanie: 'yearly' },
  'planner.recurrence.none': { en: 'One-time', beanie: 'one-time' },
  'planner.recurrence.biweekly': { en: 'Every 2 weeks', beanie: 'every 2 weeks' },
  'planner.recurrence.monthly-by-day': { en: 'Monthly by day', beanie: 'monthly by day' },
  // Used inside the weekly recurrence summary, e.g. "Weekly on Mon, Wed, Fri".
  'planner.recurrence.onSeparator': { en: 'on', beanie: 'on' },
  // Shown on disabled non-weekly chips when the user has selected multiple
  // days of the week — biweekly + monthly variants are single-anchor by
  // design, so they can't honour multi-day selection.
  'planner.recurrence.multiDayWeeklyOnlyHint': {
    en: 'Pick just one day of the week to use this option',
    beanie: 'pick just one day of the week to use this option',
  },

  // Short weekday names used by recurrence summaries (Sunday-first per JS Date).
  'planner.weekday.short.sun': { en: 'Sun', beanie: 'sun' },
  'planner.weekday.short.mon': { en: 'Mon', beanie: 'mon' },
  'planner.weekday.short.tue': { en: 'Tue', beanie: 'tue' },
  'planner.weekday.short.wed': { en: 'Wed', beanie: 'wed' },
  'planner.weekday.short.thu': { en: 'Thu', beanie: 'thu' },
  'planner.weekday.short.fri': { en: 'Fri', beanie: 'fri' },
  'planner.weekday.short.sat': { en: 'Sat', beanie: 'sat' },

  // Recurrence pill labels that include start-date-derived anchors.
  // `{date}` is replaced with an ordinal day-of-month string (e.g. "14th").
  // `{ordinal}` is replaced with a weekday ordinal (e.g. "2nd" or "last").
  // `{day}` is replaced with a short weekday name (e.g. "Tue").
  'planner.frequencyChip.monthlyOnDate': {
    en: 'Monthly on the {date}',
    beanie: 'monthly on the {date}',
  },
  'planner.frequencyChip.monthlyOnDay': {
    en: 'Monthly on the {ordinal} {day}',
    beanie: 'monthly on the {ordinal} {day}',
  },

  // ── Unified recurrence picker (#70) — shared across transactions,
  // activities and lists. `desc.*` are the composable summary fragments used by
  // `describeRule`; the rest are the picker's control labels.
  'recurrence.repeats': { en: 'Repeats', beanie: 'repeats' },
  'recurrence.resets': { en: 'Resets', beanie: 'resets' },
  'recurrence.mode.simple': { en: 'Simple', beanie: 'simple' },
  'recurrence.mode.custom': { en: 'Custom', beanie: 'custom' },
  'recurrence.mode.simpleTag': { en: 'common cadences', beanie: 'common cadences' },
  'recurrence.mode.customTag': { en: 'every N · advanced', beanie: 'every n · advanced' },
  'recurrence.cadence.daily': { en: 'Daily', beanie: 'daily' },
  'recurrence.cadence.weekly': { en: 'Weekly', beanie: 'weekly' },
  'recurrence.cadence.biweekly': { en: 'Every 2 weeks', beanie: 'every 2 weeks' },
  'recurrence.cadence.monthly': { en: 'Monthly', beanie: 'monthly' },
  'recurrence.cadence.yearly': { en: 'Yearly', beanie: 'yearly' },
  'recurrence.customEvery': { en: 'Repeat every', beanie: 'repeat every' },
  'recurrence.resetEvery': { en: 'Reset every', beanie: 'reset every' },
  'recurrence.unit.days': { en: 'days', beanie: 'days' },
  'recurrence.unit.weeks': { en: 'weeks', beanie: 'weeks' },
  'recurrence.unit.months': { en: 'months', beanie: 'months' },
  'recurrence.unit.years': { en: 'years', beanie: 'years' },
  'recurrence.ctx.days': { en: 'On which days?', beanie: 'on which days?' },
  'recurrence.ctx.day': { en: 'On which day?', beanie: 'on which day?' },
  'recurrence.ctx.monthly': {
    en: 'How should it land each month?',
    beanie: 'how should it land each month?',
  },
  'recurrence.weekdayHint': { en: 'Pick one or more', beanie: 'pick one or more' },
  'recurrence.monthly.onDate': { en: 'on the {date}', beanie: 'on the {date}' },
  'recurrence.monthly.onDay': { en: 'on the {ordinal} {day}', beanie: 'on the {ordinal} {day}' },
  'recurrence.monthly.lastDay': { en: 'on the last day', beanie: 'on the last day' },
  'recurrence.monthly.clampHint': {
    en: 'Months without a {date} use the last day.',
    beanie: 'months without a {date} use the last day.',
  },
  'recurrence.monthly.dateSub': { en: 'same date each month', beanie: 'same date each month' },
  'recurrence.monthly.daySub': { en: 'same weekday each month', beanie: 'same weekday each month' },
  'recurrence.startHint': {
    en: 'Based on your start date, {date}',
    beanie: 'based on your start date, {date}',
  },
  'recurrence.a11y.decrease': { en: 'Decrease', beanie: 'decrease' },
  'recurrence.a11y.increase': { en: 'Increase', beanie: 'increase' },
  'recurrence.a11y.unit': { en: 'Unit', beanie: 'unit' },
  'recurrence.ends': { en: 'Ends', beanie: 'ends' },
  'recurrence.ends.never': { en: 'never', beanie: 'never' },
  'recurrence.ends.onDate': { en: 'on a date', beanie: 'on a date' },
  'recurrence.ends.after': { en: 'after a number of times', beanie: 'after a number of times' },
  'recurrence.ends.times': { en: 'times', beanie: 'times' },
  'recurrence.desc.daily': { en: 'every day', beanie: 'every day' },
  'recurrence.desc.everyNDays': { en: 'every {n} days', beanie: 'every {n} days' },
  'recurrence.desc.weeklyOn': { en: 'weekly on {days}', beanie: 'weekly on {days}' },
  'recurrence.desc.everyNWeeksOn': {
    en: 'every {n} weeks on {days}',
    beanie: 'every {n} weeks on {days}',
  },
  'recurrence.desc.monthlyOnDate': {
    en: 'monthly on the {date}',
    beanie: 'monthly on the {date}',
  },
  'recurrence.desc.everyNMonthsOnDate': {
    en: 'every {n} months on the {date}',
    beanie: 'every {n} months on the {date}',
  },
  'recurrence.desc.monthlyOnDay': {
    en: 'monthly on the {ordinal} {day}',
    beanie: 'monthly on the {ordinal} {day}',
  },
  'recurrence.desc.everyNMonthsOnDay': {
    en: 'every {n} months on the {ordinal} {day}',
    beanie: 'every {n} months on the {ordinal} {day}',
  },
  'recurrence.desc.yearlyOn': { en: 'every year on {date}', beanie: 'every year on {date}' },
  'recurrence.desc.everyNYearsOn': {
    en: 'every {n} years on {date}',
    beanie: 'every {n} years on {date}',
  },
  'recurrence.desc.lastDay': { en: 'last day', beanie: 'last day' },
  'recurrence.desc.untilDate': { en: 'until {date}', beanie: 'until {date}' },
  'recurrence.desc.timesN': { en: '{n} times', beanie: '{n} times' },

  // Planner — Fee schedule labels
  'planner.fee.none': { en: 'No fees', beanie: 'no fees' },
  'planner.fee.per_session': { en: 'Each', beanie: 'each' },
  'planner.fee.weekly': { en: 'Weekly', beanie: 'weekly' },
  'planner.fee.monthly': { en: 'Monthly', beanie: 'monthly' },
  'planner.fee.quarterly': { en: 'Quarterly', beanie: 'quarterly' },
  'planner.fee.yearly': { en: 'Yearly', beanie: 'yearly' },
  'planner.fee.custom': { en: 'Custom', beanie: 'custom' },
  'planner.fee.all': { en: 'All', beanie: 'all' },
  'planner.fee.allDisabledHint': {
    en: 'Set an end date to use this option',
    beanie: 'set an end date to use this option',
  },
  'planner.fee.termly': { en: 'Per Term', beanie: 'per term' },
  'planner.fee.calculatedMonthly': { en: 'Monthly Charge', beanie: 'monthly charge' },
  'planner.fee.totalCost': { en: 'Total Cost', beanie: 'total cost' },
  'planner.fee.perSessionBreakdown': { en: 'Per Session', beanie: 'per session' },
  'planner.fee.monthlyCalcHint': {
    en: 'Calculated monthly equivalent based on your fee schedule. Linked transactions always use this monthly amount for consistent tracking.',
    beanie:
      'Calculated monthly equivalent based on your fee schedule. Linked transactions always use this monthly amount for consistent tracking.',
  },
  'planner.fee.scheduleHintIntro': {
    en: 'How often you pay this fee:',
    beanie: 'how often you pay this fee:',
  },
  'planner.fee.scheduleHintPerSession': {
    en: 'Each — charged per session the activity occurs',
    beanie: 'each — charged per session the activity occurs',
  },
  'planner.fee.scheduleHintWeekly': {
    en: 'Weekly — a fixed charge every week',
    beanie: 'weekly — a fixed charge every week',
  },
  'planner.fee.scheduleHintMonthly': {
    en: 'Monthly — a fixed charge every month',
    beanie: 'monthly — a fixed charge every month',
  },
  'planner.fee.scheduleHintQuarterly': {
    en: 'Quarterly — a fixed charge every 3 months',
    beanie: 'quarterly — a fixed charge every 3 months',
  },
  'planner.fee.scheduleHintYearly': {
    en: 'Yearly — a fixed charge once per year',
    beanie: 'yearly — a fixed charge once per year',
  },
  'planner.fee.scheduleHintCustom': {
    en: 'Custom — a set amount every N weeks or months',
    beanie: 'custom — a set amount every N weeks or months',
  },
  'planner.fee.scheduleHintAll': {
    en: 'All Sessions — one upfront payment covering every session from start to end date. Creates a one-time transaction instead of a recurring one',
    beanie:
      'all sessions — one upfront payment covering every session from start to end date. creates a one-time transaction instead of a recurring one',
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
  'planner.field.link': { en: 'Link', beanie: 'link' },
  'planner.field.moreDetails': { en: 'Add more details', beanie: 'add more details' },
  'planner.field.color': { en: 'Highlight Color', beanie: 'highlight color' },
  'planner.field.active': { en: 'Active', beanie: 'active' },

  // Duplicate-activity detection (AI extraction) — confirm prompt when a re-uploaded document
  // matches an activity the family already has.
  'planner.duplicate.title': {
    en: 'Already on your calendar?',
    beanie: 'already on your calendar?',
  },
  'planner.duplicate.message': {
    en: 'Looks like you already have a similar activity. Update it instead of adding a new one?',
    beanie:
      'looks like you already have a similar activity. update it instead of adding a new one?',
  },
  'planner.duplicate.updateExisting': { en: 'Update Existing', beanie: 'update existing' },
  'planner.duplicate.addAnyway': { en: 'Add Anyway', beanie: 'add anyway' },

  // Activity photos — placeholder button + inline gate hint.
  'activities.addPhotos': { en: 'Add Photos', beanie: 'add photos' },
  'activities.photoGate.fillFirst': {
    en: 'Fill in the activity details to attach photos.',
    beanie: 'fill in the activity details to attach photos.',
  },

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
  'app.initError.registryBlocked': {
    en: 'beanies is open in another tab or window, and it is holding up a storage update. Close your other beanies tabs and windows (including the installed app), then reload this page.',
    beanie:
      'beanies is open in another tab or window and holding up a storage update. close your other beanies tabs and windows, then reload this page.',
  },
  'app.initError.stalled': {
    en: 'Setup is taking longer than expected. Reload to try again.',
    beanie: 'setup is taking longer than expected. reload to try again.',
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
    en: 'Figures are hidden for privacy. You can also toggle them anytime by tapping the bean icon in the header.',
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

  // REVIEW-DEMO: store-review demo mode. One contiguous block so retirement is a
  // single delete — see docs/runbooks/native-store-submission.md.
  'reviewDemo.entry': { en: 'App Review Access', beanie: 'app review access' },
  'reviewDemo.modalTitle': { en: 'App Review Access', beanie: 'app review access' },
  'reviewDemo.description': {
    en: 'Enter the access code from the App Review notes to open a demo family. No sign-in needed.',
    beanie:
      'enter the access code from the app review notes to open a demo family. no sign-in needed.',
  },
  'reviewDemo.codeLabel': { en: 'Access Code', beanie: 'access code' },
  'reviewDemo.codePlaceholder': { en: 'Enter your code', beanie: 'enter your code' },
  'reviewDemo.unlock': { en: 'Open Demo', beanie: 'open demo' },
  'reviewDemo.unlocking': { en: 'counting beans...', beanie: 'counting beans...' },
  'reviewDemo.codeRequired': {
    en: 'Please enter the access code',
    beanie: 'please enter the access code',
  },
  'reviewDemo.codeInvalid': {
    en: "That code doesn't look right. Check the App Review notes and try again.",
    beanie: "that code doesn't look right. check the app review notes and try again.",
  },
  'reviewDemo.codeExpired': {
    en: 'This demo code has expired. Please request an updated build.',
    beanie: 'this demo code has expired. please request an updated build.',
  },
  'reviewDemo.cryptoUnavailable': {
    en: "This browser can't verify the code securely. Open the app over https:// and try again.",
    beanie:
      "this browser can't verify the code securely. open the app over https:// and try again.",
  },
  'reviewDemo.bannerTitle': { en: 'Demo Family', beanie: 'demo family' },
  'reviewDemo.bannerMessage': {
    en: 'This is sample data for app review. Nothing here is saved to the cloud, and it disappears when you sign out.',
    beanie:
      'this is sample data for app review. nothing here is saved to the cloud, and it disappears when you sign out.',
  },
  'reviewDemo.seedFailedTitle': { en: "Couldn't open the demo", beanie: "couldn't open the demo" },
  'reviewDemo.seedFailed.sessionExists': {
    en: 'Someone is already signed in on this device. Sign out first, then enter the code again.',
    beanie:
      'someone is already signed in on this device. sign out first, then enter the code again.',
  },
  'reviewDemo.seedFailed.unavailable': {
    en: 'Demo mode is not available in this build. Please request an updated build.',
    beanie: 'demo mode is not available in this build. please request an updated build.',
  },
  'reviewDemo.seedFailed.storage': {
    en: "The demo couldn't set up its temporary storage. Please try again.",
    beanie: "the demo couldn't set up its temporary storage. please try again.",
  },
  'reviewDemo.seedFailed.generic': {
    en: "The demo family couldn't be created. Please try again.",
    beanie: "the demo family couldn't be created. please try again.",
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
    en: "Not on Discord? Leave your details and we'll send you a token when a spot opens.",
    beanie: "not on discord? leave your details and we'll send you a token when a spot opens.",
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
  'inviteGate.notInvitedYet': { en: 'Not invited yet?', beanie: 'not invited yet?' },
  'inviteGate.requestOnDiscord': {
    en: 'Ask for an Invite on Discord',
    beanie: 'ask for an invite on discord',
  },
  'inviteGate.discordHint': {
    en: 'Join the community and ask there. No email needed.',
    beanie: 'join the community and ask there. no email needed.',
  },
  'inviteGate.noDiscord': { en: "Don't use Discord?", beanie: "don't use discord?" },
  'inviteGate.sendMessage': { en: 'Send us a message', beanie: 'send us a message' },
  'inviteGate.askOnDiscordInstead': {
    en: 'Ask on Discord instead',
    beanie: 'ask on discord instead',
  },
  'inviteGate.privacyNote': {
    en: 'Your email goes only to the beanies team to send your invite. Nothing public, nothing stored in the app.',
    beanie:
      'your email goes only to the beanies team to send your invite. nothing public, nothing stored in the app.',
  },
  'inviteGate.confirmedJoinDiscord': { en: 'Join the Discord', beanie: 'join the discord' },

  // Create-pod welcome modal (shown at the start of the Create path, replacing the invite gate).
  // Rendered all-lowercase via CSS — these strings stay standard-cased for CI + screen readers.
  'createWelcome.eyebrow': { en: 'Welcome home', beanie: 'welcome home' },
  'createWelcome.title': {
    en: "Let's grow your family pod",
    beanie: "let's grow your family pod",
  },
  'createWelcome.subtitle': {
    en: "Three quick steps to your private family space. Here's what's ahead.",
    beanie: "three quick steps to your private family space. here's what's ahead.",
  },
  'createWelcome.step1Title': { en: 'About you', beanie: 'about you' },
  'createWelcome.step1Body': {
    en: 'Your name and a couple of details to set up your space.',
    beanie: 'your name and a couple of details to set up your space.',
  },
  'createWelcome.step2Title': { en: 'Your Family Data File', beanie: 'your family data file' },
  'createWelcome.step2Body': {
    en: "We create your private, encrypted file — the safe home for your family's data.",
    beanie: "we create your private, encrypted file — the safe home for your family's data.",
  },
  'createWelcome.step3Title': { en: 'Your family', beanie: 'your family' },
  'createWelcome.step3Body': {
    en: "Add your partner or little beanies whenever you're ready.",
    beanie: "add your partner or little beanies whenever you're ready.",
  },
  'createWelcome.safeText': {
    en: 'Your data is encrypted on your device and stored in a file only you can open — we never see it.',
    beanie:
      'your data is encrypted on your device and stored in a file only you can open — we never see it.',
  },
  'createWelcome.safeLink': { en: 'How your data stays safe', beanie: 'how your data stays safe' },
  'createWelcome.cta': { en: 'Plant my bean pod', beanie: 'plant my bean pod' },
  'createWelcome.ctaHint': {
    en: 'You can change anything later.',
    beanie: 'you can change anything later.',
  },

  // Create-pod "how did you hear about us?" survey (shown after the password step, before finalize).
  // Rendered all-lowercase via CSS. The Slack attribution label is a separate stable-English
  // constant in CreatePodSurvey.vue (HEARD_OPTIONS.slackLabel) — NOT these display strings.
  'createSurvey.eyebrow': { en: 'One last thing', beanie: 'one last thing' },
  'createSurvey.title': { en: 'How did you hear about us?', beanie: 'how did you hear about us?' },
  'createSurvey.subtitle': {
    en: 'It helps us reach more families like yours. Totally optional.',
    beanie: 'it helps us reach more families like yours. totally optional.',
  },
  'createSurvey.optReddit': { en: 'Reddit', beanie: 'reddit' },
  'createSurvey.optProductHunt': { en: 'Product Hunt', beanie: 'product hunt' },
  'createSurvey.optSubstack': { en: 'Substack / blog', beanie: 'substack / blog' },
  'createSurvey.optGoogle': { en: 'Google search', beanie: 'google search' },
  'createSurvey.optAppStore': { en: 'App store', beanie: 'app store' },
  'createSurvey.optAi': { en: 'ChatGPT / AI search', beanie: 'chatgpt / ai search' },
  'createSurvey.optFriend': { en: 'A friend', beanie: 'a friend' },
  'createSurvey.optOther': { en: 'Somewhere else', beanie: 'somewhere else' },
  'createSurvey.otherPlaceholder': { en: 'Tell us where…', beanie: 'tell us where…' },
  'createSurvey.cta': { en: 'Finish setup', beanie: 'finish setup' },

  // Linked asset accounts
  'accounts.linkedTo': { en: 'Linked to {asset}', beanie: 'linked to {asset}' },
  'accounts.editOnAssetsPage': {
    en: 'This loan is linked to an asset. Edit it on the Assets page.',
    beanie: 'this loan is linked to an asset. edit it on the assets page.',
  },

  // Onboarding wizard
  'onboarding.welcomePrefix': { en: 'Welcome to ', beanie: 'welcome to ' },
  'onboarding.welcomeBrand': { en: 'beanies' },
  'onboarding.currencyQuestion': {
    en: "What's your family's base currency?",
    beanie: "what's your family's base currency?",
  },
  'onboarding.countryQuestion': {
    en: 'Where does your family live?',
    beanie: 'where does your family live?',
  },
  'onboarding.countryPlaceholder': {
    en: 'Select your country (optional)',
    beanie: 'select your country (optional)',
  },
  'onboarding.welcomeTagline': {
    en: "let's set up your bean pod",
    beanie: "let's set up your bean pod",
  },
  'onboarding.welcomeCta': {
    en: "Let's Get This Pod Rolling \u{1F96B}",
    beanie: "let's get this pod rolling \u{1F96B}",
  },
  'onboarding.welcomeSubtitle': {
    en: 'a few quick steps \u00B7 takes about 2 minutes',
    beanie: 'a few quick steps \u00B7 takes about 2 minutes',
  },

  // Generic remove action (used by OnboardingAddedRow's delete button)
  'onboarding.remove': { en: 'Remove', beanie: 'remove' },

  // Account step
  'onboarding.account.titlePrefix': { en: 'Add your first ', beanie: 'add your first ' },
  'onboarding.account.titleHighlight': { en: 'account', beanie: 'account' },
  // Privacy reassurance shown before the first financial data entry.
  'onboarding.privacy.reassure': {
    en: 'Your data stays with you.',
    beanie: 'your data stays with you.',
  },
  'onboarding.privacy.guaranteed': { en: 'Privacy, guaranteed.', beanie: 'privacy, guaranteed.' },
  'onboarding.privacy.how': { en: 'How?', beanie: 'how?' },
  'onboarding.privacy.proof1': {
    en: 'your data lives in a file only you hold',
    beanie: 'your data lives in a file only you hold',
  },
  'onboarding.privacy.proof2': {
    en: "even in the cloud, it's locked to your key alone",
    beanie: "even in the cloud, it's locked to your key alone",
  },
  'onboarding.privacy.proof3': { en: "we can't read it, ever", beanie: "we can't read it, ever" },
  'onboarding.privacy.learnMore': { en: 'Learn how it works →', beanie: 'learn how it works →' },
  'onboarding.bank': { en: 'Bank', beanie: 'bank' },
  'onboarding.bankPlaceholder': { en: 'Select bank...', beanie: 'select bank...' },
  'onboarding.balance': { en: 'Balance', beanie: 'balance' },
  'onboarding.accountType': { en: 'Type', beanie: 'type' },
  'onboarding.accountType.checking': { en: 'Checking', beanie: 'checking' },
  'onboarding.accountType.savings': { en: 'Savings', beanie: 'savings' },
  'onboarding.accountType.investment': { en: 'Investment', beanie: 'investment' },
  'onboarding.addAccount': { en: 'Add Account', beanie: 'add account' },
  'onboarding.addAnother': { en: '+ Add another', beanie: '+ add another' },

  // Savings step
  'onboarding.savings.titlePrefix': { en: 'Set a ', beanie: 'set a ' },
  'onboarding.savings.titleHighlight': { en: 'savings goal', beanie: 'savings goal' },
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
  'onboarding.savingsMode.percent': { en: '% of Income', beanie: '% of income' },
  'onboarding.savingsMode.fixed': { en: 'Fixed $', beanie: 'fixed $' },

  // Recurring step
  'onboarding.recurring.titlePrefix': { en: 'Add a regular ', beanie: 'add a regular ' },
  'onboarding.recurring.titleHighlight': { en: 'transaction', beanie: 'transaction' },
  'onboarding.summaryIncome': { en: 'Income', beanie: 'income' },
  'onboarding.summaryFixedCosts': { en: 'Fixed costs', beanie: 'fixed costs' },
  'onboarding.addRecurring': { en: 'Add Regular Transaction', beanie: 'add regular transaction' },
  // Activity & recurring-transaction preset chip labels (activityPresets.ts)
  'activityPreset.piano': { en: 'Piano', beanie: 'piano' },
  'activityPreset.tennis': { en: 'Tennis', beanie: 'tennis' },
  'activityPreset.art': { en: 'Art', beanie: 'art' },
  'activityPreset.dance': { en: 'Dance', beanie: 'dance' },
  'activityPreset.tutoring': { en: 'Tutoring', beanie: 'tutoring' },
  'activityPreset.birthday': { en: 'Birthday', beanie: 'birthday' },
  'activityPreset.afterSchool': { en: 'After School', beanie: 'after school' },
  'activityPreset.other': { en: 'Other', beanie: 'other' },
  'activityPreset.salary': { en: 'Salary', beanie: 'salary' },
  'activityPreset.sideIncome': { en: 'Side Income', beanie: 'side income' },
  'activityPreset.rent': { en: 'Rent', beanie: 'rent' },
  'activityPreset.car': { en: 'Car', beanie: 'car' },
  'activityPreset.utilities': { en: 'Utilities', beanie: 'utilities' },
  'activityPreset.phone': { en: 'Phone', beanie: 'phone' },
  'activityPreset.insurance': { en: 'Insurance', beanie: 'insurance' },
  'onboarding.transactionNamePlaceholder': {
    en: 'e.g. Monthly Rent',
    beanie: 'e.g. monthly rent',
  },
  'onboarding.amount': { en: 'Amount', beanie: 'amount' },
  'onboarding.frequency': { en: 'Frequency', beanie: 'frequency' },
  'onboarding.frequency.daily': { en: 'Daily', beanie: 'daily' },
  'onboarding.frequency.monthly': { en: 'Monthly', beanie: 'monthly' },
  'onboarding.frequency.yearly': { en: 'Yearly', beanie: 'yearly' },

  // Activity step
  'onboarding.activity.titlePrefix': { en: 'Add an ', beanie: 'add an ' },
  'onboarding.activity.titleHighlight': { en: 'activity', beanie: 'activity' },
  'onboarding.assignee': { en: 'Who', beanie: 'who' },
  'onboarding.days': { en: 'Days', beanie: 'days' },
  'onboarding.startTime': { en: 'Start Time', beanie: 'start time' },
  'onboarding.endTime': { en: 'End Time', beanie: 'end time' },
  'onboarding.costPerMonth': { en: 'Cost / Month', beanie: 'cost / month' },
  'onboarding.addActivity': { en: 'Add Activity', beanie: 'add activity' },

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

  // Step 6 invite panel
  'onboarding.invite.title': { en: 'Invite the rest?', beanie: 'invite the rest?' },
  'onboarding.invite.optional': { en: 'Optional', beanie: 'optional' },
  'onboarding.invite.lede': {
    en: "Each member gets their own personalised invite link. Tap Send and we'll walk you through sharing it via QR code, text, or email.",
    beanie:
      "each beanie gets their own personalised invite link. tap send and we'll walk you through sharing it via qr code, text, or email.",
  },
  'onboarding.invite.send': { en: 'Send \u2192', beanie: 'send \u2192' },
  'onboarding.invite.noEmail': {
    en: 'no email yet \u2014 add one on the next screen',
    beanie: 'no email yet \u2014 add one on the next screen',
  },
  'onboarding.invite.reminder': {
    en: '\u2728 you can always invite anytime later from My Pod',
    beanie: '\u2728 you can always invite anytime later from my pod',
  },

  // Error toasts (auto-routed via showToast -> errorReporter -> Slack)
  'onboarding.errors.addAccountFailed': {
    en: "Couldn't add that account. Please try again \u2014 support's been notified.",
    beanie: "couldn't add that account. please try again \u2014 support's been notified.",
  },
  'onboarding.errors.addRecurringFailed': {
    en: "Couldn't add that recurring transaction. Please try again \u2014 support's been notified.",
    beanie:
      "couldn't add that recurring transaction. please try again \u2014 support's been notified.",
  },
  'onboarding.errors.addActivityFailed': {
    en: "Couldn't add that activity. Please try again \u2014 support's been notified.",
    beanie: "couldn't add that activity. please try again \u2014 support's been notified.",
  },

  // Navigation
  'onboarding.back': { en: '\u2190 Back', beanie: '\u2190 back' },
  'onboarding.skip': { en: 'Skip for now', beanie: 'skip for now' },
  'onboarding.skipAddLater': {
    en: 'Skip \u2014 add later',
    beanie: 'skip \u2014 add later',
  },
  'onboarding.next': { en: 'Next \u2192', beanie: 'next \u2192' },

  // Settings
  'onboarding.restartOnboarding': {
    en: 'Restart Onboarding',
    beanie: 'restart onboarding',
  },
  'onboarding.restartOnboardingDescription': {
    en: 'Walk through the setup wizard again to add accounts, transactions, and activities.',
    beanie: 'walk through the setup wizard again to add accounts, transactions, and activities.',
  },
  'onboarding.restartButton': { en: 'Restart', beanie: 'restart' },
  // Beanie tip of the day
  'tips.label': { en: 'Beanie Tip of the Day', beanie: 'beanie tip of the day' },
  'tips.gotIt': { en: 'Got It', beanie: 'got it' },
  'tips.tryIt': { en: 'Try It', beanie: 'try it' },
  'tips.dontShowTips': { en: "Don't Show Tips", beanie: "don't show tips" },
  'tips.mutedConfirm': {
    en: 'Tips muted. You can re-enable them in Settings.',
    beanie: 'tips muted. you can re-enable them in settings.',
  },
  'tips.unavailable': {
    en: 'This tip is no longer available.',
    beanie: 'this tip is no longer available.',
  },

  // What's New modal
  'whatsNew.title': { en: "What's New", beanie: "what's new" },
  'whatsNew.gotItThanks': { en: 'Got It, Thanks', beanie: 'got it, thanks' },
  'whatsNew.seeAll': { en: 'See All Release Notes', beanie: 'see all release notes' },
  'whatsNew.alsoFixed': { en: 'Also Fixed', beanie: 'also fixed' },
  'whatsNew.tryIt': { en: 'Try It', beanie: 'try it' },
  'whatsNew.updateCount': { en: '{n} updates', beanie: '{n} updates' },

  // In-app notifications (the header bell + drawer)
  'notifications.title': { en: 'Notifications', beanie: 'notifications' },
  'notifications.empty': { en: "You're all caught up", beanie: "you're all caught up" },
  'notifications.emptyHint': {
    en: "We'll let you know when something needs you.",
    beanie: "we'll let you know when something needs you.",
  },
  'notifications.markAllRead': { en: 'Mark all read', beanie: 'mark all read' },
  'notifications.markUnread': { en: 'Mark unread', beanie: 'mark unread' },
  'notifications.open': { en: 'Open', beanie: 'open' },
  'notifications.back': { en: 'Back', beanie: 'back' },
  'notifications.unread': { en: 'unread', beanie: 'unread' },
  'notifications.kindTodoDue': { en: 'Coming due', beanie: 'coming due' },
  'notifications.kindTodoDueOverdue': { en: 'Overdue', beanie: 'overdue' },
  'notifications.kindTodoAssigned': { en: 'Assigned to you', beanie: 'assigned to you' },
  'notifications.kindActivityReminder': { en: 'Coming up', beanie: 'coming up' },
  'notifications.kindListCompleted': { en: 'List completed', beanie: 'list completed' },
  'notifications.kindCalendarReconnect': { en: 'Calendar sync', beanie: 'calendar sync' },
  'notifications.calendarReconnectSummary': {
    en: 'Reconnect to resume syncing',
    beanie: 'reconnect to resume syncing',
  },
  'notifications.kindWhatsNew': { en: "What's new", beanie: "what's new" },
  'notifications.kindAnnouncement': { en: 'Announcement', beanie: 'announcement' },
  'notifications.kindTip': { en: "Today's tip", beanie: "today's tip" },
  'notifications.due': { en: 'Due', beanie: 'due' },
  'notifications.yourTask': { en: 'Your task', beanie: 'your task' },
  'notifications.assignedByYou': {
    en: '{name} assigned this to you',
    beanie: '{name} assigned this to you',
  },
  'notifications.youDropoff': { en: "you're on drop-off", beanie: "you're on drop-off" },
  'notifications.youPickup': { en: "you're on pick-up", beanie: "you're on pick-up" },

  // Reminders (#55) — OS local-notification settings + notification copy
  'reminders.title': { en: 'Reminders', beanie: 'reminders' },
  'reminders.description': {
    en: 'A heads-up before activities, travel and to-dos — so you leave and prepare on time.',
    beanie: 'a heads-up before activities, travel and to-dos — so you leave and prepare on time.',
  },
  'reminders.masterToggle': { en: 'Reminders on this device', beanie: 'reminders on this device' },
  // #40: Helpful Hints settings — master (family-synced) + per-device per-type.
  'settings.helpfulHints.label': { en: 'Helpful Hints', beanie: 'helpful hints' },
  'settings.helpfulHints.title': { en: 'Helpful Hints', beanie: 'helpful hints' },
  'settings.helpfulHints.hint': {
    en: 'Suggest prep to-dos before birthdays, parties, and trips, for the whole family.',
    beanie: 'suggest prep to-dos before birthdays, parties, and trips, for the whole family.',
  },
  'settings.helpfulHints.perDeviceHint': {
    en: 'Choose which hints notify you on this device. Turning one off only silences your notifications — everyone still sees the to-do.',
    beanie:
      'choose which hints notify you on this device. turning one off only silences your notifications — everyone still sees the to-do.',
  },
  'settings.helpfulHints.type.birthdayPresent': {
    en: 'Family birthdays',
    beanie: 'family birthdays',
  },
  'settings.helpfulHints.type.birthdayPartyGift': {
    en: 'Party invitations',
    beanie: 'party invitations',
  },
  'settings.helpfulHints.type.celebrationGift': {
    en: 'Celebration gifts',
    beanie: 'celebration gifts',
  },
  'settings.helpfulHints.type.anniversaryPlan': { en: 'Anniversaries', beanie: 'anniversaries' },
  'settings.helpfulHints.type.tripPacking': { en: 'Trip packing', beanie: 'trip packing' },
  'settings.helpfulHints.type.tripDocuments': {
    en: 'Travel documents',
    beanie: 'travel documents',
  },
  // #40: per-type descriptions (shown under each hint in Settings).
  'settings.helpfulHints.desc.birthdayPresent': {
    en: 'Plan a present or party before someone in your own family has a birthday.',
    beanie: 'plan a present or party before someone in your own family has a birthday.',
  },
  'settings.helpfulHints.desc.birthdayPartyGift': {
    en: 'Bring a present before a birthday party on your calendar (e.g. one your child is invited to).',
    beanie:
      'bring a present before a birthday party on your calendar (e.g. one your child is invited to).',
  },
  'settings.helpfulHints.desc.celebrationGift': {
    en: 'A reminder to bring a gift or card before a wedding, shower, or other celebration.',
    beanie: 'a reminder to bring a gift or card before a wedding, shower, or other celebration.',
  },
  'settings.helpfulHints.desc.anniversaryPlan': {
    en: 'A reminder to plan something before an anniversary.',
    beanie: 'a reminder to plan something before an anniversary.',
  },
  'settings.helpfulHints.desc.tripPacking': {
    en: 'A reminder to start packing before a trip.',
    beanie: 'a reminder to start packing before a trip.',
  },
  'settings.helpfulHints.desc.tripDocuments': {
    en: 'A reminder to check passports, visas, and travel insurance before a trip.',
    beanie: 'a reminder to check passports, visas, and travel insurance before a trip.',
  },
  // #40: per-type lead-time control labels.
  'settings.helpfulHints.howFarAhead': { en: 'How far ahead', beanie: 'how far ahead' },
  'settings.helpfulHints.notifyOnDevice': {
    en: 'Notify me on this device',
    beanie: 'notify me on this device',
  },
  'settings.helpfulHints.leadDays.one': { en: '{n} day before', beanie: '{n} day before' },
  'settings.helpfulHints.leadDays.other': { en: '{n} days before', beanie: '{n} days before' },
  'reminders.masterToggleHint': {
    en: 'Get a nudge before things start. Reminders come from this device, so this switch only affects the phone or computer you’re on.',
    beanie:
      'get a nudge before things start. reminders come from this device, so this switch only affects the phone or computer you’re on.',
  },
  'reminders.howMuchNotice': { en: 'How much notice?', beanie: 'how much notice?' },
  'reminders.activities': { en: 'Activities', beanie: 'activities' },
  'reminders.activitiesHint': {
    en: 'The default for new activities — you can change it on any one of them',
    beanie: 'the default for new activities — you can change it on any one of them',
  },
  'reminders.flights': { en: 'Flights', beanie: 'flights' },
  'reminders.cruises': { en: 'Cruises', beanie: 'cruises' },
  'reminders.trains': { en: 'Trains', beanie: 'trains' },
  'reminders.ferries': { en: 'Ferries', beanie: 'ferries' },
  'reminders.timedTodos': { en: 'Timed to-dos', beanie: 'timed to-dos' },
  'reminders.timedTodosHint': {
    en: 'To-dos that have a time set.',
    beanie: 'to-dos that have a time set.',
  },
  'reminders.permissionNudge': {
    en: 'Turn on notifications in your device settings to get these. Your in-app briefing still shows everything either way.',
    beanie:
      'turn on notifications in your device settings to get these. your in-app briefing still shows everything either way.',
  },
  'reminders.openDeviceSettings': { en: 'Open device settings', beanie: 'open device settings' },
  // Lead-time option labels
  'reminders.lead.atTime': { en: 'At the time', beanie: 'at the time' },
  'reminders.lead.dayBefore': { en: 'The day before', beanie: 'the day before' },
  'reminders.lead.hours': { en: '{n} hours before', beanie: '{n} hours before' },
  'reminders.lead.hourOne': { en: '{n} hour before', beanie: '{n} hour before' },
  'reminders.lead.minutes': { en: '{n} minutes before', beanie: '{n} minutes before' },
  'reminders.lead.minuteOne': { en: '{n} minute before', beanie: '{n} minute before' },
  // Travel-plan creation hint
  'reminders.travelHint': {
    en: 'We’ll remind you {lead} this trip.',
    beanie: 'we’ll remind you {lead} this trip.',
  },
  'reminders.travelHintLink': { en: 'Change reminder timing', beanie: 'change reminder timing' },
  // OS notification copy (BODY only — filled via fillTemplate). The notification
  // TITLE is the item's own name, passed straight through. It deliberately has
  // no key: a value that is nothing but `{title}` is a translation-pipeline
  // hazard, and the zh auto-translation duly replaced the placeholder with the
  // word "标题", destroying every notification title. `updateTranslations.mjs`
  // now rejects placeholder-losing translations, but the real fix is not to
  // round-trip a bare placeholder through t() at all.
  'reminders.activityBodyDropoff': {
    en: 'Time to drop off — {who}',
    beanie: 'time to drop off — {who}',
  },
  'reminders.activityBodyPickup': {
    en: 'Time to pick up — {who}',
    beanie: 'time to pick up — {who}',
  },
  'reminders.activityBodyWho': { en: 'Coming up · {who}', beanie: 'coming up · {who}' },
  'reminders.activityBody': { en: 'Coming up soon', beanie: 'coming up soon' },
  // Shown once per session if the OS refuses to arm the reminders. States the
  // fallback truthfully — the in-app bell is unaffected by an OS failure.
  'reminders.scheduleFailed': {
    en: "We couldn't set your device reminders",
    beanie: "we couldn't set your device reminders",
  },
  'reminders.scheduleFailedHelp': {
    en: "Your in-app reminders still show everything. We'll try again automatically.",
    beanie: "your in-app reminders still show everything. we'll try again automatically.",
  },
  // Exact-alarm recovery (Android 12/12L, where the permission is revocable).
  'reminders.exactAlarmHelp': {
    en: 'Reminders may arrive late. Allow exact alarms so they land on time.',
    beanie: 'reminders may arrive late. allow exact alarms so they land on time.',
  },
  'reminders.exactAlarmManual': {
    en: 'Open Settings → Apps → beanies.family → Alarms & reminders',
    beanie: 'open settings → apps → beanies.family → alarms & reminders',
  },
  'reminders.todoBody': { en: 'Due at {time}', beanie: 'due at {time}' },
  'reminders.todoBodyAllDay': { en: 'Due today', beanie: 'due today' },
  'reminders.travelBody': { en: 'Departs at {time}', beanie: 'departs at {time}' },

  // Navigation
  'nav.beanstalk': { en: 'Beanie Beanstalk', beanie: 'beanie beanstalk' },
  'nav.help': { en: 'Help', beanie: 'help' },

  // ── Vacation Planner ──────────────────────────────────────────────────────

  // Toggle & entry
  'vacation.planningATrip': {
    en: 'Add a Travel Plan!',
    beanie: 'add a travel plan!',
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
    beanie: 'where are the beanies going?',
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
  'vacation.field.terminal': { en: 'Terminal', beanie: 'terminal' },
  'vacation.field.terminalPlaceholder': {
    en: 'e.g. Terminal 1',
    beanie: 'e.g. terminal 1',
  },
  'vacation.field.travellers': { en: "Who's Travelling", beanie: "who's travelling" },
  'vacation.field.travelling': { en: 'Travelling', beanie: 'travelling' },
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
  'vacation.ideas.markPlanned': { en: 'mark as planned', beanie: 'mark as planned' },
  'vacation.ideas.plannedPill': { en: '✓ planned', beanie: '✓ planned' },
  'vacation.ideas.markSkipped': { en: 'skip for this trip', beanie: 'skip for this trip' },
  'vacation.ideas.skippedPill': { en: '✗ skipped', beanie: '✗ skipped' },
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
  'vacation.celebration.allBeans': { en: 'All Beans!', beanie: 'all beanies!' },
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
  'vacation.happeningNow': { en: 'Happening Now', beanie: 'happening now' },
  'vacation.startsToday': { en: 'Starts today!', beanie: 'starts today!' },
  'vacation.dayOfTrip': { en: 'Day {n} of {total}', beanie: 'day {n} of {total}' },
  'vacation.inDays': { en: '{n}d', beanie: '{n}d' },
  'vacation.onNow': { en: 'now', beanie: 'now' },
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

  // Ideas empty state & collaboration hint
  'vacation.ideas.empty': {
    en: 'No ideas yet \u2014 add your first one above!',
    beanie: 'no ideas yet \u2014 add your first one above!',
  },
  'vacation.ideas.collabHint': {
    en: 'More ideas can be added anytime \u2014 all family members can suggest and vote on ideas together!',
    beanie:
      'more ideas can be added anytime \u2014 all beanies can suggest and vote on ideas together!',
  },

  // Notes placeholder
  'vacation.field.notesPlaceholder': { en: 'Add notes...', beanie: 'add notes...' },

  // Common vacation fields
  'vacation.field.description': { en: 'Description', beanie: 'description' },
  'vacation.field.location': { en: 'Location', beanie: 'location' },
  'vacation.field.link': { en: 'Link', beanie: 'link' },
  'vacation.field.notes': { en: 'Notes', beanie: 'notes' },
  'vacation.field.documents': { en: 'Booking Documents', beanie: 'booking documents' },
  'vacation.documentsCount': { en: '{n} attached', beanie: '{n} attached' },
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
    en: 'Where are the beans headed next?',
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
  'travel.openIdeas': { en: 'open ideas', beanie: 'open ideas' },
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
  'travel.hint.accommodationOverlap': {
    en: 'Overlaps with "{title}" - double-booked nights?',
    beanie: 'overlaps with "{title}" - double-booked nights?',
  },
  'travel.hint.accommodationDuringCruise': {
    en: 'Overlaps with "{title}" - cruise includes accommodation',
    beanie: 'overlaps with "{title}" - cruise includes accommodation',
  },
  'travel.hint.cruiseHasAccommodation': {
    en: '"{title}" booked during cruise - cruise includes accommodation',
    beanie: '"{title}" booked during cruise - cruise includes accommodation',
  },
  'travel.hint.flightDuringCruise': {
    en: 'Scheduled during "{title}" - is this intentional?',
    beanie: 'scheduled during "{title}" - is this intentional?',
  },
  'travel.hint.cruiseHasFlight': {
    en: '"{title}" scheduled during cruise',
    beanie: '"{title}" scheduled during cruise',
  },
  'travel.hint.nightFlightEarly': {
    en: "Departs at {time} - just after midnight. Double-check the date to make sure you're travelling on the right day.",
    beanie:
      "departs at {time} - just after midnight. double-check the date to make sure you're travelling on the right day.",
  },
  'travel.hint.nightFlightLate': {
    en: 'Departs at {time} - just before midnight. Make sure you have the correct departure date and allow extra time.',
    beanie:
      'departs at {time} - just before midnight. make sure you have the correct departure date and allow extra time.',
  },
  'travel.hint.beforeTripStart': {
    en: 'Scheduled before trip start ({date})',
    beanie: 'scheduled before trip start ({date})',
  },
  'travel.hint.afterTripEnd': {
    en: 'Scheduled after trip end ({date})',
    beanie: 'scheduled after trip end ({date})',
  },
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

  // Trip dates input (wizard Step 1 + summary-page edit — ADR-023)
  'travel.dates.startLabel': { en: 'Start Date', beanie: 'start date' },
  'travel.dates.endLabel': { en: 'End Date', beanie: 'end date' },
  'travel.dates.quickAdd': { en: 'Quick set:', beanie: 'quick set:' },
  'travel.dates.chip3days': { en: '+3 days', beanie: '+3 days' },
  'travel.dates.chip1week': { en: '+1 week', beanie: '+1 week' },
  'travel.dates.chip2weeks': { en: '+2 weeks', beanie: '+2 weeks' },
  'travel.dates.dayLabelSingular': { en: 'day', beanie: 'day' },
  'travel.dates.dayLabelPlural': { en: 'days', beanie: 'days' },
  'travel.dates.errorEndBeforeStart': {
    en: 'End date must be on or after start date',
    beanie: 'end date must be on or after start date',
  },
  'travel.dates.errorMissing': {
    en: 'Please set both a start and end date',
    beanie: 'please set both a start and end date',
  },
  'travel.dates.notSet': { en: 'Dates not set', beanie: 'dates not set' },
  'travel.dates.edit': { en: 'Edit dates', beanie: 'edit dates' },
  'travel.outOfRange.beforeStart': {
    en: 'Scheduled before trip start',
    beanie: 'scheduled before trip start',
  },
  'travel.outOfRange.afterEnd': {
    en: 'Scheduled after trip end',
    beanie: 'scheduled after trip end',
  },
  'travel.outOfRange.bannerTitle': {
    en: 'Some items are outside your trip dates',
    beanie: 'some items are outside your trip dates',
  },
  'travel.outOfRange.bannerAction': { en: 'Show me', beanie: 'show me' },
  'vacation.bookingDetails': { en: 'Booking details', beanie: 'booking details' },
  'vacation.tripShape': { en: 'Trip shape', beanie: 'trip shape' },
  'vacation.essentials': { en: 'Essentials', beanie: 'essentials' },
  'action.showMore': { en: 'Show more', beanie: 'show more' },
  'action.showAllN': { en: 'Show all {count}', beanie: 'show all {count}' },
  'action.showLess': { en: 'Show less', beanie: 'show less' },
  'travel.today.label': { en: 'Today', beanie: 'today' },
  'travel.today.dayPrefix': { en: 'Day', beanie: 'day' },
  'travel.today.of': { en: 'of', beanie: 'of' },
  'travel.today.freeDay': { en: 'free and easy', beanie: 'free and easy — go frolic' },
  'travel.today.tripEnded': {
    en: 'This trip has wrapped up',
    beanie: 'this trip has wrapped up — welcome home',
  },
  // timeline phase markers (past "done" tag + ongoing-span "staying now" chip)
  'travel.timeline.done': { en: 'Done', beanie: 'done' },
  'travel.timeline.stayingNow': { en: 'Staying now', beanie: 'staying now' },
  'travel.timeline.until': { en: 'until {date}', beanie: 'until {date}' },
  'travel.timeline.nextDay': { en: '+1 day', beanie: '+1 day' },

  // PWA re-install notice (shown to users bounced in from the pre-cutover PWA shell)
  'pwaReinstall.title': { en: 'Quick Re-install Needed', beanie: 'quick re-install needed' },
  'pwaReinstall.reassuranceTitle': { en: 'Your beans are safe', beanie: 'your beans are safe' },
  'pwaReinstall.reassurance': {
    en: 'Your family file, Google Drive sync, and password are all untouched. Nothing has been lost.',
    beanie:
      'your family file, Google Drive sync, and password are all untouched. nothing has been lost.',
  },
  'pwaReinstall.context': {
    en: 'A one-time backend update means the home-screen icon you installed is pointing to our old address. To get the full app experience back \u2014 offline support, quick launch, native feel \u2014 you\u2019ll want to re-install from our new home at app.beanies.family.',
    beanie:
      'a one-time backend update means the home-screen icon you installed is pointing to our old address. to get the full app experience back \u2014 offline support, quick launch, native feel \u2014 you\u2019ll want to re-install from our new home at app.beanies.family.',
  },
  'pwaReinstall.stepsHeading': { en: 'To re-install', beanie: 'to re-install' },
  'pwaReinstall.iosStep1': {
    en: 'Long-press the old <strong>beanies.family</strong> icon on your home screen and tap <strong>Remove App</strong> \u2192 <strong>Delete from Home Screen</strong>',
    beanie:
      'long-press the old <strong>beanies.family</strong> icon on your home screen and tap <strong>remove app</strong> \u2192 <strong>delete from home screen</strong>',
  },
  'pwaReinstall.iosStep2': {
    en: 'Open <strong>Safari</strong> and visit <strong>app.beanies.family</strong>',
    beanie: 'open <strong>safari</strong> and visit <strong>app.beanies.family</strong>',
  },
  'pwaReinstall.iosStep3': {
    en: 'Tap the <strong>Share</strong> button \u2192 <strong>Add to Home Screen</strong>',
    beanie: 'tap the <strong>share</strong> button \u2192 <strong>add to home screen</strong>',
  },
  'pwaReinstall.iosStep4': {
    en: 'Open the new icon and sign in \u2014 your family data will sync back from the cloud',
    beanie: 'open the new icon and sign in \u2014 your family data will sync back from the cloud',
  },
  'pwaReinstall.androidStep1': {
    en: 'Long-press the old <strong>beanies.family</strong> icon and drag it to <strong>Uninstall</strong> (or tap <strong>Remove</strong>)',
    beanie:
      'long-press the old <strong>beanies.family</strong> icon and drag it to <strong>uninstall</strong> (or tap <strong>remove</strong>)',
  },
  'pwaReinstall.androidStep2': {
    en: 'Open <strong>Chrome</strong> and visit <strong>app.beanies.family</strong>',
    beanie: 'open <strong>chrome</strong> and visit <strong>app.beanies.family</strong>',
  },
  'pwaReinstall.androidStep3': {
    en: 'Tap the three-dot menu \u2192 <strong>Install app</strong> (or <strong>Add to Home screen</strong>)',
    beanie:
      'tap the three-dot menu \u2192 <strong>install app</strong> (or <strong>add to home screen</strong>)',
  },
  'pwaReinstall.androidStep4': {
    en: 'Open the new icon and sign in \u2014 your family data will sync back from the cloud',
    beanie: 'open the new icon and sign in \u2014 your family data will sync back from the cloud',
  },
  'pwaReinstall.desktopStep1': {
    en: 'Remove the old app: in Chrome, visit <strong>chrome://apps</strong>, right-click <strong>beanies.family</strong> \u2192 <strong>Remove from Chrome</strong>',
    beanie:
      'remove the old app: in chrome, visit <strong>chrome://apps</strong>, right-click <strong>beanies.family</strong> \u2192 <strong>remove from chrome</strong>',
  },
  'pwaReinstall.desktopStep2': {
    en: 'Visit <strong>app.beanies.family</strong> in your browser',
    beanie: 'visit <strong>app.beanies.family</strong> in your browser',
  },
  'pwaReinstall.desktopStep3': {
    en: 'Click the install icon in the address bar (or three-dot menu \u2192 <strong>Install</strong>)',
    beanie:
      'click the install icon in the address bar (or three-dot menu \u2192 <strong>install</strong>)',
  },
  'pwaReinstall.desktopStep4': {
    en: 'Sign in \u2014 your family data will sync back from the cloud',
    beanie: 'sign in \u2014 your family data will sync back from the cloud',
  },
  'pwaReinstall.screenshotAlt': {
    en: 'Install instructions screenshot for your platform',
    beanie: 'install instructions screenshot for your platform',
  },
  'pwaReinstall.oneTimeNote': {
    en: 'This is a one-time change \u2014 we won\u2019t do this regularly, promise.',
    beanie: 'this is a one-time change \u2014 we won\u2019t do this regularly, promise.',
  },
  'pwaReinstall.seeFullGuide': {
    en: 'See the full install guide \u2192',
    beanie: 'see the full install guide \u2192',
  },
  'pwaReinstall.dismiss': { en: 'Got It, Thanks', beanie: 'got it, thanks' },

  // Photo attachments — reusable across activities, family members, todos, etc.
  'photos.addPhoto': { en: 'Add Photo', beanie: 'add photo' },
  'photos.takePhoto': { en: 'Take Photo', beanie: 'take photo' },
  'photos.fromLibrary': { en: 'From Library', beanie: 'from library' },
  'photos.avatar.upload': { en: 'Upload Photo', beanie: 'upload photo' },
  'photos.avatar.replace': { en: 'Change Photo', beanie: 'change photo' },
  'photos.avatar.remove': { en: 'Remove Photo', beanie: 'remove photo' },
  'photos.avatar.viewLarger': { en: 'View larger', beanie: 'view larger' },
  'photos.avatar.uploading': { en: 'Uploading photo\u2026', beanie: 'counting beans\u2026' },
  'photos.avatar.uploadFailed': {
    en: "Couldn't upload photo. Check your connection and try again.",
    beanie: "couldn't upload photo — try again",
  },
  'photos.addPhotos': { en: 'Add Photos', beanie: 'add photos' },
  'photos.attachAfterSave': {
    en: 'Save first, then add photos when editing.',
    beanie: 'save first, then add photos when editing.',
  },
  'photos.noPhotos': { en: 'No photos yet', beanie: 'no photos yet' },
  'photos.uploading': { en: 'Uploading…', beanie: 'counting beans\u2026' },
  'photos.uploadFailed': {
    en: "Couldn't upload photo. Please try again.",
    beanie: "couldn't upload photo. please try again.",
  },
  'photos.queueFailed': {
    en: "Couldn't save your photo for later. Please check your device storage and try again.",
    beanie: "couldn't save your photo for later. please check your device storage and try again.",
  },
  'photos.queuedOffline': {
    en: "Photo queued - we'll finish uploading when your connection is ready.",
    beanie: "photo queued - we'll finish uploading when your connection is ready.",
  },
  'photos.queueAtCap': {
    en: 'A lot of photos are waiting to upload. Reconnect soon.',
    beanie: 'a lot of photos are waiting to upload. reconnect soon.',
  },
  'photos.cloudRequired': {
    en: 'Photos need cloud sync. Turn on Google Drive in Settings.',
    beanie: 'photos need cloud sync. turn on google drive in settings.',
  },
  'photos.heicUnsupported': {
    en: "This browser can't read HEIC photos. Try a JPEG or PNG.",
    beanie: "this browser can't read heic photos. try a jpeg or png.",
  },
  'photos.maxReached': { en: 'Up to 4 photos per item', beanie: 'up to 4 photos per item' },
  'photos.maxReached.one': { en: 'One photo per item', beanie: 'one photo per item' },
  'photos.maxReached.n': { en: 'Up to {n} photos per item', beanie: 'up to {n} photos per item' },
  'photos.invalidType': {
    en: 'Only JPEG, PNG, and HEIC photos are supported.',
    beanie: 'only jpeg, png, and heic photos are supported.',
  },
  'photos.pdfTooLarge': {
    en: 'PDFs must be under 10 MB.',
    beanie: 'pdfs must be under 10 mb.',
  },
  'photos.addFile': { en: 'Add File', beanie: 'add file' },
  'photos.dropToAddDoc': {
    en: 'Drop an image or PDF to add',
    beanie: 'drop an image or pdf to add',
  },
  'photos.pdf.truncated': {
    en: 'Showing the first pages. Open it to see the whole document.',
    beanie: 'showing the first pages. open it to see the whole document.',
  },
  'photos.pdf.previewFailed': {
    en: "This PDF can't be shown here. Save it to open it in another app.",
    beanie: "this pdf can't be shown here. save it to open it in another app.",
  },
  'photos.downloadFailed': {
    en: "Couldn't fetch that photo",
    beanie: "couldn't fetch that photo",
  },
  'photos.downloadFailedHelp': {
    en: 'It may have been removed from your family drive, or you may not have access to it.',
    beanie: 'it may have been removed from your family drive, or you may not have access to it.',
  },
  'photos.document.tile': { en: 'PDF document', beanie: 'pdf document' },
  'photos.document.tileNamed': { en: 'PDF: {name}', beanie: 'pdf: {name}' },

  // AI document-extraction wedge (#133) — photo/invitation → prefilled activity.
  // Share target (#64) — beanies as a share destination for another app's photo or PDF.
  'shareTarget.busy.title': { en: 'Still Reading', beanie: 'still reading' },
  // ⚠️ Source-NEUTRAL. This used to say "the last thing you shared", which was correct while
  // the busy guard only ever fired on the share path. #84 puts the in-app capture behind the
  // same module-level lock, so that wording would tell someone who never opened a share sheet
  // that they had. `useSharedDocumentIngest.test.ts` asserts on the KEY, so this is safe to
  // reword.
  'shareTarget.busy.message': {
    en: 'beanies is still reading the last thing you gave it. Try again in a moment.',
    beanie: 'beanies is still reading the last thing you gave it. try again in a moment.',
  },
  'shareTarget.signIn.title': { en: 'Sign In First', beanie: 'sign in first' },
  'shareTarget.signIn.message': {
    en: 'Open beanies and sign in, then share it again.',
    beanie: 'open beanies and sign in, then share it again.',
  },
  'shareTarget.notReady.title': { en: 'Almost Ready', beanie: 'almost ready' },
  'shareTarget.notReady.message': {
    en: 'beanies is still counting your beans. Try sharing it again in a moment.',
    beanie: 'beanies is still counting your beans. try sharing it again in a moment.',
  },
  'shareTarget.unsupported.title': { en: "Can't Read That", beanie: "can't read that" },
  'shareTarget.unsupported.message': {
    en: 'beanies can read photos, screenshots, PDFs and links.',
    beanie: 'beanies can read photos, screenshots, pdfs and links.',
  },
  'shareTarget.unrecognised.title': {
    en: 'Not Sure What That Is',
    beanie: 'not sure what that is',
  },
  'shareTarget.unrecognised.message': {
    en: "beanies couldn't work out whether that was an activity, a trip or a recipe. You can still add it yourself.",
    beanie:
      "beanies couldn't work out whether that was an activity, a trip or a recipe. you can still add it yourself.",
  },
  'shareTarget.readerOff.title': { en: 'Reader Unavailable', beanie: 'reader unavailable' },
  'shareTarget.readerOff.message': {
    en: "beanies worked out what that was, but that reader isn't switched on for your family, or isn't available to you.",
    beanie:
      "beanies worked out what that was, but that reader isn't switched on for your family, or isn't available to you.",
  },
  'shareTarget.partial.title': { en: 'Some Were Skipped', beanie: 'some were skipped' },
  'shareTarget.partial.message': {
    en: 'beanies could not open everything you shared, so it read what it could.',
    beanie: 'beanies could not open everything you shared, so it read what it could.',
  },
  'shareTarget.firstAttached.title': { en: 'Read Together', beanie: 'read together' },
  'shareTarget.firstAttached.message': {
    en: 'beanies read all of them as one item. The first one is kept as the attachment.',
    beanie: 'beanies read all of them as one item. the first one is kept as the attachment.',
  },
  // Shared TEXT (#83). `shareTarget.noLink.*` used to live here and has been retired: its
  // only reason for existing was the dead end these bands replaced.
  //
  // The copy names what beanies needs, never "the share" — the same strings are reachable
  // from the in-app capture surface, where "you shared" would be wrong.
  'shareTarget.text.tooShort.title': { en: 'Not Enough to Read', beanie: 'not enough to read' },
  'shareTarget.text.tooShort.message': {
    en: 'beanies needs a bit more than that. Include the date, the time and where it is.',
    beanie: 'beanies needs a bit more than that. include the date, the time and where it is.',
  },
  'shareTarget.text.tooLong.title': { en: 'That’s a Lot of Text', beanie: 'that’s a lot of text' },
  'shareTarget.text.tooLong.message': {
    en: 'That is more text than beanies can read at once. Pick out the part with the details and try again.',
    beanie:
      'that is more text than beanies can read at once. pick out the part with the details and try again.',
  },
  'shareTarget.text.truncated.title': { en: 'Read the First Part', beanie: 'read the first part' },
  'shareTarget.text.truncated.message': {
    en: 'That was long, so beanies read the beginning of it. Check the details before you save.',
    beanie:
      'that was long, so beanies read the beginning of it. check the details before you save.',
  },
  'shareTarget.text.quota.title': { en: 'That’s Plenty for Now', beanie: 'that’s plenty for now' },
  // "on this device", not "for your family": the budget behind this message lives in
  // localStorage, so the other parent's phone still has its own. Saying "your family" would
  // send someone to check with a partner who is not actually blocked.
  'shareTarget.text.quota.message': {
    en: 'beanies has read a lot of text on this device in the last hour. Try again after {resetsAt}.',
    beanie:
      'beanies has read a lot of text on this device in the last hour. try again after {resetsAt}.',
  },
  'shareTarget.failed.title': { en: "Couldn't Open That", beanie: "couldn't open that" },
  'shareTarget.failed.message': {
    en: 'beanies could not read what was shared. Try sharing it again.',
    beanie: 'beanies could not read what was shared. try sharing it again.',
  },
  'shareTarget.failed.action': { en: 'Go to the Nook', beanie: 'go to the nook' },
  // Our proxy refused on purpose — too many extractions in the window (#83). Deliberately
  // vague about WHICH limit tripped: family and IP are implementation detail, and the
  // developer channel for that is the console line in `managedProvider`.
  'ai.error.rateLimited.title': { en: 'Taking a Breather', beanie: 'taking a breather' },
  // No attribution at all. This fires for the per-family limit AND the per-IP one, and the IP
  // limit can trip behind a shared network the family has nothing to do with — telling them
  // "your family has read a lot" would then be simply false.
  'ai.error.rateLimited.message': {
    en: 'beanies has done a lot of reading just now. Give it a few minutes and try again.',
    beanie: 'beanies has done a lot of reading just now. give it a few minutes and try again.',
  },
  'ai.offline.title': { en: "You're Offline", beanie: "you're offline" },
  'ai.offline.message': {
    en: 'Connect to the internet and beanies can read this for you.',
    beanie: 'connect to the internet and beanies can read this for you.',
  },
  'ai.notEvent.title': { en: 'No Event Found', beanie: 'no event found' },
  'ai.notEvent.message': {
    en: "We couldn't spot event details in that photo. You can still fill it in below.",
    beanie: "we couldn't spot event details in that photo. you can still fill it in below.",
  },
  'ai.notTravel.title': { en: 'No Travel Plans Found', beanie: 'no travel plans found' },
  'ai.notTravel.message': {
    en: "We couldn't spot any travel details in that document. You can add the trip manually.",
    beanie: "we couldn't spot any travel details in that document. you can add the trip manually.",
  },
  // Shown when a long PDF is read: only its first pages are sent to the reader. Number-free
  // on purpose (so the copy never drifts from MAX_EXTRACT_PAGES).
  // Page-source-neutral (#64): this now covers a long PDF AND too many shared photos, and
  // says which one is kept — on a multi-file share only the first is attached.
  'ai.pdfTruncated.title': { en: 'Long Document', beanie: 'long document' },
  'ai.pdfTruncated.message': {
    en: 'We read the first few pages. The first document is attached.',
    beanie: 'we read the first few pages. the first document is attached.',
  },
  // ── Recipe capture (#72) — the third magic-beans reader ──
  'recipeExtract.notRecipe.title': { en: 'No Recipe Found', beanie: 'no recipe found' },
  // SHARED-SURFACE COPY — reached from the cookbook, from a pasted link, AND from a shared
  // link (#64 links). It must not assume a photo: someone who shared a URL never took one.
  'recipeExtract.notRecipe.message': {
    en: "beanies couldn't find a recipe in that. Try a clearer photo of the page, or type it in.",
    beanie:
      "beanies couldn't find a recipe in that. try a clearer photo of the page, or type it in.",
  },
  'recipes.photos.willAttach': {
    en: 'beanies found a photo of this dish and will add it when you save.',
    beanie: 'beanies found a photo of this dish and will add it when you save.',
  },
  'recipes.detail.openPhotos': {
    en: 'View all {count} photos',
    beanie: 'view all {count} photos',
  },
  'recipes.detail.source': { en: 'From', beanie: 'from' },
  'recipes.field.sourceUrl': { en: 'Link', beanie: 'link' },
  'recipes.placeholder.sourceUrl': {
    en: 'https://... the page or video this came from',
    beanie: 'https://... the page or video this came from',
  },
  'recipes.photos.addAnother': { en: 'Add Your Own Photo Too', beanie: 'add your own photo too' },
  'recipeExtract.attaching': { en: 'Adding the photo…', beanie: 'adding the photo…' },
  'recipeExtract.attachFailed.title': { en: 'Recipe Saved', beanie: 'recipe saved' },
  'recipeExtract.attachFailed.message': {
    en: "Your recipe is safe, but we couldn't attach the original. You can add it yourself from the recipe.",
    beanie:
      "your recipe is safe, but we couldn't attach the original. you can add it yourself from the recipe.",
  },
  // Shown above the ingredients / steps fields when the reader filled values in itself.
  // Heritage Orange, never Alert Red — this is a routine "worth a look", not an error.
  'recipeExtract.inferred.ingredients': {
    en: 'We filled these in ourselves — worth checking against the original:',
    beanie: 'we filled these in ourselves — worth checking against the original:',
  },
  'recipeExtract.inferred.steps': {
    en: 'We filled these steps in ourselves — worth a look:',
    beanie: 'we filled these steps in ourselves — worth a look:',
  },
  'recipeExtract.badLink.title': { en: "Can't Use That Link", beanie: "can't use that link" },
  'recipeExtract.badLink.message': {
    en: 'That link needs to be a secure (https) web address we can reach. Try copying it again from your browser.',
    beanie:
      'that link needs to be a secure (https) web address we can reach. try copying it again from your browser.',
  },
  'recipeExtract.videoBlocked.title': {
    en: 'YouTube Wouldn’t Share That One',
    beanie: 'youtube wouldn’t share that one',
  },
  // SHARED-SURFACE COPY — see the note on `recipeExtract.noContent.message` (#64 links).
  'recipeExtract.videoBlocked.message': {
    en: 'YouTube blocks apps from reading some videos. Open the video, look in its description for a link to the recipe, and use that instead — it usually works, and gives exact quantities.',
    beanie:
      'youtube blocks apps from reading some videos. open the video, look in its description for a link to the recipe, and use that instead — it usually works, and gives exact quantities.',
  },
  'recipeExtract.unreachable.title': {
    en: "Couldn't Open That Link",
    beanie: "couldn't open that link",
  },
  // SHARED-SURFACE COPY — see the note on `recipeExtract.noContent.message` (#64 links).
  'recipeExtract.unreachable.message': {
    en: 'The page may have moved, or the site may not allow apps to read it. Try opening it yourself and pasting the text.',
    beanie:
      'the page may have moved, or the site may not allow apps to read it. try opening it yourself and pasting the text.',
  },
  'recipeExtract.noContent.title': { en: 'Nothing to Read', beanie: 'nothing to read' },
  // SHARED-SURFACE COPY — reachable from the cookbook AND from a shared link of any kind
  // (#64 links). It must not name recipes: a shared event page that reads as nothing would
  // otherwise be told to try the printable recipe. See `useExtractionErrorToast`'s copy rule.
  'recipeExtract.noContent.message': {
    en: 'beanies reached that page but found nothing it could read. Try the printable version, or open it yourself and paste the text.',
    beanie:
      'beanies reached that page but found nothing it could read. try the printable version, or open it yourself and paste the text.',
  },
  'recipeExtract.noTranscript.title': {
    en: "Can't Read That Video",
    beanie: "can't read that video",
  },
  // SHARED-SURFACE COPY — see the note on `recipeExtract.noContent.message` (#64 links).
  'recipeExtract.noTranscript.message': {
    en: "That video's description has no text and no link to follow, so there's nothing for beanies to read. Check the description yourself for a link, and use that instead.",
    beanie:
      "that video's description has no text and no link to follow, so there's nothing for beanies to read. check the description yourself for a link, and use that instead.",
  },
  // The title-plus-link fallback: the video names a dish but its method is only spoken
  // aloud, so the form arrives mostly empty ON PURPOSE. Say why, or an empty form reads as
  // a failure. SHARED SURFACE — shown from both the pasted-link and shared-link paths.
  'recipeExtract.titleOnly.title': {
    en: 'Started It For You',
    beanie: 'started it for you',
  },
  'recipeExtract.titleOnly.message': {
    en: "That video's recipe is only spoken aloud, so beanies couldn't read the ingredients or steps. The name and the video link are saved — type in the rest while you watch.",
    beanie:
      "that video's recipe is only spoken aloud, so beanies couldn't read the ingredients or steps. the name and the video link are saved — type in the rest while you watch.",
  },
  'recipeExtract.strip.title': {
    en: 'Start From a Link',
    beanie: 'start from a link',
  },
  'recipeExtract.strip.subtitle': {
    en: 'Paste a recipe page or a YouTube link and beanies fills this in for you.',
    beanie: 'paste a recipe page or a youtube link and beanies fills this in for you.',
  },
  'recipeExtract.strip.action': { en: 'Fill It In', beanie: 'fill it in' },
  'recipeExtract.strip.document': {
    en: 'or read a photo or PDF instead',
    beanie: 'or read a photo or pdf instead',
  },
  'recipeExtract.link.title': { en: 'Paste a Recipe Link', beanie: 'paste a recipe link' },
  'recipeExtract.link.label': { en: 'Recipe Link', beanie: 'recipe link' },
  'recipeExtract.link.placeholder': {
    en: 'https://... or a YouTube video',
    beanie: 'https://... or a youtube video',
  },
  'recipeExtract.link.invalid': {
    en: 'That needs to be a secure (https) web address.',
    beanie: 'that needs to be a secure (https) web address.',
  },
  'recipeExtract.link.action': { en: 'Read It', beanie: 'read it' },
  'recipeExtract.link.hint': {
    en: 'Most recipe sites work. We read the ingredients and steps exactly as written.',
    beanie: 'most recipe sites work. we read the ingredients and steps exactly as written.',
  },
  'recipeExtract.link.videoHint': {
    en: "That's a video — beanies reads its description and follows the recipe link most cooks put there.",
    beanie:
      "that's a video — beanies reads its description and follows the recipe link most cooks put there.",
  },
  'recipeExtract.reader.label': { en: 'Read a Recipe', beanie: 'read a recipe' },
  'recipeExtract.reader.aria': {
    // The control now opens a LINK field it programmatically focuses. Describing it as
    // "from a photo or PDF" told a screen-reader user the wrong thing about where focus was
    // about to land (WCAG 2.5.3 / 4.1.2).
    en: 'Read a recipe from a link, photo or PDF',
    beanie: 'read a recipe from a link, photo or pdf',
  },
  // ── "beanies can do magic" AI entry points — shared magic-reader language ──
  'ai.magic.title': { en: 'Magic beans', beanie: 'magic beans' },
  // Names the four SOURCES, not three types. The whole point of #84 is that the user never
  // declares what the thing is — so the copy must not ask them to either.
  'ai.magic.subtitle': {
    en: 'A photo, a file, a link or some text — beanies works out what it is',
    beanie: 'a photo, a file, a link or some text — beanies works out what it is',
  },
  'ai.magic.action': { en: 'Read something for me', beanie: 'read something for me' },
  'ai.magic.perform': { en: 'Magic beans', beanie: 'magic beans' },
  'ai.magic.performHint': {
    en: 'Snap an invite, beanies fills it in',
    beanie: 'snap an invite, beanies fills it in',
  },
  'ai.magic.quickStart': { en: 'Quick start', beanie: 'quick start' },
  'ai.magic.travelSubtitle': {
    en: "Snap your travel booking, I'll build the trip",
    beanie: "snap your travel booking, i'll build the trip",
  },
  'ai.magic.orAddYourself': { en: 'or add it yourself', beanie: 'or add it yourself' },
  // ── Travel document extraction (#30) ──
  'travelExtract.reviewTitle': { en: 'Review Travel Plans', beanie: 'review travel plans' },
  'travelExtract.reviewSubtitle': {
    en: 'Here’s what we found. Check it over, then add it to a trip — you can fine-tune any detail afterward.',
    beanie:
      'here’s what we found. check it over, then add it to a trip — you can fine-tune any detail afterward.',
  },
  'travelExtract.tripLabel': { en: 'Trip', beanie: 'trip' },
  'travelExtract.existingTripBadge': { en: 'Existing Trip', beanie: 'existing trip' },
  'travelExtract.newTripBadge': { en: 'New Trip', beanie: 'new trip' },
  'travelExtract.addingTo': { en: 'Adding to', beanie: 'adding to' },
  'travelExtract.chooseTrip': {
    en: 'A few trips overlap these dates — which one?',
    beanie: 'a few trips overlap these dates — which one?',
  },
  'travelExtract.newTrip': {
    en: 'No matching trip — we’ll create a new one:',
    beanie: 'no matching trip — we’ll create a new one:',
  },
  'travelExtract.tripNamePlaceholder': { en: 'Trip name', beanie: 'trip name' },
  'travelExtract.defaultTripName': { en: 'New Trip', beanie: 'new trip' },
  'travelExtract.createTrip': { en: 'Create Trip', beanie: 'create trip' },
  'travelExtract.addToTrip': { en: 'Add to Trip', beanie: 'add to trip' },
  'travelExtract.targetHeading': {
    en: 'Where should these go?',
    beanie: 'where should these go?',
  },
  'travelExtract.newTripNameLabel': { en: 'New trip name', beanie: 'new trip name' },
  'travelExtract.addToTripLabel': { en: 'Add to which trip?', beanie: 'add to which trip?' },
  'travelExtract.selectTripPlaceholder': { en: 'Select a trip', beanie: 'select a trip' },
  'travelExtract.travellersHeading': {
    en: 'Who are these travellers?',
    beanie: 'who are these travellers?',
  },
  'travelExtract.whoIsThis': { en: "who's this?", beanie: "who's this?" },
  'travelExtract.kind.travel': { en: 'Travel', beanie: 'travel' },
  'travelExtract.kind.accommodation': { en: 'Stay', beanie: 'stay' },
  'travelExtract.kind.transportation': { en: 'Transport', beanie: 'transport' },
  'travelExtract.error.title': { en: "Couldn't Add That", beanie: "couldn't add that" },
  'travelExtract.error.noMember': {
    en: 'Set up your family profile first, then try again.',
    beanie: 'set up your family profile first, then try again.',
  },
  'travelExtract.error.saveFailed': {
    en: 'Something went wrong saving the trip. Please try again.',
    beanie: 'something went wrong saving the trip. please try again.',
  },
  'travelExtract.attachFailed.title': { en: 'Trip Saved', beanie: 'trip saved' },
  'travelExtract.attachFailed.message': {
    en: 'Your plans were added, but the document didn’t attach. You can add it from the trip.',
    beanie: 'your plans were added, but the document didn’t attach. you can add it from the trip.',
  },
  'travelExtract.aliasLearnFailed.title': { en: 'Trip Saved', beanie: 'trip saved' },
  'travelExtract.aliasLearnFailed.message': {
    en: 'Your trip was saved, but we couldn’t remember a traveller name for next time.',
    beanie: 'your trip was saved, but we couldn’t remember a traveller name for next time.',
  },
  'travelExtract.added.title': { en: 'Travel Plans Added', beanie: 'travel plans added' },
  'travelExtract.added.message': {
    en: 'We’ve added your plans to the trip.',
    beanie: 'we’ve added your plans to the trip.',
  },
  'ai.unavailable.title': { en: 'Not Available Yet', beanie: 'not available yet' },
  'ai.unavailable.message': {
    en: "Magic beans isn't set up yet. You can still add this yourself.",
    beanie: "magic beans isn't set up yet. you can still add this yourself.",
  },
  'ai.error.title': { en: "Couldn't Read That", beanie: "couldn't read that" },
  'ai.error.timeout': {
    en: 'That took too long. Please try again.',
    beanie: 'that took too long. please try again.',
  },
  'ai.error.unreadable': {
    en: "We couldn't make sense of that one. Try a clearer photo or a sharper scan.",
    beanie: "we couldn't make sense of that one. try a clearer photo or a sharper scan.",
  },
  'ai.error.generic': {
    en: 'Something went wrong reading that. Please try again.',
    beanie: 'something went wrong reading that. please try again.',
  },
  'ai.error.busy.title': { en: 'beanies AI Is Busy', beanie: 'beanies ai is busy' },
  'ai.error.busy.message': {
    en: 'beanies AI is busy right now. Please try again in a moment.',
    beanie: 'beanies ai is busy right now. please try again in a moment.',
  },
  // Camera-or-file chooser shown (on touch devices) after consent, before the picker.
  'ai.picker.title': {
    en: 'How do you want to add it?',
    beanie: 'how do you want to add it?',
  },
  // Shared by RecipeLinkModal and the magic-beans sheet via `AiSourceButtons` (#84). Replaces
  // `recipeExtract.link.orFrom`, which was recipe-specific for no reason.
  'ai.picker.orFrom': { en: 'or read from', beanie: 'or read from' },
  'ai.picker.takePhoto': { en: 'Take a photo', beanie: 'take a photo' },
  'ai.picker.chooseFile': { en: 'Choose a file', beanie: 'choose a file' },
  // The file is over AI_PICKER_MAX_BYTES. Deliberately SEPARATE from the "can't read that"
  // type refusal: at the share boundary the user did not choose the file, so one message for
  // both was right; in-app they did choose it, and "too big" is actionable where "can't read
  // that" is not. Names the actual limit — a bound the user cannot see is not actionable.
  'ai.picker.tooLarge.title': { en: 'That File Is Too Big', beanie: 'that file is too big' },
  'ai.picker.tooLarge.message': {
    en: 'beanies can read files up to 25 MB. Try a smaller photo, or a screenshot of the part that matters.',
    beanie:
      'beanies can read files up to 25 mb. try a smaller photo, or a screenshot of the part that matters.',
  },
  // The magic-beans sheet (#84) — one button, four sources, no type question.
  'ai.capture.title': { en: 'Magic beans', beanie: 'magic beans' },
  'ai.capture.action': { en: 'Read it', beanie: 'read it' },
  'ai.capture.label': { en: 'Paste anything', beanie: 'paste anything' },
  'ai.capture.placeholder': {
    en: 'Paste a message, an email, or a link…',
    beanie: 'paste a message, an email, or a link…',
  },
  'ai.capture.hint': {
    en: 'An invite, a booking, a recipe — beanies works out which it is.',
    beanie: 'an invite, a booking, a recipe — beanies works out which it is.',
  },
  'ai.picker.openErrorTitle': {
    en: "Couldn't Open the Picker",
    beanie: "couldn't open the picker",
  },
  'ai.picker.openErrorBody': {
    en: 'Something went wrong opening the camera or file picker. Please try again.',
    beanie: 'something went wrong opening the camera or file picker. please try again.',
  },
  'ai.lowConfidence.hint': {
    en: "We weren't sure about this one. Worth a quick check.",
    beanie: "we weren't sure about this one. worth a quick check.",
  },
  'ai.addFromPhoto': { en: 'Add from a Photo', beanie: 'add from a photo' },
  'ai.processing': { en: 'Reading your photo…', beanie: 'counting beans…' },
  'ai.sourcePhotoPreview': {
    en: 'Attaches when you save',
    beanie: 'attaches when you save',
  },
  'ai.sourcePhotoPreviewAlt': {
    en: 'The photo this activity was read from',
    beanie: 'the photo this activity was read from',
  },
  'ai.consent.title': {
    en: 'Ready for some magic beans 🫘?',
    beanie: 'ready for some magic beans 🫘?',
  },
  // `intro` is one translatable sentence; the modal locates `introLink`
  // ("secure, private") inside it at render time and turns that phrase into an
  // inline link to the privacy article (gated on PRIVACY_ARTICLE_LIVE — plain
  // text until it ships). Keep `introLink` a verbatim substring of `intro`.
  'ai.consent.intro': {
    en: "beanies will read this photo, document or selected text and magically extract the key details for you (well, it's not actually magic, it's just secure, private AI).",
    beanie:
      "beanies will read this photo, document or selected text and magically extract the key details for you (well, it's not actually magic, it's just secure, private ai).",
  },
  'ai.consent.introLink': { en: 'secure, private', beanie: 'secure, private' },
  'ai.consent.whatLabel': { en: 'What we send', beanie: 'what we send' },
  'ai.consent.whatValue': {
    en: "Only this one photo, document or piece of text, never anything else, and never any of your family's data.",
    beanie:
      "only this one photo, document or piece of text, never anything else, and never any of your family's data.",
  },
  'ai.consent.whereLabel': { en: 'Where it goes', beanie: 'where it goes' },
  // Honesty (ADR-030 binding principle): today the document is encrypted in transit
  // (TLS) on both hops, and it passes through our own server on the way. It is NOT
  // yet end-to-end encrypted to the enclave — that is Gate 3 (Notion #49). No copy
  // here may imply our server cannot see the document. Once Gate 3 ships, this can
  // become "only the AI's secure hardware can read it, not even our own server".
  'ai.consent.whereManaged': {
    en: 'To a private AI service that reads it inside secure hardware its own operator cannot see into, then keeps nothing. It travels encrypted, by way of a beanies server that stores nothing.',
    beanie:
      'to a private ai service that reads it inside secure hardware its own operator cannot see into, then keeps nothing. it travels encrypted, by way of a beanies server that stores nothing.',
  },
  'ai.consent.whereByok': {
    en: "To your own AI provider, using the key you've provided.",
    beanie: "to your own ai provider, using the key you've provided.",
  },
  'ai.consent.afterLabel': { en: 'Afterwards', beanie: 'afterwards' },
  'ai.consent.afterValue': {
    en: "Nothing is kept by the AI service. Anything beanies keeps is saved only with your own family's data, attached to this item.",
    beanie:
      "nothing is kept by the ai service. anything beanies keeps is saved only with your own family's data, attached to this item.",
  },
  'ai.consent.confirm': {
    en: 'I understand - gimme those beans!',
    beanie: 'i understand - gimme those beans!',
  },
  'ai.consent.footnote': {
    en: "We'd never send anything without asking - you choose each time. You can stop the prompt for your family by ticking the box below.",
    beanie:
      "we'd never send anything without asking - you choose each time. you can stop the prompt for your family by ticking the box below.",
  },
  'ai.consent.remember': {
    en: 'I agree to let beanies.family privately and securely process the documents I choose.',
    beanie: 'i agree to let beanies.family privately and securely process the documents i choose.',
  },
  'ai.consent.privacyLink': {
    en: 'How we protect your privacy',
    beanie: 'how we protect your privacy',
  },
  'ai.consent.learnMore': {
    en: 'Learn how your data is kept secure',
    beanie: 'learn how your data is kept secure',
  },
  'settings.ai.title': { en: 'AI & Privacy', beanie: 'ai & privacy' },
  'settings.ai.askBeforePhotos': {
    en: 'Ask before reading photos',
    beanie: 'ask before reading photos',
  },
  'settings.ai.askBeforePhotosHint': {
    en: 'Show a privacy check before sending a photo, document or selected text to beanies AI.',
    beanie: 'show a privacy check before sending a photo, document or selected text to beanies ai.',
  },
  // #133 Phase 4 — AI tier settings
  'settings.card.ai': { en: 'beanies AI', beanie: 'beanies ai' },
  'settings.card.aiDesc': {
    en: 'How AI handles your documents',
    beanie: 'how ai handles your beans',
  },
  // #32 Google Calendar integration
  'settings.card.calendarSync': { en: 'Google Calendar', beanie: 'google calendar' },
  'settings.card.calendarSyncDesc': {
    en: 'Push your activities to your calendars',
    beanie: 'push your beans to your calendars',
  },
  // The Beanie Lab — per-device opt-in to experimental/in-development features.
  'settings.beanieLab.title': { en: 'The Beanie Lab', beanie: 'the beanie lab' },
  'settings.beanieLab.blurb': {
    en: "Get a sneak peek at some of our latest and greatest, fresh from the lab. Just keep in mind they're still in development, so they might act up, wander off, or not work at all (yet!).",
    beanie:
      "get a sneak peek at some of our latest and greatest beans, fresh from the lab. just keep in mind they're still sprouting, so they might act up, wander off, or not work at all (yet!).",
  },
  'settings.beanieLab.enableLabel': {
    en: 'Enable experimental features',
    beanie: 'enable experimental features',
  },
  'settings.beanieLab.enableHint': {
    en: 'This device only · off by default',
    beanie: 'this device only · off by default',
  },
  'settings.beanieLab.testingTag': { en: 'Testing', beanie: 'testing' },
  'settings.beanieLab.empty': {
    en: "Flip the switch to reveal what's brewing in the lab.",
    beanie: "flip the switch to reveal what's brewing in the lab.",
  },
  'calendarSync.intro': {
    en: 'Connect a Google calendar and your family activities are pushed to it automatically. beanies stays your source of truth. Edits always happen here.',
    beanie:
      'connect a google calendar and your family beans are pushed to it automatically. beanies stays your source of truth. edits always happen here.',
  },
  'calendarSync.destinationLabel': { en: 'Calendar', beanie: 'calendar' },
  'calendarSync.primaryCalendar': { en: 'Primary calendar', beanie: 'primary calendar' },
  // #34 clash nudge — toggle and the activity indicator.
  'calendarSync.clashNudge.title': {
    en: 'Warn me about clashes with my other calendars',
    beanie: 'warn me about clashes with my other calendars',
  },
  'calendarSync.clashNudge.hint': {
    en: 'beanies only reads when your events are, never what they are.',
    beanie: 'beanies only reads when your events are, never what they are.',
  },
  'calendarSync.clashNudge.label': { en: 'Clash warnings', beanie: 'clash warnings' },
  'calendarSync.clash.tooltipPrefix': { en: 'May clash with', beanie: 'may clash with' },
  // #34 active/quiet redesign — drawer callout + quiet ack line. The calendar's
  // own name (account email) is concatenated between prefix/suffix, never
  // interpolated (t() takes no params).
  'calendarSync.clash.overlapsCalendarPrefix': { en: 'Overlaps your', beanie: 'overlaps your' },
  'calendarSync.clash.calendarSuffix': { en: 'calendar', beanie: 'calendar' },
  'calendarSync.clash.dismissHint': {
    en: 'Dismiss if you expected it.',
    beanie: 'dismiss if you expected it.',
  },
  'calendarSync.clash.thisIsOk': { en: 'This is OK', beanie: 'this is ok' },
  'calendarSync.clash.reschedule': { en: 'Reschedule…', beanie: 'reschedule…' },
  'calendarSync.clash.whatsThis': { en: "What's this?", beanie: "what's this?" },
  'calendarSync.clash.acknowledgedLine': {
    en: "You're OK with this overlap",
    beanie: "you're ok with this overlap",
  },
  'calendarSync.clash.undo': { en: 'Undo', beanie: 'undo' },
  'calendarSync.connectOnDesktop': {
    en: 'Open beanies in a desktop browser to connect a calendar. Once connected, it syncs on all your devices.',
    beanie:
      'open beanies in a desktop browser to connect a calendar. once connected, it syncs on all your devices.',
  },
  'calendarSync.reconnect.bannerTitle': {
    en: 'Calendar sync paused',
    beanie: 'calendar sync paused',
  },
  'calendarSync.reconnect.bannerSub': {
    en: 'Google needs you to reconnect {account} before your activities can sync again.',
    beanie: 'google needs you to reconnect {account} before your beans can sync again.',
  },
  'calendarSync.reconnect.bannerSubGeneric': {
    en: 'Google needs you to reconnect this calendar before your activities can sync again.',
    beanie: 'google needs you to reconnect this calendar before your beans can sync again.',
  },
  'calendarSync.reconnect.bannerError': {
    en: "That didn't work. Please try again.",
    beanie: "that didn't work. please try again.",
  },
  'calendarSync.reconnect.dismiss': { en: 'Dismiss', beanie: 'dismiss' },
  'calendarSync.status.ok': { en: 'Synced', beanie: 'synced' },
  'calendarSync.status.needsReconnect': { en: 'Reconnect needed', beanie: 'reconnect needed' },
  'calendarSync.status.error': { en: 'Sync error', beanie: 'sync error' },
  'calendar.error.connectRetry': {
    en: 'We couldn’t finish connecting your calendar. Please tap Connect and try again.',
    beanie: 'we couldn’t finish connecting your calendar. please tap connect and try again.',
  },
  'calendarSync.status.disconnecting': { en: 'Removing…', beanie: 'removing…' },
  'calendarSync.action.connect': {
    en: 'Connect a Google calendar',
    beanie: 'connect a google calendar',
  },
  'calendarSync.action.reconnect': { en: 'Reconnect', beanie: 'reconnect' },
  'calendarSync.action.syncNow': { en: 'Sync now', beanie: 'sync now' },
  'calendarSync.action.disconnect': { en: 'Disconnect', beanie: 'disconnect' },
  'calendarSync.disconnect.title': {
    en: 'Disconnect this calendar?',
    beanie: 'disconnect this calendar?',
  },
  'calendarSync.disconnect.message': {
    en: 'beanies will remove the events it added to this calendar. Your activities stay safe in beanies.',
    beanie:
      'beanies will remove the beans it added to this calendar. your activities stay safe in beanies.',
  },
  'calendarSync.disconnect.confirm': { en: 'Disconnect', beanie: 'disconnect' },
  'calendarSync.toast.connected.title': { en: 'Calendar connected', beanie: 'calendar connected' },
  'calendarSync.toast.connected.message': {
    en: 'Your activities will sync to this calendar.',
    beanie: 'your beans will sync to this calendar.',
  },
  'calendarSync.toast.reconnected.title': { en: 'Reconnected', beanie: 'reconnected' },
  'calendarSync.toast.reconnected.message': {
    en: 'Syncing resumed for this calendar.',
    beanie: 'syncing resumed for this calendar.',
  },
  'calendarSync.toast.synced.title': { en: 'Synced', beanie: 'synced' },
  'calendarSync.toast.synced.message': {
    en: 'Your activities are up to date.',
    beanie: 'your beans are up to date.',
  },
  'calendarSync.toast.disconnected.title': {
    en: 'Calendar disconnected',
    beanie: 'calendar disconnected',
  },
  'calendarSync.toast.disconnected.message': {
    en: 'beanies stopped syncing to this calendar.',
    beanie: 'beanies stopped syncing to this calendar.',
  },
  'calendarSync.toast.syncFailed.title': { en: "Couldn't sync", beanie: "couldn't sync" },
  'calendarSync.toast.syncFailed.message': {
    en: 'Something went wrong syncing this calendar. beanies will try again automatically.',
    beanie: 'something went wrong syncing this calendar. beanies will try again automatically.',
  },
  'calendarSync.toast.syncReconnect.title': { en: 'Reconnect needed', beanie: 'reconnect needed' },
  'calendarSync.toast.syncReconnect.message': {
    en: 'Google needs you to reconnect this calendar before it can sync again.',
    beanie: 'google needs you to reconnect this calendar before it can sync again.',
  },
  'calendarSync.toast.disconnectPartial.title': {
    en: 'Partly disconnected',
    beanie: 'partly disconnected',
  },
  'calendarSync.toast.disconnectPartial.message': {
    en: "Some events couldn't be removed yet. beanies will finish next time you open this.",
    beanie: "some beans couldn't be removed yet. beanies will finish next time you open this.",
  },
  'calendarSync.toast.connectFailed.title': { en: "Couldn't connect", beanie: "couldn't connect" },
  'calendarSync.toast.destinationFailed.title': {
    en: "Couldn't switch calendar",
    beanie: "couldn't switch calendar",
  },
  'calendarSync.toast.destinationFailed.message': {
    en: 'Some events could not be removed from the old calendar, so the change was undone. Please try again.',
    beanie:
      'some beans could not be removed from the old calendar, so the change was undone. please try again.',
  },
  'settings.ai.tierLabel': {
    en: 'How documents are processed',
    beanie: 'how documents are processed',
  },
  'settings.ai.tier.managed': { en: 'Managed (recommended)', beanie: 'managed (recommended)' },
  'settings.ai.tier.byok': { en: 'Your own key (BYOK)', beanie: 'your own key (byok)' },
  'settings.ai.tier.onDevice': { en: 'On your device', beanie: 'on your device' },
  'settings.ai.comingSoon': { en: ' (coming soon)', beanie: ' (coming soon)' },
  'settings.ai.privacy.managed': {
    en: 'Your document is processed in an attested confidential-compute enclave. It is encrypted in transit, data-minimized, and nothing is retained.',
    beanie:
      'your document is processed in an attested confidential-compute enclave. it is encrypted in transit, data-minimized, and nothing is retained.',
  },
  'settings.ai.privacy.byok': {
    en: 'Your own provider key is used. The document goes straight from your device to your provider, so beanies never sees your key or your document.',
    beanie:
      'your own provider key is used. the document goes straight from your device to your provider, so beanies never sees your key or your document.',
  },
  'settings.ai.privacy.onDevice': {
    en: 'Everything stays on your device and nothing is sent anywhere. Coming soon.',
    beanie: 'everything stays on your device and nothing is sent anywhere. coming soon.',
  },
  'settings.ai.byok.provider': { en: 'Provider', beanie: 'provider' },
  'settings.ai.byok.apiKey': { en: 'API Key', beanie: 'api key' },
  'settings.ai.byok.apiKeyHint': {
    en: 'Stored on this device only. beanies never sees it.',
    beanie: 'stored on this device only. beanies never sees it.',
  },
  'settings.ai.byok.apiKeyPlaceholder': { en: 'sk-...', beanie: 'sk-...' },
  'settings.ai.provider.openai': { en: 'OpenAI', beanie: 'openai' },
  'settings.ai.provider.claude': { en: 'Claude', beanie: 'claude' },
  'settings.ai.provider.gemini': { en: 'Gemini', beanie: 'gemini' },
  'settings.ai.byok.test': { en: 'Test Key', beanie: 'test key' },
  'settings.ai.byok.testing': { en: 'Testing...', beanie: 'counting beans...' },
  'settings.ai.test.ok.title': { en: 'Key works', beanie: 'key works' },
  'settings.ai.test.ok.message': {
    en: 'Your OpenAI key connected successfully.',
    beanie: 'your openai key connected successfully.',
  },
  'settings.ai.test.invalid.title': { en: "Key didn't work", beanie: "key didn't work" },
  'settings.ai.test.invalid.message': {
    en: 'OpenAI rejected this key. Check it was copied correctly and is still active.',
    beanie: 'openai rejected this key. check it was copied correctly and is still active.',
  },
  'settings.ai.test.network.title': {
    en: "Couldn't reach OpenAI",
    beanie: "couldn't reach openai",
  },
  'settings.ai.test.network.message': {
    en: "We couldn't verify the key right now. Check your connection and try again.",
    beanie: "we couldn't verify the key right now. check your connection and try again.",
  },
  'photos.dropToAdd': { en: 'Drop photo to add', beanie: 'drop photo to add' },
  'photos.missing.tile': { en: 'Photo missing', beanie: 'photo missing' },
  'photos.missing.title': { en: "We Can't Find This Photo", beanie: "we can't find this photo" },
  'photos.missing.body': {
    en: "It may have been moved, deleted, or you don't have access anymore.",
    beanie: "it may have been moved, deleted, or you don't have access anymore.",
  },
  'photos.replace': { en: 'Replace', beanie: 'replace' },
  'photos.remove': { en: 'Remove', beanie: 'remove' },
  'photos.deleteConfirm.title': { en: 'Remove This Photo?', beanie: 'remove this photo?' },
  'photos.deleteConfirm.body': {
    en: "It'll be cleaned up on everyone's device.",
    beanie: "it'll be cleaned up on everyone's device.",
  },
  'photos.download': { en: 'Download', beanie: 'download' },
  'photos.next': { en: 'Next photo', beanie: 'next photo' },
  'photos.previous': { en: 'Previous photo', beanie: 'previous photo' },
  'photos.close': { en: 'Close', beanie: 'close' },
  'photos.viewer.of': { en: 'of', beanie: 'of' },
  'photos.viewer.open': { en: 'Open photo', beanie: 'open photo' },

  // Photo-attachment shared infrastructure (used by every entity that owns photos).
  // The link-failed pair is surfaced when an upload succeeds but the entity
  // update that pins the photoId rejects — without this the photo silently
  // becomes a Drive orphan that the user can't see.
  'photos.label': { en: 'Photos', beanie: 'photos' },
  'photos.indicator.one': { en: '1 photo attached', beanie: '1 photo attached' },
  'photos.indicator.many': { en: '{n} photos attached', beanie: '{n} photos attached' },
  'photos.linkFailed.title': {
    en: "Couldn't Save Your Photo",
    beanie: "couldn't save your photo",
  },
  'photos.linkFailed.body': {
    en: "The photo uploaded but we couldn't link it to this entry. Try again — we'll clean up the unlinked file automatically if it stays orphaned.",
    beanie:
      "the photo uploaded but we couldn't link it to this entry. try again — we'll clean up the unlinked file automatically if it stays orphaned.",
  },

  // Quick-add FAB — chrome
  'quickAdd.fab.label': { en: 'Quick add', beanie: 'quick add' },
  'quickAdd.title': {
    en: 'What would you like to add?',
    beanie: 'what would you like to add?',
  },
  'quickAdd.close': { en: 'Close', beanie: 'close' },

  // Quick-add FAB — group labels
  'quickAdd.groups.everyday.kicker': {
    en: '🫘 Everyday beans',
    beanie: '🫘 everyday beans',
  },
  'quickAdd.groups.everyday.subhint': {
    en: 'what you add most',
    beanie: 'what you add most',
  },
  'quickAdd.groups.family.title': { en: 'Family', beanie: 'family' },
  'quickAdd.groups.money.title': { en: 'Money', beanie: 'money' },
  'quickAdd.groups.money.setup': { en: 'setup', beanie: 'setup' },
  'quickAdd.groups.care.title': { en: 'Care', beanie: 'care' },

  // Quick-add FAB — entities (18 × label + hint)
  'quickAdd.activity.label': { en: 'Activity', beanie: 'activity' },
  'quickAdd.activity.hint': { en: 'calendar event', beanie: 'calendar event' },
  'quickAdd.todo.label': { en: 'To-do', beanie: 'to-do' },
  'quickAdd.todo.hint': { en: 'task · who · when', beanie: 'task · who · when' },
  'quickAdd.transaction.label': { en: 'Transaction', beanie: 'transaction' },
  'quickAdd.transaction.hint': {
    en: 'income · expense · transfer',
    beanie: 'income · expense · transfer',
  },
  'quickAdd.trip.label': { en: 'Trip', beanie: 'trip' },
  'quickAdd.trip.hint': { en: 'travel plans', beanie: 'travel plans' },
  'quickAdd.cookLog.label': { en: 'Cook log', beanie: 'cook log' },
  'quickAdd.cookLog.hint': { en: '5-star · note · photo', beanie: '5-star · note · photo' },
  'quickAdd.saying.label': { en: 'Saying', beanie: 'saying' },
  'quickAdd.saying.hint': { en: 'Quote a family member', beanie: 'quote a beanie' },
  'quickAdd.favorite.label': { en: 'Favorite', beanie: 'favorite' },
  'quickAdd.favorite.hint': { en: 'food · game · song', beanie: 'food · game · song' },
  'quickAdd.note.label': { en: 'Note', beanie: 'note' },
  'quickAdd.note.hint': { en: 'Per-member journal', beanie: 'per-bean journal' },
  'quickAdd.recipe.label': { en: 'Recipe', beanie: 'recipe' },
  'quickAdd.recipe.hint': { en: 'ingredients · steps', beanie: 'ingredients · steps' },
  'quickAdd.tripIdea.label': { en: 'Trip idea', beanie: 'trip idea' },
  'quickAdd.tripIdea.hint': {
    en: 'wishlist a destination',
    beanie: 'wishlist a destination',
  },
  'quickAdd.tripIdea.noTripsTitle': {
    en: 'Add a trip first',
    beanie: 'add a trip first',
  },
  'quickAdd.tripIdea.noTripsMessage': {
    en: 'Trip ideas live inside a trip — create one and then come back.',
    beanie: 'trip ideas live inside a trip — create one and then come back.',
  },
  'quickAdd.tripIdea.addTripAction': { en: 'Add trip', beanie: 'add trip' },
  'quickAdd.account.label': { en: 'Account', beanie: 'account' },
  'quickAdd.account.hint': {
    en: 'checking · credit · loan',
    beanie: 'checking · credit · loan',
  },
  'quickAdd.budget.label': { en: 'Budget', beanie: 'budget' },
  'quickAdd.budget.hint': {
    en: 'category caps · period',
    beanie: 'category caps · period',
  },
  'quickAdd.asset.label': { en: 'Asset', beanie: 'asset' },
  'quickAdd.asset.hint': {
    en: 'home · vehicle · investment',
    beanie: 'home · vehicle · investment',
  },
  'quickAdd.goal.label': { en: 'Goal', beanie: 'goal' },
  'quickAdd.goal.hint': { en: 'save · payoff · invest', beanie: 'save · payoff · invest' },
  'quickAdd.medication.label': { en: 'Medication', beanie: 'medication' },
  'quickAdd.medication.hint': { en: 'dose · schedule', beanie: 'dose · schedule' },
  'quickAdd.doseLog.label': { en: 'Dose log', beanie: 'dose log' },
  'quickAdd.doseLog.hint': {
    en: 'record a given dose',
    beanie: 'record a given dose',
  },
  'quickAdd.allergy.label': { en: 'Allergy', beanie: 'allergy' },
  'quickAdd.allergy.hint': { en: 'severity · response', beanie: 'severity · response' },
  'quickAdd.emergency.label': { en: 'Emergency contact', beanie: 'emergency contact' },
  'quickAdd.emergency.hint': {
    en: 'sitter · doctor · school',
    beanie: 'sitter · doctor · school',
  },

  // Quick-add FAB — error surfaces
  'quickAdd.error.unknown.title': {
    en: "Can't do that from here",
    beanie: "can't do that from here",
  },
  'quickAdd.error.unknown.message': {
    en: "This add action isn't available any more — the app may need a reload.",
    beanie: "this add action isn't available any more — the app may need a reload.",
  },
  'quickAdd.error.handler.title': {
    en: "Hmm, that didn't work",
    beanie: "hmm, that didn't work",
  },
  'quickAdd.error.handler.message': {
    en: 'Something went wrong opening that form. Check the console for details.',
    beanie: 'something went wrong opening that form. check the console for details.',
  },
  'quickAdd.error.notHere.title': {
    en: 'Open this from another page',
    beanie: 'open this from another page',
  },
  'quickAdd.error.notHere.message': {
    en: "The Quick-add menu is hidden on this page for focus. Tap the bean icon once you're back on the main app.",
    beanie:
      "the quick-add menu is hidden on this page for focus. tap the beanie once you're back on the main app.",
  },

  // Quick-add FAB — parent picker (bean / recipe / medication)
  'quickAdd.picker.back': { en: 'Back', beanie: 'back' },
  'quickAdd.picker.bean.title': { en: 'Pick a member', beanie: 'pick a beanie' },
  'quickAdd.picker.bean.empty': {
    en: "You haven't added any beanies yet — add one from the Pod.",
    beanie: "you haven't added any beanies yet — add one from the pod.",
  },
  'quickAdd.picker.recipe.title': { en: 'Pick a recipe', beanie: 'pick a recipe' },
  'quickAdd.picker.recipe.empty': {
    en: 'No recipes saved yet — add one from the Cookbook first.',
    beanie: 'no recipes saved yet — add one from the cookbook first.',
  },
  'quickAdd.picker.medication.title': {
    en: 'Pick a medication',
    beanie: 'pick a medication',
  },
  'quickAdd.picker.medication.empty': {
    en: "No active medications — add one from a member's Care tab.",
    beanie: 'no active medications — add one from a beanie‘s care tab.',
  },
  'quickAdd.picker.vacation.title': { en: 'Pick a trip', beanie: 'pick a trip' },
  'quickAdd.picker.vacation.empty': {
    en: "You haven't added any trips yet — start one from Travel Plans.",
    beanie: "you haven't added any trips yet — start one from travel plans.",
  },
  // ── OAuth native bridge backstop (OAuthNativeBridgePage) ──
  // A diagnostic surface that should never render — see the page's comment.
  'oauth.nativeBridgeTitle': { en: 'Almost there', beanie: 'almost there' },
  'oauth.nativeBridgeBody': {
    en: "We couldn't hand you back to the app automatically. Tap below to finish signing in.",
    beanie: "we couldn't hand you back to the app automatically. tap below to finish signing in.",
  },
  'oauth.nativeBridgeAction': { en: 'Return to beanies', beanie: 'return to beanies' },
  // ── i18n sweep 2026-06-15: strings migrated out of hardcoded templates ──
  'plausibleExclude.title.justDone': {
    en: "Done — you're excluded",
    beanie: "done — you're excluded",
  },
  'plausibleExclude.title.already': { en: 'Already excluded', beanie: 'already excluded' },
  'plausibleExclude.title.unavailable': {
    en: 'localStorage unavailable',
    beanie: 'localstorage unavailable',
  },
  'plausibleExclude.title.checking': { en: 'Checking...', beanie: 'checking...' },
  'plausibleExclude.body.justDone': {
    en: 'This browser will no longer be tracked by Plausible on app.beanies.family. Repeat on each device/browser you use.',
    beanie:
      'this browser will no longer be tracked by plausible on app.beanies.family. repeat on each device/browser you use.',
  },
  'plausibleExclude.body.already': {
    en: 'This browser is already excluded from Plausible analytics on app.beanies.family. Nothing to do.',
    beanie:
      'this browser is already excluded from plausible analytics on app.beanies.family. nothing to do.',
  },
  'plausibleExclude.body.unavailable': {
    en: 'Your browser blocked localStorage (private mode?). Try from a normal browser window.',
    beanie: 'your browser blocked localstorage (private mode?). try from a normal browser window.',
  },
  'plausibleExclude.backToApp': { en: 'Back to the app', beanie: 'back to the app' },
  'plausibleExclude.status.justDone': {
    en: 'plausible_ignore set to true',
    beanie: 'plausible_ignore set to true',
  },
  'plausibleExclude.status.already': {
    en: 'plausible_ignore = true',
    beanie: 'plausible_ignore = true',
  },
  'plausibleExclude.status.failed': { en: 'Could not set flag', beanie: 'could not set flag' },
  'notFound.illustrationAlt': {
    en: 'A confused beanie character looking lost',
    beanie: 'a confused beanie character looking lost',
  },
  'notFound.code': { en: '404', beanie: '404' },
  'beanTips.muteFailedTitle': { en: "Couldn't mute tips", beanie: "couldn't mute tips" },
  'beanTips.enableFailedTitle': { en: "Couldn't enable tips", beanie: "couldn't enable tips" },
  'noAccess.illustrationAlt': {
    en: 'A beanie character next to a padlock',
    beanie: 'a beanie character next to a padlock',
  },
  'forecast.illustrationAlt': {
    en: 'A beanie character looking through a telescope',
    beanie: 'a beanie character looking through a telescope',
  },
  'settings.preferredSelectedCount': { en: '{count} / 4 selected', beanie: '{count} / 4 selected' },
  'travel.bookedShort': { en: '{booked}/{total} booked', beanie: '{booked}/{total} booked' },
  'travel.bookedOf': { en: '{booked} of {total} booked', beanie: '{booked} of {total} booked' },
  'travel.flight.earlyMorning': { en: 'early morning', beanie: 'early morning' },
  'travel.flight.lateNight': { en: 'late night', beanie: 'late night' },
  'travel.ideasCount': { en: '{count} ideas', beanie: '{count} ideas' },
  'travel.ideasAndWishes': { en: 'Ideas & wishes', beanie: 'ideas & wishes' },
  'assets.perMonth': { en: '/month', beanie: '/month' },
  'assets.fromAccount': { en: 'from {name}', beanie: 'from {name}' },
  'settings.exchangeRates.title': { en: 'Exchange Rates', beanie: 'exchange rates' },
  'settings.exchangeRates.lastUpdated': { en: 'Last updated:', beanie: 'last updated:' },
  'settings.exchangeRates.stale': { en: 'Rates may be outdated', beanie: 'rates may be outdated' },
  'settings.exchangeRates.updating': { en: 'Updating...', beanie: 'updating...' },
  'settings.exchangeRates.refresh': { en: 'Refresh Rates', beanie: 'refresh rates' },
  'settings.exchangeRates.autoUpdate': { en: 'Auto-update rates', beanie: 'auto-update rates' },
  'settings.exchangeRates.autoUpdateHint': {
    en: 'Automatically fetch new rates daily on app start',
    beanie: 'automatically fetch new rates daily on app start',
  },
  'settings.exchangeRates.currentRates': {
    en: 'Current rates (base: {base})',
    beanie: 'current rates (base: {base})',
  },
  'settings.exchangeRates.currency': { en: 'Currency', beanie: 'currency' },
  'settings.exchangeRates.rate': { en: 'Rate', beanie: 'rate' },
  'settings.exchangeRates.empty': {
    en: 'No exchange rates loaded yet',
    beanie: 'no exchange rates loaded yet',
  },
  'settings.exchangeRates.fetch': { en: 'Fetch Rates', beanie: 'fetch rates' },
  'vacation.field.nextDayBadge': { en: '+1', beanie: '+1' },
  'vacation.field.flightNumberPlaceholder': { en: 'e.g. 1842', beanie: 'e.g. 1842' },
  'vacation.field.carLabelPlaceholder': { en: 'e.g. Tesla Model Y', beanie: 'e.g. tesla model y' },
  'vacation.field.durationPlaceholder': { en: 'e.g. 2 hours', beanie: 'e.g. 2 hours' },
  'vacation.field.locationPlaceholder': {
    en: 'e.g. Downtown, Beach...',
    beanie: 'e.g. downtown, beach...',
  },
  'vacation.celebration.bookedOfItems': {
    en: '{n} of {total} items',
    beanie: '{n} of {total} items',
  },
  'vacation.itemsNeedBooking.one': {
    en: '{n} item needs booking',
    beanie: '{n} item needs booking',
  },
  'vacation.itemsNeedBooking.other': {
    en: '{n} items need booking',
    beanie: '{n} items need booking',
  },
  'vacation.nightsUnaccommodated.one': {
    en: '{n} night unaccommodated',
    beanie: '{n} night unaccommodated',
  },
  'vacation.nightsUnaccommodated.other': {
    en: '{n} nights unaccommodated',
    beanie: '{n} nights unaccommodated',
  },
  'vacation.bookedCount': { en: '{n}/{total} booked', beanie: '{n}/{total} booked' },
  'vacation.everyone': { en: 'everyone!', beanie: 'everyone!' },
  'travel.schedulingHint': { en: 'Scheduling hint', beanie: 'scheduling hint' },
  'action.visitLink': { en: 'Visit link', beanie: 'visit link' },
  'planner.assignedTo': { en: 'Assigned to', beanie: 'assigned to' },
  'planner.reminderSet': { en: 'Reminder set', beanie: 'reminder set' },
  'planner.fromAccount': { en: 'from {name}', beanie: 'from {name}' },
  'planner.vacationDayOf': { en: 'day {day} of {total}', beanie: 'day {day} of {total}' },
  'planner.fee.sessionsCount': { en: '({count} sessions)', beanie: '({count} sessions)' },
  'planner.unit.perMonthAbbrev': { en: '/mo', beanie: '/mo' },
  'planner.unit.perYearAbbrev': { en: '/yr', beanie: '/yr' },
  'planner.reminder.none': { en: 'None', beanie: 'none' },
  'planner.reminder.15min': { en: '15 min', beanie: '15 min' },
  'planner.reminder.30min': { en: '30 min', beanie: '30 min' },
  'planner.reminder.1hour': { en: '1 hour', beanie: '1 hour' },
  'planner.reminder.1day': { en: '1 day', beanie: '1 day' },
  'header.greetingFallbackName': { en: 'there', beanie: 'there' },
  'header.profileAvatar': { en: 'Profile', beanie: 'profile' },
  'header.profileFallbackName': { en: 'User', beanie: 'user' },
  'search.resultCount': { en: '{count} result', beanie: '{count} bean' },
  'search.resultCountPlural': { en: '{count} results', beanie: '{count} beans' },
  'search.noResultsHint': { en: 'try a different keyword', beanie: 'try a different keyword' },
  'search.emptyHint': { en: 'find your beans...', beanie: 'find your beans...' },
  'search.subtitle.recurring': { en: 'recurring', beanie: 'recurring' },
  'search.subtitle.oneTime': { en: 'one-time', beanie: 'one-time' },
  'search.subtitle.done': { en: '✓ done', beanie: '✓ done' },
  'search.subtitle.achieved': { en: '✓ achieved', beanie: '✓ achieved' },
  'search.subtitle.priority': { en: '{priority} priority', beanie: '{priority} priority' },
  'googleDrive.saveErrorTitle': { en: 'Save error: {error}', beanie: 'save error: {error}' },
  'googleDrive.grantPermissionTitle': {
    en: 'Click to grant file permission and load latest data',
    beanie: 'click to grant file permission and load latest data',
  },
  'googleDrive.dataSavedTitle': { en: 'Data saved to {file}', beanie: 'data saved to {file}' },
  'googleDrive.needsPermission': { en: 'Needs permission', beanie: 'needs permission' },
  'currency.rateUnavailable': {
    en: 'Exchange rate not available',
    beanie: 'exchange rate not available',
  },
  'goals.progressOf': { en: '{current} of {target}', beanie: '{current} of {target}' },
  'dashboard.familyNetWorth': { en: 'Family Net Worth', beanie: 'family net worth' },
  'dashboard.vsLastMonth': { en: 'vs last month', beanie: 'vs last month' },
  'dashboard.period.thisWeek': { en: 'this week', beanie: 'this week' },
  'dashboard.period.thisMonth': { en: 'this month', beanie: 'this month' },
  'dashboard.period.past3Months': { en: 'past 3 months', beanie: 'past 3 months' },
  'dashboard.period.thisYear': { en: 'this year', beanie: 'this year' },
  'dashboard.period.allTime': { en: 'all time', beanie: 'all time' },
  'family.card.age': { en: '· age {age}', beanie: '· age {age}' },
  'family.ageLabel': { en: 'age {age}', beanie: 'age {age}' },
  'inviteWizard.qrAlt': { en: 'QR code', beanie: 'qr code' },
  'inviteShare.familyImageAlt': { en: 'beanies family', beanie: 'beanies family' },
  'emptyState.aria.piggyBank': {
    en: 'A beanie looking at an empty piggy bank',
    beanie: 'a beanie looking at an empty piggy bank',
  },
  'emptyState.aria.freshChecklist': {
    en: 'A cheerful beanie holding a fresh checklist',
    beanie: 'a cheerful beanie holding a fresh checklist',
  },
  'emptyState.aria.emptyPockets': {
    en: 'A beanie shrugging with empty pockets',
    beanie: 'a beanie shrugging with empty pockets',
  },
  'emptyState.aria.blankCalendar': {
    en: 'A beanie scratching its head near a blank calendar',
    beanie: 'a beanie scratching its head near a blank calendar',
  },
  'emptyState.aria.treasureChest': {
    en: 'A beanie dreaming about a treasure chest',
    beanie: 'a beanie dreaming about a treasure chest',
  },
  'emptyState.aria.flagOnHill': {
    en: 'A beanie looking up at a flag on a hill',
    beanie: 'a beanie looking up at a flag on a hill',
  },
  'emptyState.aria.emptyChart': {
    en: 'A beanie with a magnifying glass looking at an empty chart',
    beanie: 'a beanie with a magnifying glass looking at an empty chart',
  },
  'emptyState.aria.wavingHello': { en: 'A beanie waving hello', beanie: 'a beanie waving hello' },
  'emptyState.aria.planningBudget': {
    en: 'A beanie planning a budget',
    beanie: 'a beanie planning a budget',
  },
  'datepicker.prevMonth': { en: 'Previous month', beanie: 'previous month' },
  'datepicker.nextMonth': { en: 'Next month', beanie: 'next month' },
  'combobox.custom': { en: 'Custom', beanie: 'custom' },
  'combobox.removeCustom': { en: 'Remove custom institution', beanie: 'remove custom institution' },
  'combobox.noResults': { en: 'No results found', beanie: 'no results found' },
  'multiSelect.selectAll': { en: 'Select All', beanie: 'select all' },
  'multiSelect.noOptions': { en: 'No options available', beanie: 'no options available' },
  'celebration.letsGo': { en: "Let's go!", beanie: "let's go!" },
  'celebration.madeMistakeUndo': { en: 'made a mistake? undo', beanie: 'made a mistake? undo' },
  'invite.qrAlt': { en: 'Invite QR code', beanie: 'invite qr code' },
  'assets.notesPlaceholder': {
    en: 'Additional details about this asset...',
    beanie: 'additional details about this asset...',
  },
  'medications.forLabel': { en: 'For', beanie: 'for' },
  'medications.startedOn': { en: 'started {date}', beanie: 'started {date}' },
  'medications.endsOn': { en: 'ends {date}', beanie: 'ends {date}' },
  'login.beaniesCelebratingAlt': { en: 'beanies celebrating', beanie: 'beanies celebrating' },
  'login.beaniesFamilyIconAlt': { en: 'beanies family', beanie: 'beanies family' },
  'onboarding.beaniesHuggingAlt': {
    en: 'beanies family hugging',
    beanie: 'beanies family hugging',
  },
  'onboarding.perMonthSuffix': { en: '/mo', beanie: '/mo' },
  'onboarding.perDaySuffix': { en: '/day', beanie: '/day' },
  'onboarding.perYearSuffix': { en: '/yr', beanie: '/yr' },
  'goalLink.allocPreview': {
    en: '{amount} of {remaining} remaining',
    beanie: '{amount} of {remaining} remaining',
  },
  'error.localSaveFailed.help': {
    en: 'Your change could not be saved on this device. Check that storage is available (private mode / low disk can block it) and try again.',
    beanie:
      'your change could not be saved on this device. check that storage is available (private mode / low disk can block it) and try again.',
  },
  'error.unexpectedError': {
    en: 'An unexpected error occurred',
    beanie: 'an unexpected error occurred',
  },
  'toast.actionFailed.title': { en: "Hmm, that didn't work", beanie: "hmm, that didn't work" },
  'toast.actionFailed.help': { en: 'Please try again.', beanie: 'please try again.' },
  // ── i18n sweep follow-up: travel-segment detail-row labels (useVacationTimeline) ──
  'segmentRow.airline': { en: 'Airline', beanie: 'airline' },
  'segmentRow.flightNumber': { en: 'Flight #', beanie: 'flight #' },
  'segmentRow.from': { en: 'From', beanie: 'from' },
  'segmentRow.to': { en: 'To', beanie: 'to' },
  'segmentRow.terminal': { en: 'Terminal', beanie: 'terminal' },
  'segmentRow.date': { en: 'Date', beanie: 'date' },
  'segmentRow.departs': { en: 'Departs', beanie: 'departs' },
  'segmentRow.arrives': { en: 'Arrives', beanie: 'arrives' },
  'segmentRow.arrivesNextDay': { en: 'Arrives (+1)', beanie: 'arrives (+1)' },
  'segmentRow.cruiseLine': { en: 'Cruise line', beanie: 'cruise line' },
  'segmentRow.ship': { en: 'Ship', beanie: 'ship' },
  'segmentRow.port': { en: 'Port', beanie: 'port' },
  'segmentRow.cabin': { en: 'Cabin', beanie: 'cabin' },
  'segmentRow.embark': { en: 'Embark', beanie: 'embark' },
  'segmentRow.departTime': { en: 'Depart time', beanie: 'depart time' },
  'segmentRow.disembark': { en: 'Disembark', beanie: 'disembark' },
  'segmentRow.carType': { en: 'Car type', beanie: 'car type' },
  'segmentRow.car': { en: 'Car', beanie: 'car' },
  'segmentRow.leaving': { en: 'Leaving', beanie: 'leaving' },
  'segmentRow.type': { en: 'Type', beanie: 'type' },
  'segmentRow.details': { en: 'Details', beanie: 'details' },
  'segmentRow.time': { en: 'Time', beanie: 'time' },
  'segmentRow.duration': { en: 'Duration', beanie: 'duration' },
  'segmentRow.location': { en: 'Location', beanie: 'location' },
  'segmentRow.operator': { en: 'Operator', beanie: 'operator' },
  'segmentRow.route': { en: 'Route', beanie: 'route' },
  'segmentRow.bookingRef': { en: 'Booking ref', beanie: 'booking ref' },
  'segmentRow.link': { en: 'Link', beanie: 'link' },
  'segmentRow.notes': { en: 'Notes', beanie: 'notes' },
  'segmentRow.address': { en: 'Address', beanie: 'address' },
  'segmentRow.checkIn': { en: 'Check-in', beanie: 'check-in' },
  'segmentRow.checkOut': { en: 'Check-out', beanie: 'check-out' },
  'segmentRow.room': { en: 'Room', beanie: 'room' },
  'segmentRow.confirmation': { en: 'Confirmation', beanie: 'confirmation' },
  'segmentRow.phone': { en: 'Phone', beanie: 'phone' },
  'segmentRow.breakfast': { en: 'Breakfast', beanie: 'breakfast' },
  'segmentRow.included': { en: 'Included', beanie: 'included' },
  'segmentRow.pickupDate': { en: 'Pickup date', beanie: 'pickup date' },
  'segmentRow.pickupTime': { en: 'Pickup time', beanie: 'pickup time' },
  'segmentRow.returnDate': { en: 'Return date', beanie: 'return date' },
  'segmentRow.returnTime': { en: 'Return time', beanie: 'return time' },
  // when-band cell captions (travel timeline hero band)
  'segmentRow.starts': { en: 'Starts', beanie: 'starts' },
  'segmentRow.pickup': { en: 'Pick-up', beanie: 'pick-up' },
  'segmentRow.return': { en: 'Return', beanie: 'return' },
  // ── i18n: transaction category + group names (constants/categories.ts) ──
  'category.freelance': { en: 'Freelance', beanie: 'freelance' },
  'category.salary': { en: 'Salary', beanie: 'salary' },
  'category.consultancy': { en: 'Consultancy', beanie: 'consultancy' },
  'category.other_employment': { en: 'Other Employment Income', beanie: 'other employment income' },
  'category.dividends': { en: 'Dividends', beanie: 'dividends' },
  'category.investments': { en: 'Investment Returns', beanie: 'investment returns' },
  'category.other_investment': { en: 'Other Investment Income', beanie: 'other investment income' },
  'category.rental': { en: 'Rental Income', beanie: 'rental income' },
  'category.other_property': { en: 'Other Property Income', beanie: 'other property income' },
  'category.gifts': { en: 'Gifts Received', beanie: 'gifts received' },
  'category.refunds': { en: 'Refunds', beanie: 'refunds' },
  'category.other_income': { en: 'Other Income', beanie: 'other income' },
  'category.donations': { en: 'Donations', beanie: 'donations' },
  'category.gifts_given': { en: 'Gifts Given', beanie: 'gifts given' },
  'category.other_charity': { en: 'Other Charity', beanie: 'other charity' },
  'category.tuition': { en: 'Tutor / Tuition', beanie: 'tutor / tuition' },
  'category.school_fees': { en: 'School Fees', beanie: 'school fees' },
  'category.other_education': { en: 'Other Education', beanie: 'other education' },
  'category.music_lessons': { en: 'Music Lessons', beanie: 'music lessons' },
  'category.art_lessons': { en: 'Art Lessons', beanie: 'art lessons' },
  'category.dance_lessons': { en: 'Dance Lessons', beanie: 'dance lessons' },
  'category.other_lessons': { en: 'Other Lessons', beanie: 'other lessons' },
  'category.entertainment': { en: 'Entertainment', beanie: 'entertainment' },
  'category.hobbies': { en: 'Hobbies', beanie: 'hobbies' },
  'category.other_entertainment': { en: 'Other Entertainment', beanie: 'other entertainment' },
  'category.childcare': { en: 'Childcare', beanie: 'childcare' },
  'category.pets': { en: 'Pets', beanie: 'pets' },
  'category.other_family': { en: 'Other Family', beanie: 'other family' },
  'category.debt_payment': { en: 'Debt Payment', beanie: 'debt payment' },
  'category.insurance': { en: 'Insurance', beanie: 'insurance' },
  'category.taxes': { en: 'Taxes', beanie: 'taxes' },
  'category.credit_card_spending': { en: 'Credit Card Spending', beanie: 'credit card spending' },
  'category.other_financial': { en: 'Other Financial', beanie: 'other financial' },
  'category.coffee': { en: 'Coffee / Snacks', beanie: 'coffee / snacks' },
  'category.dining_out': { en: 'Dining Out', beanie: 'dining out' },
  'category.groceries': { en: 'Groceries', beanie: 'groceries' },
  'category.other_food': { en: 'Other Food', beanie: 'other food' },
  'category.home_maintenance': { en: 'Home Maintenance', beanie: 'home maintenance' },
  'category.rent': { en: 'Rent / Mortgage', beanie: 'rent / mortgage' },
  'category.utilities': { en: 'Utilities', beanie: 'utilities' },
  'category.other_housing': { en: 'Other Housing', beanie: 'other housing' },
  'category.healthcare': { en: 'Healthcare', beanie: 'healthcare' },
  'category.dental': { en: 'Dental', beanie: 'dental' },
  'category.other_medical': { en: 'Other Medical Expense', beanie: 'other medical expense' },
  'category.other_expense': { en: 'Other Expense', beanie: 'other expense' },
  'category.clothing': { en: 'Clothing / Shopping', beanie: 'clothing / shopping' },
  'category.personal_care': { en: 'Personal Care', beanie: 'personal care' },
  'category.other_personal': { en: 'Other Personal', beanie: 'other personal' },
  'category.sports_equipment': { en: 'Sports Equipment', beanie: 'sports equipment' },
  'category.sports_team': { en: 'Sports Team / Practice', beanie: 'sports team / practice' },
  'category.golf': { en: 'Golf', beanie: 'golf' },
  'category.gym': { en: 'Gym / Fitness', beanie: 'gym / fitness' },
  'category.yoga': { en: 'Yoga / Pilates', beanie: 'yoga / pilates' },
  'category.other_sports': { en: 'Other Sports', beanie: 'other sports' },
  'category.software': { en: 'Software', beanie: 'software' },
  'category.streaming': { en: 'Streaming', beanie: 'streaming' },
  'category.other_subscriptions': { en: 'Other Subscriptions', beanie: 'other subscriptions' },
  'category.car_maintenance': { en: 'Car / Bike Maintenance', beanie: 'car / bike maintenance' },
  'category.car_payment': { en: 'Car Payment', beanie: 'car payment' },
  'category.gas': { en: 'Gas / Fuel', beanie: 'gas / fuel' },
  'category.public_transit': { en: 'Public Transit', beanie: 'public transit' },
  'category.taxi': { en: 'Taxi / Ride Hailing', beanie: 'taxi / ride hailing' },
  'category.other_transportation': { en: 'Other Transportation', beanie: 'other transportation' },
  'category.flights': { en: 'Flight', beanie: 'flight' },
  'category.hotel': { en: 'Hotel', beanie: 'hotel' },
  'category.other_travel': { en: 'Other Travel', beanie: 'other travel' },
  'categoryGroup.charity': { en: 'Charity', beanie: 'charity' },
  'categoryGroup.education': { en: 'Education', beanie: 'education' },
  'categoryGroup.employment': { en: 'Employment', beanie: 'employment' },
  'categoryGroup.entertainment': { en: 'Entertainment', beanie: 'entertainment' },
  'categoryGroup.family': { en: 'Family', beanie: 'family' },
  'categoryGroup.financial': { en: 'Financial', beanie: 'financial' },
  'categoryGroup.food': { en: 'Food', beanie: 'food' },
  'categoryGroup.housing': { en: 'Housing', beanie: 'housing' },
  'categoryGroup.investments': { en: 'Investments', beanie: 'investments' },
  'categoryGroup.lessons': { en: 'Lessons', beanie: 'lessons' },
  'categoryGroup.medical': { en: 'Medical', beanie: 'medical' },
  'categoryGroup.other': { en: 'Other', beanie: 'other' },
  'categoryGroup.personal': { en: 'Personal', beanie: 'personal' },
  'categoryGroup.property': { en: 'Property', beanie: 'property' },
  'categoryGroup.sports': { en: 'Sports', beanie: 'sports' },
  'categoryGroup.subscriptions': { en: 'Subscriptions', beanie: 'subscriptions' },
  'categoryGroup.transportation': { en: 'Transportation', beanie: 'transportation' },
  'categoryGroup.travel': { en: 'Travel', beanie: 'travel' },

  // ── Recipe course, tags and meal grouping (#87) ──────────────────────────
  // Course labels. The stored value is the id; only the label is translated.
  'recipes.course.starter': { en: 'Starter', beanie: 'starter' },
  'recipes.course.main': { en: 'Main', beanie: 'main' },
  'recipes.course.side': { en: 'Side', beanie: 'side' },
  'recipes.course.dessert': { en: 'Dessert', beanie: 'dessert' },
  'recipes.course.drink': { en: 'Drink', beanie: 'drink' },
  'recipes.course.baking': { en: 'Baking', beanie: 'baking' },
  'recipes.course.sauce': { en: 'Sauce', beanie: 'sauce' },
  'recipes.course.other': { en: 'Other', beanie: 'other' },

  // Recipe form — the new fields.
  'recipes.field.course': { en: 'Course', beanie: 'course' },
  'recipes.field.courseNone': { en: 'Not set', beanie: 'not set' },
  'recipes.field.meals': { en: 'Good for', beanie: 'good for' },
  'recipes.field.tags': { en: 'Tags', beanie: 'tags' },
  'recipes.tags.placeholder': { en: 'Add a tag and press enter', beanie: 'add a tag, press enter' },
  'recipes.tags.hint': {
    en: 'Saved in lowercase, so you only ever get one of each.',
    beanie: 'saved in lowercase, so you only ever get one of each.',
  },
  'recipes.tags.remove': { en: 'Remove tag', beanie: 'remove tag' },
  'recipes.tags.suggestions': { en: 'Used before', beanie: 'used before' },
  'recipes.tags.duplicate': {
    en: 'You already have that tag.',
    beanie: 'you already have that one.',
  },
  'recipes.tags.limit': {
    en: 'That is as many tags as one recipe can hold ({max}).',
    beanie: "that's as many tags as one recipe can hold ({max}).",
  },
  'recipes.tags.truncated': {
    en: 'That tag was shortened to fit ({max} characters).',
    beanie: 'that tag got shortened to fit ({max} characters).',
  },

  // Cookbook controls.
  'cookbook.group.none': { en: 'Everything', beanie: 'everything' },
  'cookbook.group.meal': { en: 'By meal', beanie: 'by meal' },
  'cookbook.group.course': { en: 'By course', beanie: 'by course' },
  'cookbook.groupLabel': { en: 'Show', beanie: 'show' },
  'cookbook.filter.all': { en: 'All', beanie: 'all' },
  'cookbook.filterLabel': { en: 'Course', beanie: 'course' },
  'cookbook.sortLabel': { en: 'Sorted by', beanie: 'sorted by' },
  'cookbook.sort.name': { en: 'A\u2013Z', beanie: 'a\u2013z' },
  'cookbook.sort.recent': { en: 'Recently added', beanie: 'recently added' },
  'cookbook.sort.cooked': { en: 'Most cooked', beanie: 'most cooked' },
  'cookbook.shelf.unfiledMeal': {
    en: 'Not filed to a meal yet',
    beanie: 'not filed to a meal yet',
  },
  'cookbook.shelf.unfiledCourse': {
    en: 'No course set yet',
    beanie: 'no course set yet',
  },
  'cookbook.filteredEmpty': {
    en: 'No {course} recipes in the cookbook yet.',
    beanie: 'no {course} recipes in here yet.',
  },
  'cookbook.showAll': { en: 'Show all recipes', beanie: 'show all recipes' },
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

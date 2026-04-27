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
  'modal.canViewFinances': { en: 'Can view finances', beanie: 'can view finances' },
  'modal.canEditActivities': { en: 'Can edit family content', beanie: 'can edit family content' },
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
  'bean.hero.role.parent': { en: 'Parent Bean', beanie: 'parent bean' },
  'bean.hero.role.child': { en: 'Little Bean', beanie: 'little bean' },
  'bean.notFound.title': { en: "We can't find this bean", beanie: "can't find this bean" },
  'bean.notFound.body': {
    en: "This bean isn't in your pod (or has been removed).",
    beanie: "this bean isn't in your pod",
  },
  'bean.overview.comingSoon': {
    en: 'More details about this bean land here soon.',
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
  'bean.overview.viewAll': { en: 'View all →', beanie: 'view all →' },
  'bean.overview.about': { en: 'About', beanie: 'about' },
  'bean.stats.favorites': { en: 'favorites', beanie: 'favorites' },
  'bean.stats.sayings': { en: 'sayings', beanie: 'sayings' },
  'bean.stats.notes': { en: 'notes', beanie: 'notes' },
  'bean.stats.age': { en: 'years old', beanie: 'years old' },
  'bean.hero.edit': { en: 'Edit', beanie: 'edit' },
  'bean.hero.addSomething': { en: 'Add Something', beanie: 'add something' },
  'bean.hero.add.favorite': { en: '💝 Favorite', beanie: '💝 favorite' },
  'bean.hero.add.saying': { en: '💬 Saying', beanie: '💬 saying' },
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
    en: 'No favorites for this bean yet',
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
    en: 'No sayings saved for this bean yet',
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
    en: 'No notes for this bean yet',
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
    en: 'No allergies on file for this bean',
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
  'medications.field.ongoing': { en: 'Ongoing', beanie: 'ongoing' },
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
    en: 'No medications on file for this bean',
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
    en: 'View all →',
    beanie: 'view all →',
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
    en: 'Pick a bean to continue',
    beanie: 'pick a bean to continue',
  },
  'medicationLog.errors.noCurrentMember.detail': {
    en: 'Sign in as the family member giving the dose so we know who to credit.',
    beanie: 'sign in as the bean giving the dose so we know who to credit.',
  },
  'medicationLog.someone': { en: 'someone', beanie: 'someone' },
  'family.discardChanges.title': {
    en: 'Discard your changes?',
    beanie: 'discard your changes?',
  },
  'family.discardChanges.body': {
    en: "You've edited this bean but haven't saved. Close without saving?",
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
    en: 'everything about your beans, in one place',
    beanie: 'everything about your beans, in one place',
  },
  'scrapbook.filter.types': { en: 'Show', beanie: 'show' },
  'scrapbook.filter.members': { en: 'Beans', beanie: 'beans' },
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
  'family.role.pet': { en: '🐾 Pet Beanie', beanie: '🐾 pet beanie' },
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
  'error.backgroundRefreshFailed': {
    en: "Couldn't refresh your data",
    beanie: "couldn't refresh your beanies",
  },
  'error.backgroundRefreshFailedHelp': {
    en: 'Some data may be out of date. Try refreshing the app. If it keeps happening, sign out and sign back in.',
    beanie:
      'some beans may be out of date. try refreshing the app. if it keeps happening, sign out and sign back in.',
  },
  'error.supportNotified': {
    en: 'Support has been notified.',
    beanie: 'support has been notified.',
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
  'date.pick': { en: 'Pick a Date', beanie: 'pick a date' },
  'date.jumpToToday': { en: 'Jump to Today', beanie: 'jump to today' },
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
  'family.addMemberFailed': {
    en: "Couldn't add that beanie — please try again.",
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
  'auth.accountMismatchTitle': {
    en: 'Wrong Google account',
    beanie: 'wrong google account',
  },
  'auth.accountMismatchBody': {
    en: 'Please sign in with {email} to access your data.',
    beanie: 'please sign in with {email} to access your data',
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
    en: 'Every bean in this family has already been claimed. Ask a family admin to add you.',
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
    en: 'Pick a different bean',
    beanie: 'pick a different bean',
  },
  'join.recovery.askForNewInvite': {
    en: 'Ask for a new invite',
    beanie: 'ask for a new invite',
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
    en: 'Share with {email}',
    beanie: 'share with {email}',
  },
  'inviteWizard.step1.cta.confirm': {
    en: 'Confirm {email}',
    beanie: 'confirm {email}',
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
    en: "Yes. The family data file is encrypted with a key only you and your beanies have. Google can't read what's inside — they're just storing the locked file for you.",
    beanie:
      "yes. the family pod is encrypted with a key only you and your beanies have. google can't read what's inside — they're just storing the locked pod for you",
  },
  'inviteWizard.step1.faq.q2': {
    en: 'What about the little beanies?',
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
    en: 'Magic Link Ready',
    beanie: 'magic link ready',
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
    en: "Point a beanie's camera at this — they'll be in the pod in seconds.",
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
    en: "Google couldn't share with that email — double-check it's a Gmail or Workspace address.",
    beanie:
      "google couldn't share with that email — double-check it's a gmail or workspace address",
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
    en: 'Pick a beanie to invite, or add someone new.',
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
    en: 'add a new beanie',
    beanie: 'add a new beanie',
  },
  'inviteWizard.picker.empty': {
    en: 'No beanies waiting yet — add one to send your first invite.',
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
  'todo.allBeans': { en: 'All Beans', beanie: 'all beanies' },
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
    en: 'something went wrong',
    beanie: 'oh no, a bean got stuck',
  },
  'setupProgress.error.description': {
    en: "Don't worry — your data is safely cached on this device. You can try again, continue without saving to your file, or go back.",
    beanie:
      "don't worry — your beans are safely cached on this device. you can try again, continue without saving to your beanpod, or go back.",
  },
  'setupProgress.error.retry': { en: 'Try Again', beanie: 'try again' },
  'setupProgress.error.continue': { en: 'Continue Anyway', beanie: 'continue anyway' },
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
  'nook.motto37': {
    en: "There's more to life than being really, really, ridiculously beanie looking.",
    beanie: "there's more to life than being really, really, ridiculously beanie looking.",
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
  'nook.dutyDone': {
    en: 'Done',
    beanie: 'done',
  },
  'nook.dutyMarkDone': {
    en: 'Mark done',
    beanie: 'mark done',
  },
  'nook.criticalMore': {
    en: 'more for you today',
    beanie: 'more beans for you today',
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
  'googleDrive.downloadBackupUnavailableTitle': {
    en: "Can't prepare a backup right now",
    beanie: "can't prepare a backup right now",
  },
  'googleDrive.downloadBackupUnavailableBody': {
    en: 'Your session key or pod envelope is missing. Reconnect to Google Drive and try again.',
    beanie: 'your session key or pod envelope is missing. reconnect to google drive and try again.',
  },
  'googleDrive.downloadBackupFailedTitle': {
    en: 'Backup download failed',
    beanie: 'backup download failed',
  },
  'googleDrive.downloadBackupFailedBody': {
    en: "We couldn't prepare your backup file. Check your connection and try again.",
    beanie: "we couldn't prepare your backup. check your connection and try again.",
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
  'planner.openAgenda': { en: 'Open agenda view', beanie: 'open agenda view' },
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
  // Beanie tip of the day
  'tips.label': { en: 'Beanie Tip of the Day', beanie: 'beanie tip of the day' },
  'tips.gotIt': { en: 'Got It', beanie: 'got it' },
  'tips.tryIt': { en: 'Try It', beanie: 'try it' },
  'tips.dontShowTips': { en: "Don't Show Tips", beanie: "don't show tips" },

  // What's New modal
  'whatsNew.title': { en: "What's New", beanie: "what's new" },
  'whatsNew.gotItThanks': { en: 'Got It, Thanks', beanie: 'got it, thanks' },
  'whatsNew.seeAll': { en: 'See All Release Notes', beanie: 'see all release notes' },
  'whatsNew.alsoFixed': { en: 'Also Fixed', beanie: 'also fixed' },
  'whatsNew.tryIt': { en: 'Try It', beanie: 'try it' },

  // Navigation
  'nav.beanstalk': { en: 'Beanie Beanstalk', beanie: 'beanie beanstalk' },
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
  'action.showLess': { en: 'Show less', beanie: 'show less' },
  'travel.today.label': { en: 'Today', beanie: 'today' },
  'travel.today.dayPrefix': { en: 'Day', beanie: 'day' },
  'travel.today.of': { en: 'of', beanie: 'of' },
  'travel.today.freeDay': { en: 'free and easy', beanie: 'free and easy — go frolic' },
  'travel.today.tripEnded': {
    en: 'This trip has wrapped up',
    beanie: 'this trip has wrapped up — welcome home',
  },

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
  'photos.noPhotos': { en: 'No photos yet', beanie: 'no photos yet' },
  'photos.uploading': { en: 'Uploading…', beanie: 'counting beans\u2026' },
  'photos.uploadFailed': {
    en: "Couldn't upload photo. Please try again.",
    beanie: "couldn't upload photo. please try again.",
  },
  'photos.queuedOffline': {
    en: "You're offline. Photo will upload when you're back online.",
    beanie: "you're offline. photo will upload when you're back online.",
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
  'quickAdd.saying.hint': { en: 'quote a beanie', beanie: 'quote a beanie' },
  'quickAdd.favorite.label': { en: 'Favorite', beanie: 'favorite' },
  'quickAdd.favorite.hint': { en: 'food · game · song', beanie: 'food · game · song' },
  'quickAdd.note.label': { en: 'Note', beanie: 'note' },
  'quickAdd.note.hint': { en: 'per-bean journal', beanie: 'per-bean journal' },
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
    en: "The Quick-add menu is hidden on this page for focus. Tap the beanie once you're back on the main app.",
    beanie:
      "the quick-add menu is hidden on this page for focus. tap the beanie once you're back on the main app.",
  },

  // Quick-add FAB — parent picker (bean / recipe / medication)
  'quickAdd.picker.back': { en: 'Back', beanie: 'back' },
  'quickAdd.picker.bean.title': { en: 'Pick a beanie', beanie: 'pick a beanie' },
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
    en: 'No active medications — add one from a beanie‘s Care tab.',
    beanie: 'no active medications — add one from a beanie‘s care tab.',
  },
  'quickAdd.picker.vacation.title': { en: 'Pick a trip', beanie: 'pick a trip' },
  'quickAdd.picker.vacation.empty': {
    en: "You haven't added any trips yet — start one from Travel Plans.",
    beanie: "you haven't added any trips yet — start one from travel plans.",
  },
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

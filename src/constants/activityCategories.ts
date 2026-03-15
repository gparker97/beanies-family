// ── Activity Category Definitions ───────────────────────────────────────────
// Single source of truth for all activity categories.
// Colors, emojis, groups, and helpers are all derived from this one array.

export interface ActivityCategoryDef {
  id: string;
  name: string;
  emoji: string;
  color: string;
  group: string;
}

export const ACTIVITY_CATEGORIES: ActivityCategoryDef[] = [
  // School
  {
    id: 'after_school',
    name: 'After School Activity',
    emoji: '🏫',
    color: '#3B82F6',
    group: 'School',
  },
  {
    id: 'school_recital',
    name: 'School Recital / Presentation',
    emoji: '🎭',
    color: '#2563EB',
    group: 'School',
  },
  {
    id: 'other_school',
    name: 'Other School Activity',
    emoji: '📋',
    color: '#1D4ED8',
    group: 'School',
  },

  // Educational
  { id: 'tutoring', name: 'Tutoring', emoji: '📚', color: '#8B5CF6', group: 'Educational' },
  { id: 'math', name: 'Math', emoji: '🧮', color: '#7C3AED', group: 'Educational' },
  { id: 'language', name: 'Language', emoji: '🌐', color: '#6D28D9', group: 'Educational' },
  { id: 'science', name: 'Science', emoji: '🔬', color: '#5B21B6', group: 'Educational' },
  {
    id: 'other_educational',
    name: 'Other Educational',
    emoji: '📖',
    color: '#4C1D95',
    group: 'Educational',
  },

  // Sports
  { id: 'tennis', name: 'Tennis', emoji: '🎾', color: '#22C55E', group: 'Sports' },
  { id: 'badminton', name: 'Badminton', emoji: '🏸', color: '#16A34A', group: 'Sports' },
  { id: 'golf_activity', name: 'Golf', emoji: '⛳', color: '#15803D', group: 'Sports' },
  { id: 'baseball', name: 'Baseball', emoji: '⚾', color: '#166534', group: 'Sports' },
  { id: 'gym_activity', name: 'Training', emoji: '🏋️', color: '#059669', group: 'Sports' },
  { id: 'yoga_activity', name: 'Yoga / Pilates', emoji: '🧘', color: '#0D9488', group: 'Sports' },
  { id: 'gymnastics', name: 'Gymnastics', emoji: '🤸', color: '#10B981', group: 'Sports' },
  {
    id: 'other_sports_activity',
    name: 'Other Sports',
    emoji: '🏃',
    color: '#14B8A6',
    group: 'Sports',
  },

  // Competitions
  {
    id: 'spelling_bee',
    name: 'Spelling Bee',
    emoji: '🐝',
    color: '#F59E0B',
    group: 'Competitions',
  },
  {
    id: 'math_competition',
    name: 'Math Competition',
    emoji: '🔢',
    color: '#D97706',
    group: 'Competitions',
  },
  {
    id: 'cubing',
    name: 'Cubing Competition',
    emoji: '🧩',
    color: '#B45309',
    group: 'Competitions',
  },
  {
    id: 'other_competition',
    name: 'Other Competition',
    emoji: '🏆',
    color: '#92400E',
    group: 'Competitions',
  },

  // Lessons
  { id: 'piano', name: 'Piano', emoji: '🎹', color: '#AED6F1', group: 'Lessons' },
  { id: 'guitar', name: 'Guitar', emoji: '🎸', color: '#93C5FD', group: 'Lessons' },
  { id: 'trumpet', name: 'Trumpet', emoji: '🎺', color: '#60A5FA', group: 'Lessons' },
  { id: 'drum', name: 'Drum', emoji: '🥁', color: '#3B82F6', group: 'Lessons' },
  { id: 'music', name: 'Music', emoji: '🎵', color: '#2563EB', group: 'Lessons' },
  { id: 'art', name: 'Art', emoji: '🎨', color: '#818CF8', group: 'Lessons' },
  { id: 'dance', name: 'Dance / Ballet', emoji: '💃', color: '#A78BFA', group: 'Lessons' },
  { id: 'swimming', name: 'Swimming', emoji: '🏊', color: '#38BDF8', group: 'Lessons' },
  { id: 'other_lesson', name: 'Other Lesson', emoji: '📓', color: '#7C3AED', group: 'Lessons' },

  // Fun
  { id: 'birthday', name: 'Birthday Party', emoji: '🎂', color: '#F15D22', group: 'Fun' },
  { id: 'wedding', name: 'Wedding', emoji: '💒', color: '#E67E22', group: 'Fun' },
  { id: 'bar_mitzvah', name: 'Bar Mitzvah', emoji: '✡️', color: '#D97706', group: 'Fun' },
  {
    id: 'other_celebration',
    name: 'Other Celebration',
    emoji: '🎉',
    color: '#F59E0B',
    group: 'Fun',
  },
];

// ── Derived Maps (from single source of truth) ─────────────────────────────

/** Activity category ID → emoji */
export const ACTIVITY_EMOJI_MAP: Record<string, string> = Object.fromEntries(
  ACTIVITY_CATEGORIES.map((c) => [c.id, c.emoji])
);

/** Activity category ID → color */
export const ACTIVITY_COLORS: Record<string, string> = Object.fromEntries(
  ACTIVITY_CATEGORIES.map((c) => [c.id, c.color])
);

/** Activity group → emoji for chip picker headers */
export const ACTIVITY_GROUP_EMOJI_MAP: Record<string, string> = {
  School: '🏫',
  Educational: '📚',
  Sports: '⚽',
  Competitions: '🏆',
  Lessons: '🎵',
  Fun: '🎉',
};

// ── Helpers ─────────────────────────────────────────────────────────────────

const _categoryMap = new Map(ACTIVITY_CATEGORIES.map((c) => [c.id, c]));

export function getActivityCategoryById(id: string): ActivityCategoryDef | undefined {
  return _categoryMap.get(id);
}

export interface ActivityCategoryGroup {
  name: string;
  categories: ActivityCategoryDef[];
}

export function getActivityCategoriesGrouped(): ActivityCategoryGroup[] {
  const groupMap = new Map<string, ActivityCategoryDef[]>();

  for (const cat of ACTIVITY_CATEGORIES) {
    const existing = groupMap.get(cat.group) || [];
    existing.push(cat);
    groupMap.set(cat.group, existing);
  }

  const groups: ActivityCategoryGroup[] = [];
  for (const [name, cats] of groupMap.entries()) {
    groups.push({ name, categories: cats });
  }

  return groups;
}

/** Fallback emoji for an activity category (used when activity has no custom icon) */
export function getActivityFallbackEmoji(categoryId: string): string {
  return ACTIVITY_EMOJI_MAP[categoryId] ?? '📌';
}

/** Default color for an activity category */
export function getActivityCategoryColor(categoryId: string): string {
  return ACTIVITY_COLORS[categoryId] ?? '#95A5A6';
}

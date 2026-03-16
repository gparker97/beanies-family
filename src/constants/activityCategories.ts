// ── Activity Category Definitions ───────────────────────────────────────────
// Single source of truth for all activity categories.
// Colors, emojis, groups, and helpers are all derived from this one array.
// Categories within groups are alphabetical, with "Other *" items last.
// Groups are alphabetical, with the "Other" group last.

export interface ActivityCategoryDef {
  id: string;
  name: string;
  emoji: string;
  color: string;
  group: string;
}

export const ACTIVITY_CATEGORIES: ActivityCategoryDef[] = [
  // Appointments
  { id: 'dentist', name: 'Dentist', emoji: '🦷', color: '#DC2626', group: 'Appointments' },
  { id: 'doctor', name: 'Doctor', emoji: '🩺', color: '#EF4444', group: 'Appointments' },
  { id: 'eye_exam', name: 'Eye Exam', emoji: '👁️', color: '#B91C1C', group: 'Appointments' },
  { id: 'haircut', name: 'Haircut', emoji: '💇', color: '#F87171', group: 'Appointments' },
  {
    id: 'other_appointment',
    name: 'Other Appointment',
    emoji: '📋',
    color: '#991B1B',
    group: 'Appointments',
  },

  // Competitions
  {
    id: 'cubing',
    name: 'Cubing Competition',
    emoji: '🧩',
    color: '#B45309',
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
    id: 'spelling_bee',
    name: 'Spelling Bee',
    emoji: '🐝',
    color: '#F59E0B',
    group: 'Competitions',
  },
  {
    id: 'other_competition',
    name: 'Other Competition',
    emoji: '🏆',
    color: '#92400E',
    group: 'Competitions',
  },

  // Educational
  { id: 'language', name: 'Language', emoji: '🌐', color: '#6D28D9', group: 'Educational' },
  { id: 'math', name: 'Math', emoji: '🧮', color: '#7C3AED', group: 'Educational' },
  { id: 'science', name: 'Science', emoji: '🔬', color: '#5B21B6', group: 'Educational' },
  { id: 'tutoring', name: 'Tutoring', emoji: '📚', color: '#8B5CF6', group: 'Educational' },
  {
    id: 'other_educational',
    name: 'Other Educational',
    emoji: '📖',
    color: '#4C1D95',
    group: 'Educational',
  },

  // Fun
  { id: 'bar_mitzvah', name: 'Bar Mitzvah', emoji: '✡️', color: '#D97706', group: 'Fun' },
  { id: 'birthday', name: 'Birthday Party', emoji: '🎂', color: '#F15D22', group: 'Fun' },
  { id: 'wedding', name: 'Wedding', emoji: '💒', color: '#E67E22', group: 'Fun' },
  {
    id: 'other_celebration',
    name: 'Other Celebration',
    emoji: '🎉',
    color: '#F59E0B',
    group: 'Fun',
  },

  // Lessons
  { id: 'art', name: 'Art', emoji: '🎨', color: '#818CF8', group: 'Lessons' },
  { id: 'dance', name: 'Dance / Ballet', emoji: '💃', color: '#A78BFA', group: 'Lessons' },
  { id: 'drum', name: 'Drum', emoji: '🥁', color: '#3B82F6', group: 'Lessons' },
  { id: 'guitar', name: 'Guitar', emoji: '🎸', color: '#93C5FD', group: 'Lessons' },
  { id: 'music', name: 'Music', emoji: '🎵', color: '#2563EB', group: 'Lessons' },
  { id: 'piano', name: 'Piano', emoji: '🎹', color: '#AED6F1', group: 'Lessons' },
  { id: 'swimming', name: 'Swimming', emoji: '🏊', color: '#38BDF8', group: 'Lessons' },
  { id: 'trumpet', name: 'Trumpet', emoji: '🎺', color: '#60A5FA', group: 'Lessons' },
  { id: 'other_lesson', name: 'Other Lesson', emoji: '📓', color: '#7C3AED', group: 'Lessons' },

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

  // Sports
  { id: 'badminton', name: 'Badminton', emoji: '🏸', color: '#16A34A', group: 'Sports' },
  { id: 'baseball', name: 'Baseball', emoji: '⚾', color: '#166534', group: 'Sports' },
  { id: 'football', name: 'Football', emoji: '🏈', color: '#86EFAC', group: 'Sports' },
  { id: 'golf_activity', name: 'Golf', emoji: '⛳', color: '#15803D', group: 'Sports' },
  { id: 'gymnastics', name: 'Gymnastics', emoji: '🤸', color: '#10B981', group: 'Sports' },
  { id: 'multi_sport', name: 'Multi Sport', emoji: '🏅', color: '#065F46', group: 'Sports' },
  { id: 'rugby', name: 'Rugby', emoji: '🏉', color: '#34D399', group: 'Sports' },
  { id: 'soccer', name: 'Soccer', emoji: '⚽', color: '#4ADE80', group: 'Sports' },
  { id: 'tennis', name: 'Tennis', emoji: '🎾', color: '#22C55E', group: 'Sports' },
  { id: 'gym_activity', name: 'Training', emoji: '🏋️', color: '#059669', group: 'Sports' },
  { id: 'yoga_activity', name: 'Yoga / Pilates', emoji: '🧘', color: '#0D9488', group: 'Sports' },
  {
    id: 'other_sports_activity',
    name: 'Other Sports',
    emoji: '🏃',
    color: '#14B8A6',
    group: 'Sports',
  },

  // Other (always last group)
  { id: 'other_activity', name: 'Other Activity', emoji: '📌', color: '#6B7280', group: 'Other' },
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

/** Activity category ID → group name */
export const ACTIVITY_GROUP_MAP: Record<string, string> = Object.fromEntries(
  ACTIVITY_CATEGORIES.map((c) => [c.id, c.group])
);

/** Group name → representative emoji (for group headers in pickers) */
export const ACTIVITY_GROUP_EMOJI_MAP: Record<string, string> = {
  Appointments: '🩺',
  Competitions: '🏆',
  Educational: '📚',
  Fun: '🎉',
  Lessons: '🎵',
  School: '🏫',
  Sports: '⚽',
  Other: '📌',
};

// ── Helpers ─────────────────────────────────────────────────────────────────

const _categoryMap = new Map(ACTIVITY_CATEGORIES.map((c) => [c.id, c]));

export function getActivityCategoryById(id: string): ActivityCategoryDef | undefined {
  return _categoryMap.get(id);
}

export function getActivityFallbackEmoji(categoryId: string): string {
  return ACTIVITY_EMOJI_MAP[categoryId] ?? '📌';
}

export interface ActivityCategoryGroup {
  name: string;
  categories: ActivityCategoryDef[];
}

/**
 * Return categories grouped by group name.
 * Groups are alphabetical with "Other" last.
 * Categories within each group are alphabetical with "Other *" items last.
 */
export function getActivityCategoriesGrouped(): ActivityCategoryGroup[] {
  const groupMap = new Map<string, ActivityCategoryDef[]>();

  for (const cat of ACTIVITY_CATEGORIES) {
    const existing = groupMap.get(cat.group) || [];
    existing.push(cat);
    groupMap.set(cat.group, existing);
  }

  // Sort categories within each group: alphabetical, "Other *" last
  for (const cats of groupMap.values()) {
    cats.sort((a, b) => {
      const aIsOther = a.name.toLowerCase().startsWith('other');
      const bIsOther = b.name.toLowerCase().startsWith('other');
      if (aIsOther !== bIsOther) return aIsOther ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
  }

  // Sort groups: alphabetical, "Other" last
  const entries = [...groupMap.entries()].sort(([a], [b]) => {
    if (a === 'Other') return 1;
    if (b === 'Other') return -1;
    return a.localeCompare(b);
  });

  return entries.map(([name, categories]) => ({ name, categories }));
}

/** Look up the color for a category, falling back to group-based color */
export function getActivityCategoryColor(id: string): string {
  return ACTIVITY_COLORS[id] ?? '#6B7280';
}

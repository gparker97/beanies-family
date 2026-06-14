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
  { id: 'therapy', name: 'Therapy', emoji: '🛋️', color: '#FCA5A5', group: 'Appointments' },
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
    id: 'gymnastics_competition',
    name: 'Gymnastics Competition',
    emoji: '🤸',
    color: '#EAB308',
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
    id: 'swimming_competition',
    name: 'Swimming Competition',
    emoji: '🏊',
    color: '#FBBF24',
    group: 'Competitions',
  },
  {
    id: 'track_field',
    name: 'Track & Field',
    emoji: '🏃',
    color: '#FCD34D',
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

  // Fun (was Entertainment — id `other_entertainment` kept for data continuity)
  { id: 'arcade', name: 'Arcade', emoji: '🕹️', color: '#AD1457', group: 'Fun' },
  { id: 'beach', name: 'Beach', emoji: '🏖️', color: '#F06292', group: 'Fun' },
  { id: 'bowling', name: 'Bowling', emoji: '🎳', color: '#C2185B', group: 'Fun' },
  { id: 'concert', name: 'Concert', emoji: '🎵', color: '#BE185D', group: 'Fun' },
  { id: 'movie', name: 'Movie', emoji: '🎬', color: '#DB2777', group: 'Fun' },
  { id: 'museum', name: 'Museum', emoji: '🏛️', color: '#9D174D', group: 'Fun' },
  { id: 'festival', name: 'Festival / Fair', emoji: '🎪', color: '#F472B6', group: 'Fun' },
  { id: 'playground', name: 'Playground / Park', emoji: '🛝', color: '#F48FB1', group: 'Fun' },
  { id: 'pool', name: 'Pool / Swim', emoji: '🏊', color: '#EC407A', group: 'Fun' },
  { id: 'show', name: 'Show / Musical', emoji: '🎭', color: '#EC4899', group: 'Fun' },
  {
    id: 'sporting_event',
    name: 'Sporting Event',
    emoji: '🏟️',
    color: '#BE123C',
    group: 'Fun',
  },
  { id: 'theme_park', name: 'Theme Park', emoji: '🎢', color: '#E11D48', group: 'Fun' },
  { id: 'zoo', name: 'Zoo / Aquarium', emoji: '🦁', color: '#880E4F', group: 'Fun' },
  {
    id: 'other_entertainment',
    name: 'Other Fun Thing',
    emoji: '✨',
    color: '#831843',
    group: 'Fun',
  },

  // Food
  { id: 'brunch', name: 'Brunch', emoji: '🥞', color: '#06B6D4', group: 'Food' },
  { id: 'coffee', name: 'Coffee', emoji: '☕', color: '#0E7490', group: 'Food' },
  { id: 'dining_out', name: 'Dining Out', emoji: '🍽️', color: '#0891B2', group: 'Food' },
  { id: 'drinks', name: 'Drinks', emoji: '🍹', color: '#14B8A6', group: 'Food' },
  { id: 'picnic', name: 'Picnic', emoji: '🧺', color: '#0D9488', group: 'Food' },
  { id: 'other_food', name: 'Other Food', emoji: '🍴', color: '#155E75', group: 'Food' },

  // Party
  { id: 'anniversary', name: 'Anniversary', emoji: '💍', color: '#FB923C', group: 'Party' },
  { id: 'baby_shower', name: 'Baby Shower', emoji: '🍼', color: '#FCD34D', group: 'Party' },
  { id: 'bar_mitzvah', name: 'Bar Mitzvah', emoji: '✡️', color: '#D97706', group: 'Party' },
  { id: 'birthday', name: 'Birthday Party', emoji: '🎂', color: '#F15D22', group: 'Party' },
  { id: 'graduation', name: 'Graduation', emoji: '🎓', color: '#FBBF24', group: 'Party' },
  { id: 'wedding', name: 'Wedding', emoji: '💒', color: '#E67E22', group: 'Party' },
  {
    id: 'other_celebration',
    name: 'Other Celebration',
    emoji: '🎉',
    color: '#F59E0B',
    group: 'Party',
  },

  // Lessons
  { id: 'art', name: 'Art', emoji: '🎨', color: '#818CF8', group: 'Lessons' },
  { id: 'chess', name: 'Chess', emoji: '♟️', color: '#5C6BC0', group: 'Lessons' },
  { id: 'coding', name: 'Coding / Robotics', emoji: '🤖', color: '#3F51B5', group: 'Lessons' },
  { id: 'dance', name: 'Dance / Ballet', emoji: '💃', color: '#A78BFA', group: 'Lessons' },
  { id: 'drama', name: 'Drama / Acting', emoji: '🎭', color: '#9FA8DA', group: 'Lessons' },
  { id: 'voice', name: 'Singing / Voice', emoji: '🎤', color: '#7986CB', group: 'Lessons' },
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
    id: 'field_trip',
    name: 'Field Trip',
    emoji: '🚌',
    color: '#2563EB',
    group: 'School',
  },
  {
    id: 'school_recital',
    name: 'School Recital / Presentation',
    emoji: '🎭',
    color: '#1E40AF',
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
  { id: 'basketball', name: 'Basketball', emoji: '🏀', color: '#65A30D', group: 'Sports' },
  { id: 'football', name: 'Football', emoji: '🏈', color: '#86EFAC', group: 'Sports' },
  { id: 'golf_activity', name: 'Golf', emoji: '⛳', color: '#15803D', group: 'Sports' },
  { id: 'gymnastics', name: 'Gymnastics', emoji: '🤸', color: '#10B981', group: 'Sports' },
  { id: 'mma', name: 'MMA', emoji: '🥊', color: '#047857', group: 'Sports' },
  { id: 'multi_sport', name: 'Multi Sport', emoji: '🏅', color: '#065F46', group: 'Sports' },
  { id: 'rugby', name: 'Rugby', emoji: '🏉', color: '#34D399', group: 'Sports' },
  { id: 'soccer', name: 'Soccer', emoji: '⚽', color: '#4ADE80', group: 'Sports' },
  { id: 'taekwondo', name: 'Taekwondo', emoji: '🥋', color: '#0F766E', group: 'Sports' },
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

  // Pets
  { id: 'pet_grooming', name: 'Grooming', emoji: '✂️', color: '#C2410C', group: 'Pets' },
  { id: 'vet', name: 'Vet', emoji: '🩺', color: '#EA580C', group: 'Pets' },
  { id: 'other_pet', name: 'Other Pet', emoji: '🐾', color: '#9A3412', group: 'Pets' },

  // Religious
  {
    id: 'religious_class',
    name: 'Religious Class',
    emoji: '📿',
    color: '#4338CA',
    group: 'Religious',
  },
  { id: 'worship', name: 'Worship / Service', emoji: '🙏', color: '#4F46E5', group: 'Religious' },
  {
    id: 'other_religious',
    name: 'Other Religious',
    emoji: '⛪',
    color: '#6366F1',
    group: 'Religious',
  },

  // Social
  { id: 'date_night', name: 'Date Night', emoji: '💑', color: '#C026D3', group: 'Social' },
  { id: 'family_visit', name: 'Family Visit', emoji: '👵', color: '#D946EF', group: 'Social' },
  { id: 'playdate', name: 'Playdate', emoji: '🧒', color: '#A21CAF', group: 'Social' },
  { id: 'other_social', name: 'Other Social', emoji: '🧑‍🤝‍🧑', color: '#86198F', group: 'Social' },

  // Work
  { id: 'conference', name: 'Conference', emoji: '🎤', color: '#1E293B', group: 'Work' },
  { id: 'networking', name: 'Networking', emoji: '🧑‍💼', color: '#94A3B8', group: 'Work' },
  {
    id: 'team_building',
    name: 'Team Building / Outing',
    emoji: '🤝',
    color: '#64748B',
    group: 'Work',
  },
  { id: 'work_dinner', name: 'Work Dinner', emoji: '🍽️', color: '#475569', group: 'Work' },
  { id: 'work_drinks', name: 'Work Drinks', emoji: '🍻', color: '#334155', group: 'Work' },
  { id: 'work_party', name: 'Office Party', emoji: '🎊', color: '#52525B', group: 'Work' },
  { id: 'other_work', name: 'Other Work', emoji: '🏢', color: '#0F172A', group: 'Work' },

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
  Fun: '🎈',
  Food: '🍽️',
  Lessons: '🎵',
  Party: '🎉',
  Pets: '🐾',
  Religious: '⛪',
  School: '🏫',
  Social: '🧑‍🤝‍🧑',
  Sports: '⚽',
  Work: '💼',
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

function buildActivityCategoriesGrouped(): ActivityCategoryGroup[] {
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

/**
 * The grouped+sorted view, derived purely from the immutable ACTIVITY_CATEGORIES, so
 * it never changes at runtime — computed ONCE at module load (the Map build + the
 * ~100-id localeCompare sort passes used to re-run on every picker recompute / locale
 * toggle). Display *labels* (i18n / beanie) are applied separately by
 * `useActivityCategoryLabel` at render. Treat the returned structure as READ-ONLY.
 */
const ACTIVITY_CATEGORIES_GROUPED = buildActivityCategoriesGrouped();

/**
 * Return categories grouped by group name.
 * Groups are alphabetical with "Other" last.
 * Categories within each group are alphabetical with "Other *" items last.
 */
export function getActivityCategoriesGrouped(): ActivityCategoryGroup[] {
  return ACTIVITY_CATEGORIES_GROUPED;
}

/** Look up the color for a category, falling back to group-based color */
export function getActivityCategoryColor(id: string): string {
  return ACTIVITY_COLORS[id] ?? '#6B7280';
}

/** Look up the human-readable name for a category ID */
export function getActivityCategoryName(id: string): string {
  return _categoryMap.get(id)?.name ?? id;
}

/**
 * Emoji + ordering map for EmergencyContactCategory values. Extracted
 * so the form modal, list page, and Care & Safety preview can share
 * the same icons without drifting.
 */
import type { EmergencyContactCategory } from '@/types/models';

export const CATEGORY_EMOJI: Record<EmergencyContactCategory, string> = {
  doctor: '\u{1FA7A}',
  dentist: '\u{1F9B7}',
  nurse: '\u{1F482}',
  teacher: '\u{1F469}\u200D\u{1F3EB}',
  school: '\u{1F3EB}',
  other: '\u2728',
};

/**
 * Display order for grouped lists + filter chips. Medical first, then
 * education, then the catch-all. Keep in sync with `EmergencyContactCategory`.
 */
export const CATEGORY_ORDER: EmergencyContactCategory[] = [
  'doctor',
  'dentist',
  'nurse',
  'teacher',
  'school',
  'other',
];

import { getActivityFallbackEmoji } from '@/constants/activityCategories';
import type { FamilyActivity } from '@/types/models';

/**
 * The glyph that says WHAT an activity is.
 *
 * Category used to be carried by hue, which never worked: there are 95 categories
 * across 86 colours, and the Appointments group alone is five shades of red for
 * dentist / doctor / eye exam / haircut / therapy, rendered as a 5px edge. Nobody
 * separates 86 hues. Every category already carries a distinct emoji (95 of 95,
 * 84 distinct), so category moved to the glyph and hue was freed for the bean.
 *
 * `activity.icon` is the user's own choice and wins; the category emoji is the
 * fallback. `getActivityFallbackEmoji` terminates in '📌', so this never returns
 * empty and a card can never render a blank where the category should be.
 *
 * Collapses six copies of this expression (MonthChip, ActivityListCard,
 * ScheduleCards ×2, useCriticalItems, FamilyPlannerPage).
 */
export function activityEmoji(activity: Pick<FamilyActivity, 'icon' | 'category'>): string {
  return activity.icon ?? getActivityFallbackEmoji(activity.category);
}

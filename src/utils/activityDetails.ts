/**
 * The ONE definition of "an activity's key details".
 *
 * The wall's drill-in sheet and the app's detail surfaces answer the same
 * question — what does someone need to know about this thing? — on very
 * different screens. Letting each decide for itself is how the wall ended up
 * showing a location and a category while omitting the pickup, which is the
 * single most-asked question in a kitchen.
 *
 * So the DEFINITION is shared and pure; the RENDERING is not. A phone can
 * afford a labelled two-column list and inline editing; a wall read from two
 * metres wants five big rows and no controls.
 *
 * FINANCE IS DELIBERATELY ABSENT. `cost` and the linked transaction are real
 * activity fields, and they must never reach a screen that hangs in a kitchen
 * where guests, babysitters and children read it. This is the same promise the
 * `eslint.config.js` finance zone enforces for the wall's imports; keeping the
 * rows free of it means no caller can leak them by accident.
 */
import type { FamilyActivity } from '@/types/models';
import type { UIStringKey } from '@/services/translation/uiStrings';
import type { BeanieIconName } from '@/constants/icons';

export interface ActivityDetailRow {
  /** Label key — callers translate, so this stays pure and testable. */
  labelKey: UIStringKey;
  value: string;
  /** Set when the row names a person, so a renderer can show their avatar. */
  memberId?: string;
  /**
   * Registry icon for the row, so every renderer shows the SAME glyph for the same
   * row rather than each picking its own. Typed against the registry, so a name that
   * does not exist is a compile error rather than a placeholder circle in production.
   */
  icon: BeanieIconName;
}

export interface ActivityDetailInput {
  activity: FamilyActivity;
  /** Resolves a member id to a display name; absent members are skipped. */
  nameFor: (id: string) => string | undefined;
}

/**
 * The SUPPORTING details — who is moving the child, and who to ring.
 *
 * Time and place are deliberately NOT here. They are the two things every
 * surface leads with, so they belong in the header where they can be set large,
 * not buried as the first two rows of a label/value list. Keeping them out
 * means a renderer cannot accidentally demote them.
 */
export function activityDetailRows({
  activity,
  nameFor,
}: ActivityDetailInput): ActivityDetailRow[] {
  const rows: ActivityDetailRow[] = [];

  const dropoff = activity.dropoffMemberId ? nameFor(activity.dropoffMemberId) : undefined;
  if (dropoff) {
    rows.push({
      labelKey: 'planner.field.dropoff',
      value: dropoff,
      memberId: activity.dropoffMemberId,
      icon: 'car',
    });
  }

  const pickup = activity.pickupMemberId ? nameFor(activity.pickupMemberId) : undefined;
  if (pickup) {
    rows.push({
      labelKey: 'planner.field.pickup',
      value: pickup,
      memberId: activity.pickupMemberId,
      icon: 'car',
    });
  }

  if (activity.instructorName) {
    rows.push({
      labelKey: 'planner.field.instructor',
      value: activity.instructorName,
      icon: 'user',
    });
  }
  if (activity.instructorContact) {
    rows.push({
      labelKey: 'planner.field.instructorContact',
      value: activity.instructorContact,
      icon: 'link',
    });
  }

  return rows;
}

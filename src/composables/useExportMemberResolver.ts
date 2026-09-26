import { resolveMemberColor } from '@/constants/memberColors';
import { useFamilyStore } from '@/stores/familyStore';

/** A family member as an export sheet prints them. */
export interface ExportMember {
  name: string;
  color?: string;
  initial?: string;
}

/**
 * Resolves a member id to what an export sheet prints for them, so every sheet (the meal
 * plan's cooks, the responsibility deck's holders) names and colours people identically.
 * Unknown / missing ids resolve to `undefined`.
 */
export function useExportMemberResolver() {
  const familyStore = useFamilyStore();

  function resolveMember(id?: string): ExportMember | undefined {
    const m = id ? familyStore.members.find((mm) => mm.id === id) : undefined;
    if (!m) return undefined;
    return {
      name: m.name,
      // `resolveMemberColor`, not the raw field: a member with no colour set was falling
      // through to the export's own `|| '#2C3E50'`, so two colourless people rendered
      // identical Deep Slate discs in every cell AND in the legend.
      color: resolveMemberColor(m.color),
      // Roster-wide collision map — the same source the on-screen chips use. The printed
      // chip carries no name, so on a mono printer this letter is all that is left.
      initial: familyStore.initialsById.get(m.id),
    };
  }

  return { resolveMember };
}

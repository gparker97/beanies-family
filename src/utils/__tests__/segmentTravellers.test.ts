import { describe, it, expect } from 'vitest';
import {
  resolveSegmentTravellers,
  isTravellerSubset,
  matchTravellerIds,
  unionTravellerIds,
  normalizePersonName,
  learnableAliases,
  dedupedAppend,
} from '@/utils/segmentTravellers';
import type { FamilyMember } from '@/types/models';
import type { SegmentBuckets } from '@/utils/travelExtractionToSegments';

function member(id: string, name: string, aliases?: string[]): FamilyMember {
  return { id, name, ...(aliases ? { aliases } : {}) } as FamilyMember;
}

const TRIP = ['dad', 'mum', 'kid1', 'kid2'];

describe('resolveSegmentTravellers', () => {
  it('returns the trip default when the segment list is undefined', () => {
    expect(resolveSegmentTravellers(undefined, TRIP)).toBe(TRIP);
  });
  it('returns the segment list verbatim when defined', () => {
    expect(resolveSegmentTravellers(['dad'], TRIP)).toEqual(['dad']);
  });
  it('returns an empty list verbatim (does not fall back)', () => {
    expect(resolveSegmentTravellers([], TRIP)).toEqual([]);
  });
});

describe('isTravellerSubset', () => {
  it('is false when undefined (everyone)', () => {
    expect(isTravellerSubset(undefined, TRIP)).toBe(false);
  });
  it('is false when the segment covers the full trip', () => {
    expect(isTravellerSubset(['dad', 'mum', 'kid1', 'kid2'], TRIP)).toBe(false);
  });
  it('is true for a strict subset', () => {
    expect(isTravellerSubset(['dad'], TRIP)).toBe(true);
  });
  it('is true for an empty list', () => {
    expect(isTravellerSubset([], TRIP)).toBe(true);
  });
  it('ignores extra ids not on the trip (still covers everyone)', () => {
    expect(isTravellerSubset([...TRIP, 'guest'], TRIP)).toBe(false);
  });
});

describe('matchTravellerIds', () => {
  const roster = [member('m-john', 'John'), member('m-mary', 'Mary'), member('m-amy', 'Amy')];

  it('matches an exact (single-word) name', () => {
    expect(matchTravellerIds(['Mary'], roster)).toEqual(['m-mary']);
  });
  it('matches a full document name against a first-name member', () => {
    expect(matchTravellerIds(['John Smith'], roster)).toEqual(['m-john']);
  });
  it('is case- and space-insensitive', () => {
    expect(matchTravellerIds(['  mARY  '], roster)).toEqual(['m-mary']);
  });
  it('returns [] when nothing matches', () => {
    expect(matchTravellerIds(['Zoe'], roster)).toEqual([]);
  });
  it('dedupes repeated names', () => {
    expect(matchTravellerIds(['John', 'John Smith'], roster)).toEqual(['m-john']);
  });
  it('handles an empty roster', () => {
    expect(matchTravellerIds(['John'], [])).toEqual([]);
  });
  it('is asymmetric: a single-token doc name does NOT match a fuller member name', () => {
    // member stored as "John Smith"; ticket says only "John" → no match (avoids false positives)
    expect(matchTravellerIds(['John'], [member('m-js', 'John Smith')])).toEqual([]);
  });
  it('matches via an alias (the nickname/role bridge)', () => {
    const johnny = member('m-johnny', 'Johnny', ['Jonathan Smith']);
    expect(matchTravellerIds(['JONATHAN SMITH'], [johnny])).toEqual(['m-johnny']);
  });
  it('matches a normalized surname-first / titled name', () => {
    expect(matchTravellerIds(['SMITH/MARY MRS'], roster)).toEqual(['m-mary']);
  });
  it('drops an ambiguous name that resolves to two members (no silent guess)', () => {
    const r = [member('m-j1', 'John'), member('m-j2', 'John')];
    expect(matchTravellerIds(['John Smith'], r)).toEqual([]);
  });
});

describe('normalizePersonName', () => {
  it('reorders SURNAME/GIVEN, strips title, Title-Cases', () => {
    expect(normalizePersonName('SMITH/JONATHAN MR')).toBe('Jonathan Smith');
  });
  it('strips honorifics and punctuation', () => {
    expect(normalizePersonName('Dr. Mary Jones')).toBe('Mary Jones');
  });
  it('collapses whitespace and Title-Cases', () => {
    expect(normalizePersonName('  john   SMITH ')).toBe('John Smith');
  });
  it('leaves a name with 2+ slashes to the whitespace pass (no parse), stripping slashes', () => {
    expect(normalizePersonName('A/B/C')).toBe('Abc');
  });
  it('returns "" for empty/whitespace', () => {
    expect(normalizePersonName('   ')).toBe('');
    expect(normalizePersonName('')).toBe('');
  });
  it('passes an already-clean name through unchanged', () => {
    expect(normalizePersonName('Mary Jones')).toBe('Mary Jones');
  });
});

describe('learnableAliases', () => {
  const roster = [member('m-johnny', 'Johnny'), member('m-mary', 'Mary', ['Mary Jones'])];

  it('learns a manual mapping the matcher did not auto-resolve', () => {
    const confirmed = { 'Jonathan Smith': 'm-johnny' };
    const auto = { 'Jonathan Smith': '' };
    expect(learnableAliases(confirmed, auto, roster)).toEqual([
      { memberId: 'm-johnny', alias: 'Jonathan Smith' },
    ]);
  });
  it('does NOT re-learn an auto-matched name', () => {
    const confirmed = { Mary: 'm-mary' };
    const auto = { Mary: 'm-mary' };
    expect(learnableAliases(confirmed, auto, roster)).toEqual([]);
  });
  it('skips unmapped names, the member own name, and existing aliases', () => {
    const confirmed = { Stranger: '', Johnny: 'm-johnny', 'Mary Jones': 'm-mary' };
    const auto = { Stranger: '', Johnny: '', 'Mary Jones': '' };
    expect(learnableAliases(confirmed, auto, roster)).toEqual([]);
  });
});

describe('dedupedAppend', () => {
  it('appends new, dedupes case-insensitively vs existing and within additions', () => {
    expect(
      dedupedAppend(['Jonathan Smith'], ['jonathan smith', 'Mary Jones', 'mary jones'])
    ).toEqual(['Jonathan Smith', 'Mary Jones']);
  });
  it('handles undefined existing', () => {
    expect(dedupedAppend(undefined, ['Amy'])).toEqual(['Amy']);
  });
});

describe('unionTravellerIds', () => {
  it('dedupes the union across all three buckets and skips undefined', () => {
    const buckets = {
      travelSegments: [{ travellerIds: ['dad', 'mum'] }, { travellerIds: undefined }],
      accommodations: [{ travellerIds: ['mum', 'kid1'] }],
      transportation: [{ travellerIds: ['dad'] }],
    } as unknown as SegmentBuckets;
    expect(unionTravellerIds(buckets).sort()).toEqual(['dad', 'kid1', 'mum']);
  });
  it('returns [] when no segment has a list', () => {
    const buckets = {
      travelSegments: [{ travellerIds: undefined }],
      accommodations: [],
      transportation: [],
    } as unknown as SegmentBuckets;
    expect(unionTravellerIds(buckets)).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import {
  BEANPOD_EXT,
  POD_FILE_ACCEPT,
  isBeanpodFileName,
  isPodFileName,
} from '@/constants/beanpodFile';

/**
 * ⚠️ THE SPLIT IS THE POINT. Four of the five sites this module replaced accept `.json` as well
 * as `.beanpod`. Collapsing them onto one strict predicate would silently drop `.json` from the
 * load and drag-drop paths, which is a user-facing regression on exactly the restore route a
 * family with a broken pod is steered towards. If someone later "tidies" these into one function,
 * these tests are what fails.
 */
describe('beanpod file predicates', () => {
  it('isBeanpodFileName is STRICT — a .json is not a beanpod', () => {
    expect(isBeanpodFileName('family.beanpod')).toBe(true);
    expect(isBeanpodFileName('family.json')).toBe(false);
    expect(isBeanpodFileName('family.pdf')).toBe(false);
    expect(isBeanpodFileName('beanpod')).toBe(false);
  });

  it('isPodFileName keeps .json, which is the regression this split exists to prevent', () => {
    expect(isPodFileName('family.beanpod')).toBe(true);
    expect(isPodFileName('family.json')).toBe(true);
    expect(isPodFileName('family.pdf')).toBe(false);
  });

  it('POD_FILE_ACCEPT is the pair the file pickers advertise, beanpod first', () => {
    expect([...POD_FILE_ACCEPT]).toEqual(['.beanpod', '.json']);
    expect(BEANPOD_EXT).toBe('.beanpod');
  });

  /** A deliberate widening: share-sheet and download filenames are not under our control. */
  it('both predicates are case-insensitive', () => {
    expect(isBeanpodFileName('FAMILY.BEANPOD')).toBe(true);
    expect(isBeanpodFileName('Family.BeanPod')).toBe(true);
    expect(isPodFileName('FAMILY.JSON')).toBe(true);
  });

  it('matches on the suffix, not anywhere in the name', () => {
    expect(isBeanpodFileName('my.beanpod.txt')).toBe(false);
    expect(isBeanpodFileName('a beanpod for gran.beanpod')).toBe(true);
  });
});

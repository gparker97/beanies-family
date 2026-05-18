import { describe, it, expect } from 'vitest';
import { splitAroundAccent } from '../splitAroundAccent';

describe('splitAroundAccent', () => {
  it('splits a string around the accent word', () => {
    expect(splitAroundAccent('every bean counts', 'bean')).toEqual({
      lead: 'every ',
      accent: 'bean',
      trail: ' counts',
    });
  });

  it('preserves the original casing of the accent slice', () => {
    expect(splitAroundAccent('Where would you like to begin?', 'begin')).toEqual({
      lead: 'Where would you like to ',
      accent: 'begin',
      trail: '?',
    });
  });

  it('is case-insensitive when locating the accent', () => {
    expect(splitAroundAccent('Where would you like to BEGIN?', 'begin')).toEqual({
      lead: 'Where would you like to ',
      accent: 'BEGIN',
      trail: '?',
    });
  });

  it('returns the whole text as lead when the accent is not present', () => {
    expect(splitAroundAccent('hello world', 'bean')).toEqual({
      lead: 'hello world',
      accent: '',
      trail: '',
    });
  });

  it('returns the whole text as lead when the accent is empty', () => {
    expect(splitAroundAccent('every bean counts', '')).toEqual({
      lead: 'every bean counts',
      accent: '',
      trail: '',
    });
  });

  it('matches the first occurrence when the accent appears multiple times', () => {
    expect(splitAroundAccent('bean bean bean', 'bean')).toEqual({
      lead: '',
      accent: 'bean',
      trail: ' bean bean',
    });
  });

  it('handles an accent word at the start', () => {
    expect(splitAroundAccent('bean counts always', 'bean')).toEqual({
      lead: '',
      accent: 'bean',
      trail: ' counts always',
    });
  });

  it('handles an accent word at the end', () => {
    expect(splitAroundAccent('every count bean', 'bean')).toEqual({
      lead: 'every count ',
      accent: 'bean',
      trail: '',
    });
  });
});

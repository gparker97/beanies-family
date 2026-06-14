import { describe, it, expect } from 'vitest';
import { fillTemplate } from '../fillTemplate';

describe('fillTemplate', () => {
  it('substitutes a single token', () => {
    expect(fillTemplate('You joined {family}!', { family: 'The Smiths' })).toBe(
      'You joined The Smiths!'
    );
  });

  it('inserts $-special values literally (the bug this helper exists to fix)', () => {
    // String.prototype.replace(string, value) would interpret these as $-patterns.
    expect(fillTemplate('join {family}', { family: 'Smith $& Co' })).toBe('join Smith $& Co');
    expect(fillTemplate('join {family}', { family: 'A$`B' })).toBe('join A$`B');
    expect(fillTemplate('join {family}', { family: 'Mac $$ Crew' })).toBe('join Mac $$ Crew');
    expect(fillTemplate('hi {name}', { name: "O'$1" })).toBe("hi O'$1");
  });

  it('replaces every occurrence of a token', () => {
    expect(fillTemplate('{x} and {x}', { x: 'a$b' })).toBe('a$b and a$b');
  });

  it('renders nullish values as empty and supports numbers', () => {
    expect(fillTemplate('n={n}', { n: undefined })).toBe('n=');
    expect(fillTemplate('n={n}', { n: null })).toBe('n=');
    expect(fillTemplate('count={count}', { count: 3 })).toBe('count=3');
  });

  it('leaves unmatched placeholders untouched', () => {
    expect(fillTemplate('{a}/{b}', { a: 'x' })).toBe('x/{b}');
  });
});

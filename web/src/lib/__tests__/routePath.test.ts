import { describe, it, expect } from 'vitest';
import { routePath } from '../routePath';

const at = (path: string) => routePath(new URL(path, 'https://beanies.family'));

describe('routePath', () => {
  it('maps the homepage output file to /', () => {
    expect(at('/index.html')).toBe('/');
    expect(at('/')).toBe('/');
  });

  it('strips the .html suffix from flat output files', () => {
    expect(at('/privacy.html')).toBe('/privacy');
    expect(at('/blog/v1-is-here.html')).toBe('/blog/v1-is-here');
    expect(at('/help/features/account-details.html')).toBe('/help/features/account-details');
  });

  it('leaves a route path that has no suffix unchanged', () => {
    expect(at('/privacy')).toBe('/privacy');
    expect(at('/blog/v1-is-here')).toBe('/blog/v1-is-here');
  });

  it('maps a nested index file to its directory route', () => {
    expect(at('/help/index.html')).toBe('/help');
  });
});

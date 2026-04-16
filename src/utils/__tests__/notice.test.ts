import { describe, it, expect, beforeEach } from 'vitest';
import { noticeFlag } from '../notice';

describe('noticeFlag', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('is inactive when nothing has been set', () => {
    expect(noticeFlag('test').isActive()).toBe(false);
  });

  it('becomes active after activate()', () => {
    const flag = noticeFlag('test');
    flag.activate();
    expect(flag.isActive()).toBe(true);
  });

  it('becomes inactive after dismiss(), even if still activated', () => {
    const flag = noticeFlag('test');
    flag.activate();
    flag.dismiss();
    expect(flag.isActive()).toBe(false);
  });

  it('clear() resets to a fresh state', () => {
    const flag = noticeFlag('test');
    flag.activate();
    flag.dismiss();
    flag.clear();
    expect(flag.isActive()).toBe(false);
    flag.activate();
    expect(flag.isActive()).toBe(true);
  });

  it('namespaces keys per identifier — different flags are independent', () => {
    const a = noticeFlag('alpha');
    const b = noticeFlag('beta');
    a.activate();
    expect(a.isActive()).toBe(true);
    expect(b.isActive()).toBe(false);
  });
});

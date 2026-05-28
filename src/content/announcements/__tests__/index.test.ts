import { describe, it, expect } from 'vitest';
import {
  getAllAnnouncements,
  getAnnouncement,
  isAutoOpenAnnouncement,
} from '@/content/announcements';

describe('announcements registry', () => {
  it('exposes announcements sorted newest-first (by date, then id)', () => {
    const all = getAllAnnouncements();
    for (let i = 1; i < all.length; i++) {
      const cmp =
        all[i - 1].date.localeCompare(all[i].date) || all[i - 1].id.localeCompare(all[i].id);
      expect(cmp).toBeGreaterThanOrEqual(0);
    }
  });

  it('every entry has a unique, stable id (the read-state key) and both en + beanie strings', () => {
    const all = getAllAnnouncements();
    expect(new Set(all.map((a) => a.id)).size).toBe(all.length);
    for (const a of all) {
      expect(a.id).toBeTruthy();
      expect(a.title.en && a.title.beanie).toBeTruthy();
      expect(a.message.en && a.message.beanie).toBeTruthy();
    }
  });

  it('ships the Discord launch announcement (auto-open, external CTA, beanie lowercase)', () => {
    const a = getAnnouncement('discord-community-2026-05');
    expect(a).toBeDefined();
    expect(isAutoOpenAnnouncement(a!)).toBe(true);
    expect(a!.cta?.href).toBe('https://discord.gg/NE4grWzjxV');
    expect(a!.title.beanie).toBe(a!.title.beanie.toLowerCase());
    expect(a!.message.beanie).toBe(a!.message.beanie.toLowerCase());
  });

  it('getAnnouncement returns undefined for an unknown id', () => {
    expect(getAnnouncement('nope')).toBeUndefined();
  });
});

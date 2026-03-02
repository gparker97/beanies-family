// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { generateInviteQR } from '../qrCode';

describe('generateInviteQR', () => {
  it('returns a PNG data URL', async () => {
    const url = await generateInviteQR('https://beanies.family/#/join?t=abc&f=123');
    expect(url).toMatch(/^data:image\/png;base64,/);
  });
});

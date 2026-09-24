/**
 * RecoveryKitsModal (tracker #99): a pure view over the kit rows.
 *   - live rows carry Invalidate; the ONLY live kit carries Replace instead;
 *   - invalidated rows are listed with no action;
 *   - without manage rights: the admin-only notice, no actions, still the list;
 *   - it emits and never acts.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import RecoveryKitsModal from '@/components/settings/RecoveryKitsModal.vue';
import type { RecoveryKitSummary } from '@/services/auth/recoveryKit';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/composables/useMemberInfo', () => ({
  useMemberInfo: () => ({
    getMemberName: (id: string, fallback: string) => (id === 'm1' ? 'Greg' : fallback),
  }),
}));
vi.mock('@/utils/fillTemplate', () => ({
  fillTemplate: (s: string, vars: Record<string, string>) =>
    `${s}:${Object.values(vars).join('|')}`,
}));

const stubs = {
  BaseModal: {
    props: ['open'],
    template: '<div v-if="open"><slot /><slot name="footer" /></div>',
  },
  BaseButton: { template: '<button><slot /></button>' },
  SettingsAdminOnlyNotice: { template: '<p data-admin-only="1" />' },
};

const live = (kitId: string, createdBy?: string): RecoveryKitSummary => ({
  kitId,
  status: 'live',
  createdAt: '2026-09-01T00:00:00Z',
  ...(createdBy ? { createdBy } : {}),
});
const dead = (kitId: string): RecoveryKitSummary => ({
  kitId,
  status: 'invalidated',
  revokedAt: '2026-09-20T00:00:00Z',
  revokedBy: 'm1',
});

function mountModal(kits: RecoveryKitSummary[], canManage = true, busy = false) {
  return mount(RecoveryKitsModal, {
    props: { open: true, kits, canManage, busy },
    global: { stubs },
  });
}

describe('RecoveryKitsModal', () => {
  it('renders live rows with Invalidate when more than one kit is live, and the newest pill', () => {
    const w = mountModal([live('aaaa1111', 'm1'), live('bbbb2222'), dead('cccc3333')]);
    const rows = w.findAll('[data-kit-status]');
    expect(rows.map((r) => r.attributes('data-kit-status'))).toEqual([
      'live',
      'live',
      'invalidated',
    ]);
    expect(w.text()).toContain('recovery.kitNewest');
    expect(w.text()).toContain('recovery.kitCreatedBy:1 Sep 2026|Greg');
    expect(w.text()).toContain('recovery.kitCreatedOn:1 Sep 2026');
    expect(w.text()).toContain('recovery.kitInvalidatedBy:20 Sep 2026|Greg');
    const buttons = w.findAll('button').map((b) => b.text());
    expect(buttons.filter((t) => t === 'recovery.kitInvalidate')).toHaveLength(2);
    expect(buttons).not.toContain('recovery.kitReplace');
  });

  it('the only live kit offers Replace, never Invalidate', () => {
    const w = mountModal([live('aaaa1111'), dead('cccc3333')]);
    const buttons = w.findAll('button').map((b) => b.text());
    expect(buttons).toContain('recovery.kitReplace');
    expect(buttons).not.toContain('recovery.kitInvalidate');
    expect(w.text()).toContain('recovery.kitReplaceHint');
  });

  it('without manage rights: notice shown, list shown, no invalidate/replace, no create', () => {
    const w = mountModal([live('aaaa1111'), live('bbbb2222')], false);
    expect(w.find('[data-admin-only]').exists()).toBe(true);
    expect(w.findAll('[data-kit-status]')).toHaveLength(2);
    const buttons = w.findAll('button').map((b) => b.text());
    expect(buttons).not.toContain('recovery.kitInvalidate');
    expect(buttons).not.toContain('recovery.kitReplace');
    expect(buttons).not.toContain('recovery.kitRegenerate');
  });

  it('busy disables every action while a store action is in flight', () => {
    const w = mountModal([live('aaaa1111'), live('bbbb2222')], true, true);
    const invalidate = w.findAll('button').filter((b) => b.text() === 'recovery.kitInvalidate');
    expect(invalidate).toHaveLength(2);
    for (const b of invalidate) expect(b.attributes('disabled')).toBeDefined();
    const create = w.findAll('button').find((b) => b.text() === 'recovery.kitRegenerate')!;
    expect(create.attributes('disabled')).toBeDefined();
    const single = mountModal([live('zzzz9999')], true, true);
    const replace = single.findAll('button').find((b) => b.text() === 'recovery.kitReplace')!;
    expect(replace.attributes('disabled')).toBeDefined();
  });

  it('emits intents and never acts', async () => {
    const w = mountModal([live('aaaa1111'), live('bbbb2222')]);
    const invalidate = w.findAll('button').find((b) => b.text() === 'recovery.kitInvalidate')!;
    await invalidate.trigger('click');
    expect(w.emitted('invalidate')?.[0]?.[0]).toMatchObject({ kitId: 'aaaa1111' });

    const single = mountModal([live('zzzz9999')]);
    await single
      .findAll('button')
      .find((b) => b.text() === 'recovery.kitReplace')!
      .trigger('click');
    expect(single.emitted('replace')?.[0]?.[0]).toMatchObject({ kitId: 'zzzz9999' });

    const create = w.findAll('button').find((b) => b.text() === 'recovery.kitRegenerate')!;
    await create.trigger('click');
    expect(w.emitted('create')).toHaveLength(1);
  });

  it('shows the empty state when there are no kits at all', () => {
    const w = mountModal([]);
    expect(w.text()).toContain('recovery.kitNone');
    expect(w.findAll('[data-kit-status]')).toHaveLength(0);
  });
});

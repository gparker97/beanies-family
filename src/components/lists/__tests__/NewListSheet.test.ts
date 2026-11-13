/**
 * NewListSheet — Who Owns What (#109) template default: a template mapped to a card
 * owns the new list with the card's single holder, while the current member stays the
 * creator; the tile explains it before the pick. "Who's it for?" (#147): the row starts with
 * the creator, its choice is passed as `assigneeIds`, it replaces the card default once
 * changed, and it never goes empty.
 */
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const createFromTemplate = vi.fn(async () => ({ id: 'new-list' }));
const createBlankList = vi.fn(async () => ({ id: 'blank-list' }));
vi.mock('@/stores/listStore', () => ({
  useListStore: () => ({ createFromTemplate, createBlankList }),
}));
vi.mock('@/stores/familyStore', () => ({
  // `members` is the roster `ListPeoplePicker` counts a pick against.
  useFamilyStore: () => ({
    currentMember: { id: 'me' },
    members: [
      { id: 'me', name: 'Me' },
      { id: 'jill', name: 'Jill' },
    ],
  }),
}));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
const logEvent = vi.fn();
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: (...a: unknown[]) => logEvent(...a) }));
vi.mock('@/composables/useCardDefaultHint', () => ({
  useCardDefaultHint: () => ({
    holderFor: (t: { key: string }) =>
      t.key === 'grocery' ? { memberId: 'sofia', cardId: 'grocery-shopping' } : null,
    holdsHint: (t: { key: string }) => (t.key === 'grocery' ? 'sofia holds grocery' : ''),
  }),
}));

import NewListSheet from '../NewListSheet.vue';

const stubs = {
  BaseModal: { template: '<div><slot /></div>' },
  FamilyChipPicker: {
    name: 'FamilyChipPicker',
    props: ['modelValue'],
    template: '<div data-testid="picker" />',
  },
  ListCategoryPills: true,
  BaseButton: { template: '<button><slot /></button>' },
};

function tile(wrapper: ReturnType<typeof mount>, text: string) {
  return wrapper.findAll('button').find((b) => b.text().includes(text))!;
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});

describe('NewListSheet — card holder default (#109)', () => {
  it('shows the hint on the mapped tile only', () => {
    const wrapper = mount(NewListSheet, { props: { open: true }, global: { stubs } });
    const hints = wrapper.findAll('[data-testid="inferred-hint"]');
    expect(hints).toHaveLength(1);
    expect(hints[0]!.text()).toBe('sofia holds grocery');
  });

  it('owns the list with the holder and keeps the current member as creator', async () => {
    const wrapper = mount(NewListSheet, { props: { open: true }, global: { stubs } });
    await tile(wrapper, 'lists.template.grocery.name').trigger('click');
    expect(createFromTemplate).toHaveBeenCalledWith('grocery', 'me', { assigneeIds: ['sofia'] });
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'lists',
        message: 'card_default_applied',
        context: expect.objectContaining({ detail: 'grocery' }),
      })
    );
  });

  it("keeps today's owner default for an unmapped template", async () => {
    const wrapper = mount(NewListSheet, { props: { open: true }, global: { stubs } });
    await tile(wrapper, 'lists.template.honeydo.name').trigger('click');
    expect(createFromTemplate).toHaveBeenCalledWith('honey-do', 'me', { assigneeIds: ['me'] });
    expect(logEvent).not.toHaveBeenCalled();
  });
});

describe('NewListSheet — blank list', () => {
  it('creates through listStore.createBlankList with the current member and category', async () => {
    const wrapper = mount(NewListSheet, { props: { open: true }, global: { stubs } });
    await tile(wrapper, 'lists.new.blank').trigger('click');
    await Promise.resolve();
    // No pill and no `blankCategory`: the store's own default (Home) applies.
    expect(createBlankList).toHaveBeenCalledWith('me', {
      category: undefined,
      assigneeIds: ['me'],
    });
    expect(wrapper.emitted('created')?.[0]).toEqual(['blank-list']);
  });

  it("starts a blank list in the host's blankCategory when no pill is picked", async () => {
    const wrapper = mount(NewListSheet, {
      props: { open: true, blankCategory: 'trips' },
      global: { stubs },
    });
    await tile(wrapper, 'lists.new.blank').trigger('click');
    expect(createBlankList).toHaveBeenCalledWith('me', { category: 'trips', assigneeIds: ['me'] });
  });

  it('creates once on a double tap (a second untracked blank would never be discarded)', async () => {
    let release!: (v: { id: string }) => void;
    createBlankList.mockImplementationOnce(
      () => new Promise<{ id: string }>((resolve) => (release = resolve))
    );
    const wrapper = mount(NewListSheet, { props: { open: true }, global: { stubs } });
    const blank = tile(wrapper, 'lists.new.blank');
    await blank.trigger('click');
    await blank.trigger('click');
    await tile(wrapper, 'lists.template.honeydo.name').trigger('click');
    release({ id: 'blank-list' });
    await Promise.resolve();
    expect(createBlankList).toHaveBeenCalledTimes(1);
    expect(createFromTemplate).not.toHaveBeenCalled();
  });
});

describe('NewListSheet — caller overrides (#114)', () => {
  const link = { linkedActivityId: 'act-1', activityDate: '2026-10-10' };

  it('spreads the overrides into a template list and emits the template key', async () => {
    const wrapper = mount(NewListSheet, {
      props: { open: true, overrides: link },
      global: { stubs },
    });
    await tile(wrapper, 'lists.template.honeydo.name').trigger('click');
    await Promise.resolve();
    expect(createFromTemplate).toHaveBeenCalledWith('honey-do', 'me', {
      assigneeIds: ['me'],
      ...link,
    });
    expect(wrapper.emitted('created')?.[0]).toEqual(['new-list', 'honey-do']);
  });

  it('keeps the card holder as owner alongside the link', async () => {
    const wrapper = mount(NewListSheet, {
      props: { open: true, overrides: link },
      global: { stubs },
    });
    await tile(wrapper, 'lists.template.grocery.name').trigger('click');
    expect(createFromTemplate).toHaveBeenCalledWith('grocery', 'me', {
      assigneeIds: ['sofia'],
      ...link,
    });
  });

  it('spreads the overrides into a blank list', async () => {
    const wrapper = mount(NewListSheet, {
      props: { open: true, overrides: link },
      global: { stubs },
    });
    await tile(wrapper, 'lists.new.blank').trigger('click');
    expect(createBlankList).toHaveBeenCalledWith('me', {
      category: undefined,
      assigneeIds: ['me'],
      ...link,
    });
  });
});

describe('NewListSheet — suggested template (#114)', () => {
  function templateTiles(wrapper: ReturnType<typeof mount>) {
    return wrapper.findAll('button').filter((b) => b.text().includes('lists.template.'));
  }

  it('lists the suggested template first with a badge', () => {
    const wrapper = mount(NewListSheet, {
      props: { open: true, suggestedTemplateKey: 'party-prep' },
      global: { stubs },
    });
    const tiles = templateTiles(wrapper);
    expect(tiles[0]!.text()).toContain('lists.template.partyPrep.name');
    expect(tiles[0]!.find('[data-testid="suggested-badge"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-testid="suggested-badge"]')).toHaveLength(1);
  });

  it('keeps the default order and no badge without a suggestion', () => {
    const wrapper = mount(NewListSheet, { props: { open: true }, global: { stubs } });
    expect(templateTiles(wrapper)[0]!.text()).toContain('lists.template.grocery.name');
    expect(wrapper.find('[data-testid="suggested-badge"]').exists()).toBe(false);
  });
});

describe("NewListSheet — who it's for (#147)", () => {
  const picker = (wrapper: ReturnType<typeof mount>) =>
    wrapper.findComponent({ name: 'FamilyChipPicker' });

  it('starts with the creator', () => {
    const wrapper = mount(NewListSheet, { props: { open: true }, global: { stubs } });
    expect(picker(wrapper).props('modelValue')).toEqual(['me']);
  });

  it('passes the chosen people to a blank list and to a template', async () => {
    const wrapper = mount(NewListSheet, { props: { open: true }, global: { stubs } });
    await picker(wrapper).vm.$emit('update:modelValue', ['me', 'jill']);
    await tile(wrapper, 'lists.new.blank').trigger('click');
    await Promise.resolve();
    expect(createBlankList).toHaveBeenCalledWith('me', {
      category: undefined,
      assigneeIds: ['me', 'jill'],
    });

    const again = mount(NewListSheet, { props: { open: true }, global: { stubs } });
    await picker(again).vm.$emit('update:modelValue', ['jill']);
    await tile(again, 'lists.template.honeydo.name').trigger('click');
    expect(createFromTemplate).toHaveBeenCalledWith('honey-do', 'me', { assigneeIds: ['jill'] });
  });

  it('a changed row replaces the card default, and its hint goes', async () => {
    const wrapper = mount(NewListSheet, { props: { open: true }, global: { stubs } });
    await picker(wrapper).vm.$emit('update:modelValue', ['me', 'jill']);
    expect(wrapper.find('[data-testid="inferred-hint"]').exists()).toBe(false);
    await tile(wrapper, 'lists.template.grocery.name').trigger('click');
    expect(createFromTemplate).toHaveBeenCalledWith('grocery', 'me', {
      assigneeIds: ['me', 'jill'],
    });
    expect(logEvent).not.toHaveBeenCalled();
  });

  it('keeps at least one person: an empty pick is refused with a hint', async () => {
    const wrapper = mount(NewListSheet, { props: { open: true }, global: { stubs } });
    await picker(wrapper).vm.$emit('update:modelValue', []);
    expect(picker(wrapper).props('modelValue')).toEqual(['me']);
    expect(wrapper.get('[data-testid="new-list-people-hint"]').text()).toBe('lists.people.keepOne');
    // The same rule as the drawer (one shared picker): only removed members is nobody too.
    await picker(wrapper).vm.$emit('update:modelValue', ['m-gone']);
    expect(picker(wrapper).props('modelValue')).toEqual(['me']);
    await tile(wrapper, 'lists.new.blank').trigger('click');
    expect(createBlankList).toHaveBeenCalledWith('me', {
      category: undefined,
      assigneeIds: ['me'],
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';
import type { PlaceSuggestion } from '@/types/placeSearch';

const flags = vi.hoisted(() => ({ on: true }));
vi.mock('@/config/flags', () => ({
  isFlagEnabled: (id: string) => (id === 'placeSuggestions' ? flags.on : false),
}));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const search = {
  suggestions: ref<PlaceSuggestion[]>([]),
  searching: ref(false),
  requesting: ref(false),
  slowLookup: ref(false),
  state: ref<'idle' | 'results' | 'none'>('idle'),
  available: ref(true),
  onInput: vi.fn(),
  pick: vi.fn(),
  reset: vi.fn(),
  cancel: vi.fn(),
  noteKeepTyped: vi.fn(),
  noteRemoved: vi.fn(),
  notePickFailedShown: vi.fn(),
  noteStale: vi.fn(),
};
vi.mock('@/composables/usePlaceSearch', () => ({ usePlaceSearch: () => search }));

import LocationField from '../LocationField.vue';

const ROW: PlaceSuggestion = {
  placeId: 'ChIJ127',
  main: '127 South Bridge Road',
  secondary: 'Singapore',
};
const PLACE = { placeId: 'ChIJ127', name: '127 S Bridge Rd, Singapore 058285' };
const TYPED = '127 south bridge road block 48 unit 04-19 function room';

type Props = Record<string, unknown>;
function render(props: Props = {}) {
  const wrapper = mount(LocationField, {
    props: {
      value: { text: '' },
      mode: 'address',
      fieldKind: 'stay',
      ...props,
      'onUpdate:value': (v: unknown) => wrapper.setProps({ value: v as never }),
    } as never,
    attachTo: document.body,
  });
  return wrapper;
}
const emitted = (w: ReturnType<typeof render>) =>
  (w.emitted('update:value') ?? []).map((e) => e[0]);

beforeEach(() => {
  flags.on = true;
  search.suggestions.value = [];
  search.slowLookup.value = false;
  search.state.value = 'idle';
  search.available.value = true;
  vi.clearAllMocks();
  search.pick.mockResolvedValue({
    ok: true,
    place: PLACE,
    text: `${PLACE.name}, block 48 unit 04-19 function room`,
    detail: 'block 48 unit 04-19 function room',
  });
});
afterEach(() => {
  document.body.innerHTML = '';
});

async function typeAndList(w: ReturnType<typeof render>, text = TYPED) {
  await w.get('[data-testid="location-input"]').setValue(text);
  search.suggestions.value = [ROW];
  await flushPromises();
}

describe('LocationField', () => {
  it('emits the {text, place} pair once per change', async () => {
    const w = render();
    await w.get('[data-testid="location-input"]').setValue('12 Main');
    expect(emitted(w)).toEqual([{ text: '12 Main' }]);
    await w.get('[data-testid="location-input"]').setValue('12 Main St');
    expect(emitted(w)).toEqual([{ text: '12 Main' }, { text: '12 Main St' }]);
  });

  it('hands each keystroke to the place search, and nothing else', async () => {
    const w = render();
    await w.get('[data-testid="location-input"]').setValue('127 south');
    expect(search.onInput.mock.calls).toEqual([['127 south']]);
    // A parent rewriting the text is not a keystroke.
    await w.setProps({ value: { text: '12 Main St' } });
    await w.setProps({ value: { text: PLACE.name, place: PLACE } });
    expect(search.onInput).toHaveBeenCalledTimes(1);
  });

  it('Remove puts the typing back without starting a lookup', async () => {
    const w = render();
    await typeAndList(w);
    await w.findAll('[role="option"]')[0]!.trigger('mousedown');
    await flushPromises();
    search.onInput.mockClear();
    await w.get('[data-testid="location-remove-place"]').trigger('click');
    expect(search.onInput).not.toHaveBeenCalled();
  });

  it('lists suggestions as a combobox with Keep what I typed last and the Google Maps footer', async () => {
    const w = render({ mode: 'location-or-link', fieldKind: 'activity' });
    await typeAndList(w);
    const input = w.get('[data-testid="location-input"]');
    expect(input.attributes('role')).toBe('combobox');
    expect(input.attributes('aria-expanded')).toBe('true');
    const options = w.findAll('[role="option"]');
    expect(options).toHaveLength(2);
    expect(options[0]!.text()).toContain('127 South Bridge Road');
    expect(options[1]!.text()).toContain('location.keepTyped');
    expect(input.attributes('aria-controls')).toBe(w.get('[role="listbox"]').attributes('id'));
    const footer = w.get('[data-testid="location-attribution"]');
    expect(footer.text()).toBe('Google Maps');
    expect(footer.attributes('translate')).toBe('no');
  });

  it('Enter with nothing highlighted does not pick; with a row highlighted it does', async () => {
    const w = render();
    await typeAndList(w);
    const input = w.get('[data-testid="location-input"]');
    await input.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(search.pick).not.toHaveBeenCalled();
    await input.trigger('keydown', { key: 'ArrowDown' });
    await input.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(search.pick).toHaveBeenCalledWith(ROW, TYPED, expect.any(Function));
  });

  it('a pick emits the composed text and the place together, then shows the chip and detail', async () => {
    const w = render();
    await typeAndList(w);
    await w.findAll('[role="option"]')[0]!.trigger('mousedown');
    await flushPromises();
    expect(emitted(w).at(-1)).toEqual({
      text: `${PLACE.name}, block 48 unit 04-19 function room`,
      place: PLACE,
    });
    expect(w.get('[data-testid="location-place"]').text()).toContain('127 S Bridge Rd');
    expect(w.get('[data-testid="location-place"]').text()).toContain('Singapore 058285');
    const detail = w.get('[data-testid="location-detail"]').element as HTMLInputElement;
    expect(detail.value).toBe('block 48 unit 04-19 function room');
    expect(w.text()).toContain('location.detailHint');
  });

  it('editing the detail re-emits the composed string with the same place', async () => {
    const w = render({ value: { text: `${PLACE.name}, room 3`, place: PLACE } });
    await w.get('[data-testid="location-detail"]').setValue('room 4 ');
    expect(emitted(w).at(-1)).toEqual({ text: `${PLACE.name}, room 4`, place: PLACE });
    // The trailing space the member is still typing is not eaten by the round trip.
    expect((w.get('[data-testid="location-detail"]').element as HTMLInputElement).value).toBe(
      'room 4 '
    );
  });

  it('Remove in the same session puts back exactly what was typed', async () => {
    const w = render();
    await typeAndList(w);
    await w.findAll('[role="option"]')[0]!.trigger('mousedown');
    await flushPromises();
    await w.get('[data-testid="location-remove-place"]').trigger('click');
    expect(emitted(w).at(-1)).toEqual({ text: TYPED });
    expect(search.noteRemoved).toHaveBeenCalledWith('original');
    expect((w.get('[data-testid="location-input"]').element as HTMLInputElement).value).toBe(TYPED);
  });

  it('a pick moves focus to the detail input', async () => {
    const w = render();
    await typeAndList(w);
    await w.findAll('[role="option"]')[0]!.trigger('mousedown');
    await flushPromises();
    expect(document.activeElement).toBe(w.get('[data-testid="location-detail"]').element);
  });

  it('Remove after editing the detail keeps the edit: the composed text is restored', async () => {
    const w = render();
    await typeAndList(w);
    await w.findAll('[role="option"]')[0]!.trigger('mousedown');
    await flushPromises();
    await w.get('[data-testid="location-detail"]').setValue('block 48 unit 04-20, ask for Jo');
    await w.get('[data-testid="location-remove-place"]').trigger('click');
    const restored = `${PLACE.name}, block 48 unit 04-20, ask for Jo`;
    expect(emitted(w).at(-1)).toEqual({ text: restored });
    expect(search.noteRemoved).toHaveBeenCalledWith('composed');
    expect((w.get('[data-testid="location-input"]').element as HTMLInputElement).value).toBe(
      restored
    );
  });

  it('Remove after editing the detail back to what it was restores the original typing', async () => {
    const w = render();
    await typeAndList(w);
    await w.findAll('[role="option"]')[0]!.trigger('mousedown');
    await flushPromises();
    const detail = w.get('[data-testid="location-detail"]');
    await detail.setValue('block 48');
    await detail.setValue('block 48 unit 04-19 function room');
    await w.get('[data-testid="location-remove-place"]').trigger('click');
    expect(emitted(w).at(-1)).toEqual({ text: TYPED });
    expect(search.noteRemoved).toHaveBeenCalledWith('original');
  });

  it('Remove in a later edit keeps the saved text as-is', async () => {
    const saved = `${PLACE.name}, room 3`;
    const w = render({ value: { text: saved, place: PLACE } });
    await w.get('[data-testid="location-remove-place"]').trigger('click');
    expect(emitted(w).at(-1)).toEqual({ text: saved });
    expect(search.noteRemoved).toHaveBeenCalledWith('composed');
  });

  it('a failed pick shows the inline line, keeps the typed text and emits nothing', async () => {
    search.pick.mockResolvedValueOnce({ ok: false, code: 'upstream_http' });
    const w = render();
    await typeAndList(w);
    const before = emitted(w).length;
    await w.findAll('[role="option"]')[0]!.trigger('mousedown');
    await flushPromises();
    const message = w.get('[data-testid="location-message"]');
    expect(message.text()).toBe('location.pickFailed');
    expect(message.attributes('role')).toBe('status');
    expect(emitted(w)).toHaveLength(before);
    expect(search.notePickFailedShown).toHaveBeenCalledTimes(1);
    // The list is still there: tapping again retries.
    expect(w.findAll('[role="option"]')).toHaveLength(2);
  });

  describe('a pick whose address arrives after the member moved on', () => {
    let release: () => void = () => {};
    const OK = {
      ok: true,
      place: PLACE,
      text: `${PLACE.name}, block 48 unit 04-19 function room`,
      detail: 'block 48 unit 04-19 function room',
    };
    beforeEach(() => {
      // Like the composable: asks `stillCurrent` once the slow address fetch lands.
      search.pick.mockImplementation(
        (_s: PlaceSuggestion, _typed: string, stillCurrent?: () => boolean) =>
          new Promise((resolve) => {
            release = () =>
              resolve(stillCurrent && !stillCurrent() ? { ok: false, code: 'superseded' } : OK);
          })
      );
    });
    const startPick = async (w: ReturnType<typeof render>) => {
      await typeAndList(w);
      await w.findAll('[role="option"]')[0]!.trigger('mousedown');
      expect(search.pick).toHaveBeenCalledTimes(1);
    };
    const inputValue = (w: ReturnType<typeof render>) =>
      (w.get('[data-testid="location-input"]').element as HTMLInputElement).value;

    it('more typing wins: the later text survives and no place is applied', async () => {
      const w = render();
      await startPick(w);
      await w.get('[data-testid="location-input"]').setValue(`${TYPED} please`);
      release();
      await flushPromises();
      expect(emitted(w).at(-1)).toEqual({ text: `${TYPED} please` });
      expect(emitted(w).some((v) => (v as { place?: unknown }).place)).toBe(false);
      expect(w.find('[data-testid="location-place"]').exists()).toBe(false);
      expect(inputValue(w)).toBe(`${TYPED} please`);
      expect(w.get('[data-testid="location-message"]').text()).toBe('');
    });

    it('Keep what I typed during the resolve: the text stays as typed', async () => {
      const w = render();
      await startPick(w);
      await w.get('[data-testid="location-keep-typed"]').trigger('mousedown');
      release();
      await flushPromises();
      expect(emitted(w).at(-1)).toEqual({ text: TYPED });
      expect(w.find('[data-testid="location-place"]').exists()).toBe(false);
      expect(inputValue(w)).toBe(TYPED);
    });

    it('Escape during the resolve: the text stays as typed', async () => {
      const w = render();
      await startPick(w);
      await w.get('[data-testid="location-input"]').trigger('keydown', { key: 'Escape' });
      release();
      await flushPromises();
      expect(w.find('[data-testid="location-place"]').exists()).toBe(false);
      expect(inputValue(w)).toBe(TYPED);
    });

    it('focus moved to another control during the resolve stays there', async () => {
      const w = render();
      const other = document.createElement('input');
      document.body.appendChild(other);
      const input = w.get('[data-testid="location-input"]');
      (input.element as HTMLInputElement).focus();
      await startPick(w);
      other.focus();
      await input.trigger('blur');
      release();
      await flushPromises();
      // The pick still lands (nothing was typed), but focus is not taken back.
      expect(emitted(w).at(-1)).toEqual({ text: OK.text, place: PLACE });
      expect(document.activeElement).toBe(other);
    });

    it('a second tap while the first pick is in flight sends no second address fetch', async () => {
      const w = render();
      await startPick(w);
      await w.findAll('[role="option"]')[0]!.trigger('mousedown');
      expect(search.pick).toHaveBeenCalledTimes(1);
      release();
      await flushPromises();
      expect(emitted(w).at(-1)).toEqual({ text: OK.text, place: PLACE });
    });
  });

  it('Keep what I typed closes the list and is counted', async () => {
    const w = render();
    await typeAndList(w);
    await w.get('[data-testid="location-keep-typed"]').trigger('mousedown');
    expect(w.find('[role="listbox"]').exists()).toBe(false);
    expect(search.noteKeepTyped).toHaveBeenCalledTimes(1);
    expect(search.pick).not.toHaveBeenCalled();
  });

  it('a late answer after blur does not open the list, and blur cancels the lookup', async () => {
    const w = render();
    const input = w.get('[data-testid="location-input"]');
    await input.trigger('focus');
    await input.setValue('127 south');
    await input.trigger('blur');
    expect(search.cancel).toHaveBeenCalled();
    // The answer to a lookup already in flight lands after the field lost focus.
    search.suggestions.value = [ROW];
    await flushPromises();
    expect(w.find('[role="listbox"]').exists()).toBe(false);
  });

  it('a newer answer after Keep what I typed does not reopen the list; the next keystroke may', async () => {
    const w = render();
    await typeAndList(w);
    await w.get('[data-testid="location-keep-typed"]').trigger('mousedown');
    expect(search.cancel).toHaveBeenCalled();
    search.suggestions.value = [ROW, { ...ROW, placeId: 'ChIJother' }];
    await flushPromises();
    expect(w.find('[role="listbox"]').exists()).toBe(false);
    await typeAndList(w, `${TYPED} x`);
    expect(w.find('[role="listbox"]').exists()).toBe(true);
  });

  it('blur closes the list and keeps the text', async () => {
    const w = render();
    await typeAndList(w, '127 south');
    await w.get('[data-testid="location-input"]').trigger('blur');
    expect(w.find('[role="listbox"]').exists()).toBe(false);
    expect((w.get('[data-testid="location-input"]').element as HTMLInputElement).value).toBe(
      '127 south'
    );
  });

  it('multiline is a textarea with no role and no aria-expanded, and hands no line break on', async () => {
    const w = render({ multiline: true });
    const input = w.get('[data-testid="location-input"]');
    expect(input.element.tagName).toBe('TEXTAREA');
    expect(input.attributes('role')).toBeUndefined();
    expect(input.attributes('aria-expanded')).toBeUndefined();
    expect(input.attributes('aria-autocomplete')).toBe('list');
    expect(input.attributes('aria-controls')).toBeDefined();
    await input.setValue('18 Mosque St\nloft');
    // The input reaches usePlaceSearch, whose own rule skips a line break (pinned there).
    expect(search.onInput).toHaveBeenLastCalledWith('18 Mosque St\nloft');
    expect(emitted(w).at(-1)).toEqual({ text: '18 Mosque St\nloft' });
  });

  it('shows what a link was understood as in location-or-link mode', async () => {
    const w = render({ mode: 'location-or-link', fieldKind: 'activity' });
    await w.get('[data-testid="location-input"]').setValue('https://zoom.us/j/1');
    expect(w.get('[data-testid="location-understood"]').text()).toBe('location.understood.call');
    await w
      .get('[data-testid="location-input"]')
      .setValue('Room 3, 12 Main St https://meet.google.com/abc');
    expect(w.get('[data-testid="location-understood"]').text()).toBe(
      'location.understood.placeAndCall'
    );
    await w.get('[data-testid="location-input"]').setValue('https://swim.example/a');
    expect(w.get('[data-testid="location-understood"]').text()).toBe('location.understood.link');
  });

  it('shows the call icon inside the input when a link arrives after mount', async () => {
    // Regression: BaseInput read its `leading` slot through a computed over the non-reactive
    // `useSlots()`, so a slot added later behind `v-if` never rendered (browser walk, #150).
    const w = render({ mode: 'location-or-link', fieldKind: 'activity' });
    const input = () => w.get('[data-testid="location-input"]');
    expect(input().classes()).toContain('pl-3');
    await input().setValue('https://zoom.us/j/1');
    expect(w.find('span[aria-hidden="true"]').exists()).toBe(true);
    expect(input().classes()).toContain('pl-10');
    await input().setValue('12 Main St');
    expect(w.find('span[aria-hidden="true"]').exists()).toBe(false);
    expect(input().classes()).toContain('pl-3');
  });

  it('address mode never shows the understood-as line', async () => {
    const w = render();
    await w.get('[data-testid="location-input"]').setValue('https://zoom.us/j/1');
    expect(w.find('[data-testid="location-understood"]').exists()).toBe(false);
  });

  it('notes a stored place that no longer matches its text, once, on mount', () => {
    render({ value: { text: 'Rewritten by an old build', place: PLACE } });
    expect(search.noteStale).toHaveBeenCalledTimes(1);
  });

  describe('a named place (titled)', () => {
    const TITLED = {
      placeId: 'ChIJht',
      name: '50 E Coast Rd, #01-138 Roxy Square, Singapore 428769',
      title: 'The Hungarian Touch',
    };
    const LEAD = `${TITLED.title}, ${TITLED.name}`;

    it('the chip shows the title over the whole address, and links to the exact place', () => {
      const w = render({ value: { text: `${LEAD}, back room`, place: TITLED } });
      const link = w.get('[data-testid="location-place-link"]');
      const lines = link.findAll(':scope > span').map((s) => s.text());
      expect(lines).toEqual([TITLED.title, TITLED.name]);
      expect(link.attributes('href')).toBe(
        `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(LEAD)}&query_place_id=ChIJht`
      );
      expect((w.get('[data-testid="location-detail"]').element as HTMLInputElement).value).toBe(
        'back room'
      );
    });

    it('editing the detail keeps the title and the address ahead of it', async () => {
      const w = render({ value: { text: LEAD, place: TITLED } });
      await w.get('[data-testid="location-detail"]').setValue('patio');
      expect(emitted(w).at(-1)).toEqual({ text: `${LEAD}, patio`, place: TITLED });
    });

    it('without a title the chip splits the address as before', () => {
      const w = render({ value: { text: PLACE.name, place: PLACE } });
      const lines = w
        .get('[data-testid="location-place-link"]')
        .findAll(':scope > span')
        .map((s) => s.text());
      expect(lines).toEqual(['127 S Bridge Rd', 'Singapore 058285']);
    });
  });

  it('the map pin opens the exact place once one is picked', () => {
    const w = render({ value: { text: `${PLACE.name}, room 3`, place: PLACE }, mapPin: true });
    const pin = w.get('a[href*="query_place_id"]');
    expect(pin.attributes('href')).toContain('query_place_id=ChIJ127');
  });

  describe('the searching mark', () => {
    const spinner = (w: ReturnType<typeof render>) => w.find('[data-testid="location-searching"]');
    const announced = (w: ReturnType<typeof render>) =>
      w.find('[data-testid="location-announcement"]');

    async function focusedField(props: Props = {}) {
      const w = render(props);
      await w.get('[data-testid="location-input"]').trigger('focus');
      return w;
    }

    it('shows inside the input, at its right edge, only while the lookup is slow', async () => {
      const w = await focusedField();
      const input = () => w.get('[data-testid="location-input"]');
      expect(spinner(w).exists()).toBe(false);
      expect(input().classes()).toContain('pr-3');
      search.slowLookup.value = true;
      await flushPromises();
      expect(spinner(w).exists()).toBe(true);
      // In BaseInput's trailing slot, beside the input, and the input makes room for it.
      expect(spinner(w).element.closest('span')!.getAttribute('aria-hidden')).toBe('true');
      expect(spinner(w).attributes('aria-hidden')).toBe('true');
      expect(input().classes()).toContain('pr-10');
      expect(input().classes()).not.toContain('pr-3');
      search.slowLookup.value = false;
      await flushPromises();
      expect(spinner(w).exists()).toBe(false);
      expect(input().classes()).toContain('pr-3');
    });

    it('announces "Searching for places" once in the live region, and no visible text', async () => {
      const w = await focusedField();
      search.slowLookup.value = true;
      await flushPromises();
      const message = w.get('[data-testid="location-message"]');
      expect(message.attributes('role')).toBe('status');
      expect(announced(w).text()).toBe('location.searching');
      expect(announced(w).classes()).toContain('sr-only');
      // The hidden announcement does not push the line down.
      expect(message.classes()).not.toContain('mt-1.5');
      search.slowLookup.value = false;
      await flushPromises();
      expect(announced(w).exists()).toBe(false);
    });

    it('is gone on blur, and Escape cancels the lookup', async () => {
      const w = await focusedField();
      search.slowLookup.value = true;
      await flushPromises();
      await w.get('[data-testid="location-input"]').trigger('keydown', { key: 'Escape' });
      expect(search.cancel).toHaveBeenCalledTimes(1);
      await w.get('[data-testid="location-input"]').trigger('blur');
      expect(search.cancel).toHaveBeenCalledTimes(2);
      // Even before the composable's own signal drops, an unfocused field shows no mark.
      expect(spinner(w).exists()).toBe(false);
    });

    it('is not shown for a disabled field or while place search is unavailable', async () => {
      search.slowLookup.value = true;
      const w = await focusedField();
      expect(spinner(w).exists()).toBe(true);
      await w.setProps({ disabled: true });
      expect(spinner(w).exists()).toBe(false);
      await w.setProps({ disabled: false });
      expect(spinner(w).exists()).toBe(true);
      search.available.value = false;
      await flushPromises();
      expect(spinner(w).exists()).toBe(false);
    });

    it('multiline: sits at the textarea top right, and the textarea makes room', async () => {
      const w = await focusedField({ multiline: true });
      search.slowLookup.value = true;
      await flushPromises();
      const holder = spinner(w).element.parentElement!;
      expect(holder.className).toContain('top-3');
      expect(holder.className).toContain('right-3');
      expect(w.get('textarea').classes()).toContain('pr-10');
    });

    it("with the map pin, takes the pin's place while it shows", async () => {
      const w = await focusedField({ value: { text: '127 south' }, mapPin: true });
      expect(w.find('a[title="planner.openInMaps"]').exists()).toBe(true);
      search.slowLookup.value = true;
      await flushPromises();
      expect(spinner(w).exists()).toBe(true);
      expect(w.find('a[title="planner.openInMaps"]').exists()).toBe(false);
      search.slowLookup.value = false;
      await flushPromises();
      expect(w.find('a[title="planner.openInMaps"]').exists()).toBe(true);
    });
  });

  describe('a pick in flight', () => {
    const OTHER: PlaceSuggestion = { placeId: 'ChIJother', main: '12 Main St', secondary: 'Town' };
    let release: (r: unknown) => void = () => {};
    beforeEach(() => {
      search.pick.mockImplementation(
        (_s: PlaceSuggestion, _typed: string, stillCurrent?: () => boolean) =>
          new Promise((resolve) => {
            release = (r) =>
              resolve(stillCurrent && !stillCurrent() ? { ok: false, code: 'superseded' } : r);
          })
      );
    });
    const rows = (w: ReturnType<typeof render>) => w.findAll('[data-testid="location-suggestion"]');
    async function startPick() {
      const w = render();
      await w.get('[data-testid="location-input"]').setValue(TYPED);
      search.suggestions.value = [ROW, OTHER];
      await flushPromises();
      await rows(w)[0]!.trigger('mousedown');
      await flushPromises();
      return w;
    }
    const OK = {
      ok: true,
      place: PLACE,
      text: `${PLACE.name}, block 48 unit 04-19 function room`,
      detail: 'block 48 unit 04-19 function room',
    };

    it('the tapped row is busy with the spinner; the others dim and ignore taps', async () => {
      const w = await startPick();
      const [tapped, other] = rows(w);
      expect(tapped!.attributes('aria-busy')).toBe('true');
      expect(tapped!.find('[data-testid="location-pick-spinner"]').exists()).toBe(true);
      expect(tapped!.find('[data-testid="location-pick-spinner"]').attributes('aria-hidden')).toBe(
        'true'
      );
      expect(other!.attributes('aria-busy')).toBeUndefined();
      expect(other!.attributes('aria-disabled')).toBe('true');
      // Faint ink on the text, not an opacity modifier.
      const main = other!.find('.font-outfit');
      expect(main.classes()).toEqual(
        expect.arrayContaining(['text-secondary-400', 'dark:text-ink-faint'])
      );
      expect(other!.html()).not.toMatch(/opacity-/);
      await other!.trigger('mousedown');
      expect(search.pick).toHaveBeenCalledTimes(1);
      // Keep what I typed stays available as the way out.
      expect(
        w.get('[data-testid="location-keep-typed"]').attributes('aria-disabled')
      ).toBeUndefined();
    });

    it('settles on success: the chip replaces the list', async () => {
      const w = await startPick();
      release(OK);
      await flushPromises();
      expect(w.find('[data-testid="location-pick-spinner"]').exists()).toBe(false);
      expect(w.find('[data-testid="location-place"]').exists()).toBe(true);
    });

    it('settles on failure: no spinner, every row answers taps again', async () => {
      const w = await startPick();
      release({ ok: false, code: 'upstream_http' });
      await flushPromises();
      expect(w.find('[data-testid="location-pick-spinner"]').exists()).toBe(false);
      expect(rows(w).every((r) => r.attributes('aria-busy') === undefined)).toBe(true);
      expect(rows(w).every((r) => r.attributes('aria-disabled') === undefined)).toBe(true);
      await rows(w)[1]!.trigger('mousedown');
      expect(search.pick).toHaveBeenCalledTimes(2);
      expect(search.pick).toHaveBeenLastCalledWith(OTHER, TYPED, expect.any(Function));
    });

    it('settles the moment it is superseded, before the address lands', async () => {
      const w = await startPick();
      await w.get('[data-testid="location-input"]').setValue(`${TYPED} x`);
      await flushPromises();
      expect(w.find('[data-testid="location-pick-spinner"]').exists()).toBe(false);
      expect(rows(w).every((r) => r.attributes('aria-disabled') === undefined)).toBe(true);
      // The late answer is still dropped by the stale-pick guard.
      release(OK);
      await flushPromises();
      expect(w.find('[data-testid="location-place"]').exists()).toBe(false);
      expect(emitted(w).some((v) => (v as { place?: unknown }).place)).toBe(false);
    });

    it('Keep what I typed settles it too', async () => {
      const w = await startPick();
      await w.get('[data-testid="location-keep-typed"]').trigger('mousedown');
      await flushPromises();
      expect(w.find('[data-testid="location-pick-spinner"]').exists()).toBe(false);
    });
  });

  describe('the no-matches line', () => {
    const line = (w: ReturnType<typeof render>) => w.find('[data-testid="location-no-matches"]');

    it('shows under the field, in the helper style, once a lookup found nothing', async () => {
      const w = render();
      await w.get('[data-testid="location-input"]').setValue('nowhere at all');
      search.state.value = 'none';
      await flushPromises();
      expect(line(w).text()).toBe('location.noMatches');
      expect(line(w).classes()).toEqual(
        expect.arrayContaining(['text-secondary-400', 'dark:text-ink-faint', 'text-xs', 'mt-1.5'])
      );
      expect(w.find('[role="listbox"]').exists()).toBe(false);
      expect(w.get('[data-testid="location-announcement"]').text()).toBe('location.noMatches');
    });

    it('is cleared by the next keystroke (the composable drops the state) and by blur', async () => {
      search.onInput.mockImplementation(() => {
        search.state.value = 'idle';
      });
      const w = render();
      const input = w.get('[data-testid="location-input"]');
      await input.setValue('nowhere at all');
      search.state.value = 'none';
      await flushPromises();
      expect(line(w).exists()).toBe(true);
      await input.setValue('nowhere at all x');
      expect(line(w).exists()).toBe(false);
      search.state.value = 'none';
      await flushPromises();
      expect(line(w).exists()).toBe(true);
      await input.trigger('blur');
      expect(line(w).exists()).toBe(false);
      expect(w.find('[data-testid="location-announcement"]').exists()).toBe(false);
      search.onInput.mockReset();
    });

    it('gives way to the understood-as line when a link is typed', async () => {
      const w = render({ mode: 'location-or-link', fieldKind: 'activity' });
      await w.get('[data-testid="location-input"]').setValue('nowhere at all');
      search.state.value = 'none';
      await flushPromises();
      expect(line(w).exists()).toBe(true);
      await w.get('[data-testid="location-input"]').setValue('nowhere https://zoom.us/j/1');
      expect(line(w).exists()).toBe(false);
      expect(w.find('[data-testid="location-understood"]').exists()).toBe(true);
    });

    it('stays silent for every lookup that did not complete empty, and while unavailable', async () => {
      const w = render();
      await w.get('[data-testid="location-input"]').setValue('127 south');
      for (const state of ['idle', 'results'] as const) {
        search.state.value = state;
        await flushPromises();
        expect(line(w).exists()).toBe(false);
      }
      search.state.value = 'none';
      search.available.value = false;
      await flushPromises();
      expect(line(w).exists()).toBe(false);
    });
  });

  describe('flag off', () => {
    beforeEach(() => {
      flags.on = false;
    });

    it('never shows the searching mark, the busy rows or the no-matches line', async () => {
      search.slowLookup.value = true;
      search.state.value = 'none';
      const w = render({ value: { text: '127 south' }, mapPin: true });
      const input = w.get('input');
      await input.trigger('focus');
      await input.setValue('127 south b');
      expect(w.find('[data-testid="location-searching"]').exists()).toBe(false);
      expect(w.find('[data-testid="location-no-matches"]').exists()).toBe(false);
      expect(w.find('[role="status"]').exists()).toBe(false);
      expect(input.classes()).toContain('pr-3');
      expect(w.find('a[title="planner.openInMaps"]').exists()).toBe(true);
    });

    it('renders the legacy control: a plain input, no combobox, no list, no chip', async () => {
      const w = render({ value: { text: `${PLACE.name}, room 3`, place: PLACE } });
      expect(w.find('[data-testid="location-field"]').exists()).toBe(false);
      expect(w.find('[data-testid="location-place"]').exists()).toBe(false);
      const input = w.get('input');
      expect(input.attributes('role')).toBeUndefined();
      expect((input.element as HTMLInputElement).value).toBe(`${PLACE.name}, room 3`);
      await input.setValue('Elsewhere');
      // The place rides along untouched; the parent's placePatch drops it when it no longer fits.
      expect(emitted(w).at(-1)).toEqual({ text: 'Elsewhere', place: PLACE });
      expect(search.onInput).not.toHaveBeenCalled();
      expect(search.noteStale).not.toHaveBeenCalled();
    });

    it('keeps the map pin markup and the legacy href', () => {
      const text = `${PLACE.name}, room 3`;
      const w = render({ value: { text, place: PLACE }, mapPin: true, multiline: true });
      const pin = w.get('a');
      expect(pin.attributes('href')).toBe(
        `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}`
      );
      expect(pin.classes()).toEqual(
        expect.arrayContaining(['absolute', 'top-2', 'right-2', 'opacity-40'])
      );
      expect(w.get('textarea').attributes('rows')).toBe('2');
    });
  });
});

/**
 * The recovery screen, mounted for the first time.
 *
 * ⚠️ WHY THIS FILE EXISTS AT ALL. This screen is the last thing a person sees
 * when beanies cannot start, and until the extraction it lived inside `App.vue`
 * where nothing could render it. Every assertion below is on rendered output,
 * never on source text: a grep passes for a component that renders nothing.
 *
 * The property it guards hardest is "never a dead end". When the fatal carries
 * a way out, the store URL has to be on screen as selectable text whether or
 * not the link works, and OUTSIDE the collapsed disclosure, because an external
 * open can resolve while visibly nothing happens.
 */
import { mount } from '@vue/test-utils';
import { describe, it, expect, vi } from 'vitest';
import FatalErrorOverlay from '../FatalErrorOverlay.vue';
import type { UIStringKey } from '@/services/translation/uiStrings';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const STORE = 'https://apps.apple.com/app/id123';
const action = { labelKey: 'appUpdate.openStore' as UIStringKey, url: STORE };

function mountOverlay(props: Partial<InstanceType<typeof FatalErrorOverlay>['$props']> = {}) {
  return mount(FatalErrorOverlay, {
    props: {
      message: 'this family file needs a newer beanies',
      detail: '{"fileVersion":"5.0"}',
      clearDataHelps: true,
      action: null,
      actionHref: null,
      diagnostics: 'device info',
      ...props,
    },
  });
}

describe('FatalErrorOverlay', () => {
  it('renders nothing at all without a message', () => {
    expect(mountOverlay({ message: null }).find('div').exists()).toBe(false);
  });

  it('offers Reload and Clear data, and no link, for an ordinary fatal', () => {
    const w = mountOverlay();
    expect(w.find('a').exists()).toBe(false);
    expect(w.text()).toContain('app.initError.reload');
    expect(w.text()).toContain('app.initError.clearData');
  });

  it('drops the Clear data button when clearing cannot help', () => {
    // A payload failure leaves the file intact; clearing is the one action
    // that destroys the local copy.
    const w = mountOverlay({ clearDataHelps: false });
    expect(w.text()).not.toContain('app.initError.clearData');
    expect(w.text()).not.toContain('app.initError.description');
  });

  it('renders the way out as a real external anchor', () => {
    const w = mountOverlay({ action, actionHref: STORE });
    const link = w.get('a');
    expect(link.attributes('href')).toBe(STORE);
    expect(link.attributes('target')).toBe('_blank');
    expect(link.attributes('rel')).toBe('noopener noreferrer');
    expect(link.text()).toBe('appUpdate.openStore');
  });

  it('shows the URL as selectable text OUTSIDE the disclosure, so it is never a dead end', () => {
    const w = mountOverlay({ action, actionHref: STORE });
    const caption = w.findAll('p').find((p) => p.text() === STORE);
    expect(caption).toBeTruthy();
    // ⚠️ THE PLACEMENT IS THE POINT. `detail` lives inside a collapsed
    // `<details>`; a URL hidden there is a URL nobody in trouble will find.
    expect(w.get('details').text()).not.toContain(STORE);
  });

  it('leaves exactly one orange control: the link takes primary, Reload steps back', () => {
    const plain = mountOverlay();
    expect(plain.get('button').classes()).toContain('bg-[#F15D22]');

    const w = mountOverlay({ action, actionHref: STORE });
    expect(w.get('a').classes()).toContain('bg-[#F15D22]');
    expect(w.get('button').classes()).not.toContain('bg-[#F15D22]');
    expect(w.get('button').classes()).toContain('border-gray-300');
  });

  it('STILL shows the URL when the href was screened away, which is the dead-end case', () => {
    // ⚠️ THE FINDING THIS PINS. The caption used to be gated on the screened
    // href, so the moment the link could not be followed the address vanished
    // too — leaving a person who cannot use the app at all with nothing on
    // screen to act on, in exactly the case where they needed it most. The
    // caption prints `action.url`; only the anchor depends on the screen.
    const w = mountOverlay({ action, actionHref: null });
    expect(w.find('a').exists()).toBe(false);
    expect(w.findAll('p').some((p) => p.text() === STORE)).toBe(true);
    expect(w.get('button').classes()).toContain('bg-[#F15D22]');
  });

  it('closes the destructive panel BEFORE the sign-out it starts', async () => {
    // ⚠️ A DOUBLE-TAP USED TO START TWO SIGN-OUTS. Clearing the family database
    // takes real time and the panel stayed on screen for all of it. In
    // `App.vue` the flag was cleared on the handler's first line; the move had
    // to carry that with it.
    const w = mountOverlay();
    await w
      .findAll('button')
      .find((b) => b.text() === 'app.initError.clearData')!
      .trigger('click');
    const acting = w
      .findAll('button')
      .filter((b) => b.text() === 'app.initError.clearData')
      .at(-1);
    await acting!.trigger('click');
    expect(w.text()).not.toContain('app.initError.clearConfirm');
    expect(w.emitted('clearData')).toHaveLength(1);
  });

  it('closes the destructive panel for a NEW fatal that happens to read the same', async () => {
    // Two failures can carry the same sentence and different detail. Watching
    // the message alone left an open "clear my data" panel under an unrelated
    // error; `App.vue`'s store watcher had reset on the whole tuple.
    const w = mountOverlay();
    await w
      .findAll('button')
      .find((b) => b.text() === 'app.initError.clearData')!
      .trigger('click');
    expect(w.text()).toContain('app.initError.clearConfirm');
    await w.setProps({ detail: '{"fileVersion":"6.0"}' });
    expect(w.text()).not.toContain('app.initError.clearConfirm');
  });

  it('asks before clearing data, and only then emits', async () => {
    const w = mountOverlay();
    const clearButton = () =>
      w.findAll('button').find((b) => b.text() === 'app.initError.clearData');
    await clearButton()!.trigger('click');
    expect(w.text()).toContain('app.initError.clearConfirm');
    expect(w.emitted('clearData')).toBeUndefined();

    // Two buttons now carry that label; the one inside the confirm panel acts.
    const acting = w
      .findAll('button')
      .filter((b) => b.text() === 'app.initError.clearData')
      .at(-1);
    await acting!.trigger('click');
    expect(w.emitted('clearData')).toHaveLength(1);
  });

  it('closes the destructive panel whenever a NEW fatal arrives', async () => {
    // It used to be reset by a line in `App.vue`'s store watcher. Leaving it
    // open across fatals would put a red "clear my data" button under an error
    // it has nothing to do with.
    const w = mountOverlay();
    await w
      .findAll('button')
      .find((b) => b.text() === 'app.initError.clearData')!
      .trigger('click');
    expect(w.text()).toContain('app.initError.clearConfirm');
    await w.setProps({ message: 'something else went wrong' });
    expect(w.text()).not.toContain('app.initError.clearConfirm');
  });

  it('emits reload from the Reload button', async () => {
    const w = mountOverlay();
    await w
      .findAll('button')
      .find((b) => b.text() === 'app.initError.reload')!
      .trigger('click');
    expect(w.emitted('reload')).toHaveLength(1);
  });

  it('keeps the technical detail and the device diagnostics in the disclosure', () => {
    const w = mountOverlay();
    const details = w.get('details').text();
    expect(details).toContain('{"fileVersion":"5.0"}');
    expect(details).toContain('device info');
  });
});

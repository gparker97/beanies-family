import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import MagicBeansDoor from '@/components/ai/MagicBeansDoor.vue';

const requestConsent = vi.fn();
const ingestInAppSource = vi.fn();
const refuseIfBusy = vi.fn();
const logCaptureOpened = vi.fn();
let canReadAny = true;

// #95: the read-only refusal. Writable by default; the read-only block flips it.
const refuseManagedRead = vi.fn(() => false);
vi.mock('@/composables/useAiCapability', () => ({
  useAiCapability: () => ({ refuseManagedReadIfReadOnly: () => refuseManagedRead() }),
}));

vi.mock('@/composables/useDocumentConsent', () => ({
  useDocumentConsent: () => ({ requestConsent: () => requestConsent() }),
}));

const availableKinds = ['event', 'travel', 'recipe'];
vi.mock('@/composables/useMagicReader', () => ({
  useMagicReader: () => ({ canReadAny: ref(canReadAny) }),
  availableShareKinds: () => availableKinds,
}));

vi.mock('@/composables/useSharedDocumentIngest', () => ({
  IN_APP_ENV: { surface: 'magic-beans-capture', origin: 'in-app' },
  ingestInAppSource: (...args: unknown[]) => ingestInAppSource(...args),
  logCaptureOpened: (...args: unknown[]) => logCaptureOpened(...args),
  refuseIfBusy: (...args: unknown[]) => refuseIfBusy(...args),
}));

const logEvent = vi.fn();
vi.mock('@/services/telemetry/logEvent', () => ({
  logEvent: (...args: unknown[]) => logEvent(...args),
}));

const reportError = vi.fn();
vi.mock('@/utils/errorReporter', () => ({
  reportError: (...args: unknown[]) => reportError(...args),
}));

const showToast = vi.fn();
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ showToast }) }));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const pickCamera = vi.fn();
const pickFile = vi.fn();
vi.mock('@/components/ai/AiDocumentPicker.vue', () => ({
  default: {
    name: 'AiDocumentPicker',
    emits: ['file'],
    setup(_: unknown, { expose }: { expose: (o: unknown) => void }) {
      expose({ pickCamera, pickFile, pick: vi.fn() });
      return () => null;
    },
  },
}));

vi.mock('@/components/ai/MagicBeansSheet.vue', () => ({
  default: { name: 'MagicBeansSheet', props: ['open', 'kinds'], render: () => null },
}));

/** The door renders its affordance through a slot, so a test needs one to drive. */
function mountDoor() {
  return mount(MagicBeansDoor, {
    slots: {
      trigger: `<template #trigger="{ open }"><button class="t" @click="open" /></template>`,
    },
  });
}

const sheet = (w: ReturnType<typeof mountDoor>) => w.findComponent({ name: 'MagicBeansSheet' });

describe('MagicBeansDoor', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
    canReadAny = true;
    requestConsent.mockReset().mockResolvedValue({});
    ingestInAppSource.mockReset().mockResolvedValue(undefined);
    refuseIfBusy.mockReset().mockReturnValue(false);
    refuseManagedRead.mockReset().mockReturnValue(false);
    logCaptureOpened.mockReset();
    logEvent.mockReset();
    showToast.mockReset();
    pickCamera.mockReset();
    pickFile.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('the gate', () => {
    it('renders nothing at all — trigger included — without permission', () => {
      canReadAny = false;
      const w = mountDoor();
      expect(w.find('.t').exists()).toBe(false);
      // A rendered button whose handler no-ops is a dead tap with no trace. The gate must
      // remove the affordance and its tap together.
      expect(sheet(w).exists()).toBe(false);
    });
  });

  describe('the funnel denominator', () => {
    it('fires at the TAP, not at the ingest, so abandonment is measurable', async () => {
      const w = mountDoor();
      await w.find('.t').trigger('click');

      expect(logCaptureOpened).toHaveBeenCalledTimes(1);
      expect(ingestInAppSource).not.toHaveBeenCalled();
    });
  });

  describe('busy comes first', () => {
    it('refuses at the COMMIT, before consent and before the picker', async () => {
      refuseIfBusy.mockReturnValue(true);
      const w = mountDoor();
      await w.find('.t').trigger('click');
      await sheet(w).vm.$emit('camera');
      await flushPromises();

      // The whole point of checking here: asking for consent and opening a camera first would
      // discard a photo the user had already taken.
      expect(requestConsent).not.toHaveBeenCalled();
      expect(pickCamera).not.toHaveBeenCalled();
      expect(ingestInAppSource).not.toHaveBeenCalled();
    });
  });

  describe('read-only (#95)', () => {
    it('refuses before consent and before the picker, on every source', async () => {
      refuseManagedRead.mockReturnValue(true);
      const w = mountDoor();
      await w.find('.t').trigger('click');
      await sheet(w).vm.$emit('camera');
      await sheet(w).vm.$emit('file', 'transactions');
      await sheet(w).vm.$emit('submit', 'a pasted note');
      await flushPromises();

      expect(refuseManagedRead).toHaveBeenCalledTimes(3);
      expect(requestConsent).not.toHaveBeenCalled();
      expect(pickCamera).not.toHaveBeenCalled();
      expect(pickFile).not.toHaveBeenCalled();
      expect(ingestInAppSource).not.toHaveBeenCalled();
    });
  });

  describe('consent at the commit', () => {
    it('asks BEFORE opening the picker', async () => {
      const w = mountDoor();
      await w.find('.t').trigger('click');
      await sheet(w).vm.$emit('camera');
      await flushPromises();

      expect(requestConsent).toHaveBeenCalledTimes(1);
      expect(pickCamera).toHaveBeenCalledTimes(1);
    });

    it('opens no picker and ingests nothing when declined', async () => {
      requestConsent.mockResolvedValue(null);
      const w = mountDoor();
      await w.find('.t').trigger('click');
      await sheet(w).vm.$emit('file');
      await flushPromises();

      expect(pickFile).not.toHaveBeenCalled();
      expect(ingestInAppSource).not.toHaveBeenCalled();
    });

    it('threads the grant into the ingest for a paste', async () => {
      const grant = { id: 'g1' };
      requestConsent.mockResolvedValue(grant);
      const w = mountDoor();
      await w.find('.t').trigger('click');
      await sheet(w).vm.$emit('submit', 'Ollie party Sat 2pm');
      await flushPromises();

      // The third argument is `undefined` for every door but the recipe form: a door with no
      // `claim` must fall through to dispatch-by-kind, or a capture would be silently kept by
      // whichever surface happened to open it.
      expect(ingestInAppSource).toHaveBeenCalledWith(
        { kind: 'paste', text: 'Ollie party Sat 2pm' },
        grant,
        undefined
      );
    });
  });

  describe('the sheet closes before the ingest starts', () => {
    it('is shut by the time a paste is handed over', async () => {
      const w = mountDoor();
      await w.find('.t').trigger('click');
      expect(sheet(w).props('open')).toBe(true);

      await sheet(w).vm.$emit('submit', 'text');
      await flushPromises();

      // Three things break otherwise — the overlay z-index collision, the body-scroll lock,
      // and openQuickAdd() refusing while an overlay is open, which leaves the FAB dead.
      expect(sheet(w).props('open')).toBe(false);
    });
  });

  describe('the stranded consent grant', () => {
    it('reuses the grant for the file the picker returns', async () => {
      const grant = { id: 'g2' };
      requestConsent.mockResolvedValue(grant);
      const w = mountDoor();
      await w.find('.t').trigger('click');
      await sheet(w).vm.$emit('file');
      await flushPromises();

      const file = new File(['x'], 'a.png', { type: 'image/png' });
      w.findComponent({ name: 'AiDocumentPicker' }).vm.$emit('file', file);
      await flushPromises();

      expect(ingestInAppSource).toHaveBeenCalledWith({ kind: 'file', file }, grant, undefined);
    });

    it('EXPIRES a grant the picker never came back with, so a later pick cannot reuse it', async () => {
      // AiDocumentPicker has no cancel signal — a cancelled native camera never fires `change`
      // at all. Without the TTL a user who consents and backs out leaves a live grant that the
      // NEXT, DIFFERENT document silently reuses. ADR-030 is per-document consent; this is the
      // only rule that covers a silent cancel.
      requestConsent.mockResolvedValue({ id: 'g3' });
      const w = mountDoor();
      await w.find('.t').trigger('click');
      await sheet(w).vm.$emit('camera');
      await flushPromises();

      vi.advanceTimersByTime(3 * 60_000);
      await flushPromises();

      const later = new File(['y'], 'other.png', { type: 'image/png' });
      w.findComponent({ name: 'AiDocumentPicker' }).vm.$emit('file', later);
      await flushPromises();

      expect(ingestInAppSource).not.toHaveBeenCalled();
    });

    it('drops the grant when the sheet is closed without committing', async () => {
      requestConsent.mockResolvedValue({ id: 'g4' });
      const w = mountDoor();
      await w.find('.t').trigger('click');
      await sheet(w).vm.$emit('file');
      await flushPromises();

      await sheet(w).vm.$emit('close');
      await flushPromises();

      const file = new File(['z'], 'b.png', { type: 'image/png' });
      w.findComponent({ name: 'AiDocumentPicker' }).vm.$emit('file', file);
      await flushPromises();

      expect(ingestInAppSource).not.toHaveBeenCalled();
    });
  });

  describe('the optional pick (#108)', () => {
    it('hands the sheet the kinds this member may pick — decided here, not in the sheet', () => {
      const w = mountDoor();
      expect(sheet(w).props('kinds')).toEqual(availableKinds);
    });

    it("carries a pasted capture's pick into the ingest as `hint`", async () => {
      const grant = { id: 'g5' };
      requestConsent.mockResolvedValue(grant);
      const w = mountDoor();
      await w.find('.t').trigger('click');
      await sheet(w).vm.$emit('submit', 'BA123 LHR-SIN 4 Oct 22:05', 'travel');
      await flushPromises();

      expect(ingestInAppSource).toHaveBeenCalledWith(
        { kind: 'paste', text: 'BA123 LHR-SIN 4 Oct 22:05', hint: 'travel' },
        grant,
        undefined
      );
    });

    it('holds the pick WITH the grant for the picker, and delivers both with the file', async () => {
      const grant = { id: 'g6' };
      requestConsent.mockResolvedValue(grant);
      const w = mountDoor();
      await w.find('.t').trigger('click');
      await sheet(w).vm.$emit('camera', 'recipe');
      await flushPromises();
      expect(pickCamera).toHaveBeenCalledTimes(1);

      const file = new File(['x'], 'dish.png', { type: 'image/png' });
      w.findComponent({ name: 'AiDocumentPicker' }).vm.$emit('file', file);
      await flushPromises();

      expect(ingestInAppSource).toHaveBeenCalledWith(
        { kind: 'file', file, hint: 'recipe' },
        grant,
        undefined
      );
    });

    it('lets a pick expire WITH its grant — the two are one value, never half-cleared', async () => {
      // If the hint survived the grant's TTL it could attach to the next, different document.
      requestConsent.mockResolvedValue({ id: 'g7' });
      const w = mountDoor();
      await w.find('.t').trigger('click');
      await sheet(w).vm.$emit('file', 'event');
      await flushPromises();

      vi.advanceTimersByTime(3 * 60_000);
      await flushPromises();

      // A NEW commit with no pick, then its file arrives: it must not inherit 'event'.
      requestConsent.mockResolvedValue({ id: 'g8' });
      await sheet(w).vm.$emit('file');
      await flushPromises();
      const later = new File(['y'], 'later.png', { type: 'image/png' });
      w.findComponent({ name: 'AiDocumentPicker' }).vm.$emit('file', later);
      await flushPromises();

      expect(ingestInAppSource).toHaveBeenCalledTimes(1);
      expect(ingestInAppSource.mock.calls[0][0]).toEqual({ kind: 'file', file: later });
    });
  });

  describe('the destination vocabulary', () => {
    it('is one list, so a fourth kind cannot half-land', async () => {
      const { MAGIC_DESTINATIONS, MAGIC_DESTINATION_KINDS } =
        await import('@/constants/magicDestinations');

      // The sheet's pick tiles, the overlay's resolve and the "not right?" banner all render
      // the SAME module. Keyed on ShareKind so adding a reader is a compile error here rather
      // than a tile that silently never lights.
      expect(MAGIC_DESTINATION_KINDS).toEqual([
        'event',
        'travel',
        'recipe',
        'transactions',
        'todo',
      ]);
      for (const kind of MAGIC_DESTINATION_KINDS) {
        expect(MAGIC_DESTINATIONS[kind].emoji).toBeTruthy();
      }
    });
  });

  describe('declining consent at the commit is logged, once, by the door', () => {
    it('logs consent_declined at the commit and emits closed, with no handoff', async () => {
      requestConsent.mockResolvedValue(null);
      const w = mountDoor();
      await w.find('.t').trigger('click');
      await sheet(w).vm.$emit('submit', 'a note');
      await flushPromises();

      const declines = logEvent.mock.calls.filter(
        (c) => (c[0] as { context?: { action?: string } }).context?.action === 'consent_declined'
      );
      expect(declines).toHaveLength(1);
      expect(declines[0][0]).toMatchObject({
        surface: 'magic-beans-capture',
        context: { action: 'consent_declined', stage: 'commit' },
      });
      expect(w.emitted('closed')).toHaveLength(1);
      expect(w.emitted('handoff')).toBeUndefined();
    });
  });

  describe('drawer mode emits handoff too, and passes no click event as context', () => {
    it('emits handoff(paste) as the drawer closes', async () => {
      const w = mountDoor();
      await w.find('.t').trigger('click');
      await sheet(w).vm.$emit('submit', 'text');
      await flushPromises();
      expect(w.emitted('handoff')).toEqual([['paste']]);
    });

    it('logs the denominator with NO context from a trigger tap', async () => {
      const w = mountDoor();
      await w.find('.t').trigger('click');
      expect(logCaptureOpened).toHaveBeenCalledWith(undefined);
    });
  });

  describe('inline mode (#119, the FAB composer)', () => {
    type InlineDoor = {
      open: (c?: { stage: 'composer'; format: 'phone' | 'desktop' }) => void;
      send: (text: string) => void;
      camera: () => void;
      file: () => void;
    };

    /** A shared, ordered log: the host's handoff listener and the ingest/picker spies append. */
    let order: string[];

    function mountInline() {
      order = [];
      ingestInAppSource.mockImplementation(() => {
        order.push('ingest');
        return Promise.resolve();
      });
      pickCamera.mockImplementation(() => order.push('pickCamera'));
      pickFile.mockImplementation(() => order.push('pickFile'));
      const w = mount(MagicBeansDoor, {
        props: {
          inline: true,
          onHandoff: (source: string) => order.push(`handoff:${source}`),
        },
      });
      return { w, door: w.vm as unknown as InlineDoor };
    }

    it('renders the picker but no drawer and no trigger slot', () => {
      const w = mount(MagicBeansDoor, {
        props: { inline: true },
        slots: { trigger: `<button class="t" />` },
      });
      expect(w.findComponent({ name: 'AiDocumentPicker' }).exists()).toBe(true);
      expect(sheet(w as ReturnType<typeof mountDoor>).exists()).toBe(false);
      expect(w.find('.t').exists()).toBe(false);
    });

    it('open(context) records the denominator with that context and opens nothing', () => {
      const { w, door } = mountInline();
      door.open({ stage: 'composer', format: 'phone' });
      expect(logCaptureOpened).toHaveBeenCalledWith({ stage: 'composer', format: 'phone' });
      expect(sheet(w as ReturnType<typeof mountDoor>).exists()).toBe(false);
    });

    it('send(text) emits handoff(paste) STRICTLY before the ingest starts', async () => {
      const grant = { id: 'i1' };
      requestConsent.mockResolvedValue(grant);
      const { door } = mountInline();
      door.send('Swimming Tue 4pm');
      await flushPromises();

      // Invariant 4: the host closes its surface in the handoff listener, before the ingest.
      expect(order).toEqual(['handoff:paste', 'ingest']);
      expect(ingestInAppSource).toHaveBeenCalledWith(
        { kind: 'paste', text: 'Swimming Tue 4pm' },
        grant,
        undefined
      );
    });

    it('camera() emits handoff(camera) before the picker opens', async () => {
      const { door } = mountInline();
      door.camera();
      await flushPromises();
      expect(order).toEqual(['handoff:camera', 'pickCamera']);
    });

    it('file() emits handoff(file) before the picker opens', async () => {
      const { door } = mountInline();
      door.file();
      await flushPromises();
      expect(order).toEqual(['handoff:file', 'pickFile']);
    });

    it('busy: emits closed, no handoff, no ingest', async () => {
      refuseIfBusy.mockReturnValue(true);
      const { w, door } = mountInline();
      door.send('text');
      await flushPromises();
      expect(w.emitted('closed')).toHaveLength(1);
      expect(w.emitted('handoff')).toBeUndefined();
      expect(ingestInAppSource).not.toHaveBeenCalled();
    });

    it('read-only: emits closed, no handoff', async () => {
      refuseManagedRead.mockReturnValue(true);
      const { w, door } = mountInline();
      door.camera();
      await flushPromises();
      expect(w.emitted('closed')).toHaveLength(1);
      expect(w.emitted('handoff')).toBeUndefined();
      expect(pickCamera).not.toHaveBeenCalled();
    });

    it('decline: emits closed, no handoff, and logs consent_declined once', async () => {
      requestConsent.mockResolvedValue(null);
      const { w, door } = mountInline();
      door.send('text');
      await flushPromises();
      expect(w.emitted('closed')).toHaveLength(1);
      expect(w.emitted('handoff')).toBeUndefined();
      expect(
        logEvent.mock.calls.filter(
          (c) => (c[0] as { context?: { action?: string } }).context?.action === 'consent_declined'
        )
      ).toHaveLength(1);
    });

    it('a missing picker ref: no handoff, grant cleared, picker_missing logged, error toast', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { w, door } = mountInline();
      // The picker did not mount (a refactor put the door inside a false v-if).
      (w.vm as unknown as { $: { setupState: { picker: unknown } } }).$.setupState.picker = null;
      door.camera();
      await flushPromises();

      expect(w.emitted('handoff')).toBeUndefined();
      expect(logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'error',
          surface: 'magic-beans-capture',
          context: { action: 'picker_missing', kind: 'camera' },
        })
      );
      expect(showToast).toHaveBeenCalledWith(
        'error',
        'ai.picker.openErrorTitle',
        'ai.picker.openErrorBody'
      );

      // Grant cleared: a file that turns up anyway is not read under it.
      const file = new File(['x'], 'a.png', { type: 'image/png' });
      w.findComponent({ name: 'AiDocumentPicker' }).vm.$emit('file', file);
      await flushPromises();
      expect(ingestInAppSource).not.toHaveBeenCalled();
      errSpy.mockRestore();
    });

    it('a rejecting commit is reported on the door surface with the action and toasts, not left unhandled', async () => {
      const boom = new Error('consent prompt failed');
      requestConsent.mockRejectedValue(boom);
      const unhandled = vi.fn();
      process.on('unhandledRejection', unhandled);
      reportError.mockClear();
      const { w, door } = mountInline();
      door.send('text');
      door.camera();
      await flushPromises();
      process.off('unhandledRejection', unhandled);

      expect(w.emitted('handoff')).toBeUndefined();
      expect(ingestInAppSource).not.toHaveBeenCalled();
      expect(reportError.mock.calls.map((c) => c[0])).toEqual([
        {
          surface: 'magic-beans-capture',
          message: 'inline door action failed',
          severity: 'error',
          error: boom,
          context: { action: 'send' },
        },
        {
          surface: 'magic-beans-capture',
          message: 'inline door action failed',
          severity: 'error',
          error: boom,
          context: { action: 'camera' },
        },
      ]);
      // The person is told, once per failed action, with the generic AI error copy.
      expect(showToast.mock.calls).toEqual([
        ['error', 'ai.error.title', 'ai.error.generic'],
        ['error', 'ai.error.title', 'ai.error.generic'],
      ]);
      expect(unhandled).not.toHaveBeenCalled();
    });

    it('with no reader enabled, an action logs inline_unreadable and does nothing', async () => {
      canReadAny = false;
      const { w, door } = mountInline();
      door.send('text');
      door.camera();
      await flushPromises();

      expect(refuseIfBusy).not.toHaveBeenCalled();
      expect(requestConsent).not.toHaveBeenCalled();
      expect(w.emitted('handoff')).toBeUndefined();
      expect(
        logEvent.mock.calls.filter(
          (c) => (c[0] as { context?: { action?: string } }).context?.action === 'inline_unreadable'
        )
      ).toHaveLength(2);
    });
  });
});

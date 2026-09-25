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
  logCaptureOpened: () => logCaptureOpened(),
  refuseIfBusy: (...args: unknown[]) => refuseIfBusy(...args),
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
    logCaptureOpened.mockReset();
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
      expect(MAGIC_DESTINATION_KINDS).toEqual(['event', 'travel', 'recipe', 'transactions']);
      for (const kind of MAGIC_DESTINATION_KINDS) {
        expect(MAGIC_DESTINATIONS[kind].emoji).toBeTruthy();
      }
    });
  });
});

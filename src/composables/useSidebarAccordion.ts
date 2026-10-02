import { reactive } from 'vue';
import { NAV_SECTIONS, type AccordionSectionId } from '@/constants/navigation';
import { logEvent } from '@/services/telemetry/logEvent';
import { readStoredJson, writeStoredJson } from '@/utils/storedJson';

/**
 * Open/closed state of the sidebar + hamburger accordion sections, shared
 * across both surfaces (module-level singleton) and persisted to localStorage.
 *
 * Every section starts CLOSED; closed sections still show a peek strip of their
 * pages. Auto-opening the current route's section is NOT done here:
 * `AppNavMenu` owns that watch, so it runs whenever a menu is mounted (the
 * desktop sidebar comes and goes with the breakpoint, and the drawer's menu
 * unmounts on every close). Opening one section never closes another.
 */

// v2: the default flipped from all-open to all-closed. The old
// `sidebar-accordion-state` key is deliberately ignored (not migrated) so
// everyone starts on the new default once; the stale value is never read.
const STORAGE_KEY = 'sidebar-accordion-state-v2';
const LABEL = 'useSidebarAccordion';
const SURFACE = 'sidebar-accordion';

function defaults(): Record<AccordionSectionId, boolean> {
  return Object.fromEntries(NAV_SECTIONS.map((s) => [s.id, false])) as Record<
    AccordionSectionId,
    boolean
  >;
}

const sectionState = reactive(defaults());
let initialized = false;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function loadState() {
  const read = readStoredJson(STORAGE_KEY, LABEL);
  if (read.kind === 'missing') return;
  if (read.kind === 'ok' && isPlainObject(read.value)) {
    // Copy only known ids; a section added since the state was saved stays closed.
    const stored = read.value;
    for (const { id } of NAV_SECTIONS) {
      if (typeof stored[id] === 'boolean') sectionState[id] = stored[id];
    }
    return;
  }
  logEvent({
    level: 'warn',
    surface: SURFACE,
    message: 'stored accordion state unparseable; using defaults',
    context: { action: 'load' },
  });
}

function saveState() {
  const write = writeStoredJson(STORAGE_KEY, { ...sectionState }, LABEL);
  if (write.ok) return;
  logEvent({
    level: 'warn',
    surface: SURFACE,
    message: 'accordion state not persisted; kept in memory',
    context: { action: 'save' },
    error: write.error,
  });
}

export function useSidebarAccordion() {
  if (!initialized) {
    initialized = true;
    loadState();
  }

  function isOpen(section: AccordionSectionId): boolean {
    return sectionState[section];
  }

  function toggle(section: AccordionSectionId) {
    sectionState[section] = !sectionState[section];
    saveState();
  }

  /** Open a section (e.g. the one owning the current route). No write when already open. */
  function reveal(section: AccordionSectionId) {
    if (sectionState[section]) return;
    sectionState[section] = true;
    saveState();
  }

  return { isOpen, toggle, reveal };
}

/** Test hook: forget the loaded state so the next call re-reads storage. */
export function __resetSidebarAccordionForTesting() {
  initialized = false;
  Object.assign(sectionState, defaults());
}

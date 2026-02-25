import { reactive, watch } from 'vue';
import { useRoute } from 'vue-router';
import { NAV_ITEMS, type NavSection } from '@/constants/navigation';

const STORAGE_KEY = 'sidebar-accordion-state';

type AccordionSection = Exclude<NavSection, 'pinned'>;

const sectionState = reactive<Record<AccordionSection, boolean>>({
  treehouse: true,
  piggyBank: true,
});

let initialized = false;

function loadState() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (typeof parsed.treehouse === 'boolean') sectionState.treehouse = parsed.treehouse;
      if (typeof parsed.piggyBank === 'boolean') sectionState.piggyBank = parsed.piggyBank;
    }
  } catch {
    // Ignore parse errors
  }
}

function saveState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      treehouse: sectionState.treehouse,
      piggyBank: sectionState.piggyBank,
    })
  );
}

export function useSidebarAccordion() {
  const route = useRoute();

  if (!initialized) {
    initialized = true;
    loadState();

    watch(
      () => route.path,
      (path) => {
        const activeItem = NAV_ITEMS.find((item) => item.path === path);
        if (
          activeItem &&
          (activeItem.section === 'treehouse' || activeItem.section === 'piggyBank')
        ) {
          sectionState[activeItem.section] = true;
          saveState();
        }
      },
      { immediate: true }
    );
  }

  function isOpen(section: AccordionSection): boolean {
    return sectionState[section];
  }

  function toggle(section: AccordionSection) {
    sectionState[section] = !sectionState[section];
    saveState();
  }

  return { isOpen, toggle };
}

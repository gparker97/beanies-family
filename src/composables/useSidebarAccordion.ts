import { reactive, watch } from 'vue';
import { useRoute } from 'vue-router';
import { NAV_ITEMS, type NavSection } from '@/constants/navigation';

const STORAGE_KEY = 'sidebar-accordion-state';
const EXPANDED_ITEMS_KEY = 'sidebar-expanded-items';

type AccordionSection = Exclude<NavSection, 'pinned'>;

const sectionState = reactive<Record<AccordionSection, boolean>>({
  treehouse: true,
  piggyBank: true,
});

const expandedItems = reactive<Record<string, boolean>>({});

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
  try {
    const stored = localStorage.getItem(EXPANDED_ITEMS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Record<string, boolean>;
      for (const [path, open] of Object.entries(parsed)) {
        if (typeof open === 'boolean') expandedItems[path] = open;
      }
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

function saveExpandedItems() {
  localStorage.setItem(EXPANDED_ITEMS_KEY, JSON.stringify({ ...expandedItems }));
}

function isPathUnderParent(path: string, parentPath: string): boolean {
  if (path === parentPath) return true;
  return path.startsWith(`${parentPath}/`);
}

export function useSidebarAccordion() {
  const route = useRoute();

  if (!initialized) {
    initialized = true;
    loadState();

    watch(
      () => route.path,
      (path) => {
        const activeItem = NAV_ITEMS.find(
          (item) => item.path === path || (item.children && isPathUnderParent(path, item.path))
        );
        if (
          activeItem &&
          (activeItem.section === 'treehouse' || activeItem.section === 'piggyBank')
        ) {
          sectionState[activeItem.section] = true;
          saveState();
          if (activeItem.children && isPathUnderParent(path, activeItem.path)) {
            expandedItems[activeItem.path] = true;
            saveExpandedItems();
          }
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

  function isItemExpanded(path: string): boolean {
    return !!expandedItems[path];
  }

  function toggleItem(path: string) {
    expandedItems[path] = !expandedItems[path];
    saveExpandedItems();
  }

  return { isOpen, toggle, isItemExpanded, toggleItem };
}

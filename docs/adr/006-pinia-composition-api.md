# ADR-006: Pinia Stores with Composition API

**Status:** Accepted
**Date:** Project inception

## Context

The application needs state management across multiple entity types (family members, accounts, transactions, assets, goals, settings, sync, recurring items). The state needs to be reactive for Vue components and persist through IndexedDB.

## Decision

Use **Pinia** as the state management library with the **Composition API** style (setup stores using `ref`, `computed`, and functions rather than Options API with `state`, `getters`, `actions`).

### Implementation Details

Each store follows a consistent pattern:

```typescript
export const useEntityStore = defineStore('entity', () => {
  // State as refs
  const items = ref<Entity[]>([]);
  const isLoading = ref(false);

  // Computed getters
  const activeItems = computed(() => items.value.filter(...));

  // Actions that call repository methods
  async function loadItems() { ... }
  async function addItem(input: CreateInput) { ... }
  async function updateItem(id: string, input: UpdateInput) { ... }
  async function deleteItem(id: string) { ... }

  return { items, isLoading, activeItems, loadItems, addItem, ... };
});
```

### Store Inventory

| Store             | File                              | Purpose              |
| ----------------- | --------------------------------- | -------------------- |
| familyStore       | `src/stores/familyStore.ts`       | Family members       |
| accountsStore     | `src/stores/accountsStore.ts`     | Bank accounts        |
| transactionsStore | `src/stores/transactionsStore.ts` | Transactions         |
| assetsStore       | `src/stores/assetsStore.ts`       | Assets and loans     |
| goalsStore        | `src/stores/goalsStore.ts`        | Financial goals      |
| settingsStore     | `src/stores/settingsStore.ts`     | App settings         |
| syncStore         | `src/stores/syncStore.ts`         | Sync state           |
| recurringStore    | `src/stores/recurringStore.ts`    | Recurring items      |
| translationStore  | `src/stores/translationStore.ts`  | i18n state           |
| memberFilterStore | `src/stores/memberFilterStore.ts` | Global member filter |

## Consequences

### Positive

- Composition API style is consistent with Vue 3 component patterns
- Full TypeScript support with type inference
- Stores are testable (see `*.test.ts` files alongside stores)
- Reactive state automatically updates all consuming components

### Negative

- More boilerplate than Options API style for simple stores
- Need to ensure stores are initialized (call `loadItems()`) before components render

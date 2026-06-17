// Beanie Lists (#33) — curated templates that seed a new list. A template only
// produces a `CreateFamilyListInput` seed (name/emoji/category/recurrence/items);
// once created the list is a normal, fully-editable record with no live link
// back. `starterItems` are PLAIN seed text (user data, like a to-do title — not
// translated). Adding/removing a template is a one-row edit here + its 2 keys.
import type { ListCategory, ListLifecycle, ListFrequency } from '@/types/models';
import type { UIStringKey } from '@/services/translation/uiStrings';

export interface ListTemplate {
  key: string;
  icon: string;
  nameKey: UIStringKey;
  descriptionKey: UIStringKey;
  category: ListCategory;
  lifecycle: ListLifecycle;
  frequency?: ListFrequency;
  starterItems: string[];
}

export const LIST_TEMPLATES: ListTemplate[] = [
  {
    key: 'grocery',
    icon: '🛒',
    nameKey: 'lists.template.grocery.name',
    descriptionKey: 'lists.template.grocery.desc',
    category: 'out',
    lifecycle: 'recurring',
    frequency: 'weekly',
    starterItems: ['Bananas', 'Spinach', 'Avocados', 'Oat milk', 'Pasta & passata'],
  },
  {
    key: 'vacation-packing',
    icon: '🧳',
    nameKey: 'lists.template.vacationPacking.name',
    descriptionKey: 'lists.template.vacationPacking.desc',
    category: 'trips',
    lifecycle: 'oneoff',
    starterItems: [
      'Passports & visas',
      'Sunscreen & hats',
      'Swim things',
      'Travel adapters',
      'Chargers',
    ],
  },
  {
    key: 'honey-do',
    icon: '🍯',
    nameKey: 'lists.template.honeydo.name',
    descriptionKey: 'lists.template.honeydo.desc',
    category: 'home',
    lifecycle: 'oneoff',
    starterItems: [],
  },
  {
    key: 'kids-chores',
    icon: '🧹',
    nameKey: 'lists.template.kidsChores.name',
    descriptionKey: 'lists.template.kidsChores.desc',
    category: 'kids',
    lifecycle: 'recurring',
    frequency: 'weekly',
    starterItems: [
      'Make the bed',
      'Feed the dog',
      'Tidy toy bins',
      'Water the plants',
      'Put away laundry',
    ],
  },
  {
    key: 'before-school',
    icon: '🎒',
    nameKey: 'lists.template.beforeSchool.name',
    descriptionKey: 'lists.template.beforeSchool.desc',
    category: 'kids',
    lifecycle: 'recurring',
    frequency: 'daily',
    starterItems: ['Brush teeth', 'Pack bag', 'Water bottle', 'Homework in folder', 'Shoes on'],
  },
  {
    key: 'party-prep',
    icon: '🎉',
    nameKey: 'lists.template.partyPrep.name',
    descriptionKey: 'lists.template.partyPrep.desc',
    category: 'celebrations',
    lifecycle: 'oneoff',
    starterItems: ['Guest list', 'Send invites', 'Order cake', 'Decorations', 'Party bags'],
  },
];

const _byKey = new Map(LIST_TEMPLATES.map((t) => [t.key, t]));

export function getListTemplateByKey(key: string): ListTemplate | undefined {
  return _byKey.get(key);
}

export function getListTemplatesForCategory(category: ListCategory): ListTemplate[] {
  return LIST_TEMPLATES.filter((t) => t.category === category);
}

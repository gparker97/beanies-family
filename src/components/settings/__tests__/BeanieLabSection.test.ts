import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import { mount } from '@vue/test-utils';
import BeanieLabSection from '../BeanieLabSection.vue';

// Controllable Lab-visibility refs (the component reads these via useBeanieLab).
// AI is the sole Lab feature since 2026-07-03 (calendar graduated out).
const labEnabled = ref(false);
const aiVisible = ref(false);
const prefersReducedMotion = ref(false);
const setBeanieLabEnabled = vi.fn(async () => {});

vi.mock('@/composables/useBeanieLab', () => ({
  useBeanieLab: () => ({ labEnabled, aiVisible }),
}));
vi.mock('@/composables/useReducedMotion', () => ({
  useReducedMotion: () => ({ prefersReducedMotion }),
}));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: () => ({ setBeanieLabEnabled }) }));

// Stubs: render slots without animation/ref machinery; a clickable master toggle.
function mountSection() {
  return mount(BeanieLabSection, {
    global: {
      stubs: {
        SmoothHeight: { template: '<div><slot /></div>' },
        ConditionalSection: { template: '<div><slot /></div>' },
        BetaBadge: { template: '<span class="beta-badge" />' },
        SettingsCard: {
          props: ['icon', 'title', 'description'],
          emits: ['click'],
          template: '<div class="settings-card" @click="$emit(\'click\')">{{ title }}</div>',
        },
        SettingToggleRow: {
          props: ['modelValue'],
          emits: ['update:modelValue'],
          template:
            '<button class="master-toggle" @click="$emit(\'update:modelValue\', !modelValue)" />',
        },
      },
    },
  });
}

beforeEach(() => {
  labEnabled.value = false;
  aiVisible.value = false;
  prefersReducedMotion.value = false;
  vi.clearAllMocks();
});

describe('BeanieLabSection', () => {
  it('is collapsed by default (aria-expanded false) and expands on click', async () => {
    const wrapper = mountSection();
    const header = wrapper.get('[data-testid="beanie-lab-toggle"]');
    expect(header.attributes('aria-expanded')).toBe('false');

    await header.trigger('click');
    expect(header.attributes('aria-expanded')).toBe('true');
  });

  it('Lab OFF: shows the empty state and no feature cards', () => {
    labEnabled.value = false;
    const wrapper = mountSection();
    expect(wrapper.findAll('.settings-card')).toHaveLength(0);
    expect(wrapper.text()).toContain('settings.beanieLab.empty');
  });

  it('Lab ON: renders the single AI card and emits open-ai on click', async () => {
    labEnabled.value = true;
    aiVisible.value = true;
    const wrapper = mountSection();

    const cards = wrapper.findAll('.settings-card');
    expect(cards).toHaveLength(1);
    expect(cards[0].text()).toContain('settings.card.ai');
    expect(wrapper.text()).not.toContain('settings.beanieLab.empty');

    await cards[0].trigger('click');
    expect(wrapper.emitted('open-ai')).toHaveLength(1);
    expect(wrapper.emitted('open-calendar')).toBeUndefined();
  });

  it('Lab ON but AI unavailable: no card shows', () => {
    labEnabled.value = true;
    aiVisible.value = false;
    const wrapper = mountSection();
    expect(wrapper.findAll('.settings-card')).toHaveLength(0);
  });

  it('toggling the master switch calls setBeanieLabEnabled with the negated value', async () => {
    const wrapper = mountSection();
    await wrapper.get('[data-testid="beanie-lab-toggle"]').trigger('click'); // expand
    await wrapper.get('.master-toggle').trigger('click');
    expect(setBeanieLabEnabled).toHaveBeenCalledWith(true);
  });

  it('does not animate the beaker when reduced motion is preferred', async () => {
    prefersReducedMotion.value = true;
    const wrapper = mountSection();
    await wrapper.get('[data-testid="beanie-lab-toggle"]').trigger('click'); // expand
    expect(wrapper.find('.lab-ico-animate').exists()).toBe(false);
  });

  it('animates the beaker only once expanded (reduced motion off)', async () => {
    const wrapper = mountSection();
    expect(wrapper.find('.lab-ico-animate').exists()).toBe(false); // collapsed
    await wrapper.get('[data-testid="beanie-lab-toggle"]').trigger('click');
    expect(wrapper.find('.lab-ico-animate').exists()).toBe(true);
  });
});

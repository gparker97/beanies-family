/**
 * The loading frame must SAY something.
 *
 * The `loading` branch replaced the placeholder, but the caption only existed inside that
 * placeholder and in the with-image figcaption — so a loading frame rendered a bare gradient
 * and `recipeExtract.attaching` was unreachable on every surface that passed it. The string
 * was dead and nobody noticed, because nothing rendered it in a test.
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import PolaroidImage from '../PolaroidImage.vue';

describe('PolaroidImage', () => {
  it('shows the caption while loading, not just a spinner', () => {
    const w = mount(PolaroidImage, {
      props: { src: null, loading: true, caption: 'Adding the photo…' },
      global: { stubs: { BeanieSpinner: true } },
    });
    expect(w.text()).toContain('Adding the photo…');
  });

  it('announces itself to a screen reader while loading', () => {
    const w = mount(PolaroidImage, {
      props: { src: null, loading: true, caption: 'Adding the photo…' },
      global: { stubs: { BeanieSpinner: true } },
    });
    const live = w.find('[role="status"]');
    expect(live.exists()).toBe(true);
    expect(live.attributes('aria-busy')).toBe('true');
  });

  it('still shows the empty-state caption when not loading', () => {
    const w = mount(PolaroidImage, { props: { src: null, caption: 'No photo yet' } });
    expect(w.text()).toContain('No photo yet');
    expect(w.find('[role="status"]').exists()).toBe(false);
  });

  it('shows the image, not the spinner, once loading is done', () => {
    const w = mount(PolaroidImage, {
      props: { src: 'https://x.test/a.jpg', loading: false, caption: 'Pie' },
    });
    expect(w.find('img').exists()).toBe(true);
    expect(w.text()).toContain('Pie');
  });
});

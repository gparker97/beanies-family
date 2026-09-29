/**
 * LinkList (#113): favicon link rows. What it must guarantee:
 *   - every href goes through `safeExternalHref`, so a non-http(s) URL renders nothing,
 *   - `favicons: false` (an unreviewed model read) makes no favicon request at all,
 *   - the default still shows the favicon.
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import LinkList from '@/components/ui/LinkList.vue';

describe('LinkList', () => {
  it('renders a favicon image by default', () => {
    const w = mount(LinkList, { props: { urls: ['https://school.example/forms'] } });
    const anchors = w.findAll('a');
    expect(anchors).toHaveLength(1);
    expect(anchors[0]!.attributes('href')).toBe('https://school.example/forms');
    expect(w.find('img').exists()).toBe(true);
  });

  it('with favicons off, renders no image, only the link glyph', () => {
    const w = mount(LinkList, {
      props: {
        urls: ['https://school.example/forms', 'https://pay.example/trip'],
        favicons: false,
      },
    });
    expect(w.findAll('a')).toHaveLength(2);
    expect(w.find('img').exists()).toBe(false);
    const glyphs = w.findAll('span[aria-hidden="true"]');
    expect(glyphs).toHaveLength(2);
    expect(glyphs[0]!.text()).toBe('🔗');
  });

  it('with favicons off, still screens every href (a javascript: URL renders nothing)', () => {
    const w = mount(LinkList, {
      props: { urls: ['javascript:alert(1)', 'https://pay.example/trip'], favicons: false },
    });
    const anchors = w.findAll('a');
    expect(anchors).toHaveLength(1);
    expect(anchors[0]!.attributes('href')).toBe('https://pay.example/trip');
    expect(w.html()).not.toContain('javascript:');
  });

  it('renders nothing when no URL survives the screen', () => {
    const w = mount(LinkList, { props: { urls: ['javascript:alert(1)'], favicons: false } });
    expect(w.find('a').exists()).toBe(false);
    expect(w.find('img').exists()).toBe(false);
  });
});

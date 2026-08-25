/**
 * The shared brain behind both recipe-link surfaces (the link modal and the Add Recipe
 * form's shortcut band). Pinned here rather than in either component's tests, because the
 * whole point of the composable is that the two surfaces cannot disagree.
 */
import { describe, it, expect } from 'vitest';
import { useRecipeLinkInput } from '../useRecipeLinkInput';

describe('useRecipeLinkInput', () => {
  it('does not scold an empty field', () => {
    const i = useRecipeLinkInput();
    i.touched.value = true;
    expect(i.showError.value).toBe(false);
    expect(i.hintKey.value).toBe('recipeExtract.link.hint');
  });

  it('stays quiet about a bad link until the user has actually tried', () => {
    const i = useRecipeLinkInput();
    i.link.value = 'not a url';
    expect(i.showError.value).toBe(false); // untouched
    i.touched.value = true;
    expect(i.showError.value).toBe(true);
    expect(i.hintKey.value).toBe('recipeExtract.link.invalid');
  });

  it('recognises a video and says so, so the different behaviour is not a surprise', () => {
    const i = useRecipeLinkInput();
    i.link.value = 'https://www.youtube.com/watch?v=PmuCEQTy-9E';
    expect(i.isVideo.value).toBe(true);
    expect(i.hintKey.value).toBe('recipeExtract.link.videoHint');
  });

  it('returns the trimmed url only when it is safe to submit', () => {
    const i = useRecipeLinkInput();
    i.link.value = '  https://preppykitchen.com/pumpkin-pie-2/  ';
    expect(i.trySubmit()).toBe('https://preppykitchen.com/pumpkin-pie-2/');
  });

  it('refuses to submit a bad link, and marks it touched so the error shows', () => {
    const i = useRecipeLinkInput();
    i.link.value = 'javascript:alert(1)';
    expect(i.trySubmit()).toBeNull();
    expect(i.touched.value).toBe(true);
    expect(i.showError.value).toBe(true);
  });

  it('reset clears both the value and the complaint', () => {
    const i = useRecipeLinkInput();
    i.link.value = 'nope';
    i.touched.value = true;
    i.reset();
    expect(i.link.value).toBe('');
    expect(i.showError.value).toBe(false);
  });
});

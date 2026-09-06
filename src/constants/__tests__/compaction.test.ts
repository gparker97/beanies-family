/**
 * The safety copy's name is matched against real files to keep it out of the
 * auto-selecting pod lookup (ADR-033), so writer and reader must agree exactly.
 */
import { describe, it, expect } from 'vitest';
import { SAFETY_COPY_INFIX, safetyCopyName, isSafetyCopyName } from '../compaction';

describe('safety copy naming', () => {
  it('derives from the pod own name, so two families in one folder do not collide', () => {
    // ⚠️ The Drive app folder is per-ACCOUNT. One account owning two families
    // keeps both pods in it, and a single fixed name would have each family's
    // compaction overwrite the other's rollback copy.
    expect(safetyCopyName('parker.beanpod')).toBe('parker (before compacting).beanpod');
    expect(safetyCopyName('meng.beanpod')).toBe('meng (before compacting).beanpod');
    expect(safetyCopyName('parker.beanpod')).not.toBe(safetyCopyName('meng.beanpod'));
  });

  it('is stable, so re-compacting overwrites its own copy rather than adding one', () => {
    expect(safetyCopyName('parker.beanpod')).toBe(safetyCopyName('parker.beanpod'));
  });

  it('round-trips: anything the writer produces, the reader recognises', () => {
    for (const pod of ['a.beanpod', 'the Parker-Meng beanies.beanpod', 'no-extension']) {
      expect(isSafetyCopyName(safetyCopyName(pod))).toBe(true);
    }
  });

  it('does not mistake an ordinary pod for a copy', () => {
    expect(isSafetyCopyName('parker.beanpod')).toBe(false);
    expect(isSafetyCopyName('before compacting.beanpod')).toBe(false);
  });

  it('keeps the marker untranslated and readable as a backup', () => {
    // A localized marker would be unmatchable the moment the reader's language
    // differed from the writer's — a filter that silently does nothing. And the
    // copy stays VISIBLE in the human picker, so the name has to read as a
    // backup at a glance.
    expect(SAFETY_COPY_INFIX).toBe(' (before compacting)');
  });
});

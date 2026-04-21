import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

const showToastMock = vi.fn();
vi.mock('@/composables/useToast', () => ({
  showToast: (...args: unknown[]) => showToastMock(...args),
}));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const familyState = {
  currentMember: undefined as { id: string } | undefined,
  owner: undefined as { id: string } | undefined,
};
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => familyState,
}));

import { useAuthoringMember } from '../useAuthoringMember';

describe('useAuthoringMember.resolveOrToast', () => {
  beforeEach(() => {
    showToastMock.mockClear();
    familyState.currentMember = undefined;
    familyState.owner = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns currentMember.id when present', () => {
    familyState.currentMember = { id: 'member-current' };
    familyState.owner = { id: 'member-owner' };
    const { resolveOrToast } = useAuthoringMember();
    const author = resolveOrToast({
      callerTag: 'test',
      toastTitleKey: 'accountView.adjustError.noAuthor',
      toastHelpKey: 'accountView.adjustError.noAuthorHelp',
    });
    expect(author).toBe('member-current');
    expect(showToastMock).not.toHaveBeenCalled();
  });

  it('falls back to owner.id when currentMember is undefined', () => {
    familyState.currentMember = undefined;
    familyState.owner = { id: 'member-owner' };
    const { resolveOrToast } = useAuthoringMember();
    const author = resolveOrToast({
      callerTag: 'test',
      toastTitleKey: 'accountView.adjustError.noAuthor',
      toastHelpKey: 'accountView.adjustError.noAuthorHelp',
    });
    expect(author).toBe('member-owner');
    expect(showToastMock).not.toHaveBeenCalled();
  });

  it('returns null + toasts + logs when neither is present', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    familyState.currentMember = undefined;
    familyState.owner = undefined;
    const { resolveOrToast } = useAuthoringMember();
    const author = resolveOrToast({
      callerTag: 'test-caller',
      toastTitleKey: 'accountView.adjustError.noAuthor',
      toastHelpKey: 'accountView.adjustError.noAuthorHelp',
    });
    expect(author).toBeNull();
    expect(showToastMock).toHaveBeenCalledWith(
      'error',
      'accountView.adjustError.noAuthor',
      'accountView.adjustError.noAuthorHelp'
    );
    expect(errorSpy).toHaveBeenCalledWith('[test-caller] no authorable member');
    errorSpy.mockRestore();
  });
});

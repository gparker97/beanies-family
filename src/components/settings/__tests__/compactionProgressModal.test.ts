/**
 * The progress surface has to SHOW the three things a toast was throwing away:
 * where the run is, what it achieved, and who the family must now go and help.
 *
 * ⚠️ ASSERTED ON RENDERED OUTPUT, never on source text — the lesson
 * `lineageBanner.test.ts` records, and the one this session has needed three
 * times over messages whose render site turned out to be unreachable.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import CompactionProgressModal from '@/components/settings/CompactionProgressModal.vue';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/utils/fillTemplate', () => ({
  fillTemplate: (s: string, vars: Record<string, string>) =>
    `${s}:${Object.values(vars).join('|')}`,
}));

const stubs = {
  BaseModal: {
    props: ['open', 'closable'],
    template: '<div v-if="open" :data-closable="String(closable)"><slot /></div>',
  },
  BaseButton: { template: '<button><slot /></button>' },
  BeanieSpinner: { template: '<span data-spinner="1" />' },
};

function mountModal(props: Record<string, unknown>) {
  return mount(CompactionProgressModal, {
    props: {
      open: true,
      step: 0,
      phase: 'running',
      stats: null,
      failure: null,
      behind: [],
      ...props,
    },
    global: { stubs },
  });
}

describe('CompactionProgressModal', () => {
  it('shows the four steps while it runs, with the current one spinning', () => {
    const w = mountModal({ step: 2, phase: 'running' });
    const text = w.text();
    expect(text).toContain('compactionProgress.step0');
    expect(text).toContain('compactionProgress.step3');
    // Exactly one spinner: the step the run is actually on.
    expect(w.findAll('[data-spinner]')).toHaveLength(1);
  });

  it('CANNOT be dismissed while running', () => {
    // An interrupted compaction is precisely what the safety copy exists for;
    // offering a close control mid-run invites the state we most want to avoid.
    const w = mountModal({ phase: 'running' });
    expect(w.find('[data-closable]').attributes('data-closable')).toBe('false');
    // And no Done button until it has ended.
    expect(w.find('button').exists()).toBe(false);
  });

  it('shows the before and after sizes on success', () => {
    const w = mountModal({
      phase: 'done',
      step: 4,
      stats: { beforeBytes: 2_202_009, afterBytes: 209_715 },
    });
    const text = w.text();
    expect(text).toContain('2.1 MB');
    expect(text).toContain('0.2 MB');
    // The saved line carries both the amount and the percentage.
    expect(text).toContain('compactionProgress.saved');
  });

  it('NAMES each person who must update, with what they should do', () => {
    // The reason this is a modal and not a toast.
    const w = mountModal({
      phase: 'done',
      step: 4,
      stats: { beforeBytes: 2_202_009, afterBytes: 209_715 },
      behind: ['Sophia', 'Joey'],
    });
    const text = w.text();
    expect(text).toContain('Sophia');
    expect(text).toContain('Joey');
    expect(text).toContain('compactionProgress.todoItem');
    expect(text).toContain('compactionProgress.todoTitle');
  });

  it('says there is nothing to do when nobody is behind', () => {
    const w = mountModal({
      phase: 'done',
      step: 4,
      stats: { beforeBytes: 2_202_009, afterBytes: 209_715 },
      behind: [],
    });
    expect(w.text()).toContain('compactionProgress.doneNothingToDo');
    expect(w.text()).not.toContain('compactionProgress.todoTitle');
  });

  it('renders a refusal WHERE THE PERSON IS LOOKING, and lets them close it', async () => {
    const w = mountModal({
      phase: 'failed',
      step: 1,
      failure: {
        titleKey: 'compactionProgress.failedTitle',
        subtitleKey: 'compactionProgress.failedSubtitle',
        helpKey: 'compaction.refused.safety-copy-damaged',
      },
    });
    expect(w.text()).toContain('compaction.refused.safety-copy-damaged');
    // It must say the file was not changed — the reassurance is the point.
    expect(w.text()).toContain('compactionProgress.failedSubtitle');
    expect(w.find('[data-closable]').attributes('data-closable')).toBe('true');

    await w.find('button').trigger('click');
    expect(w.emitted('close')).toHaveLength(1);
  });

  it('keeps the step list on a failure, so the person can see WHICH step stopped', () => {
    const w = mountModal({
      phase: 'failed',
      step: 2,
      failure: {
        titleKey: 'compactionProgress.failedTitle',
        subtitleKey: 'compactionProgress.failedSubtitle',
        helpKey: 'compaction.failedHelp',
      },
    });
    expect(w.text()).toContain('compactionProgress.step2');
  });

  it('does NOT claim the file is unchanged when the PUBLISH is what failed', async () => {
    // ⚠️ THE FALSE SENTENCE WAS THE SUBTITLE. At a publish failure the document
    // IS compacted, IS on a new lineage and IS persisted to cache — only the
    // cloud copy is stale. "Your family file has not been changed" is flatly
    // false there, and it is the sentence that would stop someone re-publishing.
    const w = mountModal({
      phase: 'failed',
      step: 3,
      failure: {
        titleKey: 'compactionProgress.failedTitle',
        subtitleKey: 'compaction.publishFailed',
        helpKey: 'compaction.publishFailedHelp',
      },
    });
    const text = w.text();
    expect(text).toContain('compaction.publishFailed');
    expect(text).toContain('compaction.publishFailedHelp');
    expect(text).not.toContain('compactionProgress.failedSubtitle');
  });
});

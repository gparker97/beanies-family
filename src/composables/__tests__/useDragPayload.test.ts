import { describe, it, expect, vi } from 'vitest';
import { createDragPayload } from '@/composables/useDragPayload';

function dragEvent() {
  const dataTransfer = { setData: vi.fn(), effectAllowed: 'none' };
  return { event: { dataTransfer } as unknown as DragEvent, dataTransfer };
}

describe('createDragPayload', () => {
  it('shares one payload across every caller of the same composable', () => {
    const useThingDrag = createDragPayload<{ id: string }>('beanies-thing');
    useThingDrag().startDrag({ id: 'a' });
    expect(useThingDrag().dragged.value).toEqual({ id: 'a' });
    useThingDrag().endDrag();
    expect(useThingDrag().dragged.value).toBeNull();
  });

  it('keeps separate payload types apart', () => {
    const useA = createDragPayload<string>('beanies-a');
    const useB = createDragPayload<string>('beanies-b');
    useA().startDrag('from-a');
    expect(useB().dragged.value).toBeNull();
  });

  it('sets dataTransfer data so Firefox starts the drag', () => {
    const useThingDrag = createDragPayload<string>('beanies-thing');
    const { event, dataTransfer } = dragEvent();
    useThingDrag().startDrag('x', event);
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'beanies-thing');
    expect(dataTransfer.effectAllowed).toBe('move');
  });
});

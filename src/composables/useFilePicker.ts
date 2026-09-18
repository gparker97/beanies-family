/**
 * Programmatic `<input type="file">` composable.
 *
 * Usage:
 *   const { open, inputRef, bindings } = useFilePicker({
 *     accept: 'image/jpeg,image/png',
 *     multiple: true,
 *     onPick: (files) => handle(files),
 *   });
 *
 *   <input ref="inputRef" v-bind="bindings" />
 *   <button @click="open">Add photo</button>
 *
 * The composable does not render the input — callers are expected to
 * include a hidden `<input ref="inputRef" v-bind="bindings">` in their
 * template. This keeps the file picker colocated with its trigger while
 * centralizing the accept/multiple/reset logic.
 */
import { ref, type Ref } from 'vue';
import { reportError } from '@/utils/errorReporter';

export interface UseFilePickerOptions {
  /**
   * Comma-separated accept string for the <input> element (extensions
   * and/or MIME types): e.g. 'image/jpeg,image/png,.heic'.
   */
  accept?: string;
  /** Allow multiple files. Default false. */
  multiple?: boolean;
  /**
   * Request direct camera capture on mobile (ignored on desktop).
   * `'environment'` = rear camera, `'user'` = selfie camera. When set,
   * the OS opens the camera app instead of the gallery, and `multiple`
   * is effectively forced off (camera captures one frame at a time).
   */
  capture?: 'user' | 'environment';
  /** Called with the selected files (never with an empty array). */
  onPick: (files: File[]) => void | Promise<void>;
}

export interface UseFilePickerBindings {
  type: 'file';
  accept?: string;
  multiple: boolean;
  capture?: 'user' | 'environment';
  style: string;
  onChange: (e: Event) => void;
}

export interface UseFilePickerReturn {
  /** Attach to the <input> element via `ref`. */
  inputRef: Ref<HTMLInputElement | null>;
  /**
   * Attach via v-bind to the <input>. Includes an accept attr, multiple
   * flag, a hidden style, and the change handler.
   */
  bindings: UseFilePickerBindings;
  /**
   * Trigger the file picker dialog. Returns `false` — and reports — when the hidden
   * input never mounted, because `inputRef.value?.click()` on a null ref is a tap that
   * does nothing at all, with no error anywhere. Callers surface their own message.
   */
  open: () => boolean;
}

export function useFilePicker(options: UseFilePickerOptions): UseFilePickerReturn {
  const inputRef = ref<HTMLInputElement | null>(null);

  async function onChange(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const files = input.files ? Array.from(input.files) : [];
    // Clear value so picking the same file twice still fires change.
    input.value = '';
    if (files.length === 0) return; // user canceled
    await options.onPick(files);
  }

  function open(): boolean {
    if (!inputRef.value) {
      // The caller rendered the trigger but not the `<input ref="inputRef">`, or called
      // before mount. Either way the user taps and nothing happens, which is the exact
      // silent failure this return value exists to make impossible to ignore.
      reportError({
        surface: 'file-picker',
        message: 'file picker opened before its input mounted — the trigger is a no-op',
        severity: 'warning',
        // `kind` is a SHARED, store-declared dimension that several features filter on as a
        // small enum — a raw MIME string pollutes it. Which picker it was is already carried
        // by the surface and the stack.
        context: { action: 'picker_open_no_input' },
      });
      return false;
    }
    inputRef.value.click();
    return true;
  }

  return {
    inputRef,
    bindings: {
      type: 'file',
      accept: options.accept,
      multiple: options.multiple ?? false,
      ...(options.capture ? { capture: options.capture } : {}),
      style: 'position:absolute;left:-9999px;width:1px;height:1px;opacity:0;',
      onChange,
    },
    open,
  };
}

/**
 * Type declarations for File System Access API
 * These APIs are not fully standardized and may not have complete TypeScript support
 */

interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

interface FileSystemFileHandle {
  queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}

interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}

interface SaveFilePickerOptions {
  excludeAcceptAllOption?: boolean;
  suggestedName?: string;
  types?: FilePickerAcceptType[];
}

interface OpenFilePickerOptions {
  excludeAcceptAllOption?: boolean;
  multiple?: boolean;
  types?: FilePickerAcceptType[];
}

interface Window {
  showSaveFilePicker(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>;
  showOpenFilePicker(options?: OpenFilePickerOptions): Promise<FileSystemFileHandle[]>;
}

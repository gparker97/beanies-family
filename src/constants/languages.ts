import type { LanguageCode } from '@/types/models';

export interface LanguageInfo {
  code: LanguageCode;
  name: string;
  nativeName: string;
  flag: string;
  flagIcon?: string; // Reserved for future custom PNG flag icons
}

export const LANGUAGES: LanguageInfo[] = [
  { code: 'en', name: 'English', nativeName: 'English', flag: '🇺🇸' },
  { code: 'zh', name: 'Chinese (Simplified)', nativeName: '简体中文', flag: '🇨🇳' },
];

export const DEFAULT_LANGUAGE: LanguageCode = 'en';

export const SUPPORTED_LANGUAGE_CODES: LanguageCode[] = LANGUAGES.map((l) => l.code);

export function getLanguageInfo(code: LanguageCode): LanguageInfo | undefined {
  return LANGUAGES.find((l) => l.code === code);
}

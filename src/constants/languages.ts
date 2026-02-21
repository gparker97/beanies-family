import type { LanguageCode } from '@/types/models';

export interface LanguageInfo {
  code: LanguageCode;
  name: string;
  nativeName: string;
  flag: string;
  flagIcon?: string; // Path to beanie flag illustration
}

export const LANGUAGES: LanguageInfo[] = [
  {
    code: 'en',
    name: 'English',
    nativeName: 'English',
    flag: '🇺🇸',
    flagIcon: '/brand/flags/us.svg',
  },
  {
    code: 'zh',
    name: 'Chinese (Simplified)',
    nativeName: '简体中文',
    flag: '🇨🇳',
    flagIcon: '/brand/flags/cn.svg',
  },
];

export const DEFAULT_LANGUAGE: LanguageCode = 'en';

export const SUPPORTED_LANGUAGE_CODES: LanguageCode[] = LANGUAGES.map((l) => l.code);

export function getLanguageInfo(code: LanguageCode): LanguageInfo | undefined {
  return LANGUAGES.find((l) => l.code === code);
}

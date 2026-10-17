/**
 * The first word of a title, for the one-word surfaces (#134: the lock-screen circle's
 * `WidgetRow.shortTitle`). "swimming lesson at Tampines pool" gives "swimming"; a Chinese
 * title gives its first dictionary word ("游泳课" gives "游泳"), never the whole sentence a
 * whitespace split would return for a language written without spaces.
 *
 * `Intl.Segmenter` with word granularity, taking the first `isWordLike` segment, so a
 * leading emoji or punctuation is skipped ("🎂 Ava's party" gives "Ava's"). Guarded like
 * `memberInitials.ts`: an engine without the segmenter falls back to a whitespace split, so
 * it degrades rather than throws. Total: '' for a blank title; a title with no word-like
 * segment at all (only emoji) gives its first whitespace-separated token.
 */
import type { LanguageCode } from '@/types/models';
import { uiLocale } from '@/utils/uiLocale';

/** The first whitespace-separated token, '' when there is none. */
function firstToken(text: string): string {
  return text.split(/\s+/)[0] ?? '';
}

export function firstWord(text: string, lang: LanguageCode | undefined): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  const Seg = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (!Seg) return firstToken(trimmed);
  for (const s of new Seg(uiLocale(lang), { granularity: 'word' }).segment(trimmed)) {
    if (s.isWordLike) return s.segment;
  }
  return firstToken(trimmed);
}

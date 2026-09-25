// Statement line fingerprint (#107). Identifies ONE statement line so a later import of the same
// statement (or an overlapping one) shows it as already added.

import type { StatementLineDraft } from '@/services/ai/types';
import { sha256HexOfParts } from '@/utils/encoding';
import { normaliseMerchant } from './merchantMemory';

type FingerprintLine = Pick<
  StatementLineDraft,
  'date' | 'amount' | 'direction' | 'description' | 'reference'
>;

/**
 * The line's text part: the bank reference when printed (stable across re-reads, where OCR of
 * a description may not be), else the normalised description. It stands in for the description
 * ONLY, never for the date or the amount: a 4-digit BofA reference recurs across statements, so
 * `account + reference` alone would mark a new line on a later statement as already added.
 */
function textPart(line: FingerprintLine): string {
  return line.reference?.trim() || normaliseMerchant(line.description);
}

/**
 * ONE formula for every line: SHA-256 over account, date, amount (2 dp), direction, text part
 * and ordinal, NUL-separated. `accountId` is the import's HEADER account, never a per-row
 * override: the fingerprint identifies the statement line, and the statement belongs to the
 * header account. Throws when `crypto.subtle` is unavailable (the caller classifies it).
 */
export function statementFingerprint(
  accountId: string,
  line: FingerprintLine,
  ordinal: number
): Promise<string> {
  return sha256HexOfParts(
    [accountId, line.date, line.amount.toFixed(2), line.direction, textPart(line), String(ordinal)],
    '\0'
  );
}

/**
 * Fingerprints for a whole statement, aligned with `lines`. Computes each line's ordinal (its
 * 0-based index among the lines sharing date + amount + direction + text part, in input order)
 * so no caller ever computes ordinals itself; three identical same-day lines (Chase prints
 * 3 × -5,000.00) get ordinals 0, 1, 2 and stay three distinct lines.
 *
 * The ordinal is counted across the WHOLE merged line list, not per page or chunk: units are
 * concatenated in statement order before planning, and a page boundary can split a run of
 * identical lines, so a per-unit count would give two of them ordinal 0 and collapse them. The
 * result is stable across re-reads of the same statement as long as line order is stable,
 * which it is (units are read and merged in statement order).
 */
export async function fingerprintLines(
  accountId: string,
  lines: readonly FingerprintLine[]
): Promise<string[]> {
  const seen = new Map<string, number>();
  const ordinals = lines.map((line) => {
    const key = [line.date, line.amount.toFixed(2), line.direction, textPart(line)].join('\0');
    const ordinal = seen.get(key) ?? 0;
    seen.set(key, ordinal + 1);
    return ordinal;
  });
  return Promise.all(lines.map((line, i) => statementFingerprint(accountId, line, ordinals[i]!)));
}

/**
 * The invite message, lifted out of `ShareChannelGrid` (#92).
 *
 * WHY IT MOVED. The grid now takes a finished MESSAGE rather than building one, so that a
 * single channel implementation can carry an invite or a recipe without either knowing about
 * the other. This file is the invite's message builder; `recipeShareText.ts` is the recipe's.
 *
 * ⚠️ AND WHY IT USES `fillTemplate`. The version this replaced used
 * `t('share.messageBody').replace('{family}', familyName)`. A string replacement interprets
 * `$&`, `` $` ``, `$'` and `$1` in the REPLACEMENT, so a family called "Smith $& Co" rendered
 * the matched text back in its own place — in a live invite message, to a stranger.
 * `fillTemplate`'s function replacer inserts the value literally. See `utils/fillTemplate.ts`.
 */
import { fillTemplate } from './fillTemplate';
import type { UIStringKey } from '@/services/translation/uiStrings';

export interface InviteShareTextArgs {
  link: string;
  familyName: string;
  memberName: string;
  t: (key: UIStringKey) => string;
}

/** The message body sent to WhatsApp, Telegram, SMS, Messenger and email. */
export function buildInviteShareBody(args: InviteShareTextArgs): string {
  return fillTemplate(args.t('share.messageBody'), {
    member: args.memberName,
    family: args.familyName,
    link: args.link,
  });
}

/** The `mailto:` subject line. */
export function buildInviteEmailSubject(
  args: Pick<InviteShareTextArgs, 'familyName' | 't'>
): string {
  return fillTemplate(args.t('share.emailSubject'), { family: args.familyName });
}

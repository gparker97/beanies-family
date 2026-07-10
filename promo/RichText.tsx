import React from 'react';
import { COLORS } from './brand';

/**
 * Minimal inline markup for caption copy, so the script in `Promo.tsx` stays
 * readable prose rather than a tree of <span>s.
 *
 *   **bold**  -> Heritage Orange, bold. Use it to land the key idea, once or
 *               twice per caption. More than that and nothing is emphasised.
 *   *italic*  -> italic, inherits colour. Use it for tone ("*never*").
 *
 * Deliberately not a markdown parser: two markers, no nesting, no escaping.
 * If a caption ever needs more than this, the caption is too complicated.
 */
const TOKEN = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;

export const RichText: React.FC<{ children: string }> = ({ children }) => (
  <>
    {children.split(TOKEN).map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <strong key={i} style={{ color: COLORS.heritageOrange, fontWeight: 700 }}>
            {part.slice(2, -2)}
          </strong>
        );
      }
      if (part.startsWith('*') && part.endsWith('*')) {
        return (
          <em key={i} style={{ fontStyle: 'italic' }}>
            {part.slice(1, -1)}
          </em>
        );
      }
      return <React.Fragment key={i}>{part}</React.Fragment>;
    })}
  </>
);

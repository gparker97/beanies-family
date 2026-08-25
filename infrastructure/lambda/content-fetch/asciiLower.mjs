/**
 * Length-preserving lowercase, for scanners that index back into the ORIGINAL string.
 *
 * `String.prototype.toLowerCase()` is NOT length-preserving. The clearest case is U+0130
 * (`İ`, dotted capital I — ordinary in Turkish and Azerbaijani), which lowercases to two
 * UTF-16 units (`i` + U+0307). One of those anywhere in a document shifts every subsequent
 * index in the lowercased copy by one, so an offset found in `lower` and applied to `html`
 * lands mid-token. Reproduced: a page titled `İç Pilav` lost its entire JSON-LD recipe, and
 * a single `İ` inside an HTML COMMENT turned the extracted title
 * `Best Pumpkin Pie` into `t Pumpkin Pie</t`.
 *
 * Both failures are silent — the recipe simply falls through to the model and logs
 * `extraction_path='page_text'`, indistinguishable from a site that publishes no structured
 * data at all.
 *
 * Every marker these scanners search for is ASCII (`<script`, `<title`, `<meta`, `>`), so
 * mapping A-Z only is sufficient AND exactly index-preserving: each replacement is one
 * UTF-16 unit for one. Never use this for anything the user reads — it is a scanning aid,
 * not a text transform.
 */
export function asciiLower(s) {
  return s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
}

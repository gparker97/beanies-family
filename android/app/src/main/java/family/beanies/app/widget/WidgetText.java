package family.beanies.app.widget;

import android.graphics.Color;
import android.graphics.Typeface;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.text.style.StrikethroughSpan;
import android.text.style.StyleSpan;

/**
 * Text styling for the widget (#130).
 *
 * Only colour-free spans (bold, strikethrough) are used. A ForegroundColorSpan bakes one colour
 * into the RemoteViews, and the launcher re-applies a widget's views when the system switches
 * light/dark without asking us again: a span coloured for light mode would sit on the dark panel
 * until the next render. Colours therefore come only from the layout XML (resolved by the host
 * per mode), so an emphasised word is bold in the TextView's own colour.
 *
 * The one exception is a calendar title's accent emphasis ("Shanghai trip · **day 3 of 6**"): it
 * is drawn as TWO identical TextViews stacked in one frame, see {@link #accentLayer}. The only
 * span colour used is TRANSPARENT, which is the same in both modes, and each layer's visible
 * colour is its TextView's own (resource, re-resolved per mode).
 */
final class WidgetText {

    private WidgetText() {}

    /** `text` with the FIRST occurrence of `emphasis` in bold; plain when absent or not found. */
    static CharSequence emphasised(WidgetSnapshot.Text t) {
        if (t == null || t.text.isEmpty()) return "";
        if (t.emphasis.isEmpty()) return t.text;
        int start = t.text.indexOf(t.emphasis);
        if (start < 0) return t.text;
        SpannableString s = new SpannableString(t.text);
        s.setSpan(
                new StyleSpan(Typeface.BOLD),
                start,
                start + t.emphasis.length(),
                Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        return s;
    }

    /** Optionally bold the whole string and/or strike it through (a past row). */
    static CharSequence styled(String text, boolean bold, boolean strike) {
        if (text == null || text.isEmpty() || (!bold && !strike)) return text == null ? "" : text;
        SpannableString s = new SpannableString(text);
        if (bold) s.setSpan(new StyleSpan(Typeface.BOLD), 0, text.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        if (strike) s.setSpan(new StrikethroughSpan(), 0, text.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        return s;
    }

    /**
     * One layer of a title whose `emphasis` is bold in the accent. Both layers carry the same
     * text and the same bold span, so they lay out (and ellipsize) identically: the ink layer
     * (`accent` false) hides the emphasis, the accent layer hides everything else. Null when
     * `emphasis` is empty or not in `text` (the caller then draws the plain title).
     */
    static CharSequence accentLayer(String text, String emphasis, boolean bold, boolean accent) {
        if (text == null || emphasis == null || emphasis.isEmpty()) return null;
        int start = text.indexOf(emphasis);
        if (start < 0) return null;
        int end = start + emphasis.length();
        SpannableString s = new SpannableString(text);
        int flags = Spanned.SPAN_EXCLUSIVE_EXCLUSIVE;
        if (bold) s.setSpan(new StyleSpan(Typeface.BOLD), 0, text.length(), flags);
        s.setSpan(new StyleSpan(Typeface.BOLD), start, end, flags);
        if (accent) {
            if (start > 0) s.setSpan(new ForegroundColorSpan(Color.TRANSPARENT), 0, start, flags);
            if (end < text.length()) {
                s.setSpan(new ForegroundColorSpan(Color.TRANSPARENT), end, text.length(), flags);
            }
        } else {
            s.setSpan(new ForegroundColorSpan(Color.TRANSPARENT), start, end, flags);
        }
        return s;
    }
}

package family.beanies.app.widget;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Build;
import android.text.Layout;
import android.text.StaticLayout;
import android.text.TextPaint;
import android.text.TextUtils;
import android.util.DisplayMetrics;
import android.util.TypedValue;
import android.view.View;
import android.widget.RemoteViews;
import androidx.core.content.res.ResourcesCompat;
import family.beanies.app.R;

/**
 * The branded strings (Outfit numerals and titles, the Caveat lines) drawn as bitmaps (#130).
 *
 * WHY. `android:fontFamily="@font/..."` is ignored inside launcher-hosted RemoteViews (verified
 * on a Pixel launcher, API 35: everything rendered as Roboto), which is the plan's stated
 * fallback case. Only these few strings are drawn; times, titles and body copy stay system text.
 *
 * LIGHT/DARK. The text is drawn as a WHITE mask and the ImageView is tinted. On API 31+ the tint
 * is a colour RESOURCE the launcher re-resolves on every (re)apply, so a light/dark switch
 * repaints it without asking the app. Below 31 the colour is resolved now and holds until the
 * next render (the midnight / row-end alarm or the next app publish).
 *
 * Sizing follows the device: sp × the widget's Text size multiplier (`textScale`,
 * {@link WidgetSizes#textScale}) through the current font scale, pixels at the display density,
 * so the bitmap is as sharp as system text. Every bitmap ImageView gets the text as its content
 * description, so TalkBack reads it.
 */
final class WidgetTextBitmaps {

    private WidgetTextBitmaps() {}

    /** One bitmap string's style. */
    static final class Style {
        final int font;
        final float sp;
        /** Shrink toward this size before ellipsizing (== sp: never shrink). */
        final float minSp;
        final int maxLines;
        final boolean centered;

        Style(int font, float sp, float minSp, int maxLines, boolean centered) {
            this.font = font;
            this.sp = sp;
            this.minSp = minSp;
            this.maxLines = maxLines;
            this.centered = centered;
        }
    }

    /**
     * Draw `text` into `viewId` (an ImageView) tinted with `colorRes`, or hide the view when the
     * text is empty. `textScale` multiplies the style's size; the shrink floor stays the Standard
     * one, so a line that fits at Standard is never ellipsized at a bigger Text size (it shrinks
     * back toward Standard instead; iOS `WidgetMetrics.standardFloor`). `maxWidthDp` bounds the
     * line (0 = unbounded, single line).
     */
    static void bind(RemoteViews views, Context context, int viewId, String text, Style style,
            float textScale, float maxWidthDp, int colorRes) {
        Bitmap bitmap = text == null || text.isEmpty()
                ? null
                : render(context, text, style, textScale, maxWidthDp);
        if (bitmap == null) {
            views.setViewVisibility(viewId, View.GONE);
            return;
        }
        views.setViewVisibility(viewId, View.VISIBLE);
        views.setImageViewBitmap(viewId, bitmap);
        views.setContentDescription(viewId, text);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            views.setColorStateList(viewId, "setImageTintList", colorRes);
        } else {
            views.setInt(viewId, "setColorFilter", context.getColor(colorRes));
        }
    }

    /**
     * The width (dp) `text` draws at in `style` × `textScale`, on one line and unshrunk: what a
     * caller budgets a row of bitmaps with before binding them.
     */
    static float naturalWidthDp(Context context, String text, Style style, float textScale) {
        if (text == null || text.isEmpty()) return 0f;
        DisplayMetrics metrics = context.getResources().getDisplayMetrics();
        TextPaint paint = paint(context, style);
        paint.setTextSize(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, style.sp * textScale, metrics));
        return (Layout.getDesiredWidth(text, paint) + overhangPx(paint)) / metrics.density;
    }

    /**
     * Script and slanted faces (Caveat) draw strokes past the advance width the layout reports, so
     * every bitmap leaves this much room after the text; budgets must count it too.
     */
    private static int overhangPx(TextPaint paint) {
        return (int) Math.ceil(paint.getTextSize() * 0.15f);
    }

    /** A white anti-aliased paint in the style's font (bold system sans when it cannot load). */
    private static TextPaint paint(Context context, Style style) {
        Typeface face;
        try {
            face = ResourcesCompat.getFont(context, style.font);
        } catch (RuntimeException e) {
            face = null;
        }
        TextPaint paint = new TextPaint(TextPaint.ANTI_ALIAS_FLAG);
        paint.setColor(Color.WHITE);
        paint.setTypeface(face != null ? face : Typeface.DEFAULT_BOLD);
        return paint;
    }

    /** The white text mask, or null when the font cannot load or the text is empty. */
    static Bitmap render(Context context, String text, Style style, float textScale, float maxWidthDp) {
        DisplayMetrics metrics = context.getResources().getDisplayMetrics();
        TextPaint paint = paint(context, style);

        int maxWidthPx = maxWidthDp > 0
                ? Math.max(1, Math.round(maxWidthDp * metrics.density))
                : Integer.MAX_VALUE;
        // Shrink in 0.5sp steps until the text fits its line budget, down to the floor; past the
        // floor, the layout ellipsizes the last line.
        StaticLayout layout = null;
        float startSp = style.sp * textScale;
        // The Standard floor, or the start itself when a caller scales below Standard (the small
        // header on a too-narrow widget), so the loop always runs at least once.
        float minSp = Math.min(style.minSp, startSp);
        for (float sp = startSp; sp >= minSp - 0.01f; sp -= 0.5f) {
            paint.setTextSize(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, sp, metrics));
            layout = layout(text, paint, maxWidthPx, style, false);
            if (fits(layout, paint, text, maxWidthPx, style)) break;
            layout = null;
        }
        if (layout == null) layout = layout(text, paint, maxWidthPx, style, true);

        int width = 0;
        for (int i = 0; i < layout.getLineCount(); i++) {
            width = Math.max(width, (int) Math.ceil(layout.getLineWidth(i)));
        }
        // Room for the overhang, so the last letter's tail is not cut flat.
        width += overhangPx(paint);
        int height = layout.getHeight();
        if (width <= 0 || height <= 0) return null;
        Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        bitmap.setDensity(metrics.densityDpi);
        Canvas canvas = new Canvas(bitmap);
        if (style.centered && layout.getWidth() > width) {
            // A centred layout is laid out in its full width; shift so the text sits in the bitmap.
            canvas.translate(-(layout.getWidth() - width) / 2f, 0);
        }
        layout.draw(canvas);
        return bitmap;
    }

    private static StaticLayout layout(String text, TextPaint paint, int maxWidthPx, Style style,
            boolean ellipsize) {
        int natural = (int) Math.ceil(Layout.getDesiredWidth(text, paint));
        int width = Math.max(1, Math.min(maxWidthPx, natural));
        StaticLayout.Builder b = StaticLayout.Builder.obtain(text, 0, text.length(), paint, width)
                .setAlignment(style.centered ? Layout.Alignment.ALIGN_CENTER : Layout.Alignment.ALIGN_NORMAL)
                // Caveat's swashes overrun its ascent/descent; the Outfit numerals sit tight.
                .setIncludePad(style.font == R.font.caveat_bold)
                .setMaxLines(style.maxLines);
        if (ellipsize) b.setEllipsize(TextUtils.TruncateAt.END);
        return b.build();
    }

    /** Within the line budget, and no single word wider than the line. */
    private static boolean fits(StaticLayout layout, TextPaint paint, String text, int maxWidthPx, Style style) {
        if (Layout.getDesiredWidth(text, paint) <= maxWidthPx) return true;
        if (style.maxLines <= 1) return false;
        if (layout.getLineCount() > style.maxLines) return false;
        int last = layout.getLineCount() - 1;
        return layout.getLineEnd(last) >= text.length() && layout.getEllipsisCount(last) == 0;
    }
}

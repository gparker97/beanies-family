package family.beanies.app.widget;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProviderInfo;
import android.content.ComponentName;
import android.content.Intent;
import android.content.res.Configuration;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.widget.CheckBox;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import family.beanies.app.R;

/**
 * The widget's configuration screen (#130): the Focus (2026-11-11), then Your day's six blocks or
 * the To-dos extras (one block shown per focus, each keeping its own values, all saved), the
 * background opacity and the text size. Shown by the launcher when a widget is placed (optional on Android 12+) and from
 * "reconfigure".
 *
 * EXPORTED, SO THE ID IS UNTRUSTED. The launcher must be able to start this activity, which means
 * any app can too, with any EXTRA_APPWIDGET_ID. Before anything is written, the id must name a
 * widget bound to OUR provider; otherwise the activity finishes with RESULT_CANCELED (set first,
 * so a back press or a crash also cancels).
 */
public class DayWidgetConfigActivity extends AppCompatActivity {

    private static final String TAG = DayWidgetProvider.TAG;

    /** Checkbox ids in {@link WidgetFill#FILL_ORDER} order. */
    private static final int[] BLOCK_IDS = {
        R.id.config_block_events,
        R.id.config_block_whos_where,
        R.id.config_block_meals,
        R.id.config_block_due,
        R.id.config_block_coming_up,
        R.id.config_block_hint,
    };

    /** Radio ids in {@link WidgetPrefs#OPACITIES} order. */
    private static final int[] OPACITY_IDS = {
        R.id.config_opacity_100, R.id.config_opacity_70, R.id.config_opacity_40,
    };

    private int appWidgetId = AppWidgetManager.INVALID_APPWIDGET_ID;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setResult(RESULT_CANCELED);

        appWidgetId = readWidgetId(getIntent());
        if (!isOurWidget(appWidgetId)) {
            Log.w(TAG, "configure refused: not a beanies widget id");
            finish();
            return;
        }

        setContentView(R.layout.widget_config_activity);
        applySystemBars();
        bind(WidgetPrefs.load(this, appWidgetId));
        ((RadioGroup) findViewById(R.id.config_focus)).setOnCheckedChangeListener(
                (group, checkedId) -> showFocusBlock(focusFor(checkedId)));
        findViewById(R.id.config_done).setOnClickListener(v -> save());
    }

    /**
     * targetSdk 36 is edge-to-edge: pad the content clear of the status and navigation bars, and
     * pick bar icons that read on this screen's own background (dark icons in light mode).
     */
    private void applySystemBars() {
        View root = findViewById(R.id.config_root);
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            Insets bars = insets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
        boolean night = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                == Configuration.UI_MODE_NIGHT_YES;
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), root);
        bars.setAppearanceLightStatusBars(!night);
        bars.setAppearanceLightNavigationBars(!night);
    }

    private static int readWidgetId(Intent intent) {
        try {
            return intent == null
                    ? AppWidgetManager.INVALID_APPWIDGET_ID
                    : intent.getIntExtra(
                            AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        } catch (RuntimeException e) {
            // A hostile extras Bundle can fail to unparcel; treat it as no id.
            return AppWidgetManager.INVALID_APPWIDGET_ID;
        }
    }

    private boolean isOurWidget(int id) {
        if (id == AppWidgetManager.INVALID_APPWIDGET_ID) return false;
        AppWidgetProviderInfo info = AppWidgetManager.getInstance(this).getAppWidgetInfo(id);
        return info != null
                && new ComponentName(this, DayWidgetProvider.class).equals(info.provider);
    }

    private void bind(WidgetPrefs prefs) {
        for (int i = 0; i < BLOCK_IDS.length; i++) {
            ((CheckBox) findViewById(BLOCK_IDS[i])).setChecked(prefs.blocks[i]);
        }
        for (int i = 0; i < OPACITY_IDS.length; i++) {
            ((RadioButton) findViewById(OPACITY_IDS[i]))
                    .setChecked(WidgetPrefs.OPACITIES[i] == prefs.opacity);
        }
        ((RadioGroup) findViewById(R.id.config_text_size)).check(WidgetConfigIds.idOf(
                WidgetConfigIds.TEXT_SIZES, WidgetConfigIds.TEXT_SIZE_IDS, prefs.textSize));
        ((CheckBox) findViewById(R.id.config_todos_events)).setChecked(prefs.todosEvents);
        ((CheckBox) findViewById(R.id.config_todos_meals)).setChecked(prefs.todosMeals);
        ((RadioGroup) findViewById(R.id.config_focus)).check(WidgetConfigIds.idOf(
                WidgetConfigIds.FOCUSES, WidgetConfigIds.FOCUS_IDS, prefs.focus));
        showFocusBlock(prefs.focus);
    }

    private static WidgetPrefs.Focus focusFor(int checkedId) {
        return WidgetConfigIds.valueOf(
                WidgetConfigIds.FOCUSES, WidgetConfigIds.FOCUS_IDS, checkedId, WidgetPrefs.Focus.DEFAULT);
    }

    /** Your day's "Show" block for Your day, the "Also show" extras for To-dos. */
    private void showFocusBlock(WidgetPrefs.Focus focus) {
        boolean todos = focus == WidgetPrefs.Focus.TODOS;
        findViewById(R.id.config_show_block).setVisibility(todos ? View.GONE : View.VISIBLE);
        findViewById(R.id.config_also_block).setVisibility(todos ? View.VISIBLE : View.GONE);
    }

    private static int indexOf(int[] values, int value) {
        for (int i = 0; i < values.length; i++) if (values[i] == value) return i;
        return 0;
    }

    /** The index of the checked radio in `ids`; `fallback` when none matches. */
    private int checkedIndex(int groupId, int[] ids, int fallback) {
        int checked = ((RadioGroup) findViewById(groupId)).getCheckedRadioButtonId();
        for (int i = 0; i < ids.length; i++) {
            if (ids[i] == checked) return i;
        }
        return fallback;
    }

    private void save() {
        // Re-check: the widget may have been removed while this screen was open.
        if (!isOurWidget(appWidgetId)) {
            finish();
            return;
        }
        boolean[] blocks = new boolean[BLOCK_IDS.length];
        for (int i = 0; i < BLOCK_IDS.length; i++) {
            blocks[i] = ((CheckBox) findViewById(BLOCK_IDS[i])).isChecked();
        }
        int opacity = WidgetPrefs.OPACITIES[
                checkedIndex(R.id.config_opacity, OPACITY_IDS, indexOf(WidgetPrefs.OPACITIES, WidgetPrefs.DEFAULT_OPACITY))];
        WidgetPrefs.TextSize textSize = WidgetConfigIds.valueOf(
                WidgetConfigIds.TEXT_SIZES, WidgetConfigIds.TEXT_SIZE_IDS,
                ((RadioGroup) findViewById(R.id.config_text_size)).getCheckedRadioButtonId(),
                WidgetPrefs.TextSize.DEFAULT);
        WidgetPrefs.Focus focus =
                focusFor(((RadioGroup) findViewById(R.id.config_focus)).getCheckedRadioButtonId());
        // Every value is saved, the hidden block's too: each focus keeps its own switches.
        new WidgetPrefs(blocks, opacity, textSize, focus,
                ((CheckBox) findViewById(R.id.config_todos_events)).isChecked(),
                ((CheckBox) findViewById(R.id.config_todos_meals)).isChecked())
                .save(this, appWidgetId);

        try {
            DayWidgetProvider.renderAll(this);
        } catch (RuntimeException e) {
            // The choices are saved; the widget redraws on its next update. Never crash the screen.
            Log.e(TAG, "render after configure failed; prefs are saved and the widget redraws on its next update", e);
            WidgetPrefs.recordReadOutcome(this, WidgetPrefs.failureToken("reload_failed", e));
        }
        setResult(RESULT_OK, new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId));
        finish();
    }
}

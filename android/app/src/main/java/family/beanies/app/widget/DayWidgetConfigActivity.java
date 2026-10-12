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
 * The widget's configuration screen (#130): whose day, the six blocks, background opacity. Shown
 * by the launcher when a widget is placed (optional on Android 12+) and from "reconfigure".
 *
 * EXPORTED, SO THE ID IS UNTRUSTED. The launcher must be able to start this activity, which means
 * any app can too, with any EXTRA_APPWIDGET_ID. Before anything is written, the id must name a
 * widget bound to OUR provider; otherwise the activity finishes with RESULT_CANCELED (set first,
 * so a back press or a crash also cancels).
 */
public class DayWidgetConfigActivity extends AppCompatActivity {

    private static final String TAG = "beanies-widget";

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
        // A child session only ever publishes "my day"; the choice would do nothing.
        WidgetSnapshotStore.Result result = WidgetSnapshotStore.read(this);
        boolean child = result.state == WidgetSnapshotStore.State.READY && result.snapshot.viewer.isChild;
        int audienceVisibility = child ? View.GONE : View.VISIBLE;
        findViewById(R.id.config_audience_heading).setVisibility(audienceVisibility);
        findViewById(R.id.config_audience).setVisibility(audienceVisibility);

        ((RadioGroup) findViewById(R.id.config_audience))
                .check(WidgetPrefs.AUDIENCE_OUR.equals(prefs.audience)
                        ? R.id.config_audience_our
                        : R.id.config_audience_my);
        for (int i = 0; i < BLOCK_IDS.length; i++) {
            ((CheckBox) findViewById(BLOCK_IDS[i])).setChecked(prefs.blocks[i]);
        }
        for (int i = 0; i < OPACITY_IDS.length; i++) {
            ((RadioButton) findViewById(OPACITY_IDS[i]))
                    .setChecked(WidgetPrefs.OPACITIES[i] == prefs.opacity);
        }
    }

    private void save() {
        // Re-check: the widget may have been removed while this screen was open.
        if (!isOurWidget(appWidgetId)) {
            finish();
            return;
        }
        boolean our = ((RadioGroup) findViewById(R.id.config_audience)).getCheckedRadioButtonId()
                == R.id.config_audience_our;
        boolean[] blocks = new boolean[BLOCK_IDS.length];
        for (int i = 0; i < BLOCK_IDS.length; i++) {
            blocks[i] = ((CheckBox) findViewById(BLOCK_IDS[i])).isChecked();
        }
        int opacity = 100;
        int checked = ((RadioGroup) findViewById(R.id.config_opacity)).getCheckedRadioButtonId();
        for (int i = 0; i < OPACITY_IDS.length; i++) {
            if (OPACITY_IDS[i] == checked) opacity = WidgetPrefs.OPACITIES[i];
        }
        new WidgetPrefs(our ? WidgetPrefs.AUDIENCE_OUR : WidgetPrefs.AUDIENCE_MY, blocks, opacity)
                .save(this, appWidgetId);

        DayWidgetProvider.renderAll(this);
        setResult(RESULT_OK, new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId));
        finish();
    }
}

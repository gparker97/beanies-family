package family.beanies.app.widget;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;
import family.beanies.app.R;
import java.util.Collections;
import java.util.List;

/**
 * The calendar list of one medium or large widget on API 24-30 (#130): serves the item views
 * {@link DayWidgetList} builds through {@link DayWidgetService}. API 31+ never binds it; the
 * renderer sends the same views inline ({@link DayWidgetList#INLINE}).
 *
 * It resolves the SAME {@link WidgetFill.Plan} as the provider (same store read, same prefs, same
 * size classifier), so the list can never show a different day, audience or set of rows from the
 * rest of the widget. The provider's re-render alarm at the next row end calls
 * notifyAppWidgetViewDataChanged here, so a row greys out without a republish.
 * TODO(minSdk 31): delete with DayWidgetService.
 */
final class DayWidgetFactory implements RemoteViewsService.RemoteViewsFactory {

    private final Context context;
    private final int appWidgetId;
    private List<RemoteViews> views = Collections.emptyList();

    DayWidgetFactory(Context context, Intent intent) {
        this.context = context.getApplicationContext();
        this.appWidgetId = intent.getIntExtra(
                AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
    }

    @Override
    public void onCreate() {
        // onDataSetChanged follows immediately; nothing to prepare.
    }

    @Override
    public void onDataSetChanged() {
        if (appWidgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            views = Collections.emptyList();
            return;
        }
        long now = System.currentTimeMillis();
        WidgetFill.Plan plan;
        WidgetSizes.Size size;
        float textScale;
        float panelDp;
        try {
            WidgetSnapshotStore.Result result = WidgetSnapshotStore.read(context);
            AppWidgetManager manager = AppWidgetManager.getInstance(context);
            Bundle options = manager.getAppWidgetOptions(appWidgetId);
            size = WidgetSizes.sizeFor(options);
            WidgetPrefs prefs = WidgetPrefs.load(context, appWidgetId);
            textScale = WidgetSizes.textScale(context, prefs.textSize);
            plan = result.state == WidgetSnapshotStore.State.READY
                    ? WidgetFill.plan(result.snapshot, prefs, size,
                            WidgetSizes.layoutHeightDp(context, options, textScale), now)
                    : null;
            panelDp = DayWidgetRenderer.agendaPanelDp(WidgetSizes.widthDp(options, size));
        } catch (RuntimeException e) {
            // The same read and plan fail the provider's render too, which relays `render_failed`;
            // here the list must only never take the launcher's binder thread down.
            Log.w(DayWidgetProvider.TAG, "agenda list plan failed", e);
            views = Collections.emptyList();
            return;
        }
        views = plan == null
                ? Collections.<RemoteViews>emptyList()
                : DayWidgetList.viewsOrEmpty(context, plan, size, panelDp, textScale, now);
    }

    @Override
    public void onDestroy() {
        views = Collections.emptyList();
    }

    @Override
    public int getCount() {
        return views.size();
    }

    @Override
    public RemoteViews getViewAt(int position) {
        List<RemoteViews> current = views;
        if (position < 0 || position >= current.size()) return getLoadingView();
        return current.get(position);
    }

    @Override
    public RemoteViews getLoadingView() {
        return new RemoteViews(context.getPackageName(), R.layout.widget_day_row_loading);
    }

    /** The list's item layouts, plus the loading layout (a stale position). */
    @Override
    public int getViewTypeCount() {
        return DayWidgetList.VIEW_TYPE_COUNT + 1;
    }

    @Override
    public long getItemId(int position) {
        return position;
    }

    @Override
    public boolean hasStableIds() {
        return false;
    }
}

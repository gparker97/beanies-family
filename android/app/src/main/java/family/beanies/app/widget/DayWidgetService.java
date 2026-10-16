package family.beanies.app.widget;

import android.content.Intent;
import android.widget.RemoteViewsService;

/**
 * Hands the launcher one {@link DayWidgetFactory} per placed widget (#130), on API 24-30 only:
 * API 31+ sends the list inline (DayWidgetRenderer, {@link DayWidgetList#INLINE}). Bound only by
 * the system (`android.permission.BIND_REMOTEVIEWS`, not exported). The provider gives each
 * widget's service intent its own data Uri, so two placed widgets never share a factory.
 * TODO(minSdk 31): delete this class and its manifest entry.
 */
public class DayWidgetService extends RemoteViewsService {
    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new DayWidgetFactory(getApplicationContext(), intent);
    }
}

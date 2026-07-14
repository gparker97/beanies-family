package family.beanies.app;

import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Paints the Activity window background so the edge-to-edge status-bar / notch strip
 * matches the IN-APP theme (#53), not the system one.
 *
 * The static values{,-night}/colors.xml windowBackground follows the SYSTEM DayNight
 * setting and is only the cold-start default (correct before the WebView boots).
 * beanies has its own in-app light/dark/system toggle, which can diverge from the OS
 * setting — so useNativeShell.ts (which tracks the `dark` class on <html>) calls this
 * on every theme change to keep the strip in sync with the user's actual in-app choice.
 * Colours MUST match the App.vue root bg (#F9FAFB / #0F172A). Android-only.
 */
@CapacitorPlugin(name = "WindowBackground")
public class WindowBackgroundPlugin extends Plugin {

    @PluginMethod
    public void setColor(PluginCall call) {
        final String color = call.getString("color");
        if (color == null || color.isEmpty()) {
            call.reject("color is required");
            return;
        }

        final int parsed;
        try {
            parsed = Color.parseColor(color);
        } catch (IllegalArgumentException e) {
            call.reject("invalid color: " + color);
            return;
        }

        getActivity()
            .runOnUiThread(() -> {
                getActivity().getWindow().setBackgroundDrawable(new ColorDrawable(parsed));
                call.resolve();
            });
    }
}

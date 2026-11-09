package com.smartdash.app;

import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.BatteryManager;
import android.provider.Settings;
import android.view.Window;
import android.view.WindowManager;

import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Wall-panel helpers: keep the screen on, immersive full screen, screen brightness,
 * charging state, and optionally act as the device's home screen (launcher).
 */
@CapacitorPlugin(name = "Panel")
public class PanelPlugin extends Plugin {
    private static final String HOME_ALIAS = "com.smartdash.app.HomeAlias";
    private BroadcastReceiver powerReceiver;

    @Override
    public void load() {
        powerReceiver = new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) {
                JSObject ev = new JSObject();
                ev.put("charging", Intent.ACTION_POWER_CONNECTED.equals(intent.getAction()) || isCharging());
                notifyListeners("power", ev);
            }
        };
        IntentFilter filter = new IntentFilter();
        filter.addAction(Intent.ACTION_POWER_CONNECTED);
        filter.addAction(Intent.ACTION_POWER_DISCONNECTED);
        ContextCompat.registerReceiver(getContext(), powerReceiver, filter, ContextCompat.RECEIVER_EXPORTED);
    }

    @Override
    protected void handleOnDestroy() {
        try { getContext().unregisterReceiver(powerReceiver); } catch (Exception ignored) { }
    }

    private boolean isCharging() {
        Intent battery = getContext().registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        int plugged = battery != null ? battery.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) : 0;
        return plugged != 0;
    }

    private boolean isDefaultHome() {
        Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME);
        ResolveInfo info = getContext().getPackageManager().resolveActivity(home, PackageManager.MATCH_DEFAULT_ONLY);
        return info != null && info.activityInfo != null && getContext().getPackageName().equals(info.activityInfo.packageName);
    }

    private boolean homeAliasEnabled() {
        int state = getContext().getPackageManager().getComponentEnabledSetting(new ComponentName(getContext().getPackageName(), HOME_ALIAS));
        return state == PackageManager.COMPONENT_ENABLED_STATE_ENABLED;
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject res = new JSObject();
        res.put("charging", isCharging());
        res.put("homeEnabled", homeAliasEnabled());
        res.put("isHome", isDefaultHome());
        call.resolve(res);
    }

    @PluginMethod
    public void keepAwake(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        getActivity().runOnUiThread(() -> {
            Window w = getActivity().getWindow();
            if (on) w.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else w.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }

    @PluginMethod
    public void fullscreen(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        getActivity().runOnUiThread(() -> {
            Window w = getActivity().getWindow();
            WindowInsetsControllerCompat c = WindowCompat.getInsetsController(w, w.getDecorView());
            if (on) {
                c.hide(WindowInsetsCompat.Type.systemBars());
                c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            } else {
                c.show(WindowInsetsCompat.Type.systemBars());
            }
            call.resolve();
        });
    }

    /** level 0–1 overrides the screen brightness for this app; -1 restores the system setting. */
    @PluginMethod
    public void brightness(PluginCall call) {
        double level = call.getDouble("level", -1.0);
        getActivity().runOnUiThread(() -> {
            Window w = getActivity().getWindow();
            WindowManager.LayoutParams lp = w.getAttributes();
            lp.screenBrightness = level < 0 ? WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE : (float) Math.max(0.01, Math.min(1.0, level));
            w.setAttributes(lp);
            call.resolve();
        });
    }

    /** Lets Android offer Smart Dash as the home app, then opens the "Default home app" screen. */
    @PluginMethod
    public void setHomeApp(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        getContext().getPackageManager().setComponentEnabledSetting(
            new ComponentName(getContext().getPackageName(), HOME_ALIAS),
            enabled ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED : PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
            PackageManager.DONT_KILL_APP);
        try {
            getActivity().startActivity(new Intent(Settings.ACTION_HOME_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (Exception e) {
            getActivity().startActivity(new Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        }
        call.resolve();
    }

    /** Escape hatch to Android's own Settings (useful when Smart Dash is the home app). */
    @PluginMethod
    public void openSystemSettings(PluginCall call) {
        getActivity().startActivity(new Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        call.resolve();
    }
}

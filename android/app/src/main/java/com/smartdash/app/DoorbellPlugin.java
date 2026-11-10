package com.smartdash.app;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Doorbell popups from Eufy Security notifications. */
@CapacitorPlugin(name = "Doorbell")
public class DoorbellPlugin extends Plugin {
    private static final String EUFY = "com.oceanwing.battery.cam";

    @Override
    public void load() { DoorbellBridge.attach(this); }

    @Override
    protected void handleOnDestroy() { DoorbellBridge.detach(this); }

    void emit(JSObject ev) { notifyListeners("event", ev, true); }

    void emitDebug(JSObject ev) { notifyListeners("debug", ev); }

    private boolean eufyInstalled() {
        try {
            getContext().getPackageManager().getPackageInfo(EUFY, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject res = new JSObject();
        res.put("permission", EufyNotificationListener.isEnabled(getContext()));
        res.put("eufyInstalled", eufyInstalled());
        res.put("lastDebug", DoorbellBridge.lastDebug);
        res.put("history", DoorbellBridge.historyText());
        call.resolve(res);
    }

    @PluginMethod
    public void openPermissionSettings(PluginCall call) {
        getActivity().startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        call.resolve();
    }

    /** Opens the Eufy Security app (for the live view). */
    @PluginMethod
    public void openEufy(PluginCall call) {
        Intent i = getContext().getPackageManager().getLaunchIntentForPackage(EUFY);
        if (i == null) { call.reject("The Eufy Security app isn't installed on this device"); return; }
        getActivity().startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        call.resolve();
    }
}

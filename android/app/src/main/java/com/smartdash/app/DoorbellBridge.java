package com.smartdash.app;

import com.getcapacitor.JSObject;

/** Hands doorbell events from the notification listener to the Doorbell plugin (if the app is running). */
final class DoorbellBridge {
    private static volatile DoorbellPlugin plugin;
    private static JSObject pending;
    private static long pendingAt;

    private DoorbellBridge() { }

    static synchronized void attach(DoorbellPlugin p) {
        plugin = p;
        if (pending != null && System.currentTimeMillis() - pendingAt < 90_000) p.emit(pending);
        pending = null;
    }

    static synchronized void detach(DoorbellPlugin p) {
        if (plugin == p) plugin = null;
    }

    static synchronized void deliver(String key, String title, String text, String sub, String image, long time) {
        JSObject ev = new JSObject();
        ev.put("key", key);
        ev.put("title", title);
        ev.put("text", text);
        ev.put("sub", sub);
        ev.put("image", image);
        ev.put("time", time);
        if (plugin != null) plugin.emit(ev);
        else { pending = ev; pendingAt = System.currentTimeMillis(); }
    }
}

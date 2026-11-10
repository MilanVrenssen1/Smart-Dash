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

    /** Diagnostics about the last Eufy notification (shown in Settings → Doorbell). */
    static volatile String lastDebug = "";
    private static final java.util.ArrayDeque<String> history = new java.util.ArrayDeque<>();

    /** The last few Eufy notifications, newest first, for Settings → Doorbell. */
    static synchronized String historyText() {
        return android.text.TextUtils.join("\n\n", history);
    }

    static synchronized void record(String line) {
        String stamp = new java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.US).format(new java.util.Date());
        history.addFirst(stamp + "  " + line);
        while (history.size() > 6) history.removeLast();
    }

    static synchronized void debug(String info) {
        lastDebug = info;
        if (plugin != null) {
            JSObject ev = new JSObject();
            ev.put("debug", info);
            plugin.emitDebug(ev);
        }
    }

    static synchronized void detach(DoorbellPlugin p) {
        if (plugin == p) plugin = null;
    }

    static synchronized void deliver(String key, String title, String text, String sub, String image, long time, String debug) {
        JSObject ev = new JSObject();
        ev.put("key", key);
        ev.put("title", title);
        ev.put("text", text);
        ev.put("sub", sub);
        ev.put("image", image);
        ev.put("time", time);
        ev.put("debug", debug);
        lastDebug = debug;
        if (plugin != null) plugin.emit(ev);
        else { pending = ev; pendingAt = System.currentTimeMillis(); }
    }
}

package com.smartdash.app;

import android.app.Notification;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.BitmapDrawable;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.Icon;
import android.os.Handler;
import android.os.Looper;
import android.os.Parcelable;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.RemoteViews;
import android.os.Build;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.util.Base64;
import android.util.Log;

import java.io.ByteArrayOutputStream;

/**
 * Listens for notifications from the Eufy Security app (doorbell rings, motion, people)
 * and hands them to Smart Dash so it can show its own popup with the snapshot.
 * Only Eufy notifications are looked at; everything else is ignored immediately.
 */
public class EufyNotificationListener extends NotificationListenerService {
    private static final String TAG = "SmartDashDoorbell";

    static boolean isEufy(String pkg) {
        if (pkg == null) return false;
        String p = pkg.toLowerCase();
        return p.equals("com.oceanwing.battery.cam") || p.contains("oceanwing") || p.contains("eufy");
    }

    private final Handler main = new Handler(Looper.getMainLooper());

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        handle(sbn, 0);
    }

    /** Reads a Eufy notification. If it has no picture yet, look again shortly (Eufy often adds it later). */
    private void handle(StatusBarNotification sbn, int attempt) {
        try {
            if (!isEufy(sbn.getPackageName())) return;
            Notification n = sbn.getNotification();
            if ((n.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return;
            Bundle ex = n.extras;
            CharSequence title = ex.getCharSequence(Notification.EXTRA_TITLE);
            CharSequence text = ex.getCharSequence(Notification.EXTRA_BIG_TEXT);
            if (text == null) text = ex.getCharSequence(Notification.EXTRA_TEXT);
            CharSequence sub = ex.getCharSequence(Notification.EXTRA_SUB_TEXT);

            String[] source = { "none" };
            Bitmap pic = findPicture(n, ex, source);
            String size = pic != null ? " " + pic.getWidth() + "x" + pic.getHeight() : "";
            String debug = "picture: " + source[0] + size + " · keys: " + android.text.TextUtils.join(",", ex.keySet())
                + " · custom layout: " + (n.bigContentView != null || n.contentView != null ? "yes" : "no")
                + " · style: " + ex.getString(Notification.EXTRA_TEMPLATE, "-")
                + " · largeIcon: " + describe(n.getLargeIcon() != null ? n.getLargeIcon() : ex.get(Notification.EXTRA_LARGE_ICON))
                + " · v2";

            DoorbellBridge.record("#" + sbn.getId() + (attempt > 0 ? " (re-check " + attempt + ")" : "")
                + " · " + str(title) + " — " + str(text)
                + " · channel: " + (Build.VERSION.SDK_INT >= 26 ? n.getChannelId() : "-")
                + " · group: " + (n.getGroup() != null ? n.getGroup() : "-")
                + " · " + debug);

            if (pic == null && attempt < 2) {
                // Deliver the text now; check again for a picture in a moment.
                if (attempt == 0) DoorbellBridge.deliver(sbn.getKey(), str(title), str(text), str(sub), null, sbn.getPostTime(), debug);
                String key = sbn.getKey();
                main.postDelayed(() -> recheck(key, attempt + 1), attempt == 0 ? 2500 : 6000);
                return;
            }
            if (pic == null && attempt > 0) {
                DoorbellBridge.debug(debug);
                return;
            }
            DoorbellBridge.deliver(sbn.getKey(), str(title), str(text), str(sub), pic != null ? encode(pic) : null, sbn.getPostTime(), debug);
        } catch (Throwable t) {
            Log.w(TAG, "Couldn't read Eufy notification", t);
            DoorbellBridge.debug("error: " + t.getClass().getSimpleName() + " " + t.getMessage());
        }
    }

    private void recheck(String key, int attempt) {
        try {
            StatusBarNotification[] list = getActiveNotifications(new String[]{ key });
            if (list != null && list.length > 0) handle(list[0], attempt);
        } catch (Throwable t) {
            Log.w(TAG, "recheck failed", t);
        }
    }

    private String describe(Object o) {
        if (o == null) return "empty";
        Bitmap b = bitmapFrom(o);
        return b != null ? b.getWidth() + "x" + b.getHeight() : o.getClass().getSimpleName();
    }

    private static String str(CharSequence c) { return c != null ? c.toString() : ""; }

    /** Looks for the snapshot everywhere apps tend to put it. */
    @SuppressWarnings("deprecation")
    private Bitmap findPicture(Notification n, Bundle ex, String[] source) {
        Bitmap b = bitmapFrom(ex.get(Notification.EXTRA_PICTURE));
        if (big(b)) { source[0] = "bigPicture"; return b; }
        if (Build.VERSION.SDK_INT >= 31) {
            b = bitmapFrom(ex.get(Notification.EXTRA_PICTURE_ICON));
            if (big(b)) { source[0] = "bigPictureIcon"; return b; }
        }
        b = bitmapFrom(ex.get(Notification.EXTRA_LARGE_ICON_BIG));
        if (big(b)) { source[0] = "largeIconBig"; return b; }
        for (RemoteViews rv : new RemoteViews[]{ n.bigContentView, n.headsUpContentView, n.contentView }) {
            b = fromRemoteViews(rv);
            if (big(b)) { source[0] = "customLayout"; return b; }
        }
        // Any other bitmap-like extra (some apps use their own keys).
        for (String k : ex.keySet()) {
            Object v = ex.get(k);
            if (v instanceof Bitmap || v instanceof Icon) {
                b = bitmapFrom(v);
                if (big(b)) { source[0] = "extra:" + k; return b; }
            }
        }
        // Android shrinks notification images ("android.reduced.images"), so Eufy's snapshot
        // often survives only as the small large-icon thumbnail. Use it if it isn't tiny.
        b = n.getLargeIcon() != null ? toBitmap(n.getLargeIcon().loadDrawable(this)) : bitmapFrom(ex.get(Notification.EXTRA_LARGE_ICON));
        if (b != null && b.getWidth() >= 40 && b.getHeight() >= 40) { source[0] = big(b) ? "largeIcon" : "largeIcon(small)"; return b; }
        return null;
    }

    /** Ignore small app logos — a snapshot is at least ~160px wide. */
    private static boolean big(Bitmap b) { return b != null && b.getWidth() >= 160 && b.getHeight() >= 90; }

    private Bitmap bitmapFrom(Object o) {
        try {
            if (o instanceof Bitmap) return (Bitmap) o;
            if (o instanceof Icon) return toBitmap(((Icon) o).loadDrawable(this));
        } catch (Throwable ignored) { }
        return null;
    }

    private Bitmap fromRemoteViews(RemoteViews rv) {
        if (rv == null) return null;
        try {
            View v = rv.apply(this, new FrameLayout(this));
            return largestImage(v, null);
        } catch (Throwable t) {
            return null;
        }
    }

    private static Bitmap largestImage(View v, Bitmap best) {
        if (v instanceof ImageView) {
            Bitmap b = toBitmap(((ImageView) v).getDrawable());
            if (b != null && (best == null || (long) b.getWidth() * b.getHeight() > (long) best.getWidth() * best.getHeight())) best = b;
        }
        if (v instanceof ViewGroup) {
            ViewGroup g = (ViewGroup) v;
            for (int i = 0; i < g.getChildCount(); i++) best = largestImage(g.getChildAt(i), best);
        }
        return best;
    }

    private static Bitmap toBitmap(Drawable d) {
        if (d == null) return null;
        if (d instanceof BitmapDrawable && ((BitmapDrawable) d).getBitmap() != null) return ((BitmapDrawable) d).getBitmap();
        int w = Math.max(1, d.getIntrinsicWidth()), h = Math.max(1, d.getIntrinsicHeight());
        Bitmap b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(b);
        d.setBounds(0, 0, w, h);
        d.draw(c);
        return b;
    }

    private static String encode(Bitmap src) {
        int max = 720;
        Bitmap b = src;
        if (Math.max(src.getWidth(), src.getHeight()) > max) {
            float s = (float) max / Math.max(src.getWidth(), src.getHeight());
            b = Bitmap.createScaledBitmap(src, Math.round(src.getWidth() * s), Math.round(src.getHeight() * s), true);
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        b.compress(Bitmap.CompressFormat.JPEG, 82, out);
        return "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
    }

    static boolean isEnabled(Context ctx) {
        return androidx.core.app.NotificationManagerCompat.getEnabledListenerPackages(ctx).contains(ctx.getPackageName());
    }
}

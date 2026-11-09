package com.smartdash.app;

import android.app.Notification;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.BitmapDrawable;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.Icon;
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

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        try {
            if (!isEufy(sbn.getPackageName())) return;
            Notification n = sbn.getNotification();
            if ((n.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return;
            Bundle ex = n.extras;
            CharSequence title = ex.getCharSequence(Notification.EXTRA_TITLE);
            CharSequence text = ex.getCharSequence(Notification.EXTRA_BIG_TEXT);
            if (text == null) text = ex.getCharSequence(Notification.EXTRA_TEXT);
            CharSequence sub = ex.getCharSequence(Notification.EXTRA_SUB_TEXT);

            Bitmap pic = null;
            Object p = ex.get(Notification.EXTRA_PICTURE);
            if (p instanceof Bitmap) pic = (Bitmap) p;
            if (pic == null && Build.VERSION.SDK_INT >= 31) {
                Icon ic = ex.getParcelable(Notification.EXTRA_PICTURE_ICON);
                if (ic != null) pic = toBitmap(ic.loadDrawable(this));
            }
            if (pic == null && n.getLargeIcon() != null) pic = toBitmap(n.getLargeIcon().loadDrawable(this));

            DoorbellBridge.deliver(
                sbn.getKey(),
                title != null ? title.toString() : "",
                text != null ? text.toString() : "",
                sub != null ? sub.toString() : "",
                pic != null ? encode(pic) : null,
                sbn.getPostTime());
        } catch (Throwable t) {
            Log.w(TAG, "Couldn't read Eufy notification", t);
        }
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

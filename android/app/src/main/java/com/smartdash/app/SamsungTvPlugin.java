package com.smartdash.app;

import android.util.Base64;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.security.cert.X509Certificate;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

/**
 * Samsung Tizen TV remote (2016+ models) over the TV's local WebSocket API,
 * plus Wake-on-LAN to switch the TV on.
 *
 * Samsung TVs serve wss://<tv>:8002 with a self-signed certificate, which the
 * WebView refuses; this plugin accepts it for TV connections only.
 */
@CapacitorPlugin(name = "SamsungTv")
public class SamsungTvPlugin extends Plugin {
    private static final String TAG = "SmartDashSamsungTv";
    private static final String APP_NAME = "Smart Dash";

    private OkHttpClient client;
    private final Map<String, WebSocket> sockets = new ConcurrentHashMap<>();
    private final Map<String, PluginCall> pendingConnect = new ConcurrentHashMap<>();
    private final Map<String, PluginCall> pendingApps = new ConcurrentHashMap<>();
    private final Map<String, PluginCall> pendingIcons = new ConcurrentHashMap<>(); // host -> call (one at a time per TV)
    private final Map<String, String> tokens = new ConcurrentHashMap<>();

    @Override
    public void load() {
        try {
            // The TV's certificate is self-signed by Samsung; only used for the TV host the user entered.
            X509TrustManager trustTv = new X509TrustManager() {
                public void checkClientTrusted(X509Certificate[] chain, String authType) {}
                public void checkServerTrusted(X509Certificate[] chain, String authType) {}
                public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
            };
            SSLContext ssl = SSLContext.getInstance("TLS");
            ssl.init(null, new TrustManager[]{trustTv}, new SecureRandom());
            client = new OkHttpClient.Builder()
                .sslSocketFactory(ssl.getSocketFactory(), trustTv)
                .hostnameVerifier((host, session) -> true)
                .connectTimeout(8, TimeUnit.SECONDS)
                .readTimeout(0, TimeUnit.MILLISECONDS)
                .pingInterval(20, TimeUnit.SECONDS)
                .build();
        } catch (Exception e) {
            Log.e(TAG, "SSL setup failed", e);
            client = new OkHttpClient();
        }
    }

    /** Opens the remote-control channel. First time: the TV shows an "Allow" prompt. Resolves { token }. */
    @PluginMethod
    public void connect(PluginCall call) {
        String host = call.getString("host");
        if (host == null || host.isEmpty()) { call.reject("Missing TV address"); return; }
        String token = call.getString("token", "");
        boolean secure = call.getBoolean("secure", true);
        WebSocket old = sockets.remove(host);
        if (old != null) old.close(1000, "reconnect");
        if (token != null && !token.isEmpty()) tokens.put(host, token);

        String name = Base64.encodeToString(APP_NAME.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
        String url = (secure ? "wss://" + host + ":8002" : "ws://" + host + ":8001")
            + "/api/v2/channels/samsung.remote.control?name=" + name
            + (token != null && !token.isEmpty() ? "&token=" + token : "");

        PluginCall previous = pendingConnect.put(host, call);
        if (previous != null) previous.reject("Superseded by a new connection attempt");

        client.newWebSocket(new Request.Builder().url(url).build(), new WebSocketListener() {
            @Override public void onOpen(WebSocket ws, Response response) {
                sockets.put(host, ws);
            }

            @Override public void onMessage(WebSocket ws, String text) {
                try {
                    JSONObject msg = new JSONObject(text);
                    String event = msg.optString("event");
                    JSONObject data = msg.optJSONObject("data");
                    switch (event) {
                        case "ms.channel.connect": {
                            String t = data != null ? data.optString("token", "") : "";
                            if (!t.isEmpty()) tokens.put(host, t);
                            PluginCall c = pendingConnect.remove(host);
                            if (c != null) {
                                JSObject res = new JSObject();
                                res.put("token", tokens.getOrDefault(host, ""));
                                c.resolve(res);
                            }
                            break;
                        }
                        case "ms.channel.unauthorized":
                        case "ms.channel.timeOut": {
                            PluginCall c = pendingConnect.remove(host);
                            if (c != null) {
                                c.reject(event.endsWith("timeOut")
                                    ? "The TV didn't get an answer. Tap Allow on the TV when it asks."
                                    : "The TV refused the connection. Tap Allow on the TV, or remove Smart Dash from the TV's device list and try again.", "UNAUTHORIZED");
                            }
                            ws.close(1000, "unauthorized");
                            break;
                        }
                        case "ed.installedApp.get": {
                            PluginCall c = pendingApps.remove(host);
                            if (c != null) {
                                JSArray apps = new JSArray();
                                JSONArray list = data != null ? data.optJSONArray("data") : null;
                                if (list != null) {
                                    for (int i = 0; i < list.length(); i++) {
                                        JSONObject a = list.getJSONObject(i);
                                        JSObject o = new JSObject();
                                        o.put("appId", a.optString("appId"));
                                        o.put("name", a.optString("name"));
                                        o.put("icon", a.optString("icon", ""));
                                        apps.put(o);
                                    }
                                }
                                JSObject res = new JSObject();
                                res.put("apps", apps);
                                c.resolve(res);
                            }
                            break;
                        }
                        case "ed.apps.icon": {
                            PluginCall c = pendingIcons.remove(host);
                            if (c != null) {
                                String b64 = data != null ? data.optString("imageBase64", "") : "";
                                if (b64.isEmpty()) { c.reject("No icon", "NO_ICON"); break; }
                                JSObject res = new JSObject();
                                res.put("data", b64);
                                c.resolve(res);
                            }
                            break;
                        }
                        default:
                            break;
                    }
                } catch (Exception e) {
                    Log.w(TAG, "Bad message from TV: " + text, e);
                }
            }

            @Override public void onClosed(WebSocket ws, int code, String reason) {
                if (sockets.get(host) == ws) sockets.remove(host);
                JSObject ev = new JSObject();
                ev.put("host", host);
                notifyListeners("disconnected", ev);
            }

            @Override public void onFailure(WebSocket ws, Throwable t, Response response) {
                if (sockets.get(host) == ws) sockets.remove(host);
                PluginCall c = pendingConnect.remove(host);
                if (c != null) {
                    c.reject("Couldn't reach the TV at " + host + ". Is it on and on the same Wi-Fi?", "UNREACHABLE");
                }
                PluginCall a = pendingApps.remove(host);
                if (a != null) a.reject("TV connection lost");
                JSObject ev = new JSObject();
                ev.put("host", host);
                notifyListeners("disconnected", ev);
            }
        });
    }

    @PluginMethod
    public void isConnected(PluginCall call) {
        JSObject res = new JSObject();
        res.put("connected", sockets.containsKey(call.getString("host", "")));
        call.resolve(res);
    }

    /** Remote button, e.g. KEY_POWER, KEY_VOLUP, KEY_HOME, KEY_ENTER. */
    @PluginMethod
    public void sendKey(PluginCall call) {
        WebSocket ws = sockets.get(call.getString("host", ""));
        if (ws == null) { call.reject("Not connected to the TV", "NOT_CONNECTED"); return; }
        try {
            JSONObject params = new JSONObject()
                .put("Cmd", call.getString("cmd", "Click"))
                .put("DataOfCmd", call.getString("key"))
                .put("Option", "false")
                .put("TypeOfRemote", "SendRemoteKey");
            boolean ok = ws.send(new JSONObject().put("method", "ms.remote.control").put("params", params).toString());
            if (ok) call.resolve(); else call.reject("TV connection is closing", "NOT_CONNECTED");
        } catch (Exception e) {
            call.reject(e.getMessage(), e);
        }
    }

    /** Asks the TV for its installed apps. Resolves { apps: [{ appId, name }] }. */
    @PluginMethod
    public void getApps(PluginCall call) {
        String host = call.getString("host", "");
        WebSocket ws = sockets.get(host);
        if (ws == null) { call.reject("Not connected to the TV", "NOT_CONNECTED"); return; }
        try {
            PluginCall previous = pendingApps.put(host, call);
            if (previous != null) previous.reject("Superseded");
            JSONObject params = new JSONObject().put("event", "ed.installedApp.get").put("to", "host");
            ws.send(new JSONObject().put("method", "ms.channel.emit").put("params", params).toString());
            // Older firmware never answers; give up after a few seconds.
            new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
                PluginCall c = pendingApps.remove(host);
                if (c != null) c.reject("The TV didn't send its app list", "TIMEOUT");
            }, 6000);
        } catch (Exception e) {
            pendingApps.remove(host);
            call.reject(e.getMessage(), e);
        }
    }

    /** Fetches an app icon from the TV. Resolves { data: base64 image }. Call one at a time per TV. */
    @PluginMethod
    public void getAppIcon(PluginCall call) {
        String host = call.getString("host", "");
        WebSocket ws = sockets.get(host);
        if (ws == null) { call.reject("Not connected to the TV", "NOT_CONNECTED"); return; }
        try {
            PluginCall previous = pendingIcons.put(host, call);
            if (previous != null) previous.reject("Superseded");
            JSONObject data = new JSONObject().put("iconPath", call.getString("iconPath", ""));
            JSONObject params = new JSONObject().put("event", "ed.apps.icon").put("to", "host").put("data", data);
            ws.send(new JSONObject().put("method", "ms.channel.emit").put("params", params).toString());
            new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
                PluginCall c = pendingIcons.get(host);
                if (c == call) { pendingIcons.remove(host); c.reject("The TV didn't send the icon", "TIMEOUT"); }
            }, 5000);
        } catch (Exception e) {
            pendingIcons.remove(host);
            call.reject(e.getMessage(), e);
        }
    }

    /** Opens an app on the TV by its Samsung app ID. */
    @PluginMethod
    public void launchApp(PluginCall call) {
        WebSocket ws = sockets.get(call.getString("host", ""));
        if (ws == null) { call.reject("Not connected to the TV", "NOT_CONNECTED"); return; }
        try {
            JSONObject data = new JSONObject()
                .put("appId", call.getString("appId"))
                .put("action_type", call.getString("actionType", "DEEP_LINK"));
            JSONObject params = new JSONObject().put("event", "ed.apps.launch").put("to", "host").put("data", data);
            ws.send(new JSONObject().put("method", "ms.channel.emit").put("params", params).toString());
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage(), e);
        }
    }

    /** Wake-on-LAN magic packet to switch the TV on. */
    @PluginMethod
    public void wake(PluginCall call) {
        String mac = call.getString("mac", "");
        String broadcast = call.getString("broadcast", "255.255.255.255");
        String[] hex = mac.split("[:-]");
        if (hex.length != 6) { call.reject("Unknown TV network (MAC) address"); return; }
        try {
            byte[] macBytes = new byte[6];
            for (int i = 0; i < 6; i++) macBytes[i] = (byte) Integer.parseInt(hex[i], 16);
            byte[] packet = new byte[6 + 16 * 6];
            for (int i = 0; i < 6; i++) packet[i] = (byte) 0xff;
            for (int i = 6; i < packet.length; i += 6) System.arraycopy(macBytes, 0, packet, i, 6);
            try (DatagramSocket socket = new DatagramSocket()) {
                socket.setBroadcast(true);
                String[] targets = broadcast.equals("255.255.255.255") ? new String[]{broadcast} : new String[]{broadcast, "255.255.255.255"};
                for (int round = 0; round < 3; round++) {
                    for (String target : targets) {
                        InetAddress addr = InetAddress.getByName(target);
                        socket.send(new DatagramPacket(packet, packet.length, addr, 9));
                        socket.send(new DatagramPacket(packet, packet.length, addr, 7));
                    }
                    Thread.sleep(120);
                }
            }
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Wake-on-LAN failed", e);
            call.reject("Couldn't send the wake-up signal: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        WebSocket ws = sockets.remove(call.getString("host", ""));
        if (ws != null) ws.close(1000, "bye");
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        for (WebSocket ws : sockets.values()) ws.close(1000, "app closed");
        sockets.clear();
    }
}

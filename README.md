# Smart Dash

**One beautiful dashboard for every smart device in your home.** It runs in any browser, installs as an app (PWA), and ships with a ready-made Android project (Capacitor), so it can go on the Play Store.

- **Connect everything:** Home Assistant (Zigbee, Z-Wave, Matter, Nest, Tuya, IKEA, Sonos, Ring and 2,000+ more brands), Philips Hue, Sonos / IKEA SYMFONISK speakers, Shelly, and any device you can switch with a URL (Tasmota, ESPHome, WLED, IFTTT, Node-RED…).
- **Controls built for each device type:** a brightness slider you drag like a phone's control centre, colour and white-temperature pickers for lights, a thermostat dial you can drag, hold-to-unlock for locks, animated blinds and garage doors, fan speed, a media player and a robot vacuum view.
- **Scenes and routines:** one tap sets up the whole home. To make a scene, set your devices how you like them and save them. Routines run a scene at a set time.
- **Energy:** live power use, kWh today, cost, a 24-hour chart and the devices using the most power.
- **Polish:** dark and light themes, 7 accent colours, a ⌘K command palette, haptics, a reduced-motion setting, keyboard shortcuts and offline support.
- **Private by design:** everything stays on your device. No account and no cloud.

The app starts with a **demo home** of 26 simulated devices, so every control can be tried right away.

---

## Run it

No build step is needed. It's plain HTML, CSS and ES modules.

```bash
npm run dev            # serves ./www on http://localhost:5173
# or
python3 -m http.server 5173 -d www
```

Open it on your phone (same Wi-Fi) at `http://<your-pc-ip>:5173`, then choose **Add to Home screen** to install it.

> **Local devices and HTTPS:** browsers block plain `http://` devices (Hue bridge, Shelly, a local Home Assistant) when the page itself is served over `https://`. Open Smart Dash over `http://` on your network, use a Home Assistant `https://` URL (e.g. Nabu Casa), or use the Android app, which has no such limit.

## Build the Android app

The `android/` folder is a complete Android Studio project.

```bash
npm install              # REQUIRED first: the Android project links to Capacitor inside node_modules
npm run android:sync     # REQUIRED: copies ./www into the Android project and generates capacitor-cordova-android-plugins/
npm run android:open     # open in Android Studio → Run ▶, or Build → Generate Signed APK/Bundle
```

Skipping the first two steps makes Gradle sync fail. The errors look like *"capacitor-cordova-android-plugins/cordova.variables.gradle does not exist"* or *"project ':capacitor-android' not found"*, and the Run button stays disabled with "No configuration". Run `npm run android:sync` again after every change to `www/`.

**Use Java 21.** Newer Android Studio releases bundle Java 25, and the Gradle version here can't run on it. You'll see *"Unsupported class file major version 69"*. To fix it, install JDK 21 (`winget install EclipseAdoptium.Temurin.21.JDK`), then select it under File → Settings → Build Tools → Gradle → **Gradle JDK**.

To build from the command line on Windows (PowerShell):

```powershell
$env:JAVA_HOME = (Get-ChildItem "C:\Program Files\Eclipse Adoptium" -Directory | Where-Object Name -like "jdk-21*" | Select-Object -First 1).FullName
cd android
.\gradlew.bat assembleDebug   # APK lands in android\app\build\outputs\apk\debug\
```

Requirements: Android Studio with SDK 36+ and JDK 21.
The native app turns on `CapacitorHttp`, which means requests to local devices skip browser CORS rules. It also allows cleartext LAN traffic and wires up the Android back button and status bar.

To change the app icon, replace `assets/icon.png` (1024×1024) and run
`npx @capacitor/assets generate --android`.

## Connecting your devices

| Service | What you need |
|---|---|
| **Google Home** | Android app only, with a one-time setup (see [Google Home](#google-home) below). Brings in your Matter lights and plugs with their rooms. |
| **Home Assistant** | Your server URL plus a *long-lived access token* (Profile → Security → Long-lived access tokens). Rooms come in from your HA areas, and updates are live over WebSocket. |
| **Philips Hue** | Tap **Find bridge**, press the bridge's link button, then tap **Pair**. |
| **Sonos / IKEA SYMFONISK** | Each speaker's IP address (Sonos app → Settings → System → About My System). Supports play/pause, skip, volume and now-playing info. Android app only, because browsers block Sonos. |
| **Shelly** | The IP address of each device. Gen 1 and Gen 2/3/4 devices both work, including power metering and roller shutters. |
| **Custom HTTP** | An on URL and an off URL for each device, e.g. Tasmota `http://IP/cm?cmnd=Power%20On`. |

## Google Home

Smart Dash uses Google's official **Google Home APIs** to control the Matter lights and plugs in your Google Home. These APIs are in open beta, which brings two limits:

- They only work in the **Android app**.
- Google doesn't publish the SDK on a public repository, so you download it once yourself.

Requirements:
- A Google hub that supports the Home APIs, such as a Nest Mini, Nest Audio, Nest Hub or Google TV Streamer.
- Android 10 or newer on your phone.

**1. Download the SDK**
1. Go to <https://developers.home.google.com/apis/android/sdk> and sign in with the **same Google account** you use in Google Home.
2. Download the Android SDK.
3. Unzip it into `android/google-home-sdk/`, so that this folder exists: `android/google-home-sdk/com/google/android/gms/play-services-home/<version>/`. If you prefer, `%USERPROFILE%\.m2\repository\com\google\android\gms\play-services-home\<version>\` works too.
4. Run `npx cap sync android` and sync Gradle in Android Studio. The Build output should say *"Google Home APIs SDK … found — enabling Google Home support"*. Without the SDK, the app still builds normally, just without Google Home.

**2. Get your app's SHA-1 fingerprint**
In PowerShell, inside the `android` folder, run `.\gradlew.bat signingReport`. Copy the **SHA1** line under `Variant: debug`.

**3. Create a Google sign-in for the app (Google Cloud console, free)**
1. Go to <https://console.cloud.google.com/> and create a project, e.g. "Smart Dash".
2. Go to **APIs & Services → OAuth consent screen**:
   - User type: **External**.
   - Fill in the app name and your email.
   - Skip scopes.
   - Under **Test users / Audience**, add your own Google account.
3. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Type: **Android**.
   - Package name: `com.smartdash.app`.
   - Paste the SHA-1 from step 2.

**4. Connect**
1. Run the app from Android Studio.
2. Tap **+ → Google Home → Connect**.
3. Choose your Google account and your home.

Supported now: on/off lights, dimmable lights, colour-temperature lights, colour lights and plugs. The native code is in `android/app/src/googlehome/` and the web side is in `www/js/integrations/googlehome.js`.

## Project layout

```
www/                    the app (this is what gets deployed / packaged)
  index.html, manifest.webmanifest, sw.js
  css/app.css           design system, components, animations
  js/app.js             boot, routing, global wiring
  js/store.js           persisted state + events
  js/hub.js             routes actions to integrations (optimistic UI, throttling)
  js/devices.js         device type definitions
  js/detail.js          per-device control sheets
  js/integrations/      demo, homeassistant, hue, shelly, webhook
  js/views/             home, devices, scenes, energy, settings
android/                Capacitor Android project
assets/icon.png         source icon for Android icon/splash generation
```

### Adding a new integration

Create `www/js/integrations/<name>.js` that exports
`{ id, name, icon, color, tagline, description, fields, connect(cfg, api), disconnect(), setState(device, patch), command?(device, cmd) }`,
and register it in `integrations/index.js`. Use `api.sync([...devices])` to publish devices and `api.update(nid, patch)` for live changes. The UI picks it up automatically.

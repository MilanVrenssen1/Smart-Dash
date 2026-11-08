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
| **Home Assistant** | Your server URL plus a *long-lived access token* (Profile → Security → Long-lived access tokens). Rooms come in from your HA areas, and updates are live over WebSocket. |
| **Philips Hue** | Tap **Find bridge**, press the bridge's link button, then tap **Pair**. |
| **Sonos / IKEA SYMFONISK** | Each speaker's IP address (Sonos app → Settings → System → About My System). Supports play/pause, skip, volume and now-playing info. Android app only, because browsers block Sonos. |
| **Shelly** | The IP address of each device. Gen 1 and Gen 2/3/4 devices both work, including power metering and roller shutters. |
| **Custom HTTP** | An on URL and an off URL for each device, e.g. Tasmota `http://IP/cm?cmnd=Power%20On`. |

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

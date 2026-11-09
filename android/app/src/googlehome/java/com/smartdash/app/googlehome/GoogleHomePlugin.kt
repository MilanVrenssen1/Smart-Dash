package com.smartdash.app.googlehome

import android.util.Log
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.home.DeviceType
import com.google.home.FactoryRegistry
import com.google.home.Home
import com.google.home.HomeClient
import com.google.home.HomeConfig
import com.google.home.HomeDevice
import com.google.home.HomeException
import com.google.home.PermissionsResultStatus
import com.google.home.PermissionsState
import com.google.home.matter.standard.ColorControl
import com.google.home.matter.standard.ColorControlTrait
import com.google.home.matter.standard.ColorTemperatureLightDevice
import com.google.home.matter.standard.DimmableLightDevice
import com.google.home.matter.standard.DimmablePlugInUnitDevice
import com.google.home.matter.standard.ExtendedColorLightDevice
import com.google.home.matter.standard.LevelControl
import com.google.home.matter.standard.LevelControlTrait
import com.google.home.matter.standard.OnOff
import com.google.home.matter.standard.OnOffLightDevice
import com.google.home.matter.standard.OnOffPluginUnitDevice
import com.google.home.matter.standard.SpeakerDevice
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import kotlin.math.roundToInt

/**
 * Bridges the Google Home APIs (Matter lights & plugs in the user's Google Home)
 * to the Smart Dash web app.
 *
 * JS API (see www/js/integrations/googlehome.js):
 *   connect()                 -> asks the user for permission (Google consent screen)
 *   getDevices()              -> { devices: [...] }
 *   setState({ id, on?, brightness?, mireds?, hue?, saturation? })
 *   watch()                   -> emits "deviceChanged" events with the same shape as getDevices()
 *   disconnect()
 */
@CapacitorPlugin(name = "GoogleHome")
class GoogleHomePlugin : Plugin() {

    // Never let a Google Home failure take the whole app down.
    private val crashGuard = CoroutineExceptionHandler { _, e -> Log.e(TAG, "Unhandled Google Home error", e) }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main + crashGuard)
    private lateinit var home: HomeClient
    private val watchers = mutableMapOf<String, Job>()

    override fun load() {
        val registry = FactoryRegistry(
            traits = listOf(OnOff, LevelControl, ColorControl),
            types = listOf(
                OnOffLightDevice,
                DimmableLightDevice,
                ColorTemperatureLightDevice,
                ExtendedColorLightDevice,
                OnOffPluginUnitDevice,
                DimmablePlugInUnitDevice,
                SpeakerDevice,
            ),
        )
        home = Home.getClient(
            context.applicationContext,
            HomeConfig(coroutineContext = Dispatchers.IO, factoryRegistry = registry),
        )
        // Must happen before the activity reaches STARTED; plugins load during onCreate.
        home.registerActivityResultCallerForPermissions(activity)
    }

    override fun handleOnDestroy() {
        scope.cancel()
        super.handleOnDestroy()
    }

    /* ---------------- Permissions ---------------- */

    @PluginMethod
    fun connect(call: PluginCall) {
        scope.launch {
            try {
                val state = withTimeout(15_000) {
                    home.hasPermissions().first { it != PermissionsState.PERMISSIONS_STATE_UNINITIALIZED }
                }
                if (state == PermissionsState.GRANTED) {
                    call.resolve(JSObject().put("granted", true))
                    return@launch
                }
                val result = home.requestPermissions()
                when (result.status) {
                    PermissionsResultStatus.SUCCESS -> call.resolve(JSObject().put("granted", true))
                    PermissionsResultStatus.CANCELLED -> call.reject("You cancelled the Google Home permission screen.", "CANCELLED")
                    else -> call.reject(result.errorMessage ?: "Google Home permission failed.", "ERROR")
                }
            } catch (e: HomeException) {
                Log.e(TAG, "connect failed", e)
                call.reject(e.message ?: "Google Home error", "HOME_ERROR", e)
            } catch (e: Throwable) {
                Log.e(TAG, "connect failed", e)
                call.reject("${e.javaClass.simpleName}: ${e.message ?: "Google Home error"}", e as? Exception)
            }
        }
    }

    /* ---------------- Devices ---------------- */

    @PluginMethod
    fun getDevices(call: PluginCall) {
        scope.launch {
            try {
                val structures = withTimeout(15_000) { home.structures().first { it.isNotEmpty() } }
                val structure = structures.first()
                val rooms = structure.rooms().list().associate { it.id.id to it.name }
                val list = JSArray()
                for (device in structure.devices().list()) {
                    val type = primaryType(device) ?: continue
                    list.put(describe(device, type, rooms))
                }
                call.resolve(JSObject().put("home", structure.name).put("devices", list))
            } catch (e: HomeException) {
                Log.e(TAG, "getDevices failed", e)
                call.reject(e.message ?: "Google Home error", "HOME_ERROR", e)
            } catch (e: Throwable) {
                Log.e(TAG, "getDevices failed", e)
                call.reject("${e.javaClass.simpleName}: ${e.message ?: "Couldn't load your Google Home devices"}", e as? Exception)
            }
        }
    }

    /** Subscribe to live state changes for every supported device. */
    @PluginMethod
    fun watch(call: PluginCall) {
        scope.launch {
            try {
                watchers.values.forEach { it.cancel() }
                watchers.clear()
                val structure = withTimeout(15_000) { home.structures().first { it.isNotEmpty() } }.first()
                val rooms = structure.rooms().list().associate { it.id.id to it.name }
                for (device in structure.devices().list()) {
                    val flow = typeFlow(device) ?: continue
                    watchers[device.id.id] = scope.launch {
                        try {
                            flow.collect { type -> notifyListeners("deviceChanged", describe(device, type, rooms)) }
                        } catch (e: Throwable) {
                            Log.w(TAG, "watch ${device.name} stopped", e)
                        }
                    }
                }
                call.resolve()
            } catch (e: Throwable) {
                call.reject("${e.javaClass.simpleName}: ${e.message ?: "Couldn't watch Google Home devices"}", e as? Exception)
            }
        }
    }

    @PluginMethod
    fun disconnect(call: PluginCall) {
        watchers.values.forEach { it.cancel() }
        watchers.clear()
        call.resolve()
    }

    @PluginMethod
    fun setState(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("Missing device id")
        scope.launch {
            try {
                val device = home.devices().list().firstOrNull { it.id.id == id } ?: return@launch call.reject("Device not found")
                val type = primaryType(device) ?: return@launch call.reject("Unsupported device")
                val onOff = type.trait(OnOff)
                val level = type.trait(LevelControl)
                val color = type.trait(ColorControl)

                val brightness = call.getDouble("brightness")
                val on = call.getBoolean("on")
                if (brightness != null && level != null) {
                    // Matter level is 1-254; moveToLevelWithOnOff also switches the light on/off.
                    val lvl = (brightness.coerceIn(0.0, 100.0) * 254 / 100).roundToInt().coerceIn(1, 254)
                    level.moveToLevelWithOnOff(
                        level = lvl.toUByte(),
                        transitionTime = null,
                        optionsMask = LevelControlTrait.OptionsBitmap(),
                        optionsOverride = LevelControlTrait.OptionsBitmap(),
                    )
                }
                if (on != null && onOff != null) {
                    if (on) onOff.on() else onOff.off()
                }
                // Speakers: volume is the LevelControl level (0-254).
                val volume = call.getDouble("volume")
                if (volume != null && level != null) {
                    level.moveToLevel(
                        level = (volume.coerceIn(0.0, 100.0) * 254 / 100).roundToInt().toUByte(),
                        transitionTime = null,
                        optionsMask = LevelControlTrait.OptionsBitmap(),
                        optionsOverride = LevelControlTrait.OptionsBitmap(),
                    )
                }
                val mireds = call.getInt("mireds")
                if (mireds != null && color != null) {
                    color.moveToColorTemperature(
                        colorTemperatureMireds = mireds.coerceIn(100, 1000).toUShort(),
                        transitionTime = 3u.toUShort(),
                        optionsMask = ColorControlTrait.OptionsBitmap(),
                        optionsOverride = ColorControlTrait.OptionsBitmap(),
                    )
                }
                val hue = call.getDouble("hue")
                val saturation = call.getDouble("saturation")
                if (hue != null && saturation != null && color != null) {
                    color.moveToHueAndSaturation(
                        hue = ((hue % 360) / 360 * 254).roundToInt().coerceIn(0, 254).toUByte(),
                        saturation = (saturation.coerceIn(0.0, 100.0) * 254 / 100).roundToInt().toUByte(),
                        transitionTime = 3u.toUShort(),
                        optionsMask = ColorControlTrait.OptionsBitmap(),
                        optionsOverride = ColorControlTrait.OptionsBitmap(),
                    )
                }
                call.resolve()
            } catch (e: HomeException) {
                Log.e(TAG, "setState failed", e)
                call.reject(e.message ?: "Google Home command failed", "HOME_ERROR", e)
            } catch (e: Throwable) {
                Log.e(TAG, "setState failed", e)
                call.reject("${e.javaClass.simpleName}: ${e.message ?: "Google Home command failed"}", e as? Exception)
            }
        }
    }

    /* ---------------- Helpers ---------------- */

    /** Most capable supported type first, so colour lights aren't treated as plain on/off lights. */
    private suspend fun primaryType(d: HomeDevice): DeviceType? = when {
        d.has(ExtendedColorLightDevice) -> d.type(ExtendedColorLightDevice).first()
        d.has(ColorTemperatureLightDevice) -> d.type(ColorTemperatureLightDevice).first()
        d.has(DimmableLightDevice) -> d.type(DimmableLightDevice).first()
        d.has(OnOffLightDevice) -> d.type(OnOffLightDevice).first()
        d.has(DimmablePlugInUnitDevice) -> d.type(DimmablePlugInUnitDevice).first()
        d.has(OnOffPluginUnitDevice) -> d.type(OnOffPluginUnitDevice).first()
        d.has(SpeakerDevice) -> d.type(SpeakerDevice).first()
        else -> null
    }

    private fun typeFlow(d: HomeDevice): Flow<DeviceType>? = when {
        d.has(ExtendedColorLightDevice) -> d.type(ExtendedColorLightDevice)
        d.has(ColorTemperatureLightDevice) -> d.type(ColorTemperatureLightDevice)
        d.has(DimmableLightDevice) -> d.type(DimmableLightDevice)
        d.has(OnOffLightDevice) -> d.type(OnOffLightDevice)
        d.has(DimmablePlugInUnitDevice) -> d.type(DimmablePlugInUnitDevice)
        d.has(OnOffPluginUnitDevice) -> d.type(OnOffPluginUnitDevice)
        d.has(SpeakerDevice) -> d.type(SpeakerDevice)
        else -> null
    }

    private fun describe(d: HomeDevice, type: DeviceType, rooms: Map<String, String>): JSObject {
        val isPlug = type is OnOffPluginUnitDevice || type is DimmablePlugInUnitDevice
        val isSpeaker = type is SpeakerDevice
        val onOff = type.trait(OnOff)
        val level = type.trait(LevelControl)
        val color = type.trait(ColorControl)
        val o = JSObject()
        o.put("id", d.id.id)
        o.put("name", d.name)
        o.put("room", d.roomId?.let { rooms[it.id] })
        o.put("kind", if (isSpeaker) "speaker" else if (isPlug) "outlet" else "light")
        o.put("online", type.metadata.sourceConnectivity.connectivityState.name != "OFFLINE")
        o.put("on", onOff?.onOff ?: false)
        o.put("dimmable", level != null && type !is OnOffLightDevice && type !is OnOffPluginUnitDevice)
        level?.currentLevel?.let {
            val pct = (it.toInt() * 100.0 / 254).roundToInt().coerceIn(0, 100)
            o.put(if (isSpeaker) "volume" else "brightness", if (isSpeaker) pct else pct.coerceAtLeast(1))
        }
        o.put("supportsTemp", type is ColorTemperatureLightDevice || type is ExtendedColorLightDevice)
        o.put("supportsColor", type is ExtendedColorLightDevice)
        if (color != null) {
            o.put("colorMode", color.colorMode?.name)
            color.colorTemperatureMireds?.let { o.put("mireds", it.toInt()) }
            color.currentHue?.let { o.put("hue", it.toInt() * 360.0 / 254) }
            color.currentSaturation?.let { o.put("saturation", it.toInt() * 100.0 / 254) }
            color.currentX?.let { o.put("x", it.toInt() / 65535.0) }
            color.currentY?.let { o.put("y", it.toInt() / 65535.0) }
            color.colorTempPhysicalMinMireds?.let { o.put("minMireds", it.toInt()) }
            color.colorTempPhysicalMaxMireds?.let { o.put("maxMireds", it.toInt()) }
        }
        return o
    }

    companion object {
        private const val TAG = "SmartDashGoogleHome"
    }
}

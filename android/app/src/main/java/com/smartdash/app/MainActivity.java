package com.smartdash.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;

public class MainActivity extends BridgeActivity {
    @Override
    @SuppressWarnings("unchecked")
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SamsungTvPlugin.class);
        // The Google Home plugin is only compiled in when the Home APIs SDK is installed.
        try {
            registerPlugin((Class<? extends Plugin>) Class.forName("com.smartdash.app.googlehome.GoogleHomePlugin"));
        } catch (ClassNotFoundException ignored) {
            // Built without the Google Home SDK.
        }
        super.onCreate(savedInstanceState);
    }
}

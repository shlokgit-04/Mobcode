package com.mobcode.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MobcodeSecureStorePlugin.class);
        super.onCreate(savedInstanceState);
    }
}

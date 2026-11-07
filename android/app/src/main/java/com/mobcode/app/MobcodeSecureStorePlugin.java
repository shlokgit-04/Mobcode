package com.mobcode.app;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/**
 * MobcodeSecureStore — encrypts user connection credentials at rest with
 * AES-256-GCM via EncryptedSharedPreferences (keys wrapped by the Android
 * Keystore MasterKey). Backups are disabled (allowBackup=false), so this
 * never leaves the device.
 */
@CapacitorPlugin(name = "MobcodeSecureStore")
public class MobcodeSecureStorePlugin extends Plugin {

    private static final String FILE = "mobcode_secure_prefs";
    private static final int MAX_VALUE_CHARS = 8192;

    private volatile SharedPreferences prefs;

    private SharedPreferences prefs() throws Exception {
        SharedPreferences p = prefs;
        if (p != null) return p;
        synchronized (this) {
            if (prefs == null) {
                Context ctx = getContext();
                MasterKey masterKey = new MasterKey.Builder(ctx, MasterKey.DEFAULT_MASTER_KEY_ALIAS)
                        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                        .build();
                prefs = EncryptedSharedPreferences.create(
                        ctx,
                        FILE,
                        masterKey,
                        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
                );
            }
            return prefs;
        }
    }

    @PluginMethod
    public void set(PluginCall call) {
        String key = call.getString("key", "").trim();
        String value = call.getString("value");
        if (key.isEmpty() || value == null || value.length() > MAX_VALUE_CHARS) {
            call.reject("invalid key or value");
            return;
        }
        try {
            prefs().edit().putString(sanitizedKey(key), value).apply();
            call.resolve();
        } catch (Exception e) {
            call.reject("secure store write failed: " + e.getClass().getSimpleName());
        }
    }

    @PluginMethod
    public void get(PluginCall call) {
        String key = call.getString("key", "").trim();
        if (key.isEmpty()) { call.reject("invalid key"); return; }
        try {
            String value = prefs().getString(sanitizedKey(key), null);
            JSObject out = new JSObject();
            out.put("value", value == null ? JSObject.NULL : value);
            call.resolve(out);
        } catch (Exception e) {
            // Corrupted keystore/hardware change: start clean rather than crash-loop.
            try {
                Context ctx = getContext();
                ctx.deleteSharedPreferences(FILE);
                prefs = null;
            } catch (Exception ignored) {}
            JSObject out = new JSObject();
            out.put("value", JSObject.NULL);
            call.resolve(out);
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String key = call.getString("key", "").trim();
        if (key.isEmpty()) { call.reject("invalid key"); return; }
        try {
            prefs().edit().remove(sanitizedKey(key)).apply();
            call.resolve();
        } catch (Exception e) {
            call.reject("secure store remove failed: " + e.getClass().getSimpleName());
        }
    }

    @PluginMethod
    public void clearAll(PluginCall call) {
        try {
            prefs().edit().clear().apply();
            call.resolve();
        } catch (Exception e) {
            call.reject("secure store clear failed: " + e.getClass().getSimpleName());
        }
    }

    /** Restrict keys to a safe namespace so plugin names can't collide. */
    private static String sanitizedKey(String key) throws Exception {
        if (!key.matches("[A-Za-z0-9_.-]{1,64}")) throw new IllegalArgumentException("bad key");
        // flatten into tiny digest to avoid use as another module's key
        return "k_" + digest(key);
    }

    private static String digest(String s) throws Exception {
        byte[] h = MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder(64);
        for (byte b : h) sb.append(Character.forDigit((b >> 4) & 0xF, 16)).append(Character.forDigit(b & 0xF, 16));
        return sb.toString();
    }
}

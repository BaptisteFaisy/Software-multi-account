package com.codexswitch.terminal;

import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Stocke le token natif chiffre avec une cle non exportable d'Android Keystore.
 *
 * La WebView conserve sa propre session web. Ce stockage sert uniquement au
 * pont CstAndroid et evite de laisser une seconde copie du token en clair dans
 * les SharedPreferences de l'application.
 */
final class SecureTokenStore {
    private static final String KEY_ALIAS = "com.codexswitch.terminal.admin-token";
    private static final String KEY_CIPHERTEXT = "tokenCiphertext";
    private static final String KEY_IV = "tokenIv";
    private static final String ANDROID_KEY_STORE = "AndroidKeyStore";

    private final SharedPreferences preferences;

    SecureTokenStore(SharedPreferences preferences) {
        this.preferences = preferences;
    }

    synchronized String read() {
        String ciphertext = preferences.getString(KEY_CIPHERTEXT, "");
        String iv = preferences.getString(KEY_IV, "");
        if (ciphertext.isEmpty() || iv.isEmpty()) {
            return "";
        }

        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(
                    Cipher.DECRYPT_MODE,
                    getOrCreateKey(),
                    new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
            byte[] clear = cipher.doFinal(Base64.decode(ciphertext, Base64.NO_WRAP));
            return new String(clear, StandardCharsets.UTF_8);
        } catch (Exception ignored) {
            // Une cle peut etre invalidee apres une restauration ou un changement
            // de verrouillage. On oublie alors uniquement la copie native.
            clear();
            return "";
        }
    }

    synchronized void write(String value) {
        String token = value == null ? "" : value.trim();
        if (token.isEmpty()) {
            clear();
            return;
        }

        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
            byte[] encrypted = cipher.doFinal(token.getBytes(StandardCharsets.UTF_8));
            preferences.edit()
                    .putString(KEY_CIPHERTEXT, Base64.encodeToString(encrypted, Base64.NO_WRAP))
                    .putString(KEY_IV, Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
                    .apply();
        } catch (Exception error) {
            throw new IllegalStateException("Impossible de proteger le token Android.", error);
        }
    }

    synchronized void clear() {
        preferences.edit().remove(KEY_CIPHERTEXT).remove(KEY_IV).apply();
    }

    private SecretKey getOrCreateKey() throws Exception {
        KeyStore store = KeyStore.getInstance(ANDROID_KEY_STORE);
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) {
            return (SecretKey) store.getKey(KEY_ALIAS, null);
        }

        KeyGenerator generator = KeyGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_AES,
                ANDROID_KEY_STORE);
        generator.init(new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build());
        return generator.generateKey();
    }
}

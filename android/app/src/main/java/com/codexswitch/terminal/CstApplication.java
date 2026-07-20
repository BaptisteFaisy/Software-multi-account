package com.codexswitch.terminal;

import android.app.Application;

/** Initialise Firebase avant qu'un message FCM puisse reveiller le processus. */
public final class CstApplication extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        PaymentPushRegistration.initializeFirebaseFromStoredConfiguration(this);
    }
}

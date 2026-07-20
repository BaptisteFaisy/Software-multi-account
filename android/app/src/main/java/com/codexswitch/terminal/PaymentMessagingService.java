package com.codexswitch.terminal;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

/** Recoit uniquement des identifiants de handoff et construit la notification localement. */
public final class PaymentMessagingService extends FirebaseMessagingService {

    @Override
    public void onRegistered(String firebaseInstallationId) {
        PaymentPushRegistration.registerCurrentInstallation(this, firebaseInstallationId);
    }

    @Override
    public void onMessageReceived(RemoteMessage message) {
        PaymentPushRegistration.showPaymentNotification(this, message.getData());
    }
}

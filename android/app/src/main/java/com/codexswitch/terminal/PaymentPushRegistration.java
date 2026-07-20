package com.codexswitch.terminal;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.text.InputType;
import android.text.method.PasswordTransformationMethod;
import android.view.Gravity;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.messaging.FirebaseMessaging;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.math.BigDecimal;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.NumberFormat;
import java.util.Currency;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * Enregistre cette installation aupres de cst-server et affiche les rapports
 * d'agents, les alertes et les handoffs de paiement. Le FID et le token admin
 * restent hors de la WebView et des notifications.
 */
final class PaymentPushRegistration {
    static final String ACTION_OPEN_PAYMENT =
            "com.codexswitch.terminal.action.OPEN_PAYMENT_HANDOFF";
    static final String ACTION_OPEN_AUTONOMOUS_AGENT =
            "com.codexswitch.terminal.action.OPEN_AUTONOMOUS_AGENT";
    static final String EXTRA_AGENT_ID = "cst.payment.agentId";
    static final String EXTRA_PAYMENT_ID = "cst.payment.paymentId";
    static final String EXTRA_AUTONOMOUS_AGENT_ID = "cst.autonomous.agentId";
    static final int REQUEST_NOTIFICATION_PERMISSION = 1004;

    private static final String KEY_DEVICE_ID = "mobilePushDeviceId";
    private static final String KEY_CONFIG_BASE_URL = "mobilePushConfigBaseUrl";
    private static final String KEY_FIREBASE_PROJECT_ID = "mobilePushFirebaseProjectId";
    private static final String KEY_FIREBASE_SENDER_ID = "mobilePushFirebaseSenderId";
    private static final String KEY_FIREBASE_PACKAGE_NAME = "mobilePushFirebasePackageName";
    private static final String KEY_FIREBASE_APPLICATION_ID = "mobilePushFirebaseApplicationId";
    private static final String KEY_FIREBASE_API_KEY = "mobilePushFirebaseApiKey";
    private static final int CONNECT_TIMEOUT_MS = 10_000;
    private static final int READ_TIMEOUT_MS = 15_000;
    private static final int MAX_CONFIGURATION_RESPONSE_BYTES = 128 * 1024;
    private static boolean permissionPromptShown;
    private static boolean configurationSyncInFlight;

    private interface ConfigurationCallback {
        void onComplete(JSONObject configuration, String error);
    }

    private PaymentPushRegistration() {}

    static void initialize(Activity activity) {
        if (!firebaseConfigured(activity)) {
            syncConfigurationFromServer(activity, true, null);
            return;
        }
        completeInitialization(activity);
    }

    private static void completeInitialization(Activity activity) {
        createNotificationChannel(activity);
        if (canPostNotifications(activity)) {
            requestFirebaseRegistration();
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
                || permissionPromptShown
                || activity.isFinishing()) {
            return;
        }
        permissionPromptShown = true;
        new AlertDialog.Builder(activity)
                .setTitle(R.string.payment_permission_title)
                .setMessage(R.string.payment_permission_message)
                .setNegativeButton(R.string.payment_permission_later, null)
                .setPositiveButton(R.string.payment_permission_enable, (dialog, ignored) -> {
                    activity.requestPermissions(
                            new String[]{Manifest.permission.POST_NOTIFICATIONS},
                            REQUEST_NOTIFICATION_PERMISSION);
                })
                .show();
    }

    static void onNotificationPermissionResult(Context context, boolean granted) {
        if (granted && firebaseConfigured(context)) {
            requestFirebaseRegistration();
        }
    }

    static void refreshAfterConfigurationChange(
            Activity activity,
            SharedPreferences preferences,
            SecureTokenStore tokenStore,
            String previousBaseUrl,
            String previousAdminToken) {
        String currentBaseUrl = normalizedBaseUrl(activity, preferences);
        String currentAdminToken = tokenStore.read();
        if (!previousBaseUrl.equals(currentBaseUrl)
                || !previousAdminToken.equals(currentAdminToken)) {
            unregisterFromServerAsync(
                    previousBaseUrl,
                    previousAdminToken,
                    deviceId(preferences));
        }
        initialize(activity);
    }

    static void showConfigurationDialog(Activity activity) {
        if (activity.isFinishing()) {
            return;
        }
        SharedPreferences preferences =
                activity.getSharedPreferences("cst", Context.MODE_PRIVATE);
        if (normalizedBaseUrl(activity, preferences).isEmpty()
                || new SecureTokenStore(preferences).read().isEmpty()) {
            Toast.makeText(
                    activity,
                    R.string.payment_config_connection_required,
                    Toast.LENGTH_LONG).show();
            return;
        }

        LinearLayout fields = new LinearLayout(activity);
        fields.setOrientation(LinearLayout.VERTICAL);
        fields.setPadding(dp(activity, 20), dp(activity, 8), dp(activity, 20), dp(activity, 8));

        TextView instructions = new TextView(activity);
        instructions.setText(R.string.payment_config_instructions);
        instructions.setTextSize(14);
        fields.addView(instructions, matchWidthWrapHeight());

        TextView status = new TextView(activity);
        status.setText(R.string.payment_config_loading);
        status.setTextSize(14);
        LinearLayout.LayoutParams statusParams = matchWidthWrapHeight();
        statusParams.topMargin = dp(activity, 12);
        fields.addView(status, statusParams);

        EditText googleServices = configurationEditor(
                activity,
                R.string.payment_config_google_services_hint,
                false);
        LinearLayout.LayoutParams editorParams = matchWidthWrapHeight();
        editorParams.topMargin = dp(activity, 16);
        fields.addView(googleServices, editorParams);

        EditText serviceAccount = configurationEditor(
                activity,
                R.string.payment_config_service_account_hint,
                true);
        LinearLayout.LayoutParams secretParams = matchWidthWrapHeight();
        secretParams.topMargin = dp(activity, 12);
        fields.addView(serviceAccount, secretParams);

        TextView privacy = new TextView(activity);
        privacy.setText(R.string.payment_config_privacy);
        privacy.setTextSize(12);
        LinearLayout.LayoutParams privacyParams = matchWidthWrapHeight();
        privacyParams.topMargin = dp(activity, 10);
        fields.addView(privacy, privacyParams);

        ScrollView scrollView = new ScrollView(activity);
        scrollView.addView(fields, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        boolean secureWasEnabled = (activity.getWindow().getAttributes().flags
                & WindowManager.LayoutParams.FLAG_SECURE) != 0;
        activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        AlertDialog dialog = new AlertDialog.Builder(activity)
                .setTitle(R.string.payment_config_title)
                .setView(scrollView)
                .setNegativeButton(android.R.string.cancel, null)
                .setNeutralButton(R.string.payment_config_test, null)
                .setPositiveButton(R.string.payment_config_save, null)
                .create();
        dialog.setOnDismissListener(ignored -> {
            googleServices.setText("");
            serviceAccount.setText("");
            if (!secureWasEnabled) {
                activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
            }
        });
        dialog.setOnShowListener(ignored -> {
            dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setEnabled(false);
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);
            syncConfigurationFromServer(activity, false, (configuration, error) -> {
                if (!dialog.isShowing()) {
                    return;
                }
                if (configuration != null) {
                    status.setText(formatConfigurationStatus(activity, configuration));
                    googleServices.setHint(R.string.payment_config_google_services_keep_hint);
                    serviceAccount.setHint(R.string.payment_config_service_account_keep_hint);
                    dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setEnabled(
                            configuration.optBoolean("configured", false)
                                    && configuration.optInt("registeredDevices", 0) > 0);
                } else {
                    status.setText(error == null
                            ? activity.getString(R.string.payment_config_unavailable)
                            : error);
                }
                dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true);
            });
            dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener(button -> {
                button.setEnabled(false);
                dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);
                status.setText(R.string.payment_config_testing);
                new Thread(() -> {
                    JSONObject result = null;
                    String error = null;
                    try {
                        result = executeMobilePushRequest(activity, "/test", "POST", null);
                    } catch (Exception testError) {
                        error = testError.getMessage();
                    }
                    JSONObject testResult = result;
                    String failure = error;
                    activity.runOnUiThread(() -> {
                        if (!dialog.isShowing()) return;
                        if (testResult != null && testResult.optBoolean("ok", false)) {
                            status.setText(activity.getString(
                                    R.string.payment_config_test_sent,
                                    testResult.optInt("deliveredDevices", 0)));
                        } else {
                            status.setText(failure == null
                                    ? activity.getString(R.string.payment_config_unavailable)
                                    : failure);
                        }
                        button.setEnabled(true);
                        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true);
                    });
                }, "cst-mobile-push-test").start();
            });
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(button -> {
                String googleJson = googleServices.getText().toString().trim();
                String serviceJson = serviceAccount.getText().toString().trim();
                if (googleJson.isEmpty() && serviceJson.isEmpty()) {
                    status.setText(R.string.payment_config_nothing_to_save);
                    return;
                }
                boolean testWasEnabled =
                        dialog.getButton(AlertDialog.BUTTON_NEUTRAL).isEnabled();
                button.setEnabled(false);
                dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setEnabled(false);
                status.setText(R.string.payment_config_saving);
                new Thread(() -> {
                    JSONObject configuration = null;
                    String error = null;
                    try {
                        JSONObject request = new JSONObject()
                                .put("androidPackageName", activity.getPackageName());
                        if (!googleJson.isEmpty()) {
                            request.put("googleServicesJson", googleJson);
                        }
                        if (!serviceJson.isEmpty()) {
                            request.put("serviceAccountJson", serviceJson);
                        }
                        configuration = executeMobilePushRequest(
                                activity, "/config", "POST", request);
                    } catch (Exception saveError) {
                        error = saveError.getMessage();
                    }
                    JSONObject result = configuration;
                    String failure = error;
                    activity.runOnUiThread(() -> {
                        if (!dialog.isShowing()) {
                            return;
                        }
                        if (result == null) {
                            status.setText(failure == null
                                    ? activity.getString(R.string.payment_config_unavailable)
                                    : failure);
                            button.setEnabled(true);
                            dialog.getButton(AlertDialog.BUTTON_NEUTRAL)
                                    .setEnabled(testWasEnabled);
                            return;
                        }
                        try {
                            boolean androidReady = result.optBoolean("androidConfigured", false);
                            boolean active = androidReady
                                    && cacheAndInitializeConfiguration(activity, result);
                            googleServices.setText("");
                            serviceAccount.setText("");
                            if (!result.optBoolean("configured", false)) {
                                status.setText(formatConfigurationStatus(activity, result));
                                button.setEnabled(true);
                                dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setEnabled(
                                        result.optBoolean("configured", false)
                                                && result.optInt("registeredDevices", 0) > 0);
                                if (active) {
                                    completeInitialization(activity);
                                }
                                return;
                            }
                            dialog.dismiss();
                            Toast.makeText(
                                    activity,
                                    active
                                            ? R.string.payment_config_saved
                                            : R.string.payment_config_restart_required,
                                    Toast.LENGTH_LONG).show();
                            if (active) completeInitialization(activity);
                        } catch (Exception applyError) {
                            status.setText(applyError.getMessage());
                            button.setEnabled(true);
                            dialog.getButton(AlertDialog.BUTTON_NEUTRAL)
                                    .setEnabled(testWasEnabled);
                        }
                    });
                }, "cst-mobile-push-config-save").start();
            });
        });
        dialog.show();
    }

    private static EditText configurationEditor(
            Context context,
            int hintResource,
            boolean secret) {
        EditText editor = new EditText(context);
        editor.setHint(hintResource);
        editor.setGravity(Gravity.TOP | Gravity.START);
        editor.setMinLines(5);
        editor.setMaxLines(9);
        editor.setHorizontallyScrolling(false);
        editor.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
        editor.setSaveEnabled(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            editor.setImportantForAutofill(ViewGroup.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        }
        if (secret) {
            editor.setTransformationMethod(PasswordTransformationMethod.getInstance());
        }
        return editor;
    }

    private static LinearLayout.LayoutParams matchWidthWrapHeight() {
        return new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    private static int dp(Context context, int value) {
        return Math.round(value * context.getResources().getDisplayMetrics().density);
    }

    private static String formatConfigurationStatus(Context context, JSONObject configuration) {
        String project = configuration.optString("projectId", "-");
        int devices = configuration.optInt("registeredDevices", 0);
        if (configuration.optBoolean("configured", false)) {
            return context.getString(R.string.payment_config_ready, project, devices);
        }
        boolean androidReady = configuration.optBoolean("androidConfigured", false);
        boolean serverReady = configuration.optBoolean("serviceAccountConfigured", false);
        return context.getString(
                R.string.payment_config_partial,
                androidReady ? context.getString(R.string.yes) : context.getString(R.string.no),
                serverReady ? context.getString(R.string.yes) : context.getString(R.string.no));
    }

    static void registerCurrentInstallation(Context context, String firebaseInstallationId) {
        if (!canPostNotifications(context)) {
            return;
        }
        SharedPreferences preferences = context.getSharedPreferences("cst", Context.MODE_PRIVATE);
        SecureTokenStore tokenStore = new SecureTokenStore(preferences);
        String baseUrl = normalizedBaseUrl(context, preferences);
        String adminToken = tokenStore.read();
        String target = safeFirebaseInstallationId(firebaseInstallationId);
        if (baseUrl.isEmpty() || adminToken.isEmpty() || target.isEmpty()) {
            return;
        }
        String localDeviceId = deviceId(preferences);
        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                connection = authenticatedConnection(
                        baseUrl + "/api/notifications/mobile-push/devices",
                        "POST",
                        adminToken);
                byte[] body = new JSONObject()
                        .put("deviceId", localDeviceId)
                        .put("firebaseInstallationId", target)
                        .put("appVersion", BuildConfig.VERSION_NAME)
                        .toString()
                        .getBytes(StandardCharsets.UTF_8);
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                connection.setFixedLengthStreamingMode(body.length);
                connection.setDoOutput(true);
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(body);
                }
                connection.getResponseCode();
            } catch (Exception ignored) {
                // Reseau mobile et Tailscale peuvent etre temporairement absents.
            } finally {
                if (connection != null) {
                    connection.disconnect();
                }
            }
        }, "cst-mobile-push-register").start();
    }

    static void showPaymentNotification(Context context, Map<String, String> data) {
        if (!canPostNotifications(context)) {
            return;
        }
        String type = data.get("type");
        if ("configuration_test".equals(type)) {
            showConfigurationTestNotification(context);
            return;
        }
        if ("autonomous_agent_report".equals(type) || "autonomous_agent_alert".equals(type)) {
            showAutonomousAgentNotification(
                    context,
                    data,
                    "autonomous_agent_alert".equals(type));
            return;
        }
        if (!"payment_handoff".equals(type)) return;
        String agentId = safeUuid(data.get("agentId"));
        String paymentId = safeUuid(data.get("paymentId"));
        if (agentId.isEmpty() || paymentId.isEmpty()) {
            return;
        }
        String agentName = compact(data.get("agentName"), 80, "Agent autonome");
        String merchant = compact(data.get("merchant"), 80, "Marchand");
        String amount = formatAmount(data.get("amountMinor"), data.get("currency"));

        createNotificationChannel(context);
        Intent intent = new Intent(context, MainActivity.class)
                .setAction(ACTION_OPEN_PAYMENT)
                .putExtra(EXTRA_AGENT_ID, agentId)
                .putExtra(EXTRA_PAYMENT_ID, paymentId)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                context,
                paymentId.hashCode(),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        String body = context.getString(
                R.string.payment_notification_body,
                amount,
                merchant,
                agentName);
        Notification publicVersion = notificationBuilder(context)
                .setSmallIcon(R.drawable.ic_launcher)
                .setContentTitle(context.getString(R.string.payment_notification_title))
                .setContentText(context.getString(R.string.payment_notification_public))
                .build();
        Notification notification = notificationBuilder(context)
                .setSmallIcon(R.drawable.ic_launcher)
                .setColor(context.getColor(R.color.accent))
                .setContentTitle(context.getString(R.string.payment_notification_title))
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setContentIntent(pendingIntent)
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .setCategory(Notification.CATEGORY_EVENT)
                .setPriority(Notification.PRIORITY_HIGH)
                .setVisibility(Notification.VISIBILITY_PRIVATE)
                .setPublicVersion(publicVersion)
                .build();
        NotificationManager manager =
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        manager.notify(paymentId.hashCode(), notification);
    }

    private static void showAutonomousAgentNotification(
            Context context,
            Map<String, String> data,
            boolean attentionRequired) {
        String agentId = safeUuid(data.get("agentId"));
        if (agentId.isEmpty()) {
            return;
        }
        String agentName = compact(data.get("agentName"), 80, "Agent autonome");
        String notificationId = compact(data.get("notificationId"), 160, agentId);
        String content = compact(
                data.get("content"),
                600,
                attentionRequired
                        ? "Une intervention est requise."
                        : "Un nouveau compte rendu est disponible.");

        createNotificationChannel(context);
        Intent intent = new Intent(context, MainActivity.class)
                .setAction(ACTION_OPEN_AUTONOMOUS_AGENT)
                .putExtra(EXTRA_AUTONOMOUS_AGENT_ID, agentId)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int requestCode = (agentId + "|" + notificationId).hashCode();
        PendingIntent pendingIntent = PendingIntent.getActivity(
                context,
                requestCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        String title = context.getString(
                attentionRequired
                        ? R.string.autonomous_notification_alert_title
                        : R.string.autonomous_notification_title,
                agentName);
        Notification publicVersion = autonomousNotificationBuilder(context)
                .setSmallIcon(R.drawable.ic_launcher)
                .setContentTitle(title)
                .setContentText(context.getString(R.string.autonomous_notification_public))
                .build();
        Notification notification = autonomousNotificationBuilder(context)
                .setSmallIcon(R.drawable.ic_launcher)
                .setColor(context.getColor(R.color.accent))
                .setContentTitle(title)
                .setContentText(content)
                .setStyle(new Notification.BigTextStyle().bigText(content))
                .setContentIntent(pendingIntent)
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .setCategory(attentionRequired ? Notification.CATEGORY_ERROR : Notification.CATEGORY_STATUS)
                .setPriority(attentionRequired ? Notification.PRIORITY_HIGH : Notification.PRIORITY_DEFAULT)
                .setVisibility(Notification.VISIBILITY_PRIVATE)
                .setPublicVersion(publicVersion)
                .build();
        NotificationManager manager =
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        manager.notify(requestCode, notification);
    }

    private static void showConfigurationTestNotification(Context context) {
        createNotificationChannel(context);
        Intent intent = new Intent(context, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                context,
                0x435354,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification publicVersion = notificationBuilder(context)
                .setSmallIcon(R.drawable.ic_launcher)
                .setContentTitle(context.getString(R.string.payment_config_test_title))
                .setContentText(context.getString(R.string.payment_notification_public))
                .build();
        Notification notification = notificationBuilder(context)
                .setSmallIcon(R.drawable.ic_launcher)
                .setColor(context.getColor(R.color.accent))
                .setContentTitle(context.getString(R.string.payment_config_test_title))
                .setContentText(context.getString(R.string.payment_config_test_body))
                .setContentIntent(pendingIntent)
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .setPriority(Notification.PRIORITY_HIGH)
                .setVisibility(Notification.VISIBILITY_PRIVATE)
                .setPublicVersion(publicVersion)
                .build();
        NotificationManager manager =
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        manager.notify(0x435354, notification);
    }

    private static Notification.Builder notificationBuilder(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return new Notification.Builder(
                    context,
                    context.getString(R.string.payment_notification_channel_id));
        }
        return new Notification.Builder(context);
    }

    private static Notification.Builder autonomousNotificationBuilder(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return new Notification.Builder(
                    context,
                    context.getString(R.string.autonomous_notification_channel_id));
        }
        return new Notification.Builder(context);
    }

    private static void createNotificationChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationChannel channel = new NotificationChannel(
                context.getString(R.string.payment_notification_channel_id),
                context.getString(R.string.payment_notification_channel_name),
                NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription(context.getString(R.string.payment_notification_channel_description));
        channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        NotificationManager manager =
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        manager.createNotificationChannel(channel);
        NotificationChannel autonomousChannel = new NotificationChannel(
                context.getString(R.string.autonomous_notification_channel_id),
                context.getString(R.string.autonomous_notification_channel_name),
                NotificationManager.IMPORTANCE_DEFAULT);
        autonomousChannel.setDescription(
                context.getString(R.string.autonomous_notification_channel_description));
        autonomousChannel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        manager.createNotificationChannel(autonomousChannel);
    }

    static void initializeFirebaseFromStoredConfiguration(Context context) {
        try {
            if (!FirebaseApp.getApps(context).isEmpty()) {
                return;
            }
            if (FirebaseApp.initializeApp(context) != null) {
                return;
            }
            SharedPreferences preferences =
                    context.getSharedPreferences("cst", Context.MODE_PRIVATE);
            initializeFirebaseFromPreferences(context, preferences);
        } catch (RuntimeException ignored) {
            // L'interface de configuration expliquera le champ invalide.
        }
    }

    private static boolean firebaseConfigured(Context context) {
        initializeFirebaseFromStoredConfiguration(context);
        try {
            if (FirebaseApp.getApps(context).isEmpty()) {
                return false;
            }
            SharedPreferences preferences =
                    context.getSharedPreferences("cst", Context.MODE_PRIVATE);
            String configuredBase = preferences.getString(KEY_CONFIG_BASE_URL, "");
            String applicationId = preferences.getString(KEY_FIREBASE_APPLICATION_ID, "");
            if (configuredBase != null
                    && !configuredBase.isEmpty()
                    && !configuredBase.equals(normalizedBaseUrl(context, preferences))) {
                return false;
            }
            FirebaseOptions active = FirebaseApp.getInstance().getOptions();
            return applicationId == null
                    || applicationId.isEmpty()
                    || applicationId.equals(active.getApplicationId());
        } catch (RuntimeException ignored) {
            return false;
        }
    }

    private static boolean initializeFirebaseFromPreferences(
            Context context,
            SharedPreferences preferences) {
        String baseUrl = preferences.getString(KEY_CONFIG_BASE_URL, "");
        String projectId = preferences.getString(KEY_FIREBASE_PROJECT_ID, "");
        String senderId = preferences.getString(KEY_FIREBASE_SENDER_ID, "");
        String packageName = preferences.getString(KEY_FIREBASE_PACKAGE_NAME, "");
        String applicationId = preferences.getString(KEY_FIREBASE_APPLICATION_ID, "");
        String apiKey = preferences.getString(KEY_FIREBASE_API_KEY, "");
        if (baseUrl == null
                || !baseUrl.equals(normalizedBaseUrl(context, preferences))
                || projectId == null
                || projectId.isEmpty()
                || senderId == null
                || senderId.isEmpty()
                || packageName == null
                || !packageName.equals(context.getPackageName())
                || applicationId == null
                || !applicationId.contains(":android:")
                || apiKey == null
                || !apiKey.startsWith("AIza")) {
            return false;
        }
        FirebaseOptions options = new FirebaseOptions.Builder()
                .setApiKey(apiKey)
                .setApplicationId(applicationId)
                .setProjectId(projectId)
                .setGcmSenderId(senderId)
                .build();
        FirebaseApp.initializeApp(context, options);
        return true;
    }

    private static boolean cacheAndInitializeConfiguration(
            Context context,
            JSONObject configuration) throws Exception {
        if (!configuration.optBoolean("androidConfigured", false)) {
            throw new Exception("Ajoute d'abord google-services.json.");
        }
        String projectId = configuration.optString("projectId", "").trim();
        String senderId = configuration.optString("senderId", "").trim();
        String packageName = configuration.optString("androidPackageName", "").trim();
        String applicationId = configuration.optString("androidApplicationId", "").trim();
        String apiKey = configuration.optString("androidApiKey", "").trim();
        if (projectId.isEmpty()
                || !senderId.matches("[0-9]{5,32}")
                || !packageName.equals(context.getPackageName())
                || !applicationId.startsWith("1:")
                || !applicationId.contains(":android:")
                || !apiKey.startsWith("AIza")) {
            throw new Exception("La configuration Android Firebase ne correspond pas a cette app.");
        }
        SharedPreferences preferences =
                context.getSharedPreferences("cst", Context.MODE_PRIVATE);
        preferences.edit()
                .putString(KEY_CONFIG_BASE_URL, normalizedBaseUrl(context, preferences))
                .putString(KEY_FIREBASE_PROJECT_ID, projectId)
                .putString(KEY_FIREBASE_SENDER_ID, senderId)
                .putString(KEY_FIREBASE_PACKAGE_NAME, packageName)
                .putString(KEY_FIREBASE_APPLICATION_ID, applicationId)
                .putString(KEY_FIREBASE_API_KEY, apiKey)
                .apply();
        if (!FirebaseApp.getApps(context).isEmpty()) {
            FirebaseOptions active = FirebaseApp.getInstance().getOptions();
            return applicationId.equals(active.getApplicationId())
                    && projectId.equals(active.getProjectId())
                    && senderId.equals(active.getGcmSenderId());
        }
        return initializeFirebaseFromPreferences(context, preferences);
    }

    private static void syncConfigurationFromServer(
            Activity activity,
            boolean activate,
            ConfigurationCallback callback) {
        synchronized (PaymentPushRegistration.class) {
            if (configurationSyncInFlight) {
                if (callback != null) {
                    callback.onComplete(null, "Chargement Firebase deja en cours.");
                }
                return;
            }
            configurationSyncInFlight = true;
        }
        new Thread(() -> {
            JSONObject configuration = null;
            String error = null;
            try {
                configuration = executeMobilePushRequest(activity, "/config", "GET", null);
            } catch (Exception requestError) {
                error = requestError.getMessage();
            }
            JSONObject result = configuration;
            String initialFailure = error;
            activity.runOnUiThread(() -> {
                String resolvedFailure = initialFailure;
                synchronized (PaymentPushRegistration.class) {
                    configurationSyncInFlight = false;
                }
                if (result != null) {
                    try {
                        if (activate && cacheAndInitializeConfiguration(activity, result)) {
                            completeInitialization(activity);
                        } else if (activate) {
                            resolvedFailure =
                                    "Configuration enregistree : redemarre l'app pour l'activer.";
                        }
                    } catch (Exception applyError) {
                        resolvedFailure = applyError.getMessage();
                    }
                }
                if (callback != null) {
                    callback.onComplete(result, resolvedFailure);
                }
            });
        }, "cst-mobile-push-config").start();
    }

    private static boolean canPostNotifications(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            return false;
        }
        NotificationManager manager =
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.N || manager.areNotificationsEnabled();
    }

    private static void requestFirebaseRegistration() {
        try {
            FirebaseMessaging.getInstance().setAutoInitEnabled(true);
            FirebaseMessaging.getInstance().register();
        } catch (RuntimeException ignored) {
            // Configuration absente ou Google Play Services indisponible.
        }
    }

    private static void unregisterFromServerAsync(
            String baseUrl,
            String adminToken,
            String localDeviceId) {
        if (baseUrl == null || baseUrl.isEmpty() || adminToken == null || adminToken.isEmpty()) {
            return;
        }
        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                connection = authenticatedConnection(
                        baseUrl + "/api/notifications/mobile-push/devices/" + localDeviceId,
                        "DELETE",
                        adminToken);
                connection.getResponseCode();
            } catch (Exception ignored) {
                // Un ancien serveur hors ligne supprimera le FID lorsqu'il deviendra invalide.
            } finally {
                if (connection != null) {
                    connection.disconnect();
                }
            }
        }, "cst-mobile-push-unregister").start();
    }

    private static HttpURLConnection authenticatedConnection(
            String endpoint,
            String method,
            String adminToken) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(endpoint).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        connection.setUseCaches(false);
        connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("Authorization", "Bearer " + adminToken);
        return connection;
    }

    private static JSONObject executeMobilePushRequest(
            Context context,
            String endpointSuffix,
            String method,
            JSONObject requestBody) throws Exception {
        if (!"/config".equals(endpointSuffix) && !"/test".equals(endpointSuffix)) {
            throw new Exception("Route de configuration mobile invalide.");
        }
        SharedPreferences preferences =
                context.getSharedPreferences("cst", Context.MODE_PRIVATE);
        String baseUrl = normalizedBaseUrl(context, preferences);
        String adminToken = new SecureTokenStore(preferences).read();
        if (baseUrl.isEmpty() || adminToken.isEmpty()) {
            throw new Exception("Configure d'abord l'URL HTTPS et le token admin.");
        }
        HttpURLConnection connection = null;
        try {
            connection = authenticatedConnection(
                    baseUrl + "/api/notifications/mobile-push" + endpointSuffix,
                    method,
                    adminToken);
            if (requestBody != null) {
                byte[] body = requestBody.toString().getBytes(StandardCharsets.UTF_8);
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                connection.setFixedLengthStreamingMode(body.length);
                connection.setDoOutput(true);
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(body);
                }
            }
            int status = connection.getResponseCode();
            String responseBody = readResponseBody(connection, status >= 400);
            if (status < 200 || status >= 300) {
                throw new Exception(configurationErrorMessage(responseBody, status));
            }
            return new JSONObject(responseBody);
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private static String readResponseBody(
            HttpURLConnection connection,
            boolean errorResponse) throws Exception {
        InputStream stream = errorResponse ? connection.getErrorStream() : connection.getInputStream();
        if (stream == null) {
            return "";
        }
        try (InputStream input = stream;
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int total = 0;
            int read;
            while ((read = input.read(buffer)) != -1) {
                total += read;
                if (total > MAX_CONFIGURATION_RESPONSE_BYTES) {
                    throw new Exception("Reponse Firebase trop volumineuse.");
                }
                output.write(buffer, 0, read);
            }
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }

    private static String configurationErrorMessage(String responseBody, int status) {
        try {
            JSONObject error = new JSONObject(responseBody).optJSONObject("error");
            if (error != null) {
                String message = error.optString("message", "").trim();
                if (!message.isEmpty()) {
                    return message;
                }
            }
        } catch (Exception ignored) {
            // Reponse non JSON : ne jamais la recopier car elle pourrait contenir un secret.
        }
        return "Le serveur a refuse la configuration Firebase (HTTP " + status + ").";
    }

    private static String normalizedBaseUrl(Context context, SharedPreferences preferences) {
        String value = preferences.getString("baseUrl", "");
        if (value == null || value.trim().isEmpty()) {
            value = context.getString(R.string.server_url);
        }
        String normalized = value.trim();
        while (normalized.endsWith("/")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        return normalized.startsWith("https://") ? normalized : "";
    }

    private static String deviceId(SharedPreferences preferences) {
        String current = safeUuid(preferences.getString(KEY_DEVICE_ID, ""));
        if (!current.isEmpty()) {
            return current;
        }
        String created = UUID.randomUUID().toString();
        preferences.edit().putString(KEY_DEVICE_ID, created).apply();
        return created;
    }

    private static String safeUuid(String value) {
        if (value == null) {
            return "";
        }
        try {
            return UUID.fromString(value.trim()).toString();
        } catch (IllegalArgumentException ignored) {
            return "";
        }
    }

    private static String safeFirebaseInstallationId(String value) {
        if (value == null) {
            return "";
        }
        String target = value.trim();
        if (target.length() < 10 || target.length() > 512) {
            return "";
        }
        for (int index = 0; index < target.length(); index++) {
            char character = target.charAt(index);
            if (character <= 0x20 || character >= 0x7f) {
                return "";
            }
        }
        return target;
    }

    private static String compact(String value, int maxLength, String fallback) {
        if (value == null) {
            return fallback;
        }
        String normalized = value.trim().replaceAll("\\s+", " ");
        if (normalized.isEmpty()) {
            return fallback;
        }
        return normalized.substring(0, Math.min(normalized.length(), maxLength));
    }

    private static String formatAmount(String rawAmountMinor, String rawCurrency) {
        try {
            long amountMinor = Long.parseLong(rawAmountMinor);
            Currency currency = Currency.getInstance(rawCurrency.trim().toUpperCase(Locale.ROOT));
            int digits = Math.max(0, currency.getDefaultFractionDigits());
            BigDecimal amount = BigDecimal.valueOf(amountMinor, digits);
            NumberFormat formatter = NumberFormat.getCurrencyInstance(Locale.getDefault());
            formatter.setCurrency(currency);
            return formatter.format(amount);
        } catch (Exception ignored) {
            return compact(rawAmountMinor, 24, "Montant") + " "
                    + compact(rawCurrency, 3, "");
        }
    }
}

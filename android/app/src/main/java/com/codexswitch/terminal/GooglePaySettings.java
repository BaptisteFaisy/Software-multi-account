package com.codexswitch.terminal;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import com.google.android.gms.wallet.IsReadyToPayRequest;
import com.google.android.gms.wallet.PaymentsClient;
import com.google.android.gms.wallet.Wallet;
import com.google.android.gms.wallet.WalletConstants;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Controle localement si Google Pay est pret, puis confie toute gestion du
 * compte et des cartes a l'interface officielle Google Wallet.
 */
final class GooglePaySettings {
    private static final String GOOGLE_WALLET_PACKAGE =
            "com.google.android.apps.walletnfcrel";
    private static final Uri GOOGLE_WALLET_URL = Uri.parse("https://wallet.google.com/");

    private GooglePaySettings() {}

    static void show(Activity activity) {
        if (activity.isFinishing()) {
            return;
        }

        LinearLayout content = new LinearLayout(activity);
        content.setOrientation(LinearLayout.VERTICAL);
        int horizontalPadding = dp(activity, 24);
        content.setPadding(horizontalPadding, dp(activity, 8), horizontalPadding, 0);

        TextView explanation = new TextView(activity);
        explanation.setText(R.string.google_pay_account_explanation);
        explanation.setTextSize(14);
        content.addView(explanation, matchWidthWrapHeight());

        TextView status = new TextView(activity);
        status.setText(R.string.google_pay_status_checking);
        status.setTextSize(15);
        LinearLayout.LayoutParams statusParams = matchWidthWrapHeight();
        statusParams.topMargin = dp(activity, 16);
        content.addView(status, statusParams);

        TextView privacy = new TextView(activity);
        privacy.setText(R.string.google_pay_account_privacy);
        privacy.setTextSize(12);
        LinearLayout.LayoutParams privacyParams = matchWidthWrapHeight();
        privacyParams.topMargin = dp(activity, 12);
        content.addView(privacy, privacyParams);

        AlertDialog dialog = new AlertDialog.Builder(activity)
                .setTitle(R.string.google_pay_account_title)
                .setView(content)
                .setNegativeButton(android.R.string.cancel, null)
                .setNeutralButton(R.string.google_pay_refresh, null)
                .setPositiveButton(R.string.google_pay_manage, null)
                .create();

        dialog.setOnShowListener(ignored -> {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(button ->
                    openGoogleWallet(activity));
            dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener(button ->
                    refreshStatus(activity, dialog, status));
            refreshStatus(activity, dialog, status);
        });
        dialog.show();
    }

    private static void refreshStatus(
            Activity activity,
            AlertDialog dialog,
            TextView status) {
        status.setText(R.string.google_pay_status_checking);
        dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setEnabled(false);

        final IsReadyToPayRequest request;
        try {
            request = IsReadyToPayRequest.fromJson(isReadyToPayRequest().toString());
        } catch (JSONException error) {
            status.setText(R.string.google_pay_status_error);
            dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setEnabled(true);
            return;
        }
        if (request == null) {
            status.setText(R.string.google_pay_status_error);
            dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setEnabled(true);
            return;
        }

        PaymentsClient paymentsClient = Wallet.getPaymentsClient(
                activity,
                new Wallet.WalletOptions.Builder()
                        .setEnvironment(WalletConstants.ENVIRONMENT_PRODUCTION)
                        .build());
        paymentsClient.isReadyToPay(request).addOnCompleteListener(activity, task -> {
            if (!dialog.isShowing()) {
                return;
            }
            if (task.isSuccessful()) {
                status.setText(Boolean.TRUE.equals(task.getResult())
                        ? R.string.google_pay_status_ready
                        : R.string.google_pay_status_setup_required);
            } else {
                status.setText(R.string.google_pay_status_error);
            }
            dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setEnabled(true);
        });
    }

    private static JSONObject isReadyToPayRequest() throws JSONException {
        JSONArray authenticationMethods = new JSONArray()
                .put("PAN_ONLY")
                .put("CRYPTOGRAM_3DS");
        JSONArray cardNetworks = new JSONArray()
                .put("AMEX")
                .put("DISCOVER")
                .put("INTERAC")
                .put("JCB")
                .put("MASTERCARD")
                .put("VISA");
        JSONObject cardParameters = new JSONObject()
                .put("allowedAuthMethods", authenticationMethods)
                .put("allowedCardNetworks", cardNetworks);
        JSONObject cardPaymentMethod = new JSONObject()
                .put("type", "CARD")
                .put("parameters", cardParameters);
        return new JSONObject()
                .put("apiVersion", 2)
                .put("apiVersionMinor", 0)
                .put("existingPaymentMethodRequired", true)
                .put("allowedPaymentMethods", new JSONArray().put(cardPaymentMethod));
    }

    private static void openGoogleWallet(Activity activity) {
        Intent walletIntent = activity.getPackageManager()
                .getLaunchIntentForPackage(GOOGLE_WALLET_PACKAGE);
        if (walletIntent == null) {
            walletIntent = new Intent(Intent.ACTION_VIEW, GOOGLE_WALLET_URL)
                    .addCategory(Intent.CATEGORY_BROWSABLE);
        }
        try {
            activity.startActivity(walletIntent);
        } catch (RuntimeException error) {
            Toast.makeText(activity, R.string.no_app_for_link, Toast.LENGTH_LONG).show();
        }
    }

    private static LinearLayout.LayoutParams matchWidthWrapHeight() {
        return new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    private static int dp(Activity activity, int value) {
        return Math.round(value * activity.getResources().getDisplayMetrics().density);
    }
}

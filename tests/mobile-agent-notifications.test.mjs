import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [main, platform, autonomous, mobilePush, activity, registration, strings, docs] =
  await Promise.all([
    read("src/main.ts"),
    read("src/platform.ts"),
    read("src-tauri/src/autonomous.rs"),
    read("src-tauri/src/mobile_push.rs"),
    read("android/app/src/main/java/com/codexswitch/terminal/MainActivity.java"),
    read("android/app/src/main/java/com/codexswitch/terminal/PaymentPushRegistration.java"),
    read("android/app/src/main/res/values/strings.xml"),
    read("android/README.md"),
  ]);

test("un agent peut activer les notifications de rapports dans l'app mobile", () => {
  assert.match(main, /id="autonomousMobileNotifications"/);
  assert.match(main, /data-autonomous-edit-field="mobileNotifications"/);
  assert.match(main, /mobileNotificationsEnabled: autonomousMobileNotifications/);
  assert.match(main, /mobileNotificationsEnabled: draft\.mobileNotificationsEnabled/);
  assert.match(autonomous, /pub mobile_notifications_enabled: bool/);
  assert.match(autonomous, /mobile_push::enqueue_agent_notification/);
});

test("le backend distingue rapports et alertes sans données de paiement", () => {
  assert.match(mobilePush, /"autonomous_agent_report"/);
  assert.match(mobilePush, /"autonomous_agent_alert"/);
  assert.match(mobilePush, /"notificationId": job\.notification_id/);
  assert.match(mobilePush, /"content": job\.content/);
  const agentPayload = mobilePush.match(
    /MobilePushNotificationJob::AutonomousAgent\(job\) => json!\(\{([\s\S]*?)\n\s*\}\),/,
  )?.[1] ?? "";
  assert.doesNotMatch(agentPayload, /paymentId|merchant|amountMinor|checkout/i);
});

test("Android affiche un canal privé et ouvre directement le bon agent", () => {
  assert.match(registration, /"autonomous_agent_report"\.equals\(type\)/);
  assert.match(registration, /"autonomous_agent_alert"\.equals\(type\)/);
  assert.match(registration, /ACTION_OPEN_AUTONOMOUS_AGENT/);
  assert.match(registration, /R\.string\.autonomous_notification_channel_id/);
  assert.match(registration, /Notification\.VISIBILITY_PRIVATE/);
  assert.match(activity, /public String consumeAutonomousAgentHandoff\(\)/);
  assert.match(activity, /__cstAutonomousAgentHandoffReady/);
  assert.match(activity, /cst:autonomous-agent-handoff/);
  assert.match(platform, /installMobileAutonomousAgentHandoffListener/);
  assert.match(main, /openMobileAutonomousAgentHandoff/);
  assert.match(strings, /<string name="autonomous_notification_channel_id"/);
  assert.match(docs, /Notifications dans l'app\s+mobile/i);
});

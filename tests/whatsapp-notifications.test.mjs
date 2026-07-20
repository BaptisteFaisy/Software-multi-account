import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [main, platform, backend, autonomous, server, docs] = await Promise.all([
  readFile(new URL("../src/main.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/platform.ts", import.meta.url), "utf8"),
  readFile(new URL("../src-tauri/src/whatsapp_notifications.rs", import.meta.url), "utf8"),
  readFile(new URL("../src-tauri/src/autonomous.rs", import.meta.url), "utf8"),
  readFile(new URL("../src-tauri/src/server.rs", import.meta.url), "utf8"),
  readFile(new URL("../docs/whatsapp-notifications.md", import.meta.url), "utf8"),
]);

test("les paramètres proposent une vraie liaison WhatsApp Business", () => {
  assert.match(main, /id="whatsappConnectionSettings"/);
  assert.match(main, /id="whatsappConnectForm"/);
  assert.match(main, /data-whatsapp-draft="accessToken"/);
  assert.match(main, /data-whatsapp-draft="appSecret"/);
  assert.match(main, /data-whatsapp-draft="phoneNumberId"/);
  assert.match(main, /data-whatsapp-draft="recipientPhoneNumber"/);
  assert.match(main, /invoke<WhatsAppConnectionView>\("connect_whatsapp"/);
  assert.match(main, /invoke<WhatsAppSendResult>\("test_whatsapp"/);
});

test("la création et l’édition d’un agent transportent le canal WhatsApp", () => {
  assert.match(main, /id="autonomousWhatsAppNotifications"/);
  assert.match(main, /whatsappNotificationChannelId: autonomousWhatsAppNotifications/);
  assert.match(main, /data-autonomous-edit-field="whatsappNotifications"/);
  assert.match(autonomous, /pub whatsapp_notification_channel_id: Option<String>/);
  assert.match(autonomous, /enqueue_agent_notification\([\s\S]*?channel_id,[\s\S]*?agent_id,[\s\S]*?agent_name,[\s\S]*?content/);
});

test("le mode web route la liaison, le test et la déconnexion vers le serveur", () => {
  assert.match(platform, /case "whatsapp_connection":\s*return api<T>\("GET", "\/api\/notifications\/whatsapp"\)/);
  assert.match(platform, /case "connect_whatsapp":\s*return api<T>\("POST", "\/api\/notifications\/whatsapp", args\.request\)/);
  assert.match(platform, /case "disconnect_whatsapp":\s*return api<T>\("DELETE", "\/api\/notifications\/whatsapp"\)/);
  assert.match(platform, /case "test_whatsapp":\s*return api<T>\("POST", "\/api\/notifications\/whatsapp\/test"\)/);
  assert.match(server, /"\/notifications\/whatsapp"/);
  assert.match(server, /"\/notifications\/whatsapp\/webhook"/);
  assert.match(server, /validate_channel_for_owner/);
});

test("le backend ne remet jamais le jeton ou le numéro complet dans la vue publique", () => {
  const viewStart = backend.indexOf("pub struct WhatsAppConnectionView");
  const requestStart = backend.indexOf("pub struct ConnectWhatsAppRequest");
  assert.ok(viewStart >= 0 && requestStart > viewStart);
  const publicView = backend.slice(viewStart, requestStart);
  assert.doesNotMatch(publicView, /access_token/);
  assert.doesNotMatch(publicView, /app_secret/);
  assert.doesNotMatch(publicView, /recipient_phone_number/);
  assert.match(backend, /fs::Permissions::from_mode\(0o600\)/);
  assert.match(backend, /\.replace\(access_token, "\*\*\*"\)/);
});

test("l’envoi suit le contrat Cloud API et documente la règle des 24 heures", () => {
  assert.match(backend, /"messaging_product": "whatsapp"/);
  assert.match(backend, /"recipient_type": "individual"/);
  assert.match(backend, /"type": "template"/);
  assert.match(backend, /GRAPH_API_VERSION/);
  assert.match(docs, /fenêtre de conversation de 24 heures/i);
  assert.match(docs, /\{\{1\}\}/);
  assert.match(docs, /WhatsApp Business Cloud/);
});

test("le webhook entrant est signé, dédupliqué et limité au numéro autorisé", () => {
  assert.match(backend, /Hmac::<Sha256>/);
  assert.match(server, /x-hub-signature-256/i);
  assert.match(backend, /recent_inbound_message_ids/);
  assert.match(backend, /sender != authorized_sender/);
  assert.match(server, /verify_and_extract_webhook_messages/);
  assert.match(server, /api_receive_whatsapp_webhook/);
  assert.match(docs, /X-Hub-Signature-256/);
});

test("un message WhatsApp est routé vers l’agent puis reçoit une réponse", () => {
  assert.match(autonomous, /receive_whatsapp_message/);
  assert.match(autonomous, /agent_target_for_outbound_message/);
  assert.match(autonomous, /AutonomousAgentMessageMode::Guidance/);
  assert.match(backend, /send_conversation_reply/);
  assert.match(main, /Parler aux agents depuis WhatsApp/);
  assert.match(main, /data-whatsapp-copy-webhook="token"/);
  assert.match(docs, /@NomAgent ton message/);
});

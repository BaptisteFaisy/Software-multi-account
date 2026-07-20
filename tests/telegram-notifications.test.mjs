import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [main, platform, backend, autonomous, server, docs] = await Promise.all([
  readFile(new URL("../src/main.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/platform.ts", import.meta.url), "utf8"),
  readFile(new URL("../src-tauri/src/telegram_notifications.rs", import.meta.url), "utf8"),
  readFile(new URL("../src-tauri/src/autonomous.rs", import.meta.url), "utf8"),
  readFile(new URL("../src-tauri/src/server.rs", import.meta.url), "utf8"),
  readFile(new URL("../docs/telegram-agents.md", import.meta.url), "utf8"),
]);

test("les paramètres proposent Telegram gratuitement avec un appairage BotFather", () => {
  assert.match(main, /id="telegramConnectionSettings"/);
  assert.match(main, /id="telegramConnectForm"/);
  assert.match(main, /data-telegram-draft="botToken"/);
  assert.match(main, /Recommandé · Gratuit/);
  assert.match(main, /id="telegramPairingOpen"/);
  assert.match(main, /invoke<TelegramConnectionView>\("connect_telegram"/);
  assert.match(docs, /sans compte Business, abonnement, numéro destinataire/i);
});

test("le parcours Managed Bots automatise la récupération du bot enfant", () => {
  assert.match(main, /id="telegramManagerConnectForm"/);
  assert.match(main, /Bot Management Mode/);
  assert.match(main, /id="telegramManagedBotPrepareForm"/);
  assert.match(main, /id="telegramManagedBotCreateOpen"/);
  assert.match(main, /invoke<TelegramManagerView>\("connect_telegram_manager"/);
  assert.match(main, /invoke<TelegramManagerView>\("prepare_managed_telegram_bot"/);
  assert.match(backend, /can_manage_bots/);
  assert.match(backend, /"allowed_updates": \["managed_bot"\]/);
  assert.match(backend, /"getManagedBotToken"/);
  assert.match(backend, /"setManagedBotAccessSettings"/);
  assert.match(backend, /required_pairing_user_id/);
  assert.match(docs, /bots gestionnaires/i);
  assert.match(docs, /ce clic reste donc obligatoire/i);
});

test("la création et l’édition d’un agent transportent le canal Telegram", () => {
  assert.match(main, /id="autonomousTelegramNotifications"/);
  assert.match(main, /telegramNotificationChannelId: autonomousTelegramNotifications/);
  assert.match(main, /data-autonomous-edit-field="telegramNotifications"/);
  assert.match(autonomous, /pub telegram_notification_channel_id: Option<String>/);
  assert.match(autonomous, /telegram_notifications::enqueue_agent_notification/);
});

test("desktop et web exposent la connexion, l’appairage, le test et la déconnexion", () => {
  assert.match(platform, /case "telegram_connection":\s*return api<T>\("GET", "\/api\/notifications\/telegram"\)/);
  assert.match(platform, /case "connect_telegram":\s*return api<T>\("POST", "\/api\/notifications\/telegram", args\.request\)/);
  assert.match(platform, /case "refresh_telegram_pairing":\s*return api<T>\("POST", "\/api\/notifications\/telegram\/pairing"\)/);
  assert.match(platform, /case "disconnect_telegram":\s*return api<T>\("DELETE", "\/api\/notifications\/telegram"\)/);
  assert.match(platform, /case "test_telegram":\s*return api<T>\("POST", "\/api\/notifications\/telegram\/test"\)/);
  assert.match(platform, /case "telegram_manager":\s*return api<T>\("GET", "\/api\/notifications\/telegram\/manager"\)/);
  assert.match(platform, /case "connect_telegram_manager":\s*return api<T>\("POST", "\/api\/notifications\/telegram\/manager", args\.request\)/);
  assert.match(platform, /case "prepare_managed_telegram_bot":\s*return api<T>\("POST", "\/api\/notifications\/telegram\/manager\/prepare", args\.request\)/);
  assert.match(platform, /case "disconnect_telegram_manager":\s*return api<T>\("DELETE", "\/api\/notifications\/telegram\/manager"\)/);
  assert.match(server, /"\/notifications\/telegram"/);
  assert.match(server, /"\/notifications\/telegram\/pairing"/);
  assert.match(server, /"\/notifications\/telegram\/manager"/);
  assert.match(server, /"\/notifications\/telegram\/manager\/prepare"/);
  assert.match(server, /telegram_notifications::validate_channel_for_owner/);
});

test("la vue publique ne révèle ni jeton, ni chat id, ni numéro", () => {
  const viewStart = backend.indexOf("pub struct TelegramConnectionView");
  const requestStart = backend.indexOf("pub struct ConnectTelegramRequest");
  assert.ok(viewStart >= 0 && requestStart > viewStart);
  const publicView = backend.slice(viewStart, requestStart);
  assert.doesNotMatch(publicView, /bot_token/);
  assert.doesNotMatch(publicView, /chat_id/);
  const managerViewStart = backend.indexOf("pub struct TelegramManagerView");
  const managerRequestStart = backend.indexOf("pub struct ConnectTelegramManagerRequest");
  assert.ok(managerViewStart >= 0 && managerRequestStart > managerViewStart);
  const publicManagerView = backend.slice(managerViewStart, managerRequestStart);
  assert.doesNotMatch(publicManagerView, /bot_token/);
  assert.doesNotMatch(publicManagerView, /bot_id/);
  assert.doesNotMatch(publicManagerView, /user_id/);
  assert.match(backend, /fs::Permissions::from_mode\(0o600\)/);
  assert.match(backend, /\.replace\(bot_token, "\*\*\*"\)/);
  assert.match(docs, /Aucun numéro de téléphone n’est demandé ni enregistré/);
});

test("le backend utilise uniquement les méthodes officielles de la Bot API", () => {
  assert.match(backend, /"getMe"/);
  assert.match(backend, /"getWebhookInfo"/);
  assert.match(backend, /"getUpdates"/);
  assert.match(backend, /"sendMessage"/);
  assert.match(backend, /"getManagedBotToken"/);
  assert.match(backend, /"setManagedBotAccessSettings"/);
  assert.match(backend, /"timeout": 25/);
  assert.match(docs, /long polling officiel `getUpdates`/);
  assert.match(docs, /bot possède déjà un webhook/);
});

test("les messages entrants sont appairés, persistés et dédupliqués", () => {
  assert.match(backend, /PAIRING_TTL_SECONDS/);
  assert.match(backend, /constant_time_eq/);
  assert.match(backend, /recent_inbound_message_ids/);
  assert.match(backend, /next_update_offset = Some\(update_id\.saturating_add\(1\)\)/);
  assert.match(backend, /connection\.chat_id == Some\(chat_id\)/);
  assert.match(backend, /connection\.telegram_user_id == Some\(user_id\)/);
});

test("une réponse Telegram retrouve le bon agent et accepte une sélection explicite", () => {
  assert.match(autonomous, /receive_telegram_message/);
  assert.match(backend, /agent_target_for_outbound_message/);
  assert.match(autonomous, /AutonomousAgentMessageMode::Guidance/);
  assert.match(autonomous, /"\/agents"/);
  assert.match(autonomous, /normalized\.starts_with\("\/agent "\)/);
  assert.match(docs, /Une réponse directe à un compte rendu est routée vers l’agent/);
});

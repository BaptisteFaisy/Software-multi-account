import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

const backend = source("../src-tauri/src/tiktok_messaging.rs");
const server = source("../src-tauri/src/server.rs");
const tools = source("../src-tauri/src/chat_model_tools.rs");
const chat = source("../src-tauri/src/chat.rs");
const desktop = source("../src-tauri/src/lib.rs");
const platform = source("../src/platform.ts");

test("le chat VPS expose le flux TikTok prepare, confirme et suivi", () => {
  assert.match(tools, /LIST_TIKTOK_DM_CAMPAIGNS_TOOL_NAME/);
  assert.match(tools, /PREPARE_TIKTOK_DM_CAMPAIGN_TOOL_NAME/);
  assert.match(tools, /SEND_TIKTOK_DM_CAMPAIGN_TOOL_NAME/);
  assert.match(tools, /"maxItems": 5/);
  assert.match(tools, /"ownedAccountsConfirmed"/);
  assert.match(tools, /"sendConfirmed"/);
  assert.match(server, /"\/tiktok\/dm-campaigns"/);
  assert.match(server, /api_prepare_tiktok_dm_campaign/);
  assert.match(server, /api_confirm_tiktok_dm_campaign/);
  assert.match(chat, /enabled_tools=\[[^\n]*\{PREPARE_TIKTOK_DM_CAMPAIGN_TOOL_NAME\}/);
  assert.match(chat, /tools\.\{SEND_TIKTOK_DM_CAMPAIGN_TOOL_NAME\}\.approval_mode/);
  assert.match(chat, /mcp__\{MCP_SERVER_NAME\}__\{SEND_TIKTOK_DM_CAMPAIGN_TOOL_NAME\}/);
  assert.match(platform, /case "prepare_tiktok_dm_campaign"/);
  assert.match(platform, /case "confirm_tiktok_dm_campaign"/);
  assert.match(tools, /"extract_tiktok_followers"/);
  assert.match(tools, /"maximum": 1000/);
  assert.match(tools, /"default": 1000/);
  assert.match(tools, /"authorizedAccountConfirmed"/);
  assert.match(tools, /"dmPipeline"/);
  assert.match(tools, /"ownedRecipientAllowlist"/);
  assert.match(tools, /"ownedAccountsConfirmed"/);
  assert.match(tools, /"maxItems": 5/);
  assert.match(server, /"\/tiktok\/follower-extractions"/);
  assert.match(server, /api_queue_tiktok_follower_extraction/);
  assert.match(platform, /case "queue_tiktok_follower_extraction"/);
});

test("le connecteur reste sortant et TikMatrix demeure sur le loopback Windows", () => {
  assert.match(desktop, /run_tiktok_connector\(\)/);
  assert.match(backend, /CST_CLIENT_BASE_URL|client_startup_config/);
  assert.match(backend, /http:\/\/127\.0\.0\.1:\{port\}/);
  assert.match(backend, /\/api\/tiktok\/connector\/jobs\/claim/);
  assert.match(backend, /\/api\/message_now/);
  assert.match(backend, /\/api\/scrape_now/);
  assert.match(backend, /scrape_users_settings\.json/);
  assert.match(backend, /exported_users_/);
  assert.match(backend, /mass_dm_settings\.json/);
  assert.match(backend, /cst-dm-campaigns/);
  assert.doesNotMatch(backend, /0\.0\.0\.0:50809/);
});

test("les confirmations, leases et recus locaux empechent les envois implicites ou doubles", () => {
  assert.match(backend, /MAX_TIKTOK_DM_RECIPIENTS: usize = 5/);
  assert.match(backend, /MAX_TIKTOK_FOLLOWER_RESULTS: usize = 1_000/);
  assert.match(backend, /scrape_to_dm_pipeline/);
  assert.match(backend, /prepared_campaign_id/);
  assert.match(backend, /CLAIM_LEASE_SECONDS: i64 = 120/);
  assert.match(backend, /owned_accounts_confirmed/);
  assert.match(backend, /send_confirmed/);
  assert.match(backend, /tiktok-connector-receipts\.json/);
  assert.match(backend, /load_local_receipts/);
  assert.match(backend, /persist_local_receipts/);
  assert.match(backend, /idempotency_key/);
});

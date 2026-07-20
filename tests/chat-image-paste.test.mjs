import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const attachments = readFileSync(
  new URL("../src/chat/image-attachments.ts", import.meta.url),
  "utf8",
);
const view = readFileSync(new URL("../src/chat/view.ts", import.meta.url), "utf8");
const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const style = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
const platform = readFileSync(new URL("../src/platform.ts", import.meta.url), "utf8");
const backend = readFileSync(new URL("../src-tauri/src/chat.rs", import.meta.url), "utf8");
const server = readFileSync(new URL("../src-tauri/src/server.rs", import.meta.url), "utf8");

test("une image du presse-papiers devient une piece jointe avec apercu supprimable", () => {
  assert.match(attachments, /clipboard\.items/);
  assert.match(attachments, /item\.kind === "file"/);
  assert.match(attachments, /readAsDataURL\(file\)/);
  assert.match(attachments, /URL\.createObjectURL\(file\)/);
  assert.match(attachments, /MAX_CHAT_IMAGE_ATTACHMENTS = 4/);
  assert.match(attachments, /MAX_CHAT_IMAGE_TOTAL_BYTES = 20 \* 1024 \* 1024/);

  assert.match(view, /data-chat-control="image-attachments"/);
  assert.match(view, /data-chat-action="remove-image"/);
  assert.match(view, /renderChatImageAttachments\(model\.imageAttachments\)/);
  assert.match(style, /\.chat-image-attachment img/);
});

test("le collage fonctionne dans le chat principal et chaque panneau expert", () => {
  assert.match(main, /chatPrompt\?\.addEventListener\("paste"/);
  assert.match(main, /prompt\?\.addEventListener\("paste"/);
  assert.match(main, /attachPastedChatImages\(event, mainImageAttachmentBinding\)/);
  assert.match(main, /attachPastedChatImages\(event, imageAttachmentBinding\)/);
  assert.match(main, /event\.preventDefault\(\)/);
  assert.match(main, /IMAGE_ONLY_CHAT_PROMPT = "Image jointe\."/);
});

test("les images suivent les messages mis en attente et les reprises automatiques", () => {
  assert.match(main, /type QueuedChatSubmission = \{\s*prompt: string;\s*imageAttachments:/);
  assert.match(main, /imageAttachments: \[\.\.\.draftImageAttachments\]/);
  assert.match(main, /chatImageAttachmentPayloads\(submission\.imageAttachments\)/);
  assert.match(platform, /imageAttachments,/);
});

test("le serveur valide les images et Codex les recoit via son option native", () => {
  assert.match(backend, /struct TemporaryChatImages/);
  assert.match(backend, /validated_chat_image_extension/);
  assert.match(backend, /command\.arg\("--image"\)\.arg\(path\)/);
  assert.match(backend, /let _image_files = image_files/);
  assert.match(server, /DefaultBodyLimit::max\(MAX_CHAT_TURN_REQUEST_BYTES\)/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  chatMessagesEqual,
  chatTurnIsBusy,
  conversationWaitsForUser,
  formatChatDuration,
  formatChatResetCountdown,
  groupConsecutiveCommandParts,
  reconcileChatMessages,
} from "../src/chat/runtime.ts";

const view = readFileSync(new URL("../src/chat/view.ts", import.meta.url), "utf8");
const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const platform = readFileSync(new URL("../src/platform.ts", import.meta.url), "utf8");
const style = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
const chatBackend = readFileSync(new URL("../src-tauri/src/chat.rs", import.meta.url), "utf8");

test("un transcript en retard ne retire jamais le dernier message envoye", () => {
  const persisted = [
    { role: "user", text: "Premier message", timestamp: 100 },
    { role: "assistant", text: "Premiere reponse", timestamp: 101 },
  ];
  const optimistic = {
    role: "user",
    text: "Continue",
    timestamp: 200,
    deliveryState: "pending",
  };

  assert.deepEqual(
    reconcileChatMessages([...persisted, optimistic], persisted, true),
    [...persisted, optimistic],
  );

  const latestAssistant = {
    role: "assistant",
    text: "La reponse vient de se terminer.",
    timestamp: 202,
  };
  assert.deepEqual(
    reconcileChatMessages([...persisted, latestAssistant], persisted, true),
    [...persisted, latestAssistant],
  );
});

test("le badge optimiste disparait quand le serveur a persiste le message", () => {
  const pending = [{ role: "user", text: "Continue", timestamp: 200, deliveryState: "pending" }];
  const server = [{ role: "user", text: "Continue", timestamp: 201 }];
  const merged = reconcileChatMessages(pending, server, true);

  assert.equal(chatMessagesEqual(merged, server), true);
  assert.equal(merged[0].deliveryState, undefined);
});

test("un message utilisateur en attente ne recoit pas de cadre pointille", () => {
  // `chat-user-message` partage la classe d'etat `chat-msg--pending` sans avoir
  // de bordure. Un selecteur generique sur cette classe faisait donc apparaitre
  // la bordure `medium` blanche par defaut du navigateur autour de tout le tour.
  assert.doesNotMatch(style, /\.chat-app-layout \.chat-msg--pending\s*\{/);
  assert.match(style, /\.chat-app-layout \.chat-msg\.chat-msg--pending\s*\{/);
});

test("une question finale place clairement le chat en attente de l'utilisateur", () => {
  assert.equal(
    conversationWaitsForUser([
      { role: "assistant", text: "Quel environnement voulez-vous utiliser ?", timestamp: 1 },
    ]),
    true,
  );
  assert.equal(
    conversationWaitsForUser([
      { role: "assistant", text: "La correction est terminee.", timestamp: 1 },
    ]),
    false,
  );
});

test("la reponse finale sort du mode anime pendant la synchronisation", () => {
  assert.equal(chatTurnIsBusy("running"), true);
  assert.equal(chatTurnIsBusy("finalizing"), true);
  assert.equal(chatTurnIsBusy("completed"), false);
  assert.match(view, /model\.turnStatus === "finalizing"/);
  assert.match(view, /Réponse terminée, synchronisation en cours/);
  assert.match(main, /snapshot\.status === "finalizing"/);
  assert.match(chatBackend, /event_type == "turn\.completed"/);
  assert.match(chatBackend, /provider == Provider::Claude && event_type == "result"/);
  assert.match(chatBackend, /PROVIDER_EXIT_GRACE/);
});

test("les durees et resets sont lisibles pendant un long tour", () => {
  assert.equal(formatChatDuration(9), "9 s");
  assert.equal(formatChatDuration(65), "1 min 05 s");
  assert.equal(formatChatDuration(3720), "1 h 02 min");
  assert.equal(formatChatResetCountdown(10_000, 6_400), "dans 1 h");
});

test("le chat expose le chronometre, le quota et le dock de question", () => {
  assert.match(view, /data-chat-control="runtime"/);
  assert.match(view, /data-chat-elapsed/);
  assert.match(view, /data-chat-elapsed-value/);
  assert.match(view, /Temps écoulé depuis le début du tour/);
  assert.match(view, /Quota épuisé/);
  assert.match(view, /Votre réponse est attendue/);
  assert.match(view, /structuredWaiting \? "focus-question" : "focus-prompt"/);
  assert.match(main, /activeView === "limits" \|\| activeView === "chat"/);
  assert.match(main, /startedAt: Math\.floor\(Date\.now\(\) \/ 1000\)/);
  assert.match(main, /startedAt: Math\.min\(previousStartedAt, snapshot\.startedAt\)/);
  assert.equal(
    (main.match(/startedAt: Math\.min\(optimisticStartedAt, snapshot\.startedAt\)/g) ?? []).length,
    3,
  );
  assert.match(main, /reconcileChatMessages\(/);
});

test("le bandeau du chat indique en couleur si le tour est en cours", () => {
  assert.match(view, /data-chat-control="turn-status"/);
  assert.match(view, /finalizing \? "Terminé" : "Disponible"/);
  assert.match(view, /chat-turn-status--\$\{state\}/);
  assert.match(style, /\.chat-turn-status--running \{[\s\S]*?background: #f59e0b;/);
  assert.match(style, /\.chat-turn-status--finalizing \{[\s\S]*?background: #22c55e;/);
  assert.match(main, /\[data-chat-control='turn-status'\]/);
});

test("une question structuree suspend le tour et propose choix plus reponse libre", () => {
  assert.match(view, /data-chat-control="question"/);
  assert.match(view, /Le même tour reprendra/);
  assert.match(view, /question\.options\.map/);
  assert.match(view, /data-question-custom/);
  assert.match(view, /data-chat-action="answer-question"/);
  assert.match(view, /model\.pendingQuestion \? "is-question-pending"/);
  assert.match(view, /turnStatus === "running" && !pendingQuestion/);
  assert.match(style, /\.chat-composer\.is-question-pending \{ display: none; \}/);
  assert.match(main, /answerStructuredChatQuestion/);
  assert.match(main, /collectChatQuestionAnswers/);
  assert.match(platform, /answer_chat_question/);
  assert.match(platform, /questions\/\$\{encodeURIComponent\(String\(args\.questionId\)\)\}\/answer/);
});

test("la pensee visible diffuse les resumes sans exposer le raisonnement brut", () => {
  assert.match(view, /data-component="reasoning-part"/);
  assert.match(view, /chat-reasoning-markdown/);
  assert.match(main, /parts: chatTurn\?\.parts \?\? \[\]/);
  assert.match(main, /parts: pane\.turn\?\.parts \?\? \[\]/);
  assert.match(style, /\.chat-reasoning-part/);
  assert.match(chatBackend, /hide_agent_reasoning=false/);
  assert.match(chatBackend, /show_raw_agent_reasoning=false/);
  assert.doesNotMatch(chatBackend, /get\("encrypted_content"\)/);
});

test("le chat suit la timeline OpenCode au lieu de separer pensee et outils", () => {
  assert.match(view, /data-component="message-timeline"/);
  assert.match(view, /data-component="session-turn"/);
  assert.match(view, /data-component="reasoning-part"/);
  assert.match(view, /data-component="tool-part"/);
  assert.match(view, /data-component="text-part"/);
  assert.match(view, /data-component="thinking-row"/);
  assert.match(view, /groupMessagesIntoTurns/);
  assert.match(view, /renderOpenCodeParts\(model\.parts/);
  assert.match(main, /parts: chatTurn\?\.parts \?\? \[\]/);
  assert.match(main, /parts: pane\.turn\?\.parts \?\? \[\]/);
  assert.match(style, /Timeline de chat portee du modele OpenCode/);
  assert.match(style, /\.chat-user-bubble/);
  assert.doesNotMatch(
    view,
    /data-component="user-message"[^\n]*chat-msg--question/,
    "le conteneur utilisateur ne doit pas recevoir le style de question pleine largeur",
  );
  assert.match(style, /\.chat-thinking-shimmer/);
  assert.match(chatBackend, /pub struct ChatPart/);
  assert.match(chatBackend, /upsert_part/);
});

test("les commandes consecutives sont regroupees dans une seule liste depliante", () => {
  const command = (id) => ({
    id,
    kind: "tool",
    tool: "command",
    status: "complete",
    title: "Commande executee",
    detail: `npm run ${id}`,
  });
  const textPart = { id: "text", kind: "text", status: "complete", text: "Etape suivante" };
  const groups = groupConsecutiveCommandParts([
    command("lint"),
    command("test"),
    textPart,
    command("build"),
    command("preview"),
  ]);

  assert.deepEqual(groups.map((group) => group.map((part) => part.id)), [
    ["lint", "test"],
    ["text"],
    ["build", "preview"],
  ]);
  assert.match(view, /data-tool-kind="command-group"/);
  assert.match(view, /Commandes exécutées/);
  assert.match(view, /<ol class="chat-command-list">/);
  assert.match(style, /\.chat-command-list/);
});

test("le bouton d'envoi OpenCode reste sombre et conserve son icone", () => {
  assert.match(main, /ArrowUp/);
  assert.match(main, /MessageCircleQuestion/);
  assert.match(style, /\.chat-app-layout \.chat-send \{[\s\S]*?appearance: none;/);
  assert.match(style, /\.chat-app-layout \.chat-send \{[\s\S]*?background: rgba\(255, 255, 255, 0\.08\);/);
  assert.doesNotMatch(style, /\.chat-app-layout \.chat-send \{[\s\S]*?linear-gradient\(180deg, #f1f1f1/);
});

test("une mise a jour d'outil dans un transcript declenche le rafraichissement", () => {
  const before = [{
    role: "assistant",
    text: "Je verifie.",
    timestamp: 10,
    parts: [{ id: "tool-1", kind: "tool", status: "running", title: "Tests" }],
  }];
  const after = [{
    ...before[0],
    parts: [{ id: "tool-1", kind: "tool", status: "complete", title: "Tests", output: "OK" }],
  }];
  assert.equal(chatMessagesEqual(before, after), false);
});

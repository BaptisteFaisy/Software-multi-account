import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CHAT_READY_SOUND_MAX_DURATION_SECONDS,
  CHAT_READY_SOUND_STORAGE_KEY,
  chatBecameAvailable,
  chatReadySoundDurationError,
  isMp3File,
  loadChatReadySoundPreferences,
  normalizeChatReadySoundPreferences,
  persistChatReadySoundPreferences,
} from "../src/chat/ready-sound.ts";

const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const readySound = readFileSync(new URL("../src/chat/ready-sound.ts", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

test("la notification est desactivee par defaut et persiste sur l'appareil", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };

  assert.equal(loadChatReadySoundPreferences(storage).enabled, false);
  assert.equal(persistChatReadySoundPreferences({
    enabled: true,
    customSoundDataUrl: null,
    customSoundName: null,
    customSoundDuration: null,
  }, storage), true);
  assert.equal(JSON.parse(values.get(CHAT_READY_SOUND_STORAGE_KEY)).enabled, true);
  assert.equal(loadChatReadySoundPreferences(storage).enabled, true);
  assert.equal(loadChatReadySoundPreferences({ getItem: () => { throw new Error("bloque"); } }).enabled, false);
});

test("seule la transition en cours vers disponible declenche le son", () => {
  assert.equal(chatBecameAvailable("running", "completed"), true);
  assert.equal(chatBecameAvailable("finalizing", "failed"), true);
  assert.equal(chatBecameAvailable("running", "finalizing"), false);
  assert.equal(chatBecameAvailable("completed", "completed"), false);
  assert.equal(chatBecameAvailable(undefined, "completed"), false);

  assert.equal((main.match(/chatBecameAvailable\(previousStatus, snapshot\.status\)/g) ?? []).length, 2);
  assert.match(main, /playChatReadySound\(chatReadySoundPreferences\)/);
});

test("l'import accepte les MP3 de cinq secondes maximum", () => {
  assert.equal(CHAT_READY_SOUND_MAX_DURATION_SECONDS, 5);
  assert.equal(isMp3File({ name: "notification.mp3", type: "" }), true);
  assert.equal(isMp3File({ name: "notification", type: "audio/mpeg" }), true);
  assert.equal(isMp3File({ name: "notification.wav", type: "audio/wav" }), false);
  assert.equal(chatReadySoundDurationError(5), null);
  assert.match(chatReadySoundDurationError(5.01), /durée maximale est de 5 s/);
  assert.match(chatReadySoundDurationError(Number.NaN), /Impossible de lire/);

  const invalid = normalizeChatReadySoundPreferences({
    enabled: true,
    customSoundDataUrl: "data:text/html,non",
    customSoundName: "non.mp3",
    customSoundDuration: 2,
  });
  assert.equal(invalid.customSoundDataUrl, null);
  assert.equal(invalid.customSoundName, null);
});

test("les options proposent un son doux, un apercu et un MP3 personnalisable", () => {
  assert.match(main, /id="chatReadySoundEnabled"/);
  assert.match(main, /id="chatReadySoundPreview"/);
  assert.match(main, /accept="\.mp3,audio\/mpeg,audio\/mp3"/);
  assert.match(main, /durée maximale de 5 secondes/);
  assert.match(main, /Le fichier reste sur cet appareil/);
  assert.match(readySound, /oscillator\.type = "sine"/);
  assert.match(readySound, /523\.25/);
  assert.match(styles, /\.chat-ready-sound-toggle input:checked/);
});

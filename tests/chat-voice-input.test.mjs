import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const view = readFileSync(new URL("../src/chat/view.ts", import.meta.url), "utf8");
const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const voice = readFileSync(new URL("../src/chat/voice.ts", import.meta.url), "utf8");
const platform = readFileSync(new URL("../src/platform.ts", import.meta.url), "utf8");
const backend = readFileSync(new URL("../src-tauri/src/voice.rs", import.meta.url), "utf8");
const rustLib = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
const server = readFileSync(new URL("../src-tauri/src/server.rs", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
const setup = readFileSync(new URL("../scripts/setup-local-voice.ps1", import.meta.url), "utf8");
const remoteSetup = readFileSync(new URL("../scripts/configure-remote-voice.ps1", import.meta.url), "utf8");
const remoteGuide = readFileSync(new URL("../docs/remote-voice-gpu.md", import.meta.url), "utf8");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("le compositeur principal et les multi-chats exposent le meme bouton vocal", () => {
  assert.match(view, /data-chat-action="voice"/);
  assert.match(view, /data-chat-control="voice-status"/);
  assert.match(view, /id="\$\{id\("chatVoice"\)\}"/);
  assert.match(main, /bindVoiceComposer\(root\)/);
  assert.match(main, /bindVoiceComposer\(mainChatPanel\)/);
});

test("la capture produit un WAV 16 kHz et reste bornee a cinq minutes", () => {
  assert.match(voice, /TARGET_SAMPLE_RATE = 16_000/);
  assert.match(voice, /MAX_RECORDING_MS = 5 \* 60 \* 1_000/);
  assert.match(voice, /writeAscii\(view, 0, "RIFF"\)/);
  assert.match(voice, /channelCount: 1/);
});

test("le resume vocal est insere pour relecture sans envoi automatique", () => {
  assert.match(voice, /invoke<VoiceProcessResponse>\("process_voice_input"/);
  assert.match(voice, /insertVoiceText\(prompt, result\.summary \|\| result\.transcript\)/);
  assert.doesNotMatch(voice, /sendChatMessage|sendExpertChatMessage|requestSubmit/);
});

test("le mode distant route aussi la voix vers la machine GPU", () => {
  assert.match(platform, /case "process_voice_input"/);
  assert.match(platform, /"\/api\/voice\/process"/);
  assert.match(server, /"\/voice\/process"/);
  assert.match(server, /DefaultBodyLimit::max\(voice::MAX_REQUEST_BYTES\)/);
  assert.match(backend, /multipart::Form::new\(\)/);
  assert.match(backend, /\/v1\/audio\/transcriptions/);
  assert.match(backend, /RemoteTranscriptionResponse/);
  assert.match(backend, /openai-compatible-remote/);
  assert.match(voice, /result\.transcriptionProvider\.includes\("remote"\)/);
});

test("le transport GPU distant exige TLS et garde les jetons hors du JSON", () => {
  assert.match(backend, /CST_VOICE_TRANSCRIPTION_API_KEY/);
  assert.match(backend, /CST_VOICE_OLLAMA_API_KEY/);
  assert.match(backend, /CST_VOICE_ALLOW_INSECURE_REMOTE/);
  assert.match(backend, /\.bearer_auth\(token\)/);
  assert.match(backend, /Policy::none\(\)/);
  assert.match(remoteSetup, /transcriptionMode = "remote"/);
  assert.match(remoteSetup, /remoteFallbackLocal = \[bool\]\$FallbackLocal/);
  assert.doesNotMatch(remoteSetup, /ApiKey\s*=/i);
  assert.equal(packageJson.scripts["voice:remote"].includes("configure-remote-voice.ps1"), true);
  assert.match(remoteGuide, /Ollama ne doit pas etre expose directement/);
});

test("les parametres affichent le statut vocal et GPU sans charger le modele", () => {
  assert.match(backend, /pub async fn voice_runtime_status\(\)/);
  assert.match(backend, /ollama_api_url\(&ollama_base_url, "\/api\/ps"\)/);
  assert.match(backend, /query_nvidia_gpu/);
  assert.match(backend, /VoiceActivityGuard::begin\(\)/);
  assert.match(rustLib, /voice::voice_runtime_status/);
  assert.match(server, /"\/voice\/status", get\(api_voice_runtime_status\)/);
  assert.match(platform, /case "voice_runtime_status":[\s\S]*?"\/api\/voice\/status"/);
  assert.match(main, /id="voiceRuntimeStatus"/);
  assert.match(main, /status\.stage === "transcribing" \? "Transcription" : "Reformulation"/);
  assert.match(main, /Modele charge sur \$\{processor\}/);
  assert.match(main, /Aucun calcul vocal et aucun modele Ollama charge/);
  assert.match(main, /startVoiceRuntimePoll/);
  assert.match(main, /2_000/);
  assert.match(styles, /voice-runtime-primary\[data-state="active"\]/);
});

test("Whisper termine avant le chargement du petit modele Ollama", () => {
  const transcription = backend.indexOf("transcribe_with_local_whisper(");
  const summarization = backend.indexOf("summarize_with_ollama");
  assert.ok(transcription >= 0 && summarization > transcription);
  assert.match(
    backend,
    /DEFAULT_OLLAMA_MODEL: &str = "qwen3:4b-instruct-2507-q4_K_M"/,
  );
  assert.match(setup, /\[string\]\$WhisperModel = "small-q5_1"/);
  assert.match(
    setup,
    /\[string\]\$SummaryModel = "qwen3:4b-instruct-2507-q4_K_M"/,
  );
  assert.match(setup, /redistrib_11\.8\.0\.json/);
  assert.match(setup, /cublas64_11\.dll/);
  assert.match(setup, /Get-FileHash -LiteralPath \$archive -Algorithm SHA256/);
});

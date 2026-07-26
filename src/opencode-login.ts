// Connexion d'un compte pilote par OpenCode (Z.ai, MiniMax, DeepSeek,
// OpenRouter). Contrairement a Codex et Claude, `opencode auth login` n'ouvre
// pas de navigateur : il attend une cle API dans le terminal puis sort. Sans
// lecture de cette sortie, l'application laissait un terminal de connexion
// ouvert indefiniment, sans indiquer quoi taper ni detecter la reussite.
//
// Ce module analyse donc le flux du PTY pour distinguer trois etats : la CLI
// absente du PATH, l'invite de saisie de la cle, et la fin de la connexion.

const OPENCODE_LOGIN_OUTPUT_LIMIT = 32_000;

// `opencode auth login` termine sa boite clack par `└  Done`. Les
// alternatives couvrent un fournisseur qui basculerait sur un flux OAuth.
const OPENCODE_SUCCESS_RE =
  /(?:└\s+Done\b|Login successful|Logged in successfully|Authentication successful)/i;
const OPENCODE_API_KEY_PROMPT_RE = /(?:Enter|Paste)\s+your\s+API\s+key/i;
// Message d'erreur propre a la CLI (`Error: Unknown provider "..."`), toujours
// en debut de ligne et suivi d'une sortie immediate du process.
const OPENCODE_ERROR_RE = /(?:^|\n)[ \t]*Error:[ \t]*([^\n]{1,200})/;
// La CLI manquante s'exprime differemment selon le shell : bash, cmd.exe et
// PowerShell (anglais comme francais). Le nom de la commande encadre le
// libelle tantot avant (bash, cmd), tantot apres (trace PowerShell).
const MISSING_CLI_MARKERS =
  "command not found|is not recognized|n['’]est pas reconnu|CommandNotFoundException|No such file or directory";
const OPENCODE_MISSING_CLI_RE = new RegExp(
  `opencode[\\s\\S]{0,120}?(?:${MISSING_CLI_MARKERS})`
    + `|(?:${MISSING_CLI_MARKERS})[\\s\\S]{0,120}?opencode`,
  "i",
);

export const OPENCODE_MISSING_CLI_MESSAGE =
  "OpenCode est introuvable dans le PATH. Installe-le (npm install -g opencode-ai) puis relance la connexion.";

type OpenCodeLoginState = {
  output: string;
  awaitingApiKey: boolean;
  completed: boolean;
};

export type OpenCodeLoginUpdate =
  | { type: "none" }
  | { type: "prompt" }
  | { type: "success" }
  | { type: "error"; message: string };

const openCodeLogins = new Map<string, OpenCodeLoginState>();

// La cle est transmise telle quelle au PTY et n'est jamais persistee cote
// application. Refuser les caracteres de controle empeche un collage d'injecter
// une seconde commande dans le shell si l'invite s'est fermee entre-temps.
export const normalizeOpenCodeApiKey = (value: string): string | null => {
  const key = value.trim();
  if (!key || key.length > 4_096 || /[\u0000-\u001f\u007f]/.test(key)) return null;
  return key;
};

// L'invite clack redessine sa boite a chaque frappe : sans retrait des
// sequences ANSI, le marqueur de fin serait noye dans les deplacements de
// curseur.
export const stripOpenCodeLoginControlSequences = (value: string): string =>
  value
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replaceAll("\r", "");

export const parseOpenCodeLoginOutput = (
  output: string,
): { awaitingApiKey: boolean; success: boolean; error: string | null } => {
  const plain = stripOpenCodeLoginControlSequences(output);
  if (OPENCODE_MISSING_CLI_RE.test(plain)) {
    return { awaitingApiKey: false, success: false, error: OPENCODE_MISSING_CLI_MESSAGE };
  }
  if (OPENCODE_SUCCESS_RE.test(plain)) {
    return { awaitingApiKey: false, success: true, error: null };
  }
  const failure = plain.match(OPENCODE_ERROR_RE)?.[1]?.trim() ?? null;
  return {
    awaitingApiKey: OPENCODE_API_KEY_PROMPT_RE.test(plain),
    success: false,
    error: failure ? `OpenCode : ${failure}` : null,
  };
};

export const consumeOpenCodeLoginOutput = (
  sessionKey: string,
  chunk: string,
): OpenCodeLoginUpdate => {
  const state = openCodeLogins.get(sessionKey) ?? {
    output: "",
    awaitingApiKey: false,
    completed: false,
  };
  if (state.completed) return { type: "none" };

  state.output = `${state.output}${chunk}`.slice(-OPENCODE_LOGIN_OUTPUT_LIMIT);
  openCodeLogins.set(sessionKey, state);
  const parsed = parseOpenCodeLoginOutput(state.output);

  if (parsed.success) {
    state.completed = true;
    state.awaitingApiKey = false;
    return { type: "success" };
  }
  if (parsed.error) {
    state.completed = true;
    state.awaitingApiKey = false;
    return { type: "error", message: parsed.error };
  }
  if (parsed.awaitingApiKey && !state.awaitingApiKey) {
    state.awaitingApiKey = true;
    return { type: "prompt" };
  }
  return { type: "none" };
};

// Le champ de saisie dedie n'apparait qu'une fois l'invite reellement affichee :
// un fournisseur bascule sur OAuth ne doit pas se voir proposer une cle API.
export const openCodeLoginAwaitsApiKey = (sessionKey: string): boolean =>
  openCodeLogins.get(sessionKey)?.awaitingApiKey === true;

export const forgetOpenCodeLoginOutput = (sessionKey: string) => {
  openCodeLogins.delete(sessionKey);
};

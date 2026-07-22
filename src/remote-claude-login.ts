const CLAUDE_LOGIN_OUTPUT_LIMIT = 64_000;
const CLAUDE_AUTH_SUCCESS_RE =
  /(?:Authentication successful|Claude Code login successful|Login successful)(?:[.!\s]|$)/i;

type RemoteClaudeLoginState = {
  output: string;
  urlDelivered: boolean;
  completed: boolean;
};

export type RemoteClaudeLoginUpdate =
  | { type: "none" }
  | { type: "ready"; url: string }
  | { type: "success" };

const remoteClaudeLogins = new Map<string, RemoteClaudeLoginState>();

// Le code OAuth est transmis tel quel au PTY et n'est jamais persiste. Refuser
// les caracteres de controle evite qu'un collage puisse injecter une deuxieme
// commande dans le shell si le prompt Claude s'est ferme entre-temps.
export const normalizeRemoteClaudeLoginCode = (value: string): string | null => {
  const code = value.trim();
  if (!code || code.length > 4_096 || /[\u0000-\u001f\u007f]/.test(code)) {
    return null;
  }
  return code;
};

// Claude entoure l'URL OAuth d'un lien OSC 8 et peut aussi ajouter des styles
// ANSI. Les retirer avant l'analyse evite qu'un separateur terminal soit pris
// pour une partie de l'URL.
export const stripRemoteClaudeLoginControlSequences = (value: string): string =>
  value
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replaceAll("\r", "");

const validatedClaudeLoginUrl = (value: string): string | null => {
  try {
    const url = new URL(value);
    const supportedEndpoint =
      (url.hostname === "claude.com" && url.pathname === "/cai/oauth/authorize")
      || (url.hostname === "platform.claude.com" && url.pathname === "/oauth/authorize");
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || !supportedEndpoint
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
};

export const parseRemoteClaudeLoginOutput = (
  output: string,
): { url: string | null; success: boolean } => {
  const plain = stripRemoteClaudeLoginControlSequences(output);
  const candidates = plain.match(/https:\/\/[^\s\u0000-\u001f]+/gi) ?? [];
  const url = candidates
    .map((candidate) => validatedClaudeLoginUrl(candidate))
    .find((candidate): candidate is string => !!candidate) ?? null;
  return {
    url,
    success: CLAUDE_AUTH_SUCCESS_RE.test(plain),
  };
};

export const consumeRemoteClaudeLoginOutput = (
  sessionKey: string,
  chunk: string,
): RemoteClaudeLoginUpdate => {
  const state = remoteClaudeLogins.get(sessionKey) ?? {
    output: "",
    urlDelivered: false,
    completed: false,
  };
  if (state.completed) return { type: "none" };

  state.output = `${state.output}${chunk}`.slice(-CLAUDE_LOGIN_OUTPUT_LIMIT);
  remoteClaudeLogins.set(sessionKey, state);
  const parsed = parseRemoteClaudeLoginOutput(state.output);

  if (parsed.success) {
    state.completed = true;
    return { type: "success" };
  }
  if (parsed.url && !state.urlDelivered) {
    state.urlDelivered = true;
    return { type: "ready", url: parsed.url };
  }
  return { type: "none" };
};

export const forgetRemoteClaudeLoginOutput = (sessionKey: string) => {
  remoteClaudeLogins.delete(sessionKey);
};

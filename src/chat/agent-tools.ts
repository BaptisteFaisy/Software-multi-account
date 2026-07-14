export const CHAT_AGENT_MODE_IDS = ["question", "proof"] as const;

export type ChatAgentModeId = (typeof CHAT_AGENT_MODE_IDS)[number];
export type ChatAgentToolId = string;

export type ChatAgentToolDefinition = {
  id: ChatAgentToolId;
  label: string;
  icon: string;
  tone: "question" | "proof" | "skill";
  activeTitle: string;
  inactiveTitle: string;
};

// Question et Preuve sont des modes de conduite permanents. Les autres boutons
// sont construits depuis public/skills/index.json par main.ts.
export const CHAT_AGENT_TOOLS: readonly ChatAgentToolDefinition[] = [
  {
    id: "question",
    label: "Question",
    icon: "message-circle-question",
    tone: "question",
    activeTitle: "Mode Question activé : l'agent regroupera au début toutes les questions nécessaires",
    inactiveTitle: "Activer le mode Question pour clarifier tous les points ambigus au début",
  },
  {
    id: "proof",
    label: "Preuve",
    icon: "scan-eye",
    tone: "proof",
    activeTitle: "Mode Preuve activé : l'agent devra démontrer que son travail fonctionne",
    inactiveTitle: "Activer le mode Preuve pour exiger des tests et, si pertinent, une capture d'écran",
  },
];

const CHAT_AGENT_MODE_ID_SET = new Set<string>(CHAT_AGENT_MODE_IDS);
const CHAT_AGENT_TOOL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;

export const isChatAgentModeId = (value: unknown): value is ChatAgentModeId =>
  typeof value === "string" && CHAT_AGENT_MODE_ID_SET.has(value);

// Les ids de skills viennent du manifeste embarqué. Cette validation légère
// permet aussi de restaurer un bouton ajouté ultérieurement sans nouvelle union
// TypeScript ni migration du localStorage.
export const isChatAgentToolId = (value: unknown): value is ChatAgentToolId =>
  typeof value === "string" && CHAT_AGENT_TOOL_ID_PATTERN.test(value);

export const normalizeChatAgentTools = (values: unknown): ChatAgentToolId[] => {
  if (!Array.isArray(values)) return [];
  const selected = [...new Set(values.filter(isChatAgentToolId))];
  return [
    ...CHAT_AGENT_MODE_IDS.filter((id) => selected.includes(id)),
    ...selected.filter((id) => !isChatAgentModeId(id)),
  ];
};

const LEGACY_INTERFACE_TOOL_ID = "impeccable-make-interfaces-feel-better";

export const migratePersistedChatAgentTools = (record: {
  enabledTools?: unknown;
  questionToolEnabled?: unknown;
  proofToolEnabled?: unknown;
}): ChatAgentToolId[] => {
  const values = Array.isArray(record.enabledTools) ? [...record.enabledTools] : [];
  if (values.includes(LEGACY_INTERFACE_TOOL_ID)) {
    values.push("impeccable", "make-interfaces-feel-better");
  }
  if (record.questionToolEnabled === true) values.push("question");
  if (record.proofToolEnabled === true) values.push("proof");
  return normalizeChatAgentTools(
    values.filter((value) => value !== LEGACY_INTERFACE_TOOL_ID),
  );
};

export const toggleChatAgentTool = (
  enabledTools: readonly ChatAgentToolId[],
  id: ChatAgentToolId,
): ChatAgentToolId[] =>
  normalizeChatAgentTools(
    enabledTools.includes(id)
      ? enabledTools.filter((candidate) => candidate !== id)
      : [...enabledTools, id],
  );

export const chatAgentToolLabel = (
  id: ChatAgentToolId,
  definitions: readonly ChatAgentToolDefinition[] = CHAT_AGENT_TOOLS,
): string => definitions.find((tool) => tool.id === id)?.label ?? id;

export const chatSkillToolDefinition = (skill: {
  id: string;
  name: string;
  buttonLabel?: string;
  icon?: string;
}): ChatAgentToolDefinition => {
  const label = skill.buttonLabel?.trim() || skill.name.trim() || skill.id;
  const name = skill.name.trim() || skill.id;
  return {
    id: skill.id,
    label,
    icon: skill.icon?.trim() || "sparkles",
    tone: "skill",
    activeTitle: `Skill « ${name} » activé pour le prochain message`,
    inactiveTitle: `Activer le skill « ${name} » pour le prochain message`,
  };
};

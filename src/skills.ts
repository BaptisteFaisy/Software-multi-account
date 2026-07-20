export const CUSTOM_SKILLS_STORAGE_KEY = "codex-switch-terminal.custom-skills.v1";
export const CUSTOM_SKILL_LIMIT = 32;
export const SKILL_NAME_MAX_LENGTH = 160;
export const SKILL_DESCRIPTION_MAX_LENGTH = 1_200;
export const SKILL_CONTENT_MAX_BYTES = 64 * 1024;
export const SKILL_TAG_MAX_LENGTH = 40;
export const SKILL_TAG_LIMIT = 10;

const SKILL_ID_MAX_LENGTH = 128;
const SKILL_BUTTON_LABEL_MAX_LENGTH = 48;
const SKILL_ICON_MAX_LENGTH = 64;
const SKILL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;

export type CustomSkillEntry = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  buttonLabel: string;
  icon: string;
  content: string;
  custom: true;
  createdAt: number;
  updatedAt: number;
};

export type CustomSkillDraft = {
  name: unknown;
  description?: unknown;
  tags?: unknown;
  buttonLabel?: unknown;
  icon?: unknown;
  content: unknown;
};

export type CustomSkillStorage = Pick<Storage, "getItem" | "setItem">;

export type SaveCustomSkillResult =
  | { ok: true; items: CustomSkillEntry[]; skill: CustomSkillEntry; created: boolean }
  | { ok: false; error: string };

export type SkillMarkdownDraft = {
  name: string;
  description: string;
  tags: string[];
  content: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const normalizeSingleLine = (value: unknown, maxLength: number): string =>
  typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, maxLength)
    : "";

const normalizeTimestamp = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;

export const skillContentBytes = (content: string): number =>
  new TextEncoder().encode(content).byteLength;

export const normalizeSkillName = (value: unknown): string =>
  normalizeSingleLine(value, SKILL_NAME_MAX_LENGTH);

export const normalizeSkillDescription = (value: unknown): string =>
  typeof value === "string"
    ? value.trim().replace(/\r\n?/g, "\n").slice(0, SKILL_DESCRIPTION_MAX_LENGTH)
    : "";

export const normalizeSkillContent = (value: unknown): string =>
  typeof value === "string" ? value.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim() : "";

export const normalizeSkillTags = (value: unknown): string[] => {
  const candidates = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,\n]/)
      : [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const candidate of candidates) {
    const tag = normalizeSingleLine(candidate, SKILL_TAG_MAX_LENGTH);
    const key = tag.toLocaleLowerCase("fr-FR");
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= SKILL_TAG_LIMIT) break;
  }
  return tags;
};

const normalizeSkillButtonLabel = (value: unknown, fallback: string): string =>
  normalizeSingleLine(value, SKILL_BUTTON_LABEL_MAX_LENGTH)
  || fallback.slice(0, SKILL_BUTTON_LABEL_MAX_LENGTH);

const normalizeSkillIcon = (value: unknown): string => {
  const icon = normalizeSingleLine(value, SKILL_ICON_MAX_LENGTH).toLocaleLowerCase("en-US");
  return /^[a-z0-9][a-z0-9-]*$/.test(icon) ? icon : "sparkles";
};

const normalizeStoredSkillId = (value: unknown): string => {
  const id = normalizeSingleLine(value, SKILL_ID_MAX_LENGTH).toLocaleLowerCase("en-US");
  return SKILL_ID_PATTERN.test(id) ? id : "";
};

const slugifySkillName = (name: string): string => name
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLocaleLowerCase("en-US")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, SKILL_ID_MAX_LENGTH - "custom-".length)
  .replace(/-+$/g, "");

export const createCustomSkillId = (
  name: string,
  reservedIds: Iterable<string> = [],
): string => {
  const reserved = new Set(reservedIds);
  const slug = slugifySkillName(name) || "skill";
  const base = `custom-${slug}`;
  if (!reserved.has(base)) return base;
  let suffix = 2;
  while (reserved.has(`${base.slice(0, SKILL_ID_MAX_LENGTH - String(suffix).length - 1)}-${suffix}`)) {
    suffix += 1;
  }
  return `${base.slice(0, SKILL_ID_MAX_LENGTH - String(suffix).length - 1)}-${suffix}`;
};

export const normalizeCustomSkills = (
  value: unknown,
  fallbackTimestamp = Date.now(),
): CustomSkillEntry[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const normalized: CustomSkillEntry[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate) || normalized.length >= CUSTOM_SKILL_LIMIT) continue;
    const id = normalizeStoredSkillId(candidate.id);
    const name = normalizeSkillName(candidate.name);
    const content = normalizeSkillContent(candidate.content);
    if (
      !id
      || !name
      || !content
      || skillContentBytes(content) > SKILL_CONTENT_MAX_BYTES
      || seen.has(id)
    ) continue;
    seen.add(id);
    const createdAt = normalizeTimestamp(candidate.createdAt, fallbackTimestamp);
    normalized.push({
      id,
      name,
      description: normalizeSkillDescription(candidate.description),
      tags: normalizeSkillTags(candidate.tags),
      buttonLabel: normalizeSkillButtonLabel(candidate.buttonLabel, name),
      icon: normalizeSkillIcon(candidate.icon),
      content,
      custom: true,
      createdAt,
      updatedAt: Math.max(createdAt, normalizeTimestamp(candidate.updatedAt, createdAt)),
    });
  }
  return normalized.sort((left, right) => right.updatedAt - left.updatedAt);
};

const browserSkillStorage = (): CustomSkillStorage | null => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const resolveStorage = (
  storage: CustomSkillStorage | null | undefined,
): CustomSkillStorage | null => storage === undefined ? browserSkillStorage() : storage;

export const loadCustomSkills = (
  storage?: CustomSkillStorage | null,
): CustomSkillEntry[] => {
  const target = resolveStorage(storage);
  if (!target) return [];
  try {
    const serialized = target.getItem(CUSTOM_SKILLS_STORAGE_KEY);
    return serialized ? normalizeCustomSkills(JSON.parse(serialized)) : [];
  } catch {
    return [];
  }
};

export const persistCustomSkills = (
  items: readonly CustomSkillEntry[],
  storage?: CustomSkillStorage | null,
): boolean => {
  const target = resolveStorage(storage);
  if (!target) return false;
  try {
    target.setItem(CUSTOM_SKILLS_STORAGE_KEY, JSON.stringify(normalizeCustomSkills(items)));
    return true;
  } catch {
    return false;
  }
};

export const saveCustomSkill = (
  items: readonly CustomSkillEntry[],
  draft: CustomSkillDraft,
  options: {
    id?: string | null;
    reservedIds?: Iterable<string>;
    timestamp?: number;
  } = {},
): SaveCustomSkillResult => {
  const current = normalizeCustomSkills(items);
  const editingId = options.id ? normalizeStoredSkillId(options.id) : "";
  const existing = editingId ? current.find((skill) => skill.id === editingId) ?? null : null;
  if (editingId && !existing) return { ok: false, error: "Ce skill personnel n’existe plus." };
  if (!existing && current.length >= CUSTOM_SKILL_LIMIT) {
    return { ok: false, error: `La limite de ${CUSTOM_SKILL_LIMIT} skills personnels est atteinte.` };
  }

  const name = normalizeSkillName(draft.name);
  const content = normalizeSkillContent(draft.content);
  if (!name) return { ok: false, error: "Donnez un nom à ce skill." };
  if (!content) return { ok: false, error: "Les instructions du skill ne peuvent pas être vides." };
  if (skillContentBytes(content) > SKILL_CONTENT_MAX_BYTES) {
    return {
      ok: false,
      error: `Le contenu dépasse ${Math.floor(SKILL_CONTENT_MAX_BYTES / 1024)} Ko.`,
    };
  }

  const timestamp = Math.max(0, Math.floor(options.timestamp ?? Date.now()));
  const reserved = new Set(options.reservedIds ?? []);
  current.forEach((skill) => {
    if (skill.id !== editingId) reserved.add(skill.id);
  });
  const id = existing?.id ?? createCustomSkillId(name, reserved);
  const skill: CustomSkillEntry = {
    id,
    name,
    description: normalizeSkillDescription(draft.description),
    tags: normalizeSkillTags(draft.tags),
    buttonLabel: normalizeSkillButtonLabel(draft.buttonLabel, name),
    icon: normalizeSkillIcon(draft.icon),
    content,
    custom: true,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: Math.max(existing?.createdAt ?? timestamp, timestamp),
  };
  const next = existing
    ? current.map((candidate) => candidate.id === existing.id ? skill : candidate)
    : [skill, ...current];
  return {
    ok: true,
    items: next.sort((left, right) => right.updatedAt - left.updatedAt),
    skill,
    created: !existing,
  };
};

export const removeCustomSkill = (
  items: readonly CustomSkillEntry[],
  id: string,
): CustomSkillEntry[] => normalizeCustomSkills(items).filter((skill) => skill.id !== id);

const unquoteFrontmatterValue = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;
  const quote = trimmed[0];
  if ((quote !== '"' && quote !== "'") || trimmed.at(-1) !== quote) return trimmed;
  const body = trimmed.slice(1, -1);
  return quote === '"'
    ? body.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\")
    : body.replace(/''/g, "'");
};

const parseInlineTags = (value: string): string[] => {
  const trimmed = value.trim();
  const body = trimmed.startsWith("[") && trimmed.endsWith("]")
    ? trimmed.slice(1, -1)
    : trimmed;
  return normalizeSkillTags(body.split(",").map(unquoteFrontmatterValue));
};

const parseSkillFrontmatter = (markdown: string): {
  attributes: Record<string, string>;
  tags: string[];
  body: string;
} => {
  const normalized = markdown.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  if (lines[0]?.trim() !== "---") return { attributes: {}, tags: [], body: normalized };
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (closingIndex < 0) return { attributes: {}, tags: [], body: normalized };

  const attributes: Record<string, string> = {};
  let tags: string[] = [];
  for (let index = 1; index < closingIndex; index += 1) {
    const line = lines[index];
    if (/^\s/.test(line)) continue;
    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1].toLocaleLowerCase("en-US");
    const rawValue = match[2];
    if ((rawValue === "|" || rawValue === ">") && index + 1 < closingIndex) {
      const continuation: string[] = [];
      while (index + 1 < closingIndex && (/^\s/.test(lines[index + 1]) || !lines[index + 1].trim())) {
        index += 1;
        continuation.push(lines[index].replace(/^\s+/, ""));
      }
      attributes[key] = rawValue === ">"
        ? continuation.join(" ").replace(/\s+/g, " ").trim()
        : continuation.join("\n").trim();
      continue;
    }
    if (key === "tags") tags = parseInlineTags(rawValue);
    else attributes[key] = unquoteFrontmatterValue(rawValue);
  }
  return {
    attributes,
    tags,
    body: lines.slice(closingIndex + 1).join("\n").trim(),
  };
};

const skillNameFromFilename = (filename: string): string => {
  const base = filename.replace(/\\/g, "/").split("/").at(-1) ?? "";
  const withoutExtension = base.replace(/\.(?:md|markdown|txt)$/i, "");
  if (!withoutExtension || withoutExtension.toLocaleLowerCase("en-US") === "skill") return "";
  return normalizeSkillName(withoutExtension.replace(/[-_]+/g, " "));
};

const firstMarkdownHeading = (content: string): string => {
  const match = /^#\s+(.+)$/m.exec(content);
  return normalizeSkillName(match?.[1]?.replace(/\s+#+\s*$/, "") ?? "");
};

const firstMarkdownParagraph = (content: string): string => {
  const lines = content.split("\n");
  const paragraph: string[] = [];
  let inFence = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence || /^#{1,6}\s/.test(line) || line.startsWith(">") || /^[-*+]\s/.test(line)) {
      if (paragraph.length) break;
      continue;
    }
    if (!line) {
      if (paragraph.length) break;
      continue;
    }
    paragraph.push(line);
  }
  return normalizeSkillDescription(paragraph.join(" "));
};

export const skillDraftFromMarkdown = (
  filename: string,
  markdown: string,
): SkillMarkdownDraft => {
  const parsed = parseSkillFrontmatter(markdown);
  const content = normalizeSkillContent(parsed.body);
  return {
    name: normalizeSkillName(parsed.attributes.name)
      || firstMarkdownHeading(content)
      || skillNameFromFilename(filename),
    description: normalizeSkillDescription(parsed.attributes.description)
      || firstMarkdownParagraph(content),
    tags: parsed.tags,
    content,
  };
};

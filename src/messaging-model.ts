export const PRIVATE_MESSAGE_MAX_CHARS = 4_000;

export type PrivateMessageUser = {
  id: string;
  username: string;
  avatarUrl?: string | null;
};

export type PrivateMessage = {
  id: string;
  sender: PrivateMessageUser;
  recipient: PrivateMessageUser;
  body: string;
  images: PrivateMessageImage[];
  createdAt: number;
  sequence: number;
  readAt?: number | null;
};

export type PrivateMessageImage = {
  id: string;
  name: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  size: number;
};

export type PrivateMessageImageContent = {
  mimeType: PrivateMessageImage["mimeType"];
  dataBase64: string;
};

export type PrivateConversationSummary = {
  user: PrivateMessageUser;
  lastMessage: PrivateMessage;
  unreadCount: number;
};

export type PrivateConversation = {
  user: PrivateMessageUser;
  messages: PrivateMessage[];
};

const searchable = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("fr");

export const sortPrivateMessageUsers = (
  users: PrivateMessageUser[],
): PrivateMessageUser[] => [...users].sort((left, right) =>
  left.username.localeCompare(right.username, "fr", { sensitivity: "base" })
  || left.id.localeCompare(right.id),
);

export const filterPrivateMessageUsers = (
  users: PrivateMessageUser[],
  query: string,
): PrivateMessageUser[] => {
  const needle = searchable(query);
  const sorted = sortPrivateMessageUsers(users);
  if (!needle) return sorted;
  return sorted.filter((user) => searchable(user.username).includes(needle));
};

export const sortPrivateConversations = (
  conversations: PrivateConversationSummary[],
): PrivateConversationSummary[] => [...conversations].sort((left, right) =>
  right.lastMessage.sequence - left.lastMessage.sequence
  || right.lastMessage.createdAt - left.lastMessage.createdAt
  || left.user.username.localeCompare(right.user.username, "fr", { sensitivity: "base" }),
);

export const privateMessagingUnreadCount = (
  conversations: PrivateConversationSummary[],
): number => conversations.reduce(
  (total, conversation) => total + Math.max(0, conversation.unreadCount || 0),
  0,
);

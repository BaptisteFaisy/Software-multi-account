export const MAX_CHAT_IMAGE_ATTACHMENTS = 4;
export const MAX_CHAT_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_CHAT_IMAGE_TOTAL_BYTES = 20 * 1024 * 1024;

export type ChatImageMimeType = "image/png" | "image/jpeg" | "image/webp";

export type ChatImageAttachment = {
  id: string;
  name: string;
  mimeType: ChatImageMimeType;
  size: number;
  dataBase64: string;
  previewUrl: string;
};

export type ChatImageAttachmentPayload = Pick<
  ChatImageAttachment,
  "name" | "mimeType" | "dataBase64"
>;

const normalizeChatImageMimeType = (
  value: string | null | undefined,
): ChatImageMimeType | null => {
  const mimeType = value?.trim().toLowerCase();
  if (mimeType === "image/png") return "image/png";
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return "image/jpeg";
  if (mimeType === "image/webp") return "image/webp";
  return null;
};

const chatImageId = (): string =>
  globalThis.crypto?.randomUUID?.()
  ?? `chat-image-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const chatImageLabel = (file: File, mimeType: ChatImageMimeType): string => {
  const supplied = file.name.trim();
  if (supplied && supplied !== "image.png") return supplied.slice(0, 160);
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1];
  return `Image collee.${extension}`;
};

const fileAsBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error("Lecture de l'image collee impossible."));
  reader.onload = () => {
    const result = typeof reader.result === "string" ? reader.result : "";
    const comma = result.indexOf(",");
    if (comma < 0 || !result.slice(0, comma).includes(";base64")) {
      reject(new Error("Format de l'image collee invalide."));
      return;
    }
    resolve(result.slice(comma + 1));
  };
  reader.readAsDataURL(file);
});

export const clipboardChatImageFiles = (clipboard: DataTransfer | null): File[] => {
  if (!clipboard) return [];
  const fromItems = Array.from(clipboard.items)
    .filter((item) => item.kind === "file" && item.type.toLowerCase().startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => !!file);
  if (fromItems.length) return fromItems;
  return Array.from(clipboard.files).filter((file) => file.type.toLowerCase().startsWith("image/"));
};

export const readChatImageAttachments = async (
  files: readonly File[],
  existing: readonly ChatImageAttachment[],
): Promise<ChatImageAttachment[]> => {
  const availableSlots = MAX_CHAT_IMAGE_ATTACHMENTS - existing.length;
  if (availableSlots <= 0) {
    throw new Error(`Vous pouvez joindre jusqu'a ${MAX_CHAT_IMAGE_ATTACHMENTS} images par message.`);
  }

  const selected = files.slice(0, availableSlots);
  const existingBytes = existing.reduce((total, image) => total + image.size, 0);
  let selectedBytes = 0;
  for (const file of selected) {
    const mimeType = normalizeChatImageMimeType(file.type);
    if (!mimeType) {
      throw new Error("Utilisez une image PNG, JPEG ou WebP.");
    }
    if (!file.size) throw new Error("L'image collee est vide.");
    if (file.size > MAX_CHAT_IMAGE_BYTES) {
      throw new Error("Chaque image doit peser 8 Mo ou moins.");
    }
    selectedBytes += file.size;
  }
  if (existingBytes + selectedBytes > MAX_CHAT_IMAGE_TOTAL_BYTES) {
    throw new Error("Les images d'un message ne peuvent pas depasser 20 Mo au total.");
  }

  const attachments: ChatImageAttachment[] = [];
  try {
    for (const file of selected) {
      const mimeType = normalizeChatImageMimeType(file.type);
      if (!mimeType) throw new Error("Format d'image non pris en charge.");
      attachments.push({
        id: chatImageId(),
        name: chatImageLabel(file, mimeType),
        mimeType,
        size: file.size,
        dataBase64: await fileAsBase64(file),
        previewUrl: URL.createObjectURL(file),
      });
    }
    return attachments;
  } catch (error) {
    disposeChatImagePreviews(attachments);
    throw error;
  }
};

export const chatImageAttachmentPayloads = (
  images: readonly ChatImageAttachment[],
): ChatImageAttachmentPayload[] => images.map(({ name, mimeType, dataBase64 }) => ({
  name,
  mimeType,
  dataBase64,
}));

export const disposeChatImagePreviews = (
  images: readonly ChatImageAttachment[],
): void => {
  images.forEach((image) => URL.revokeObjectURL(image.previewUrl));
};

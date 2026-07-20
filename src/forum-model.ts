export const FORUM_TITLE_MAX_CHARS = 140;
export const FORUM_TOPIC_MAX_CHARS = 20_000;
export const FORUM_REPLY_MAX_CHARS = 12_000;

export type ForumAuthor = {
  id: string;
  username: string;
  avatarUrl?: string | null;
};

export type ForumReply = {
  id: string;
  author: ForumAuthor;
  body: string;
  createdAt: number;
};

export type ForumTopic = {
  id: string;
  title: string;
  body: string;
  author: ForumAuthor;
  createdAt: number;
  lastActivityAt: number;
  activitySequence: number;
  replies: ForumReply[];
};

export type ForumTopicSummary = {
  id: string;
  title: string;
  excerpt: string;
  author: ForumAuthor;
  createdAt: number;
  lastActivityAt: number;
  activitySequence: number;
  replyCount: number;
  lastReplyAuthor?: ForumAuthor | null;
};

export const sortForumTopics = (topics: ForumTopicSummary[]): ForumTopicSummary[] =>
  [...topics].sort((left, right) =>
    right.activitySequence - left.activitySequence
    || right.lastActivityAt - left.lastActivityAt
    || right.createdAt - left.createdAt
    || right.id.localeCompare(left.id),
  );

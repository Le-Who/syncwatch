export const REACTION_EMOJIS = ["🔥", "😂", "💖", "👀", "🤯", "💯"] as const;

export function parseReaction(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const emoji = (payload as { emoji?: unknown }).emoji;
  if (typeof emoji !== "string") return null;
  const supportedEmoji = REACTION_EMOJIS.find(
    (candidate) => candidate === emoji,
  );
  return supportedEmoji ? { emoji: supportedEmoji } : null;
}

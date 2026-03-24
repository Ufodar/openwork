import type { OpenworkKnowledgeItem } from "./openwork-server";

export type KnowledgeOwnerGroup = {
  ownerKey: string;
  ownerLabel: string;
  items: OpenworkKnowledgeItem[];
};

function normalizeOwnerLabel(item: OpenworkKnowledgeItem, fallbackOwnerLabel: string) {
  const displayName = item.ownerDisplayName.trim();
  if (displayName) return displayName;
  const userId = item.ownerUserId.trim();
  if (userId) return userId;
  return fallbackOwnerLabel;
}

function normalizeOwnerKey(item: OpenworkKnowledgeItem, fallbackOwnerLabel: string) {
  const userId = item.ownerUserId.trim();
  if (userId) return userId;
  const displayName = item.ownerDisplayName.trim();
  if (displayName) return displayName;
  return fallbackOwnerLabel;
}

export function groupKnowledgeItemsByOwner(
  items: OpenworkKnowledgeItem[],
  fallbackOwnerLabel: string,
): KnowledgeOwnerGroup[] {
  const groups = new Map<string, KnowledgeOwnerGroup>();
  const orderedKeys: string[] = [];
  for (const item of items) {
    const ownerKey = normalizeOwnerKey(item, fallbackOwnerLabel);
    const ownerLabel = normalizeOwnerLabel(item, fallbackOwnerLabel);
    let group = groups.get(ownerKey);
    if (!group) {
      group = {
        ownerKey,
        ownerLabel,
        items: [],
      };
      groups.set(ownerKey, group);
      orderedKeys.push(ownerKey);
    }
    group.items.push(item);
  }
  return orderedKeys
    .map((ownerKey) => groups.get(ownerKey))
    .filter((group): group is KnowledgeOwnerGroup => Boolean(group));
}

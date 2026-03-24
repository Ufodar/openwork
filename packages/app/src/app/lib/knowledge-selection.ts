import type { OpenworkKnowledgeItem, OpenworkKnowledgeScope } from "./openwork-server";

export type KnowledgeSelectionPatch = {
  id: string;
  checked: boolean;
};

export type KnowledgeSelection = {
  scope: OpenworkKnowledgeScope;
  knowledgeId: string;
};

function normalizeKnowledgeIds(ids: string[]): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const raw of ids) {
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
  }
  return ordered;
}

export function reduceKnowledgeSelection(
  currentIds: string[],
  patches: KnowledgeSelectionPatch[],
): string[] {
  const next = normalizeKnowledgeIds(currentIds);
  const active = new Set(next);

  for (const patch of patches) {
    const id = patch.id.trim();
    if (!id) continue;
    if (patch.checked) {
      if (active.has(id)) continue;
      active.add(id);
      next.push(id);
      continue;
    }
    if (!active.delete(id)) continue;
    const index = next.indexOf(id);
    if (index >= 0) next.splice(index, 1);
  }

  return next;
}

export function sameKnowledgeSelection(left: string[], right: string[]): boolean {
  const a = normalizeKnowledgeIds(left).sort();
  const b = normalizeKnowledgeIds(right).sort();
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

export function findKnowledgeItem(
  scope: OpenworkKnowledgeScope,
  knowledgeId: string,
  mineItems: OpenworkKnowledgeItem[],
  othersItems: OpenworkKnowledgeItem[],
): OpenworkKnowledgeItem | null {
  const source = scope === "mine" ? mineItems : othersItems;
  return source.find((item) => item.knowledgeId === knowledgeId) ?? null;
}

export function pickKnowledgeSelection(
  current: KnowledgeSelection | null,
  mineItems: OpenworkKnowledgeItem[],
  othersItems: OpenworkKnowledgeItem[],
): KnowledgeSelection | null {
  if (current && findKnowledgeItem(current.scope, current.knowledgeId, mineItems, othersItems)) {
    return current;
  }
  const firstMine = mineItems[0];
  if (firstMine) {
    return {
      scope: "mine",
      knowledgeId: firstMine.knowledgeId,
    };
  }
  const firstOther = othersItems[0];
  if (firstOther) {
    return {
      scope: "others",
      knowledgeId: firstOther.knowledgeId,
    };
  }
  return null;
}

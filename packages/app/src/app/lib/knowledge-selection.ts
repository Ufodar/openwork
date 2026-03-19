export type KnowledgeSelectionPatch = {
  id: string;
  checked: boolean;
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

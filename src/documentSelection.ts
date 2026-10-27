import type { SourceDocument } from "./types.js";

type TreeNode = { id: string; parentId: string | null };

/** Move a whole branch among its siblings, preserving every parent relationship. */
export function moveBranch<T extends TreeNode>(
  documents: readonly T[],
  id: string,
  targetId: string,
  after = false,
): T[] {
  const source = documents.find((item) => item.id === id);
  const target = documents.find((item) => item.id === targetId);
  if (
    !source ||
    !target ||
    id === targetId ||
    source.parentId !== target.parentId
  )
    return [...documents];
  const moving = subtreeIds(documents, id);
  const targetBranch = subtreeIds(documents, targetId);
  const branch = documents.filter((item) => moving.has(item.id));
  const rest = documents.filter((item) => !moving.has(item.id));
  const index =
    rest.findIndex((item) => item.id === targetId) +
    (after ? targetBranch.size : 0);
  rest.splice(index, 0, ...branch);
  return rest;
}

export function subtreeIds(documents: readonly TreeNode[], id: string) {
  const ids = new Set([id]);
  for (const item of documents)
    if (item.parentId && ids.has(item.parentId)) ids.add(item.id);
  return ids;
}

/** Unknown nodes count as content so the empty action never drops rich blocks. */
export function isEmptyDocument(
  document: SourceDocument,
  includeComments: boolean,
) {
  const empty = (node: Record<string, unknown>): boolean => {
    if (node.type === "text") return !String(node.text ?? "").trim();
    if (node.type === "hard_break") return true;
    if (node.type !== "doc" && node.type !== "paragraph") return false;
    return (
      !Array.isArray(node.content) ||
      node.content.every((child) =>
        child && typeof child === "object" ? empty(child) : false,
      )
    );
  };
  return (
    empty(document.content) && !(includeComments && document.comments?.length)
  );
}

/** Reapply a saved order to current siblings when a refreshed snapshot adds documents. */
export function orderDocuments<T extends TreeNode>(
  documents: readonly T[],
  order: readonly string[],
): T[] {
  const ranks = new Map(order.map((id, index) => [id, index]));
  const children = new Map<string | null, T[]>();
  for (const item of documents) {
    const siblings = children.get(item.parentId) ?? [];
    siblings.push(item);
    children.set(item.parentId, siblings);
  }
  const result: T[] = [];
  const visit = (parent: string | null) => {
    const siblings = children.get(parent) ?? [];
    siblings.sort(
      (a, b) => (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity),
    );
    for (const item of siblings) {
      result.push(item);
      visit(item.id);
    }
  };
  visit(null);
  return result;
}

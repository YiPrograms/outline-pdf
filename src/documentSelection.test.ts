import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isEmptyDocument,
  moveBranch,
  orderDocuments,
  subtreeIds,
} from "./documentSelection.js";
import type { SourceDocument } from "./types.js";

const nodes = [
  { id: "root", parentId: null },
  { id: "a", parentId: "root" },
  { id: "a1", parentId: "a" },
  { id: "a2", parentId: "a" },
  { id: "b", parentId: "root" },
  { id: "b1", parentId: "b" },
  { id: "other", parentId: null },
];
test("dragging a sibling moves its whole subtree without changing parents", () => {
  const before = structuredClone(nodes);
  const reordered = moveBranch(nodes, "a", "b", true);
  assert.deepEqual(
    reordered.map((item) => item.id),
    ["root", "b", "b1", "a", "a1", "a2", "other"],
  );
  assert.deepEqual(
    moveBranch(reordered, "a", "b").map((item) => item.id),
    nodes.map((item) => item.id),
  );
  assert.deepEqual(
    moveBranch(nodes, "root", "other", true).map((item) => item.id),
    ["other", "root", "a", "a1", "a2", "b", "b1"],
  );
  assert.deepEqual(nodes, before);
  for (const item of reordered)
    assert.equal(
      item.parentId,
      nodes.find((node) => node.id === item.id)!.parentId,
    );
});
test("cross-parent, self and missing drop targets leave order unchanged", () => {
  for (const [id, target] of [
    ["a", "root"],
    ["a", "a1"],
    ["a", "other"],
    ["a", "a"],
    ["a", "missing"],
    ["missing", "a"],
  ])
    assert.deepEqual(moveBranch(nodes, id!, target!), nodes);
  assert.deepEqual([...subtreeIds(nodes, "a")], ["a", "a1", "a2"]);
});
test("deselect empty is conservative for rich content and respects visible comments", () => {
  const source: SourceDocument = {
    id: "a",
    parentId: null,
    title: "A folder title is not body content",
    sourceUrl: "https://example.test/doc/a",
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: " \n " }, { type: "hard_break" }],
        },
      ],
    },
  };
  assert.equal(isEmptyDocument(source, false), true);
  for (const node of [
    { type: "text", text: "Content" },
    { type: "image" },
    { type: "table" },
    { type: "embed" },
    { type: "mermaid" },
    { type: "future-node" },
  ])
    assert.equal(
      isEmptyDocument(
        { ...source, content: { type: "doc", content: [node] } },
        false,
      ),
      false,
    );
  const commented = {
    ...source,
    comments: [
      {
        id: "c",
        parentCommentId: null,
        author: "A",
        createdAt: "2026-10-27",
        content: { type: "doc" },
      },
    ],
  };
  assert.equal(isEmptyDocument(commented, false), true);
  assert.equal(isEmptyDocument(commented, true), false);
});

test("a refreshed tree retains sibling order and places new children with their parent", () => {
  const order = moveBranch(nodes, "b", "a").map((item) => item.id);
  const refreshed = [...nodes, { id: "new", parentId: "a" }];
  assert.deepEqual(
    orderDocuments(refreshed, order).map((item) => item.id),
    ["root", "b", "b1", "a", "a1", "a2", "new", "other"],
  );
});

import { fixtureImage } from "./image.js";

interface NavigationNode {
  id: string;
  children: NavigationNode[];
}

interface PMNode {
  type: string;
  text?: string;
  attrs?: Record<string, string | number | boolean>;
  marks?: { type: string; attrs: Record<string, string> }[];
  content?: PMNode[];
}

const text = (value: string): PMNode => ({ type: "text", text: value });
const paragraph = (value: string): PMNode => ({
  type: "paragraph",
  content: [text(value)],
});
const heading = (value: string, level = 2): PMNode => ({
  type: "heading",
  attrs: { level },
  content: [text(value)],
});
const link = (label: string, href: string): PMNode => ({
  type: "paragraph",
  content: [{ ...text(label), marks: [{ type: "link", attrs: { href } }] }],
});
const code = (value: string, language: string): PMNode => ({
  type: "code_fence",
  attrs: { language },
  content: [text(value)],
});

/** Deterministic native ProseMirror fixture: eight document levels plus duplicate siblings. */
export function fixtureBook() {
  const documents = Array.from({ length: 10 }, (_, index) => {
    const id = `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    const title = index < 8 ? `第 ${index + 1} 層：系統文件` : "部署方式";
    return {
      id,
      parentId:
        index > 0 && index < 8
          ? `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`
          : null,
      title,
      sourceUrl: `https://outline.example.test/doc/fixture-${String(index + 1).padStart(10, "0")}`,
      content: {
        type: "doc",
        content: [
          paragraph(
            `DOC_TOKEN_${index + 1}。繁體中文驗證：網路架構、儲存設定與故障排除。`,
          ),
          heading("安裝方法", 1),
          paragraph("保留 Outline 的原生內容樣式。每篇文件從新頁開始。"),
          heading("安裝方法", 2),
          paragraph(`HEADING_TOKEN_${index + 1}。同一篇文件內也有重複標題。`),
          link("前往本篇第二個同名標題", "#h-安裝方法-1"),
        ],
      } satisfies PMNode,
    };
  });
  const first = documents[0];
  const sibling = documents[9];
  if (!first || !sibling) throw new Error("Missing fixture");
  first.content.content.push(
    link("跨文件連結至另一篇部署方式", `${sibling.sourceUrl}#h-安裝方法-1`),
    link(
      "匯出範圍外文件",
      "https://outline.example.test/doc/not-exported-abcdefghij",
    ),
    link(
      "其他站台相同路徑",
      "https://foreign.example.test/doc/fixture-0000000010",
    ),
    {
      type: "paragraph",
      content: [
        {
          ...text("COMMENT_MARK_TOKEN"),
          marks: [
            {
              type: "comment",
              attrs: {
                id: "00000000-0000-4000-8000-000000000099",
                userId: "00000000-0000-4000-8000-000000000098",
              },
            },
          ],
        },
      ],
    },
    {
      type: "container_notice",
      attrs: { style: "info" },
      content: [
        paragraph(
          "提示：這段 Callout 使用 Outline 原生 renderer。注意備份與還原程序。",
        ),
      ],
    },
    {
      type: "bullet_list",
      content: [
        {
          type: "list_item",
          content: [
            paragraph("網路設定"),
            {
              type: "bullet_list",
              content: [
                { type: "list_item", content: [paragraph("子網路與防火牆")] },
              ],
            },
          ],
        },
      ],
    },
    {
      type: "checkbox_list",
      content: [
        {
          type: "checkbox_item",
          attrs: { checked: true },
          content: [paragraph("已驗證備份")],
        },
        {
          type: "checkbox_item",
          attrs: { checked: false },
          content: [paragraph("準備上線")],
        },
      ],
    },
    code(
      'const message = "繁體中文";\nconsole.log(message);\n// ' +
        "long_line_".repeat(16) +
        "\n" +
        Array.from(
          { length: 45 },
          (_, i) => `console.log("LONG_CODE_${i}");`,
        ).join("\n"),
      "javascript",
    ),
    {
      type: "table",
      content: Array.from({ length: 5 }, (_, row) => ({
        type: "tr",
        content: Array.from({ length: 3 }, (_, col) => ({
          type: row === 0 ? "th" : "td",
          content: [
            paragraph(
              row === 0
                ? (["元件", "狀態", "說明"][col] ?? "")
                : `表格 ${row}-${col}：網路服務正常`,
            ),
          ],
        })),
      })),
    },
    code(
      "graph LR\n A[文件內容] --> B[列印頁面]\n B --> C[存為 PDF]",
      "mermaid",
    ),
    {
      type: "paragraph",
      content: [
        text("數學公式："),
        { type: "math_inline", content: [text("E = mc^2")] },
      ],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "image",
          attrs: {
            src: fixtureImage(),
            alt: "內嵌圖片驗證",
            width: 240,
            height: 72,
          },
        },
      ],
    },
    paragraph("END_OF_RICH_CONTENT。圖片、Mermaid 與數學公式驗證結束。"),
  );
  const tree: NavigationNode[] = [];
  let branch = tree;
  for (const document of documents.slice(0, 8)) {
    const node = { id: document.id, children: [] };
    branch.push(node);
    branch = node.children;
  }
  for (const document of documents.slice(8))
    tree.push({ id: document.id, children: [] });
  return { title: "Outline Print 技術驗證", documents, tree };
}

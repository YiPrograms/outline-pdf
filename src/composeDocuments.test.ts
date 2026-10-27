import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { composeDocuments } from "./composeDocuments.js";
import type { RenderedDocument } from "./types.js";
type SourceDocument = Omit<RenderedDocument, "element"> & { html: string };

const source = (
  id: string,
  html = '<article><div class="native"><div id="content"><h1><span id="h-install"></span>安裝方法</h1></div></div></article>',
): SourceDocument => ({
  id,
  title: "同名文件",
  parentId: null,
  sourceUrl: `https://outline.example.test/doc/${id}`,
  html,
});
function compose(
  documents: SourceDocument[],
  options = {
    includeToc: true,
    includeHeadingToc: false,
    includeCover: false,
  },
  selectedIds?: ReadonlySet<string>,
) {
  const dom = new JSDOM(
    "<!doctype html><html><head></head><body></body></html>",
  );
  try {
    const rendered = documents.map(({ html, ...source }) => ({
      ...source,
      element: new dom.window.DOMParser().parseFromString(html, "text/html")
        .body,
    }));
    dom.window.document.body.append(
      composeDocuments(dom.window.document, {
        title: "<script>cover</script>",
        documents: rendered,
        selectedIds,
        options,
      }),
    );
  } catch (error) {
    dom.window.close();
    throw error;
  }
  return dom;
}

test("document order and nested TOC preserve eight levels independently of heading levels", () => {
  const documents = Array.from({ length: 8 }, (_, i) => ({
    ...source(`doc-${i}`),
    parentId: i ? `doc-${i - 1}` : null,
  }));
  const before = structuredClone(documents);
  const dom = compose(documents);
  try {
    assert.deepEqual(
      [...dom.window.document.querySelectorAll(".pdf-chapter")].map(
        (el) => el.id,
      ),
      documents.map((d) => `pdf-doc-${d.id}`),
    );
    let row = dom.window.document.querySelector(".pdf-toc > ol > li");
    for (const document of documents) {
      assert.equal(
        row?.querySelector(":scope > a")?.getAttribute("href"),
        `#pdf-doc-${document.id}`,
      );
      row = row!.querySelector(":scope > ol > li");
    }
    assert.deepEqual(documents, before);
  } finally {
    dom.window.close();
  }
});

test("duplicate heading IDs across documents and links with hostile or foreign origins stay unambiguous", () => {
  const html = source("a").html.replace(
    "</article>",
    '<a href="/doc/b#h-install">in book</a><a href="https://foreign.test/doc/b#h-install">foreign</a><a href="/doc/outside#h-install">outside</a><a href="javascript:alert(1)">unsafe</a><a href="#h-install">local</a></article>',
  );
  const dom = compose([source("a", html), source("b")]);
  try {
    const doc = dom.window.document;
    const links = [...doc.querySelectorAll(".pdf-chapter a")];
    const destination = links[0]?.getAttribute("href");
    assert.ok(destination);
    assert.ok(destination?.startsWith("#pdf-doc-b-"));
    assert.ok(doc.getElementById(destination.slice(1))?.closest("#pdf-doc-b"));
    assert.equal(
      links[1]?.getAttribute("href"),
      "https://foreign.test/doc/b#h-install",
    );
    assert.equal(
      links[2]?.getAttribute("href"),
      "https://outline.example.test/doc/outside#h-install",
    );
    assert.equal(links[3]?.hasAttribute("href"), false);
    assert.ok(links[4]?.getAttribute("href")?.startsWith("#pdf-doc-a-"));
  } finally {
    dom.window.close();
  }
});

test("SVG arrow and paint references survive ID namespacing", () => {
  const dom = compose([
    source(
      "a",
      '<article><div id="content"><svg><defs><marker id="arrow"/></defs><path marker-end="url(#arrow)"/><use href="#arrow"/></svg></div></article>',
    ),
  ]);
  try {
    const doc = dom.window.document;
    const id = doc.querySelector("marker")?.id;
    assert.ok(id?.startsWith("pdf-doc-a-"));
    assert.equal(
      doc.querySelector("path")?.getAttribute("marker-end"),
      `url(#${id})`,
    );
    assert.equal(doc.querySelector("use")?.getAttribute("href"), `#${id}`);
  } finally {
    dom.window.close();
  }
});

test("empty scopes, invalid hierarchies and ambiguous native HTML are rejected", () => {
  assert.throws(() => compose([]), /No downloadable/);
  assert.throws(() => compose([source("a"), source("a")]), /hierarchy/);
  assert.throws(
    () => compose([{ ...source("a"), parentId: "a" }]),
    /hierarchy/,
  );
  assert.throws(
    () =>
      compose([
        source("a"),
        { ...source("b"), sourceUrl: source("a").sourceUrl },
      ]),
    /Ambiguous/,
  );
  assert.throws(
    () =>
      compose([
        source(
          "a",
          '<div id="content"><p id="same">first</p><p id="same">second</p></div>',
        ),
      ]),
    /Duplicate native ID/,
  );
});

test("no TOC keeps heading anchors; cover titles are escaped text", () => {
  const dom = compose([source("a")], {
    includeToc: false,
    includeHeadingToc: false,
    includeCover: true,
  });
  try {
    const doc = dom.window.document;
    assert.equal(doc.querySelector(".pdf-toc"), null);
    assert.equal(
      doc.querySelector(".pdf-cover")?.textContent,
      "<script>cover</script>",
    );
    assert.equal(doc.querySelectorAll("script").length, 0);
    assert.ok(doc.querySelector(".pdf-chapter h1 [id]"));
  } finally {
    dom.window.close();
  }
});

test("document and heading contents switch independently and preserve local hierarchy and links", () => {
  const html =
    '<article><div id="content"><h2 id="intro">Intro</h2><h4>Details</h4><h3 id="details-2">Details</h3><h1>Summary</h1><a href="/doc/b#intro">Other intro</a></div></article>';
  for (const includeToc of [false, true]) {
    for (const includeHeadingToc of [false, true]) {
      const dom = compose(
        [source("a", html), { ...source("b", html), parentId: "a" }],
        {
          includeCover: false,
          includeToc,
          includeHeadingToc,
        },
      );
      try {
        const doc = dom.window.document;
        assert.equal(
          doc.querySelectorAll(".pdf-toc").length,
          Number(includeToc),
        );
        assert.equal(
          doc.querySelectorAll(".pdf-document-toc").length,
          includeHeadingToc ? 2 : 0,
        );
        for (const section of doc.querySelectorAll(".pdf-chapter")) {
          const toc = section.querySelector(".pdf-document-toc");
          if (includeHeadingToc) {
            assert.equal(section.children[1], toc);
            assert.deepEqual(
              [...toc!.querySelectorAll(":scope > ol > li > a")].map(
                (a) => a.textContent,
              ),
              ["Intro", "Summary"],
            );
            assert.deepEqual(
              [
                ...toc!.querySelectorAll(
                  ":scope > ol > li:first-child > ol > li > a",
                ),
              ].map((a) => a.textContent),
              ["Details", "Details"],
            );
            for (const link of toc!.querySelectorAll("a")) {
              const heading = doc.getElementById(link.hash.slice(1));
              assert.equal(heading?.closest(".pdf-chapter"), section);
              assert.equal(heading?.textContent, link.textContent);
            }
          }
          const crossLink = [...section.querySelectorAll("article a")].find(
            (a) => a.textContent === "Other intro",
          );
          assert.ok(
            doc
              .getElementById(crossLink!.getAttribute("href")!.slice(1))
              ?.closest("#pdf-doc-b"),
          );
        }
        const ids = [...doc.querySelectorAll("[id]")].map((el) => el.id);
        assert.equal(new Set(ids).size, ids.length);
      } finally {
        dom.window.close();
      }
    }
  }
});

test("documents without headings have no empty heading contents", () => {
  const dom = compose(
    [
      source(
        "a",
        '<article><div id="content"><p>Plain text</p></div></article>',
      ),
    ],
    {
      includeCover: false,
      includeToc: false,
      includeHeadingToc: true,
    },
  );
  try {
    assert.equal(dom.window.document.querySelector("nav"), null);
    assert.equal(
      dom.window.document.querySelector("p")?.textContent,
      "Plain text",
    );
  } finally {
    dom.window.close();
  }
});

test("renamed Outline URLs, short routes and stale headings stay inside included documents", () => {
  const id = "12345678-abcd-4321-abcd-123456789012";
  const urls = [
    "/doc/previous-title-AbCdEf1234#h-install",
    "/d/AbCdEf1234#h-install",
    `/doc/${id.toUpperCase()}#h-install`,
    "/s/shared/doc/old-title-AbCdEf1234/#h-install",
    "http://outline.example.test/doc/old-title-AbCdEf1234#h-install",
    "/doc/old-title-AbCdEf1234#removed-heading",
    "/doc/old-title-AbCdEf1234#bad%zz",
    "https://foreign.test/doc/old-title-AbCdEf1234#h-install",
    "/doc/outside-ZyXwVu9876#h-install",
  ];
  const dom = compose([
    source(
      "a",
      '<article><div id="content">' +
        urls
          .map((href, i) => `<a href="${href}" target="_blank">Link ${i}</a>`)
          .join("") +
        "</div></article>",
    ),
    {
      ...source(id),
      sourceUrl: "https://outline.example.test/doc/current-title-AbCdEf1234",
    },
  ]);
  try {
    const doc = dom.window.document;
    const links = [...doc.querySelectorAll<HTMLAnchorElement>("#pdf-doc-a a")];
    for (const link of links.slice(0, 7)) {
      assert.ok(link.getAttribute("href")?.startsWith("#"));
      assert.equal(link.hasAttribute("target"), false);
      assert.equal(
        doc.getElementById(link.hash.slice(1))?.closest(".pdf-chapter")?.id,
        `pdf-doc-${id}`,
      );
    }
    assert.equal(links[5]?.hash, `#pdf-doc-${id}`);
    assert.equal(links[6]?.hash, `#pdf-doc-${id}`);
    assert.equal(links[7]?.getAttribute("href"), urls[7]);
    assert.equal(links[7]?.target, "_blank");
    assert.equal(
      links[8]?.getAttribute("href"),
      "https://outline.example.test/doc/outside-ZyXwVu9876#h-install",
    );
  } finally {
    dom.window.close();
  }
});

test("repeated native SVG diagrams preserve their own markers and root IDs", () => {
  const diagram =
    '<svg id="diagram" aria-labelledby="diagram-title"><title id="diagram-title">Native diagram</title><defs><marker id="arrow"/></defs><path marker-end="url(#arrow)"/><use href="#arrow"/></svg>';
  const dom = compose([
    source("a", `<article><div>${diagram}${diagram}</div></article>`),
  ]);
  try {
    const ids = [...dom.window.document.querySelectorAll("[id]")].map(
      (node) => node.id,
    );
    assert.equal(new Set(ids).size, ids.length);
    for (const svg of dom.window.document.querySelectorAll("svg")) {
      assert.equal(
        svg.getAttribute("aria-labelledby"),
        svg.querySelector("title")?.id,
      );
      assert.equal(
        svg.querySelector("path")?.getAttribute("marker-end"),
        `url(#${svg.querySelector("marker")?.id})`,
      );
      assert.equal(
        svg.querySelector("use")?.getAttribute("href"),
        `#${svg.querySelector("marker")?.id}`,
      );
    }
  } finally {
    dom.window.close();
  }
});

test("unprinted ancestors group selected descendants without chapters, page links or missing branches", () => {
  const dom = compose(
    [
      { ...source("folder", "<p>FOLDER_BODY</p>"), title: "Folder" },
      {
        ...source(
          "a",
          '<h2 id="intro">Intro</h2><a href="/doc/folder">Parent</a><a href="/doc/b#h-install">Sibling</a>',
        ),
        parentId: "folder",
      },
      { ...source("b"), parentId: "folder" },
      source("excluded"),
    ],
    { includeToc: true, includeHeadingToc: true, includeCover: false },
    new Set(["a", "b"]),
  );
  try {
    const doc = dom.window.document;
    assert.deepEqual(
      [...doc.querySelectorAll(".pdf-chapter")].map((el) => el.id),
      ["pdf-doc-a", "pdf-doc-b"],
    );
    assert.equal(doc.body.textContent?.includes("FOLDER_BODY"), false);
    const group = doc.querySelector(".pdf-toc > ol > li")!;
    assert.equal(group.querySelector(":scope > span")?.textContent, "Folder");
    assert.equal(group.querySelector(":scope > a"), null);
    assert.equal(group.querySelectorAll("ol li a").length, 2);
    assert.equal(doc.querySelectorAll(".pdf-toc > ol > li").length, 1);
    assert.equal(
      doc.querySelector("#pdf-doc-a > :nth-child(2)")?.className,
      "pdf-document-toc",
    );
    const links = [...doc.querySelectorAll("#pdf-doc-a a")].filter(
      (el) => !el.closest("nav"),
    );
    assert.equal(
      links[0]?.getAttribute("href"),
      "https://outline.example.test/doc/folder",
    );
    assert.ok(links[1]?.getAttribute("href")?.startsWith("#pdf-doc-b-"));
  } finally {
    dom.window.close();
  }
});

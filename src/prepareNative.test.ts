import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { prepareNative } from "./prepareNative.js";

function fixture(html: string) {
  const dom = new JSDOM(
    `<div class="print-staging" aria-hidden="true"><div class="ProseMirror">${html}</div></div>`,
  );
  Object.defineProperty(dom.window.document, "fonts", {
    value: { ready: Promise.resolve() },
  });
  return {
    dom,
    root: dom.window.document.body.firstElementChild as HTMLElement,
  };
}
test("native output is copied without altering its highlighting or source DOM", async () => {
  const { dom, root } = fixture(
    '<div class="code-block collapsed" data-language="javascript"><code><span class="native-token">const</span> value = 1;</code></div><img class="ProseMirror-separator"><button>Copy</button><div class="table-wrapper table-sticky-header table-sticky-column" style="--sticky-scroll-offset:40px"><table><colgroup><col style="width:1200px"></colgroup><tbody><tr><th>Header</th></tr></tbody></table></div><div class="mermaid-diagram-wrapper parse-error">Native diagram error</div>',
  );
  const source = root.outerHTML;
  const languages: string[] = [];
  try {
    const copy = await prepareNative(root, {
      signal: new AbortController().signal,
      timeoutMs: 1000,
      loadCodeLanguage: async (language) => {
        languages.push(language);
      },
    });
    assert.deepEqual(languages, ["javascript"]);
    assert.equal(root.outerHTML, source);
    assert.equal(copy.className, "native-document");
    assert.equal(
      copy.querySelectorAll(".table-sticky-header,.table-sticky-column").length,
      0,
    );
    assert.equal(
      (
        copy.querySelector(".table-wrapper") as HTMLElement
      ).style.getPropertyValue("--sticky-scroll-offset"),
      "",
    );
    assert.equal(copy.querySelectorAll(".collapsed").length, 0);
    assert.equal(copy.hasAttribute("aria-hidden"), false);
    assert.equal(
      copy.querySelector("code")?.innerHTML,
      root.querySelector("code")?.innerHTML,
    );
    assert.equal(
      copy.querySelectorAll(".ProseMirror-separator,button").length,
      0,
    );
    assert.equal(copy.querySelectorAll('[data-print-issue="image"]').length, 0);
    assert.equal(
      copy.querySelectorAll('[data-print-issue="diagram"]').length,
      1,
    );
  } finally {
    dom.window.close();
  }
});
test("native loading and fonts are bounded and abort when the view closes", async () => {
  for (const phase of ["code", "fonts", "mount", "abort"]) {
    const { dom, root } = fixture(
      '<div data-language="javascript"><code>const value = 1;</code></div>',
    );
    const controller = new AbortController();
    if (phase === "mount") root.replaceChildren();
    if (phase === "fonts")
      Object.defineProperty(dom.window.document.fonts, "ready", {
        value: new Promise(() => {}),
      });
    try {
      const preparing = prepareNative(root, {
        signal: controller.signal,
        timeoutMs: phase === "fonts" ? 250 : 25,
        loadCodeLanguage: async () => {
          if (phase === "code" || phase === "abort")
            await new Promise(() => {});
        },
      });
      if (phase === "abort") controller.abort();
      await assert.rejects(
        preparing,
        phase === "abort" ? { name: "AbortError" } : /timed out/,
      );
    } finally {
      dom.window.close();
    }
  }
});

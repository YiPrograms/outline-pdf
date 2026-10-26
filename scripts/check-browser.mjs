import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const [base, credentialsFile, output] = process.argv.slice(2);
const fixture = JSON.parse(fs.readFileSync(credentialsFile, "utf8"));
const executablePath =
  process.env.CHROMIUM_PATH ??
  (fs.existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const errors = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1360, height: 1000 },
    locale: "en-US",
    colorScheme: "dark",
  });
  await context.addCookies([
    {
      name: "accessToken",
      value: fixture.token,
      url: base,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  context.on("response", async (response) => {
    if (response.status() === 403) {
      const result = await response.json().catch(() => ({}));
      if (result.error === "csrf_error" || result.code === "csrf_error")
        fs.appendFileSync(
          path.join(output, "csrf-failures.jsonl"),
          JSON.stringify({
            path: new URL(response.url()).pathname,
            code: result.error ?? result.code,
            message: result.message,
            method: response.request().method(),
            page: response.frame().url().split("?")[0],
          }) + "\n",
        );
    }
  });
  const page = await context.newPage();
  context.on("page", (tab) =>
    tab.on("pageerror", (error) => errors.push(error.message)),
  );
  page.on("pageerror", (error) => errors.push(error.message));
  let bridgeUrl;
  page.on("response", (response) => {
    if (response.url().includes("outline-pdf-bridge-"))
      bridgeUrl = response.url();
  });
  const openDocumentDialog = async () => {
    await page
      .getByRole("button", { name: "Document options", exact: true })
      .first()
      .click({ timeout: 30000 });
    await page.getByRole("menuitem", { name: "Export", exact: true }).hover();
    const item = page.getByRole("menuitem", {
      name: "Print to PDF…",
      exact: true,
    });
    await item.focus();
    await item.press("Enter");
    await page
      .getByRole("button", { name: "Open print view", exact: true })
      .waitFor();
  };
  const openView = async (
    buttonName = "Open print view",
    printName = "Print to PDF",
  ) => {
    const opening = context.waitForEvent("page");
    await page.getByRole("button", { name: buttonName, exact: true }).click();
    const view = await opening;
    await view.waitForLoadState("domcontentloaded");
    await view.waitForFunction(
      () => document.getElementById("print-button")?.disabled === false,
    );
    assert.ok(
      await view
        .getByRole("button", { name: printName, exact: true })
        .isEnabled(),
    );
    assert.equal(await view.evaluate(() => window.opener), null);
    return view;
  };
  await page.goto(new URL(fixture.documentPath, base).href);
  await openDocumentDialog();
  const currentDocument = page.getByRole("radio", {
    name: "Current document",
    exact: true,
  });
  const documentTree = page.getByRole("radio", {
    name: "Document tree",
    exact: true,
  });
  assert.equal(await currentDocument.isChecked(), true);
  assert.equal(await page.getByRole("checkbox").count(), 0);
  assert.equal(
    await page
      .getByRole("switch", {
        name: "Document tree table of contents",
        exact: true,
      })
      .count(),
    0,
  );
  const singleView = await openView();
  assert.equal(
    new URL(singleView.url()).searchParams.get("includeToc"),
    "false",
  );
  assert.equal(await singleView.locator(".pdf-toc").count(), 0);
  assert.equal(await singleView.locator(".print-comments").count(), 0);
  await page
    .getByRole("switch", { name: "Show comments", exact: true })
    .check();
  const commentView = await openView();
  assert.equal(await commentView.locator(".print-comment").count(), 2);
  assert.equal(
    await commentView.locator(".print-comment .print-comment").count(),
    1,
  );
  assert.ok(
    (await commentView.locator(".print-comments").innerText()).includes(
      "PRINT_COMMENT_BODY",
    ),
  );
  assert.ok(
    (await commentView.locator(".print-comments").innerText()).includes(
      "PRINT_COMMENT_REPLY",
    ),
  );
  assert.ok(
    !(await commentView.locator(".print-comments").innerText()).includes(
      "DELETED_COMMENT_SECRET",
    ),
  );
  await commentView.locator(".print-comments").screenshot({
    path: path.join(output, "print-comments.png"),
  });
  const commentsPdf = path.join(output, "browser-print-comments.pdf");
  await commentView.pdf({
    path: commentsPdf,
    printBackground: true,
    format: "A4",
  });
  const commentsText = execFileSync("pdftotext", [commentsPdf, "-"], {
    encoding: "utf8",
  });
  assert.ok(commentsText.includes("PRINT_COMMENT_BODY"));
  assert.ok(commentsText.includes("PRINT_COMMENT_REPLY"));
  await commentView.close();
  await page
    .getByRole("switch", { name: "Show comments", exact: true })
    .uncheck();
  await singleView.close();
  await page.screenshot({
    path: path.join(output, "print-dialog-document.png"),
  });
  await documentTree.check();
  const documentContents = page.getByRole("switch", {
    name: "Document tree table of contents",
    exact: true,
  });
  const headingContents = page.getByRole("switch", {
    name: "Document table of contents",
    exact: true,
  });
  assert.equal(await documentContents.isChecked(), true);
  assert.equal(await headingContents.isChecked(), false);
  const parentTheme = await page.evaluate(
    () => getComputedStyle(document.body).color,
  );
  assert.ok(
    parentTheme
      .match(/\d+/g)
      .slice(0, 3)
      .every((value) => Number(value) > 180),
    `Source page uses dark mode: ${parentTheme}`,
  );
  const treeView = await openView();
  assert.equal(
    await treeView
      .locator(".print-page")
      .evaluate((node) => getComputedStyle(node).backgroundColor),
    "rgb(255, 255, 255)",
  );
  const codeBackground = await treeView
    .locator(".code-block pre")
    .first()
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  assert.ok(
    codeBackground
      .match(/\d+/g)
      .slice(0, 3)
      .every((value) => Number(value) > 200),
    `Native code uses a light theme: ${codeBackground}`,
  );
  assert.ok(
    (await treeView.locator(".token.keyword").count()) > 0,
    "Native syntax highlighter has completed",
  );
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.body).color),
    parentTheme,
    "Printing does not alter the user's theme",
  );
  assert.equal(await treeView.locator(".pdf-chapter").count(), 8);
  assert.equal(await treeView.locator(".pdf-toc li").count(), 8);
  await treeView.locator(".pdf-toc a").last().click();
  assert.ok(new URL(treeView.url()).hash.startsWith("#pdf-doc-"));
  await treeView.evaluate(() => {
    window.print = () => {
      window.__printCalled = true;
    };
  });
  await treeView
    .getByRole("button", { name: "Print to PDF", exact: true })
    .click();
  assert.equal(await treeView.evaluate(() => window.__printCalled), true);
  await treeView.screenshot({
    path: path.join(output, "document-tree-print-view.png"),
  });
  await treeView.emulateMedia({ media: "print" });
  assert.equal(await treeView.locator(".print-toolbar").isVisible(), false);
  await treeView.pdf({
    path: path.join(output, "browser-print-a4.pdf"),
    format: "A4",
    scale: 0.85,
    margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" },
    printBackground: true,
  });
  const printedText = execFileSync(
    "pdftotext",
    [path.join(output, "browser-print-a4.pdf"), "-"],
    { encoding: "utf8" },
  );
  assert.ok(printedText.includes("DOC_TOKEN_8"));
  assert.ok(printedText.includes("COMMENT_MARK_TOKEN"));
  assert.ok(
    printedText.includes("LONG_CODE_44"),
    "Long native code blocks print in full",
  );
  assert.ok(!printedText.includes("PRIVATE_TOKEN_MUST_NOT_LEAK"));
  assert.ok(
    !printedText.includes("Print to PDF"),
    "Print toolbar must not appear on paper",
  );
  const a4Info = execFileSync(
    "pdfinfo",
    [path.join(output, "browser-print-a4.pdf")],
    { encoding: "utf8" },
  );
  assert.match(a4Info, /Page size:\s+59\d[.\d]* x 84\d[.\d]*/);
  await treeView.pdf({
    path: path.join(output, "browser-print-letter.pdf"),
    format: "Letter",
    landscape: true,
    scale: 0.9,
    margin: { top: "20mm", bottom: "20mm", left: "20mm", right: "20mm" },
    printBackground: true,
  });
  const letterInfo = execFileSync(
    "pdfinfo",
    [path.join(output, "browser-print-letter.pdf")],
    { encoding: "utf8" },
  );
  assert.match(letterInfo, /Page size:\s+792(?:\.0+)? x 612(?:\.0+)?/);
  await treeView.close();
  for (const [documents, headings] of [
    [true, true],
    [false, true],
    [false, false],
  ]) {
    await documentContents.setChecked(documents);
    await headingContents.setChecked(headings);
    const view = await openView();
    assert.equal(
      new URL(view.url()).searchParams.get("includeToc"),
      String(documents),
    );
    assert.equal(
      new URL(view.url()).searchParams.get("includeHeadingToc"),
      String(headings),
    );
    assert.equal(await view.locator(".pdf-toc").count(), Number(documents));
    assert.equal(
      await view.locator(".pdf-document-toc").count(),
      headings ? 8 : 0,
    );
    if (headings) {
      const link = view.locator(".pdf-document-toc a").first();
      const target = await link.getAttribute("href");
      await link.click();
      assert.equal(new URL(view.url()).hash, target);
    }
    if (documents && headings) {
      await view.evaluate(() => window.scrollTo(0, 0));
      await view.screenshot({
        path: path.join(output, "both-contents-print-view.png"),
      });
      const contentsPdf = path.join(output, "browser-print-contents.pdf");
      await view.pdf({
        path: contentsPdf,
        format: "A4",
        printBackground: true,
      });
      const urls = execFileSync("pdfinfo", ["-url", contentsPdf], {
        encoding: "utf8",
      });
      assert.ok(
        !urls.includes("/print?"),
        "Contents links must stay inside the PDF",
      );
    }
    await view.close();
  }
  await currentDocument.check();
  assert.equal(await documentContents.count(), 0);
  await documentTree.check();
  assert.equal(await documentContents.isChecked(), false);
  await documentContents.check();

  const language = (lng) =>
    page.evaluate(
      async ({ value, bridgeUrl }) => {
        assertPresent(bridgeUrl);
        const bridge = await (await fetch(bridgeUrl)).text();
        const hook = bridge.match(
          /import \{[^}]+ as __pdfUseTranslation\} from "([^"]+)"/,
        );
        assertPresent(hook);
        const native = await import(new URL(hook[1], bridgeUrl).href);
        const instance = native.r();
        await instance.changeLanguage(value);
        function assertPresent(value) {
          if (!value) throw new Error("Native translation bridge missing");
        }
      },
      { value: lng, bridgeUrl },
    );

  await language("zh-TW");
  await page.getByRole("dialog", { name: "PDF 列印", exact: true }).waitFor();
  await page.getByRole("switch", { name: "文件樹目錄", exact: true }).waitFor();
  await page.getByRole("switch", { name: "文件目錄", exact: true }).waitFor();
  const translated = await openView("開啟列印頁", "PDF 列印");
  assert.equal(new URL(translated.url()).searchParams.get("language"), "zh-TW");
  await translated.close();
  await page.screenshot({
    path: path.join(output, "advanced-print-dialog-zh-TW.png"),
  });
  await language("zh-CN");
  await page
    .getByRole("button", { name: "打开打印页面", exact: true })
    .waitFor();
  await language("en-GB");
  const englishView = await openView();
  assert.equal(
    new URL(englishView.url()).searchParams.get("language"),
    "en-US",
  );
  await englishView.close();
  await language("pl-PL");
  await page
    .getByRole("button", { name: "Open print view", exact: true })
    .waitFor();
  await language("en-US");
  await page.keyboard.press("Escape");
  await page
    .locator(`a[href=${JSON.stringify(fixture.otherDocumentPath)}]`)
    .first()
    .click();
  await openDocumentDialog();
  const nextView = await openView();
  assert.equal(await nextView.locator(".pdf-chapter").count(), 1);
  await nextView.close();
  await page.keyboard.press("Escape");
  const collection = await page.evaluate(
    async (id) =>
      (
        await (
          await fetch("/api/collections.info", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id }),
          })
        ).json()
      ).data,
    fixture.collectionId,
  );
  await page.goto(new URL(collection.url, base).href);
  await page
    .getByRole("button", { name: "Collection options", exact: true })
    .last()
    .click();
  await page.getByRole("menuitem", { name: /^Export/ }).click();
  await page
    .getByRole("button", { name: "Print to PDF…", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("radio", { name: "Entire collection", exact: true })
      .isChecked(),
    true,
  );
  assert.equal(
    await page
      .getByRole("switch", {
        name: "Document tree table of contents",
        exact: true,
      })
      .isChecked(),
    true,
  );
  const collectionView = await openView();
  assert.equal(await collectionView.locator(".pdf-chapter").count(), 10);
  const depth = await collectionView.evaluate(() =>
    Math.max(
      ...[...document.querySelectorAll(".pdf-toc li")].map((item) => {
        let depth = 1;
        while ((item = item.parentElement.closest("li"))) depth++;
        return depth;
      }),
    ),
  );
  assert.equal(depth, 8);
  await collectionView.screenshot({
    path: path.join(output, "collection-print-view.png"),
  });
  await collectionView.close();
  const broken = await context.newPage();
  await broken.goto(
    new URL(`/print?sourceId=${fixture.brokenId}&scope=document`, base).href,
  );
  await broken.waitForFunction(
    () => document.getElementById("print-button")?.disabled === false,
  );
  assert.equal(await broken.getByRole("alert").count(), 1);
  assert.equal(
    await broken.getByRole("alert").textContent(),
    "Images unavailable: 1 · Diagrams unavailable: 1",
  );
  const issue = broken.getByRole("link", {
    name: "Diagrams unavailable: 1",
    exact: true,
  });
  await issue.click();
  assert.ok(
    await broken.evaluate(
      () => !!document.getElementById(location.hash.slice(1)),
    ),
  );
  await broken.close();
  const diagram = await context.newPage();
  await diagram.goto(
    new URL(`/print?sourceId=${fixture.diagramId}&scope=document`, base).href,
  );
  await diagram.waitForFunction(
    () => document.getElementById("print-button")?.disabled === false,
  );
  assert.equal(
    await diagram
      .locator(".native-document img")
      .evaluate((image) => image.naturalWidth),
    300,
  );
  await diagram.screenshot({
    path: path.join(output, "drawio-print-view.png"),
  });
  await diagram.pdf({
    path: path.join(output, "browser-print-drawio.pdf"),
    format: "A4",
    printBackground: true,
  });
  assert.ok(
    execFileSync(
      "pdftotext",
      [path.join(output, "browser-print-drawio.pdf"), "-"],
      { encoding: "utf8" },
    ).includes("Draw.io label"),
  );
  await diagram.close();
  assert.deepEqual(errors, [], "Browser script errors");
  const report = {
    status: "passed",
    documentAndSubtreePrintUi: true,
    collectionPrintUi: true,
    nestedTocDepth: depth,
    internalLinks: true,
    nativePrintAction: true,
    nativeWebEditor: true,
    lightPrintInDarkMode: true,
    customPaperMarginsAndScale: true,
    localizedUi: ["en-US", "zh-TW", "zh-CN"],
    languageFallback: true,
    independentContentsOptions: true,
    subsequentPagePrint: true,
    brokenAssetsRemainPrintable: true,
    drawioSvg: true,
    browserScriptErrors: errors.length,
  };
  fs.writeFileSync(
    path.join(output, "browser-checks.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} catch (error) {
  fs.writeFileSync(
    path.join(output, "browser-errors.json"),
    JSON.stringify(errors),
  );
  for (const page of browser.contexts().flatMap((context) => context.pages())) {
    await page
      .screenshot({ path: path.join(output, "browser-failure.png") })
      .catch(() => {});
    fs.appendFileSync(
      path.join(output, "browser-staging.txt"),
      await page
        .locator(".print-staging")
        .evaluateAll((nodes) => nodes.map((node) => node.outerHTML).join("\n"))
        .catch(() => ""),
    );
    fs.appendFileSync(
      path.join(output, "browser-failure.txt"),
      await page
        .locator("body")
        .innerText()
        .catch(() => ""),
    );
  }
  throw error;
} finally {
  await browser.close();
}

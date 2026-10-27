import assert from "node:assert/strict";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { devices } from "playwright-core";

export async function checkDocumentSelection(view, browser, context, output) {
  const ready = () =>
    view.waitForFunction(
      () => document.getElementById("print-button")?.disabled === false,
    );
  const chapters = () =>
    view
      .locator(".pdf-chapter")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.id.replace("pdf-doc-", "")),
      );
  const original = await chapters();
  const row = (id) => view.locator(`[data-document-id="${id}"]`);
  let requests = 0;
  view.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/advancedPrint.info")
      requests++;
  });
  // The first eight documents form a nested branch, followed by two root siblings.
  await row(original[0]).getByRole("checkbox").uncheck();
  await ready();
  assert.deepEqual(await chapters(), original.slice(1));
  assert.equal(await row(original[1]).getByRole("checkbox").isChecked(), true);
  assert.equal(await view.locator(".pdf-toc > ol > li > span").count(), 1);
  assert.equal(await view.locator(".pdf-toc a").count(), 9);
  await row(original[0]).locator("select").selectOption("deselect");
  await ready();
  assert.deepEqual(await chapters(), original.slice(8));
  await row(original[0]).locator("select").selectOption("select");
  await ready();
  assert.deepEqual(await chapters(), original);
  await view.getByRole("button", { name: "Deselect all", exact: true }).click();
  await view.getByText("No documents selected.", { exact: true }).waitFor();
  assert.equal(await view.locator("#print-button").isDisabled(), true);
  assert.equal(await view.locator(".pdf-chapter").count(), 0);
  await view.getByRole("button", { name: "Select all", exact: true }).click();
  await ready();
  await view
    .getByRole("button", { name: "Deselect empty", exact: true })
    .click();
  await ready();
  assert.deepEqual(
    await chapters(),
    original,
    "Rich fixture documents are never considered empty",
  );
  await row(original[0]).locator(".print-tree-expand").click();
  assert.equal(await view.locator(".print-document-row").count(), 3);
  const grip = row(original[0]).locator(".print-drag-handle");
  await grip.scrollIntoViewIfNeeded();
  const from = await grip.boundingBox();
  const target = await row(original[8]).boundingBox();
  await view.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await view.mouse.down();
  await view.mouse.move(
    target.x + target.width / 2,
    target.y + target.height - 5,
    { steps: 10 },
  );
  await view.locator(".drop-after").waitFor();
  await view.mouse.up();
  await ready();
  const reordered = [original[8], ...original.slice(0, 8), original[9]];
  assert.deepEqual(
    await chapters(),
    reordered,
    "Pointer drag moves the whole branch",
  );
  await view.screenshot({ path: path.join(output, "document-selection.png") });
  await grip.press("ArrowUp");
  await ready();
  assert.deepEqual(
    await chapters(),
    original,
    "Keyboard reordering retains hierarchy",
  );
  await row(original[0]).locator("select").selectOption("down");
  await ready();
  assert.deepEqual(await chapters(), reordered);
  // Exclude the folder after moving its branch; selected children retain that order.
  await row(original[0]).getByRole("checkbox").uncheck();
  await ready();
  assert.deepEqual(
    await chapters(),
    reordered.filter((id) => id !== original[0]),
  );
  await view
    .getByRole("switch", { name: "Show page numbers", exact: true })
    .check();
  await ready();
  await view
    .getByRole("radio", { name: "Per-document page numbers", exact: true })
    .locator("..")
    .click();
  await ready();
  await view
    .getByRole("switch", {
      name: "Page numbers in table of contents",
      exact: true,
    })
    .check();
  await ready();
  const chapterOrder = await view
    .locator('.pdf-chapter[id^="pdf-doc-"]')
    .evaluateAll((nodes) => [
      ...new Set(nodes.map((node) => node.id.replace("pdf-doc-", ""))),
    ]);
  assert.deepEqual(
    chapterOrder,
    reordered.filter((id) => id !== original[0]),
  );
  assert.equal(
    await view.locator(".pdf-toc > ol > li > span .toc-page-number").count(),
    0,
  );
  const labels = await view
    .locator(".pdf-toc a .toc-page-number")
    .allTextContents();
  assert.equal(labels.length, 9);
  assert.ok(
    labels.every((label, i) => label === `${i + 1}-1`),
    `Page numbers follow selected print order: ${labels}`,
  );
  const pdf = path.join(output, "selected-document-order.pdf");
  await view.pdf({ path: pdf, preferCSSPageSize: true, printBackground: true });
  const text = execFileSync("pdftotext", [pdf, "-"], { encoding: "utf8" });
  assert.ok(text.indexOf("DOC_TOKEN_9") < text.indexOf("DOC_TOKEN_2"));
  assert.ok(
    !/DOC_TOKEN_1\b/.test(text),
    "Unchecked parent body never enters the PDF",
  );
  assert.equal(
    requests,
    0,
    "Selection and order reuse the authorized snapshot",
  );

  const comments = view.getByRole("switch", {
    name: "Show comments",
    exact: true,
  });
  await comments.check();
  await ready();
  assert.equal(await row(original[0]).getByRole("checkbox").isChecked(), false);
  assert.deepEqual(
    await view
      .locator('.pdf-chapter[id^="pdf-doc-"]')
      .evaluateAll((nodes) => [
        ...new Set(nodes.map((node) => node.id.replace("pdf-doc-", ""))),
      ]),
    reordered.filter((id) => id !== original[0]),
  );
  assert.equal(
    requests,
    1,
    "Changing comments refetches while preserving selection and order",
  );

  // Real Chromium touch events exercise pointer capture on a narrow screen.
  const mobile = await browser.newContext({
    ...devices["Pixel 7"],
    locale: "en-US",
  });
  await mobile.addCookies(await context.cookies());
  const tab = await mobile.newPage();
  await tab.goto(
    view
      .url()
      .replace(/pageNumbers=[^&]*/, "pageNumbers=none")
      .replace(/tocPageNumbers=[^&]*/, "tocPageNumbers=false"),
  );
  await tab.waitForFunction(
    () => document.getElementById("print-button")?.disabled === false,
  );
  await tab.getByText("Print settings", { exact: true }).click();
  await tab
    .locator(`[data-document-id="${original[0]}"] .print-tree-expand`)
    .click();
  const touchGrip = tab.locator(
    `[data-document-id="${original[0]}"] .print-drag-handle`,
  );
  await touchGrip.scrollIntoViewIfNeeded();
  const a = await touchGrip.boundingBox();
  const b = await tab
    .locator(`[data-document-id="${original[8]}"]`)
    .boundingBox();
  const client = await mobile.newCDPSession(tab);
  const start = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
  const end = { x: b.x + b.width / 2, y: b.y + b.height - 5 };
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [start],
  });
  for (let i = 1; i <= 10; i++)
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x: start.x + ((end.x - start.x) * i) / 10,
          y: start.y + ((end.y - start.y) * i) / 10,
        },
      ],
    });
  await tab.locator(".drop-after").waitFor();
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await tab.waitForFunction(
    () => document.getElementById("print-button")?.disabled === false,
  );
  assert.deepEqual(
    await tab
      .locator(".pdf-chapter")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.id.replace("pdf-doc-", "")),
      ),
    reordered,
  );
  await tab.screenshot({
    path: path.join(output, "mobile-document-selection.png"),
  });
  await mobile.close();
}

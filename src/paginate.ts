import { Previewer } from "pagedjs";
import type { PageNumbers, PageNumberPosition } from "./pageNumbers.js";

export interface PageLayout {
  paper: "A4" | "A3" | "Letter";
  orientation: "portrait" | "landscape";
  margin: number;
}

/** Keep native document styles; paginate only the detached print DOM. */
export async function paginate(
  source: HTMLElement,
  target: HTMLElement,
  layout: PageLayout,
  mode: Exclude<PageNumbers, "none">,
  position: PageNumberPosition,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const preview = new Previewer();
  const cancel = () => preview.chunker.stop();
  signal.addEventListener("abort", cancel, { once: true });
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    cancel();
  }, 120000);
  const fragment = document.createDocumentFragment();
  const copy = source.cloneNode(true) as HTMLElement;
  const canvases = [...source.querySelectorAll("canvas")];
  [...copy.querySelectorAll("canvas")].forEach((canvas, index) => {
    canvas.dataset.printCanvas = String(index);
  });
  [...copy.querySelectorAll<HTMLElement>(".pdf-chapter")].forEach(
    (chapter, index) => {
      chapter.dataset.printDocument = String(index + 1);
      chapter.style.removeProperty("page");
    },
  );
  for (const link of copy.querySelectorAll(".pdf-toc a, .pdf-document-toc a")) {
    const number = document.createElement("span");
    number.className = "toc-page-number";
    link.append(number);
  }
  fragment.append(...copy.childNodes);
  const dimensions = { A4: [210, 297], A3: [297, 420], Letter: [215.9, 279.4] }[
    layout.paper
  ]!;
  const [width, height] =
    layout.orientation === "landscape" ? [...dimensions].reverse() : dimensions;
  const css = `
    @page { size: ${width}mm ${height}mm; margin: ${layout.margin}mm;
      @${position} { content: " "; font: 9pt sans-serif; color: #555; text-align: ${position.split("-")[1]}; }
    }
    .pdf-chapter { break-before: page; }
    .paginated .pdf-cover { min-height: 0; height: calc(var(--pagedjs-pagebox-height) - var(--pagedjs-margin-top) - var(--pagedjs-margin-bottom)); break-after: page; }
    h1,h2,h3,h4,h5,h6 { break-after: avoid; }
    tr,blockquote,.notice-block { break-inside: avoid; }
    .native-document .table-scrollable { margin: 0 !important; padding: 0 !important; }
  `;
  try {
    const flow = await preview.preview(
      fragment,
      [{ [window.location.href]: css }],
      target,
    );
    signal.throwIfAborted();
    if (timedOut) throw new Error("Print pagination timed out");
    for (const canvas of target.querySelectorAll<HTMLCanvasElement>(
      "canvas[data-print-canvas]",
    )) {
      const original = canvases[Number(canvas.dataset.printCanvas)];
      if (original?.width && original.height)
        canvas.getContext("2d")?.drawImage(original, 0, 0);
    }
    const anchors = new Map<string, string>();
    const documentPages = new Map<string, number>();
    flow.pages.forEach(({ element }, index) => {
      const documentId = element.querySelector<HTMLElement>(
        "[data-print-document]",
      )?.dataset.printDocument;
      let label = String(index + 1);
      if (documentId && mode === "document") {
        const page = (documentPages.get(documentId) ?? 0) + 1;
        documentPages.set(documentId, page);
        label = `${documentId}-${page}`;
      }
      const number = element.querySelector(
        `.pagedjs_margin-${position} .pagedjs_margin-content`,
      );
      if (number) number.textContent = label;
      for (const anchor of element.querySelectorAll<HTMLElement>("[id]"))
        if (!anchors.has(anchor.id)) anchors.set(anchor.id, label);
    });
    for (const link of target.querySelectorAll<HTMLAnchorElement>(
      ".pdf-toc a, .pdf-document-toc a",
    )) {
      const label = anchors.get(decodeURIComponent(link.hash.slice(1)));
      if (!label) throw new Error("Missing paginated contents target");
      link.querySelector(".toc-page-number")!.textContent = label;
    }
    return () => {
      preview.chunker.stop();
      preview.chunker.destroy();
      preview.polisher.destroy();
    };
  } catch (error) {
    preview.chunker.stop();
    preview.polisher.destroy();
    target.replaceChildren();
    throw error;
  } finally {
    clearTimeout(deadline);
    signal.removeEventListener("abort", cancel);
  }
}

/** Wait for native editor output, then detach a copy for print-only anchors/layout. */
export async function prepareNative(
  root: HTMLElement,
  options: {
    signal: AbortSignal;
    timeoutMs: number;
    editors?: number;
    loadCodeLanguage: (language: string) => Promise<unknown>;
  },
) {
  const deadline = Date.now() + options.timeoutMs;
  let changed = Date.now();
  const observer = new root.ownerDocument.defaultView!.MutationObserver(() => {
    changed = Date.now();
  });
  observer.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  const bounded = <T>(promise: Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      options.signal.throwIfAborted();
      const abort = () => {
        cleanup();
        reject(options.signal.reason);
      };
      const timer = setTimeout(
        () => {
          cleanup();
          reject(new Error("Native print rendering timed out"));
        },
        Math.max(1, deadline - Date.now()),
      );
      const cleanup = () => {
        clearTimeout(timer);
        options.signal.removeEventListener("abort", abort);
      };
      options.signal.addEventListener("abort", abort, { once: true });
      promise.then(
        (value) => {
          cleanup();
          resolve(value);
        },
        (error) => {
          cleanup();
          reject(error);
        },
      );
    });
  const pause = async () => {
    options.signal.throwIfAborted();
    if (Date.now() >= deadline)
      throw new Error("Native print rendering timed out");
    await new Promise((resolve) => setTimeout(resolve, 50));
  };
  try {
    while (
      root.querySelectorAll(".ProseMirror").length < (options.editors ?? 1)
    )
      await pause();
    const languages = new Set(
      [...root.querySelectorAll("[data-language]")].map(
        (node) => node.getAttribute("data-language") ?? "",
      ),
    );
    await bounded(Promise.all([...languages].map(options.loadCodeLanguage)));
    for (;;) {
      options.signal.throwIfAborted();
      for (const image of root.querySelectorAll<HTMLImageElement>("img[src]"))
        if (image.loading !== "eager") image.loading = "eager";
      const images = [...root.querySelectorAll<HTMLImageElement>("img[src]")];
      const diagrams = [...root.querySelectorAll(".mermaid-diagram-wrapper")];
      const pending =
        images.some((image) => !image.complete) ||
        diagrams.some(
          (node) =>
            !node.querySelector("svg") &&
            !node.classList.contains("parse-error") &&
            !node.classList.contains("empty"),
        );
      if (!pending && Date.now() - changed >= 150) break;
      await pause();
    }
    await bounded(root.ownerDocument.fonts.ready);
    await bounded(
      Promise.all(
        [...root.querySelectorAll<HTMLImageElement>("img[src]")].map((image) =>
          image.decode().catch(() => {}),
        ),
      ),
    );
    options.signal.throwIfAborted();
    const copy = root.cloneNode(true) as HTMLElement;
    const canvases = [...copy.querySelectorAll("canvas")];
    [...root.querySelectorAll("canvas")].forEach((canvas, index) => {
      if (canvas.width && canvas.height)
        canvases[index]?.getContext("2d")?.drawImage(canvas, 0, 0);
    });
    [...root.querySelectorAll("table")].forEach((table, index) => {
      const columns = [
        ...table.querySelectorAll<HTMLTableColElement>(
          ":scope > colgroup > col",
        ),
      ];
      const widths = columns.map(
        (column) => column.getBoundingClientRect().width,
      );
      const total = widths.reduce((sum, width) => sum + width, 0);
      [...copy.querySelectorAll("table")][index]
        ?.querySelectorAll<HTMLTableColElement>(":scope > colgroup > col")
        .forEach((column, index) => {
          if (total) column.style.width = `${(widths[index]! / total) * 100}%`;
          else column.style.removeProperty("width");
        });
    });
    copy.className = "native-document";
    copy.removeAttribute("aria-hidden");
    for (const node of copy.querySelectorAll(
      ".code-block.collapsed,.toggle-block.folded,.checklist-wrapper.completed-hidden",
    ))
      node.classList.remove("collapsed", "folded", "completed-hidden");
    for (const table of copy.querySelectorAll<HTMLElement>(".table-wrapper")) {
      table.classList.remove(
        "table-sticky-header",
        "table-sticky-column",
        "table-shadow-left",
        "table-shadow-right",
      );
      for (const property of [
        "--sticky-scroll-offset",
        "--table-height",
        "--table-width",
      ])
        table.style.removeProperty(property);
    }
    for (const node of copy.querySelectorAll(".ProseMirror-separator, button"))
      node.remove();
    for (const node of copy.querySelectorAll(
      ".image-wrapper > div.image-handle",
    ))
      node.setAttribute("data-print-issue", "image");
    for (const node of copy.querySelectorAll(
      ".mermaid-diagram-wrapper.parse-error",
    ))
      node.setAttribute("data-print-issue", "diagram");
    const originals = [...root.querySelectorAll<HTMLImageElement>("img[src]")];
    [...copy.querySelectorAll<HTMLImageElement>("img[src]")].forEach(
      (image, index) => {
        if (!originals[index]?.naturalWidth)
          image.setAttribute("data-print-issue", "image");
      },
    );
    for (const input of copy.querySelectorAll("input,textarea,select"))
      (input as HTMLInputElement).disabled = true;
    return copy;
  } finally {
    observer.disconnect();
  }
}

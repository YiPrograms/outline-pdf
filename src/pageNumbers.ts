export type PageNumbers = "none" | "continuous" | "document";

/** Native margin counters follow the browser's final paper, scale and margins. */
export function pageNumberStyles(root: HTMLElement, mode: PageNumbers) {
  if (mode === "none") return "";
  let css = `@page { margin-bottom: 12mm; @bottom-center { content: counter(page); font: 9pt sans-serif; color: #555; } }`;
  if (mode === "document") {
    const counters: string[] = [];
    [...root.querySelectorAll<HTMLElement>(".pdf-chapter")].forEach(
      (chapter, index) => {
        const name = `print-document-${index + 1}`;
        chapter.style.page = name;
        counters.push(`${name} 0`);
        css += `@page ${name} { counter-increment: ${name}; @bottom-center { content: "${String(index + 1).padStart(2, "0")}-" counter(${name}, decimal-leading-zero); } }`;
      },
    );
    css += `@media print { body { counter-reset: ${counters.join(" ")}; } }`;
  }
  return css;
}

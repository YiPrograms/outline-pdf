export type PageNumberPosition =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export type PageNumbers = "none" | "continuous" | "document";

/** Native margin counters follow the browser's final paper, scale and margins. */
export function pageNumberStyles(
  root: HTMLElement,
  mode: PageNumbers,
  position: PageNumberPosition,
) {
  if (mode === "none") return "";
  const edge = position.startsWith("top") ? "top" : "bottom";
  let css = `@page { margin-${edge}: 12mm; @${position} { content: counter(page); font: 9pt sans-serif; color: #555; text-align: ${position.split("-")[1]}; } }`;
  if (mode === "document") {
    const counters: string[] = [];
    [...root.querySelectorAll<HTMLElement>(".pdf-chapter")].forEach(
      (chapter, index) => {
        const name = `print-document-${index + 1}`;
        chapter.style.page = name;
        counters.push(`${name} 0`);
        css += `@page ${name} { counter-increment: ${name}; @${position} { content: "${index + 1}-" counter(${name}); } }`;
      },
    );
    css += `@media print { body { counter-reset: ${counters.join(" ")}; } }`;
  }
  return css;
}

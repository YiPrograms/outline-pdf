declare module "pagedjs" {
  export class Previewer {
    preview(
      content: DocumentFragment,
      stylesheets: Record<string, string>[],
      target: HTMLElement,
    ): Promise<{ pages: { element: HTMLElement }[] }>;
    chunker: { stop(): void; destroy(): void };
    polisher: { destroy(): void };
  }
}

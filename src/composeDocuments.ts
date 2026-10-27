import type { RenderedDocument } from "./types.js";

/** Append authorized documents in navigation order, with links scoped to the page. */
export function composeDocuments(
  doc: Document,
  input: {
    title: string;
    documents: RenderedDocument[];
    selectedIds?: ReadonlySet<string>;
    options: {
      includeToc: boolean;
      includeHeadingToc: boolean;
      includeCover: boolean;
    };
  },
) {
  if (!input.documents.length) throw new Error("No downloadable documents");
  const output = doc.createDocumentFragment();
  const aliases = new Map<string, string>();
  const chapters = new Map<
    string,
    { section: HTMLElement; fragments: Map<string, string> }
  >();
  const seen = new Set<string>();
  doc.title = input.title;
  for (const source of input.documents) {
    if (
      !/^[a-zA-Z0-9-]+$/.test(source.id) ||
      seen.has(source.id) ||
      (source.parentId && !seen.has(source.parentId))
    )
      throw new Error("Invalid document hierarchy");
    seen.add(source.id);
    if (input.selectedIds && !input.selectedIds.has(source.id)) continue;
    const sourceUrl = new URL(source.sourceUrl);
    if (!/^https?:$/.test(sourceUrl.protocol))
      throw new Error("Invalid document URL");
    for (const pathname of [sourceUrl.pathname, `/doc/${source.id}`]) {
      const key = documentKey(new URL(pathname, sourceUrl));
      if (aliases.has(key) && aliases.get(key) !== source.id)
        throw new Error("Ambiguous source URL");
      aliases.set(key, source.id);
    }
    const section = doc.createElement("section");
    section.className = "pdf-chapter";
    section.id = `pdf-doc-${source.id}`;
    const title = doc.createElement("h1");
    title.textContent = source.title;
    section.append(title, doc.adoptNode(source.element));
    for (const el of section.querySelectorAll("script,base")) el.remove();
    for (const [index, svg] of [...section.querySelectorAll("svg")].entries()) {
      namespaceIds(svg, `${section.id}-svg-${index}`, true);
    }
    const fragments = namespaceIds(section, section.id);
    chapters.set(source.id, { section, fragments });
    output.append(section);
  }
  for (const source of input.documents) {
    const chapter = chapters.get(source.id);
    if (!chapter) continue;
    for (const link of chapter.section.querySelectorAll("a[href]")) {
      const href = link.getAttribute("href") ?? "";
      let url: URL;
      try {
        url = new URL(href, source.sourceUrl);
      } catch {
        link.removeAttribute("href");
        continue;
      }
      if (!["http:", "https:", "mailto:", "tel:"].includes(url.protocol)) {
        link.removeAttribute("href");
        continue;
      }
      const targetId = href.startsWith("#")
        ? source.id
        : aliases.get(documentKey(url));
      const target = targetId ? chapters.get(targetId) : undefined;
      let anchor;
      try {
        anchor = url.hash
          ? target?.fragments.get(decodeURIComponent(url.hash.slice(1)))
          : target?.section.id;
      } catch {
        /* Fall back to the included document if its old heading no longer exists. */
      }
      anchor ??= target?.section.id;
      if (anchor) {
        link.removeAttribute("target");
        link.removeAttribute("download");
      }
      link.setAttribute("href", anchor ? `#${anchor}` : url.href);
    }
  }
  if (input.options.includeHeadingToc) {
    for (const source of input.documents) {
      const section = chapters.get(source.id)?.section;
      if (!section) continue;
      const entries: ContentsEntry[] = [];
      const parents: { id: string; level: number }[] = [];
      for (const heading of section.querySelectorAll("h1,h2,h3,h4,h5,h6")) {
        if (
          heading === section.firstElementChild ||
          heading.closest(".print-comments")
        )
          continue;
        const title = heading.textContent?.trim();
        if (!title) continue;
        const level = Number(heading.tagName[1]);
        while (parents.length && parents.at(-1)!.level >= level) parents.pop();
        heading.id ||= `${section.id}-heading-${entries.length}`;
        entries.push({
          id: heading.id,
          title,
          parentId: parents.at(-1)?.id ?? null,
        });
        parents.push({ id: heading.id, level });
      }
      if (entries.length) {
        const toc = contents(doc, entries, "pdf-document-toc");
        toc.setAttribute("aria-label", source.title);
        section.firstElementChild!.after(toc);
      }
    }
  }
  if (input.options.includeToc) {
    // Retain unprinted ancestors as plain grouping labels, without empty chapters.
    const included = new Set(chapters.keys());
    for (const source of [...input.documents].reverse())
      if (included.has(source.id) && source.parentId)
        included.add(source.parentId);
    const toc = contents(
      doc,
      input.documents
        .filter((source) => included.has(source.id))
        .map((source) => ({
          id: `pdf-doc-${source.id}`,
          title: source.title,
          parentId: source.parentId ? `pdf-doc-${source.parentId}` : null,
          grouping: !chapters.has(source.id),
        })),
      "pdf-toc",
    );
    toc.setAttribute("aria-label", input.title);
    const title = doc.createElement("div");
    title.className = "pdf-toc-title";
    title.textContent = input.title;
    toc.prepend(title);
    output.prepend(toc);
  }
  if (input.options.includeCover) {
    const cover = doc.createElement("section");
    cover.className = "pdf-cover";
    cover.textContent = input.title;
    output.prepend(cover);
  }
  const ids = [...output.querySelectorAll("[id]")].map((el) => el.id);
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate print IDs");
  return output;
}

interface ContentsEntry {
  id: string;
  title: string;
  parentId: string | null;
  grouping?: boolean;
}
function contents(doc: Document, entries: ContentsEntry[], className: string) {
  const toc = doc.createElement("nav");
  toc.className = className;
  const root = doc.createElement("ol");
  const lists = new Map<string, HTMLOListElement>();
  toc.append(root);
  for (const entry of entries) {
    const row = doc.createElement("li");
    const link = doc.createElement(entry.grouping ? "span" : "a");
    if (!entry.grouping) link.setAttribute("href", `#${entry.id}`);
    link.textContent = entry.title;
    row.append(link);
    (entry.parentId ? lists.get(entry.parentId)! : root).append(row);
    const children = doc.createElement("ol");
    lists.set(entry.id, children);
    row.append(children);
  }
  for (const list of lists.values()) if (!list.children.length) list.remove();
  return toc;
}

/** Outline identifies documents by UUID or the stable URL suffix, even after a rename. */
function documentKey(url: URL) {
  const match = url.pathname.match(/^\/(?:s\/[^/]+\/)?(?:doc|d)\/([^/]+)\/?$/);
  if (!match) return `${url.host}${url.pathname}`;
  let slug;
  try {
    slug = decodeURIComponent(match[1]!);
  } catch {
    return `${url.host}${url.pathname}`;
  }
  const id = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(slug)
    ? slug.toLowerCase()
    : (slug.match(/(?:^|-)([a-zA-Z0-9]{10,15})$/)?.[1] ?? slug);
  return `${url.host}/doc/${id}`;
}

function namespaceIds(root: Element, prefix: string, includeRoot = false) {
  const fragments = new Map<string, string>();
  for (const el of [
    ...(includeRoot && root.id ? [root] : []),
    ...root.querySelectorAll("[id]"),
  ]) {
    if (fragments.has(el.id)) throw new Error(`Duplicate native ID: ${el.id}`);
    const id = `${prefix}-id-${fragments.size}`;
    fragments.set(el.id, id);
    el.id = id;
  }
  for (const el of [
    ...(includeRoot ? [root] : []),
    ...root.querySelectorAll("*"),
  ]) {
    for (const attr of [...el.attributes]) {
      if (/^on/i.test(attr.name)) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (attr.name === "id") continue;
      let value = attr.value.replace(
        /url\(["']?#([^)'"\s]+)["']?\)/g,
        (original, id: string) =>
          fragments.has(id) ? `url(#${fragments.get(id)})` : original,
      );
      if (["aria-labelledby", "aria-describedby", "for"].includes(attr.name))
        value = value
          .split(/\s+/)
          .map((id) => fragments.get(id) ?? id)
          .join(" ");
      if (
        el.namespaceURI === "http://www.w3.org/2000/svg" &&
        ["href", "xlink:href"].includes(attr.name) &&
        value.startsWith("#")
      )
        value = `#${fragments.get(value.slice(1)) ?? value.slice(1)}`;
      el.setAttribute(attr.name, value);
    }
  }

  return fragments;
}

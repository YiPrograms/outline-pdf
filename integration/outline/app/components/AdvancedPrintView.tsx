import {
  React,
  NativeEditor,
  nativeExtensions,
  ThemeProvider,
  useBuildTheme,
  loadCodeLanguage,
} from "./outline-pdf-bridge.js";
import { usePrintTranslation } from "../utils/printI18n";
import { composeDocuments } from "../../../../src/composeDocuments";
import { prepareNative } from "../../../../src/prepareNative";
import type {
  PrintSnapshot,
  RenderedDocument,
  PrintComment,
} from "../../../../src/types";
import { pageNumberStyles } from "../../../../src/pageNumbers";
import { paginate } from "../../../../src/paginate";
import type { PageLayout } from "../../../../src/paginate";
import printCss from "../../../../src/print.css";

/** Reuses Outline's web editor under a light theme without changing user preferences. */
export function AdvancedPrintView() {
  const theme = useBuildTheme({}, "light");
  return (
    <ThemeProvider theme={theme}>
      <PrintContent theme={theme} />
    </ThemeProvider>
  );
}
function PrintContent({
  theme,
}: {
  theme: { background: string; text: string; link: string };
}) {
  const query = React.useMemo(() => window.location.search, []);
  const { t } = usePrintTranslation(
    new URLSearchParams(query).get("language") ?? undefined,
  );
  const [snapshot, setSnapshot] = React.useState<PrintSnapshot | null>(null);
  const [index, setIndex] = React.useState(0);
  const [ready, setReady] = React.useState(false);
  const [error, setError] = React.useState(false);
  const [contentReady, setContentReady] = React.useState(false);
  const [layout, setLayout] = React.useState<PageLayout>({
    paper: "A4",
    orientation: "portrait",
    margin: 15,
  });
  const [marginInput, setMarginInput] = React.useState("15");
  const [numberCss, setNumberCss] = React.useState("");
  const printSource = React.useRef<HTMLDivElement | null>(null);
  const paginated =
    !!snapshot &&
    snapshot.options.pageNumbers !== "none" &&
    snapshot.options.tocPageNumbers;
  const [issues, setIssues] = React.useState<
    { kind: string; id: string; count: number }[]
  >([]);
  const staging = React.useRef<HTMLDivElement>(null);
  const output = React.useRef<HTMLDivElement>(null);
  const rendered = React.useRef<RenderedDocument[]>([]);
  const deadline = React.useRef(0);
  React.useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/advancedPrint.info${query}`, {
      signal: controller.signal,
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Print snapshot request failed");
        const { data } = await response.json();
        if (!controller.signal.aborted) {
          deadline.current = Date.now() + data.timeoutMs;
          setSnapshot(data);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [query]);
  React.useEffect(() => {
    if (!snapshot || !staging.current || !output.current) return;
    const source = snapshot.documents[index];
    if (!source) return;
    const controller = new AbortController();
    prepareNative(staging.current, {
      signal: controller.signal,
      editors: 1 + (source.comments?.length ?? 0),
      timeoutMs: Math.max(1, deadline.current - Date.now()),
      loadCodeLanguage,
    })
      .then((element) => {
        if (controller.signal.aborted) return;
        rendered.current.push({ ...source, element });
        if (index + 1 < snapshot.documents.length) {
          setIndex(index + 1);
          return;
        }
        const fragment = composeDocuments(document, {
          ...snapshot,
          documents: rendered.current,
        });
        const failures: { kind: string; id: string; count: number }[] = [];
        for (const kind of ["image", "diagram"]) {
          const nodes = [
            ...fragment.querySelectorAll(`[data-print-issue="${kind}"]`),
          ];
          nodes.forEach((node, i) => {
            node.id ||= `print-issue-${kind}-${i}`;
          });
          if (nodes.length)
            failures.push({ kind, id: nodes[0].id, count: nodes.length });
        }
        output.current!.replaceChildren(fragment);
        setIssues(failures);
        setContentReady(true);
        setIndex(snapshot.documents.length);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [snapshot, index]);
  React.useEffect(() => {
    if (!contentReady || !snapshot || !output.current) return;
    if (!paginated) {
      setNumberCss(
        pageNumberStyles(output.current, snapshot.options.pageNumbers),
      );
      setReady(true);
      return;
    }
    if (!printSource.current) {
      printSource.current = document.createElement("div");
      printSource.current.append(...output.current.childNodes);
    }
    setReady(false);
    setError(false);
    const controller = new AbortController();
    let cleanup: (() => void) | undefined;
    paginate(
      printSource.current,
      output.current,
      layout,
      snapshot.options.pageNumbers as "continuous" | "document",
      controller.signal,
    )
      .then((dispose) => {
        cleanup = dispose;
        if (controller.signal.aborted) dispose();
        else setReady(true);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => {
      controller.abort();
      cleanup?.();
    };
  }, [contentReady, snapshot, layout, paginated]);
  const source = snapshot?.documents[index];
  return (
    <main
      className="print-page"
      style={{
        background: theme.background,
        color: theme.text,
        colorScheme: "light",
        "--print-link-color": theme.link,
      }}
    >
      <style>{printCss}</style>
      <style>{numberCss}</style>
      <header className="print-toolbar">
        <button
          id="print-button"
          type="button"
          disabled={!ready}
          onClick={() => window.print()}
        >
          {t("Print to PDF")}
        </button>
        {paginated && (
          <div className="print-layout-controls">
            <label>
              {t("Paper size")}
              <select
                aria-label={t("Paper size")}
                value={layout.paper}
                disabled={!contentReady || (!ready && !error)}
                onChange={(event) => {
                  setReady(false);
                  setLayout({
                    ...layout,
                    paper: event.target.value as PageLayout["paper"],
                  });
                }}
              >
                {["A4", "A3", "Letter"].map((paper) => (
                  <option key={paper}>{paper}</option>
                ))}
              </select>
            </label>
            <label>
              {t("Orientation")}
              <select
                aria-label={t("Orientation")}
                value={layout.orientation}
                disabled={!contentReady || (!ready && !error)}
                onChange={(event) => {
                  setReady(false);
                  setLayout({
                    ...layout,
                    orientation: event.target
                      .value as PageLayout["orientation"],
                  });
                }}
              >
                <option value="portrait">{t("Portrait")}</option>
                <option value="landscape">{t("Landscape")}</option>
              </select>
            </label>
            <label>
              {t("Margins (mm)")}
              <input
                type="number"
                aria-label={t("Margins (mm)")}
                min="5"
                max="40"
                value={marginInput}
                disabled={!contentReady || (!ready && !error)}
                onChange={(event) => setMarginInput(event.target.value)}
                onBlur={() => {
                  const margin = Math.min(
                    40,
                    Math.max(5, Number(marginInput) || 15),
                  );
                  setMarginInput(String(margin));
                  if (margin !== layout.margin) {
                    setReady(false);
                    setLayout({ ...layout, margin });
                  }
                }}
              />
            </label>
            <span>
              {t(
                "Use the same paper size, no margins, and 100% scale in the print dialog.",
              )}
            </span>
          </div>
        )}
        <span
          id="print-status"
          role={error || issues.length ? "alert" : "status"}
        >
          {error
            ? t("Print preparation failed.")
            : !ready
              ? t("Preparing…")
              : issues.map((issue, i) => (
                  <React.Fragment key={issue.kind}>
                    {i > 0 && " · "}
                    <a href={`#${issue.id}`}>
                      {t(
                        issue.kind === "image"
                          ? "Images unavailable: {{count}}"
                          : "Diagrams unavailable: {{count}}",
                        { count: issue.count },
                      )}
                    </a>
                  </React.Fragment>
                ))}
        </span>
        {!!snapshot?.excludedBranches && (
          <span>{t("Some documents were excluded.")}</span>
        )}
      </header>
      <div
        className={paginated ? "print-output paginated" : "print-output"}
        ref={output}
      />
      {source && !error && (
        <div
          className="print-staging"
          key={source.id}
          ref={staging}
          aria-hidden="true"
        >
          <NativeEditor
            id={source.id}
            value={source.content}
            defaultValue={source.content}
            extensions={nativeExtensions}
            readOnly
            canUpdate={false}
            canComment={false}
            grow={false}
            placeholder=""
            headingPrefix={source.headingPrefix}
          />
          {!!source.comments?.length && (
            <section className="print-comments">
              <h2>{t("Comments")}</h2>
              {source.comments
                .filter(
                  (comment) =>
                    !source.comments!.some(
                      (parent) => parent.id === comment.parentCommentId,
                    ),
                )
                .map((comment) => (
                  <CommentThread
                    key={comment.id}
                    comment={comment}
                    comments={source.comments!}
                    language={snapshot!.language}
                  />
                ))}
            </section>
          )}
        </div>
      )}
    </main>
  );
}

function CommentThread({
  comment,
  comments,
  language,
}: {
  comment: PrintComment;
  comments: PrintComment[];
  language: string;
}) {
  return (
    <article className="print-comment">
      <header>
        <strong>{comment.author}</strong>
        {" · "}
        <time dateTime={comment.createdAt}>
          {new Date(comment.createdAt).toLocaleString(language)}
        </time>
      </header>
      <NativeEditor
        id={comment.id}
        value={comment.content}
        defaultValue={comment.content}
        extensions={nativeExtensions}
        readOnly
        canUpdate={false}
        canComment={false}
        grow={false}
        placeholder=""
      />
      {comments
        .filter((reply) => reply.parentCommentId === comment.id)
        .map((reply) => (
          <CommentThread
            key={reply.id}
            comment={reply}
            comments={comments.filter((item) => item.id !== comment.id)}
            language={language}
          />
        ))}
    </article>
  );
}

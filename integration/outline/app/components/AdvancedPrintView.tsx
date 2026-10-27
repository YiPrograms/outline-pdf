import { React, ThemeProvider, useBuildTheme } from "./outline-pdf-bridge.js";
import { usePrintTranslation } from "../utils/printI18n";
import { PrintSettings } from "./PrintSettings";
import { PrintPreview } from "./PrintPreview";
import type { PrintStatus } from "./PrintPreview";
import { PrintDocuments } from "./PrintDocuments";
import { orderDocuments } from "../../../../src/documentSelection";
import type { SourceDocument } from "../../../../src/types";
import type { PrintSnapshot } from "../../../../src/types";
import type { PageLayout } from "../../../../src/paginate";
import type { PageNumberPosition } from "../../../../src/pageNumbers";
import printCss from "../../../../src/print.css";

/** Reuse Outline's native controls and editor under a light print theme. */
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
  const base = React.useMemo(
    () => new URLSearchParams(window.location.search),
    [],
  );
  const tree = base.get("scope") !== "document";
  const { t, language } = usePrintTranslation(
    base.get("language") ?? undefined,
  );
  const [options, setOptions] = React.useState<PrintSnapshot["options"]>(
    () => ({
      includeCover: base.get("includeCover") === "true",
      includeToc: tree && base.get("includeToc") !== "false",
      includeHeadingToc: base.get("includeHeadingToc") === "true",
      includeComments: base.get("includeComments") === "true",
      pageNumbers: (["continuous", "document"].includes(
        base.get("pageNumbers") ?? "",
      )
        ? base.get("pageNumbers")
        : "none") as PrintSnapshot["options"]["pageNumbers"],
      tocPageNumbers: base.get("tocPageNumbers") === "true",
    }),
  );
  const [documents, setDocuments] = React.useState<SourceDocument[]>([]);
  const [selection, setSelection] = React.useState<Set<string> | null>(null);
  const [order, setOrder] = React.useState<string[]>([]);
  const ordered = React.useMemo(
    () => orderDocuments(documents, order),
    [documents, order],
  );
  const selected = React.useMemo(
    () => selection ?? new Set(documents.map((item) => item.id)),
    [selection, documents],
  );
  const orderedIds = React.useMemo(
    () => ordered.map((item) => item.id),
    [ordered],
  );
  const [layout, setLayout] = React.useState<PageLayout>({
    paper: "A4",
    orientation: "portrait",
    margin: 15,
  });
  const [position, setPosition] =
    React.useState<PageNumberPosition>("bottom-center");
  const [status, setStatus] = React.useState<PrintStatus>({
    ready: false,
    error: false,
    issues: [],
    excluded: 0,
  });
  const query = React.useMemo(() => {
    const params = new URLSearchParams(base);
    params.set("includeComments", String(options.includeComments));
    return "?" + params;
  }, [base, options.includeComments]);
  const preparing = () =>
    setStatus((current) => ({ ...current, ready: false, error: false }));
  const update = (changes: Partial<PrintSnapshot["options"]>) => {
    preparing();
    const next = { ...options, ...changes };
    setOptions(next);
    const params = new URLSearchParams(base);
    for (const [key, value] of Object.entries(next))
      params.set(key, String(value));
    window.history.replaceState(null, "", `/print?${params}`);
  };
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
      <header className="print-toolbar">
        <button
          id="print-button"
          type="button"
          disabled={!status.ready}
          onClick={() => window.print()}
        >
          {t("Print to PDF")}
        </button>
        <span
          id="print-status"
          role={status.error || status.issues.length ? "alert" : "status"}
        >
          {status.error
            ? t("Print preparation failed.")
            : status.empty
              ? t("No documents selected.")
              : !status.ready
                ? t("Preparing…")
                : status.issues.map((issue, i) => (
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
        {!!status.excluded && <span>{t("Some documents were excluded.")}</span>}
      </header>
      <div className="print-workspace">
        <PrintSettings
          options={options}
          onChange={update}
          tree={tree}
          disabled={!status.ready && !status.error && !status.empty}
          layout={layout}
          setLayout={(value) => {
            preparing();
            setLayout(value);
          }}
          position={position}
          setPosition={(value) => {
            preparing();
            setPosition(value);
          }}
          language={language}
          documents={
            tree ? (
              <PrintDocuments
                documents={ordered}
                selected={selected}
                onSelect={(ids) => {
                  preparing();
                  setSelection(ids);
                }}
                onOrder={(ids) => {
                  preparing();
                  setOrder(ids);
                }}
                includeComments={options.includeComments}
                disabled={!status.ready && !status.empty}
                language={language}
              />
            ) : null
          }
        />
        <div className="print-preview">
          <PrintPreview
            key={String(options.includeComments)}
            query={query}
            options={options}
            layout={layout}
            position={position}
            selectedIds={selected}
            order={orderedIds}
            onDocuments={setDocuments}
            onStatus={setStatus}
            commentsLabel={t("Comments")}
          />
        </div>
      </div>
    </main>
  );
}

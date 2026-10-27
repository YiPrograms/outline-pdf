import {
  React,
  NativeEditor,
  nativeExtensions,
  loadCodeLanguage,
} from "./outline-pdf-bridge.js";
import { prepareNative, cloneNative } from "../../../../src/prepareNative";
import { composeDocuments } from "../../../../src/composeDocuments";
import type {
  PrintSnapshot,
  RenderedDocument,
  PrintComment,
} from "../../../../src/types";
import { pageNumberStyles } from "../../../../src/pageNumbers";
import { paginate } from "../../../../src/paginate";
import type { PageLayout } from "../../../../src/paginate";
import type { PageNumberPosition } from "../../../../src/pageNumbers";

export interface PrintStatus {
  ready: boolean;
  error: boolean;
  issues: { kind: string; id: string; count: number }[];
  excluded: number;
}

export function PrintPreview({
  query,
  options,
  layout,
  position,
  onStatus,
  commentsLabel,
}: {
  query: string;
  options: PrintSnapshot["options"];
  layout: PageLayout;
  position: PageNumberPosition;
  onStatus: (status: PrintStatus) => void;
  commentsLabel: string;
}) {
  const [snapshot, setSnapshot] = React.useState<PrintSnapshot | null>(null);
  const [index, setIndex] = React.useState(0);
  const [contentReady, setContentReady] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [numberCss, setNumberCss] = React.useState("");
  const output = React.useRef<HTMLDivElement>(null);
  const staging = React.useRef<HTMLDivElement>(null);
  const rendered = React.useRef<RenderedDocument[]>([]);
  const deadline = React.useRef(0);
  const paginated =
    options.pageNumbers !== "none" &&
    options.tocPageNumbers &&
    (options.includeToc || options.includeHeadingToc);
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
        if (!controller.signal.aborted) {
          setFailed(true);
          onStatus({ ready: false, error: true, issues: [], excluded: 0 });
        }
      });
    return () => controller.abort();
  }, [query, onStatus]);
  React.useEffect(() => {
    if (!snapshot || !staging.current) return;
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
        setIndex(index + 1);
        if (index + 1 === snapshot.documents.length) setContentReady(true);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setFailed(true);
          onStatus({
            ready: false,
            error: true,
            issues: [],
            excluded: snapshot.excludedBranches,
          });
        }
      });
    return () => controller.abort();
  }, [snapshot, index, onStatus]);
  React.useEffect(() => {
    if (!contentReady || !snapshot || !output.current) return;
    const controller = new AbortController();
    let cleanup: (() => void) | undefined;
    const run = async () => {
      onStatus({
        ready: false,
        error: false,
        issues: [],
        excluded: snapshot.excludedBranches,
      });
      const fragment = composeDocuments(document, {
        ...snapshot,
        options,
        documents: rendered.current.map((source) => ({
          ...source,
          element: cloneNative(source.element),
        })),
      });
      const issues: PrintStatus["issues"] = [];
      for (const kind of ["image", "diagram"]) {
        const nodes = [
          ...fragment.querySelectorAll(`[data-print-issue="${kind}"]`),
        ];
        nodes.forEach((node, i) => {
          node.id ||= `print-issue-${kind}-${i}`;
        });
        if (nodes.length)
          issues.push({ kind, id: nodes[0].id, count: nodes.length });
      }
      output.current!.replaceChildren();
      if (paginated) {
        setNumberCss("");
        const source = document.createElement("div");
        source.append(fragment);
        cleanup = await paginate(
          source,
          output.current!,
          layout,
          options.pageNumbers,
          position,
          controller.signal,
        );
        if (controller.signal.aborted) {
          cleanup();
          return;
        }
      } else {
        output.current!.append(fragment);
        setNumberCss(
          pageNumberStyles(output.current!, options.pageNumbers, position),
        );
      }
      onStatus({
        ready: true,
        error: false,
        issues,
        excluded: snapshot.excludedBranches,
      });
    };
    run().catch(() => {
      if (!controller.signal.aborted)
        onStatus({
          ready: false,
          error: true,
          issues: [],
          excluded: snapshot.excludedBranches,
        });
    });
    return () => {
      controller.abort();
      cleanup?.();
    };
  }, [contentReady, snapshot, options, layout, position, paginated, onStatus]);
  const source = snapshot?.documents[index];
  return (
    <>
      <style>{numberCss}</style>
      <div
        className={paginated ? "print-output paginated" : "print-output"}
        ref={output}
      />
      {source && !failed && (
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
              <h2>{commentsLabel}</h2>
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
    </>
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

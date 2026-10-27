import { React } from "./outline-pdf-bridge.js";
import { usePrintTranslation } from "../utils/printI18n";
import {
  isEmptyDocument,
  moveBranch,
  subtreeIds,
} from "../../../../src/documentSelection";
import type { SourceDocument } from "../../../../src/types";

export function PrintDocuments({
  documents,
  selected,
  onSelect,
  onOrder,
  includeComments,
  disabled,
  language,
}: {
  documents: SourceDocument[];
  selected: ReadonlySet<string>;
  onSelect: (ids: Set<string>) => void;
  onOrder: (ids: string[]) => void;
  includeComments: boolean;
  disabled: boolean;
  language: string;
}) {
  const { t } = usePrintTranslation(language);
  const [collapsed, setCollapsed] = React.useState(new Set<string>());
  const drag = React.useRef<string | null>(null);
  const [drop, setDrop] = React.useState<{ id: string; after: boolean } | null>(
    null,
  );
  const depths = new Map<string, number>();
  const hidden = new Set<string>();
  for (const item of documents) {
    depths.set(
      item.id,
      item.parentId ? (depths.get(item.parentId) ?? -1) + 1 : 0,
    );
    if (
      item.parentId &&
      (hidden.has(item.parentId) || collapsed.has(item.parentId))
    )
      hidden.add(item.id);
  }
  const parents = new Set(documents.map((item) => item.parentId));
  const move = (id: string, target: string, after: boolean) =>
    onOrder(moveBranch(documents, id, target, after).map((item) => item.id));
  const step = (id: string, direction: number) => {
    const item = documents.find((item) => item.id === id)!;
    const siblings = documents.filter(
      (node) => node.parentId === item.parentId,
    );
    const target = siblings[siblings.indexOf(item) + direction];
    if (target) move(id, target.id, direction > 0);
  };
  return (
    <fieldset className="print-documents" disabled={disabled}>
      <legend>
        {t("Documents")}{" "}
        <span className="print-document-count">
          {documents.filter((item) => selected.has(item.id)).length}/
          {documents.length}
        </span>
      </legend>
      <div className="print-document-tools">
        <button
          type="button"
          onClick={() => onSelect(new Set(documents.map((item) => item.id)))}
        >
          {t("Select all")}
        </button>
        <button type="button" onClick={() => onSelect(new Set())}>
          {t("Deselect all")}
        </button>
        <button
          type="button"
          onClick={() =>
            onSelect(
              new Set(
                documents
                  .filter(
                    (item) =>
                      selected.has(item.id) &&
                      !isEmptyDocument(item, includeComments),
                  )
                  .map((item) => item.id),
              ),
            )
          }
        >
          {t("Deselect empty")}
        </button>
      </div>
      <div className="print-document-list">
        {documents
          .filter((item) => !hidden.has(item.id))
          .map((item) => (
            <div
              key={item.id}
              data-document-id={item.id}
              className={`print-document-row${drop?.id === item.id ? (drop.after ? " drop-after" : " drop-before") : ""}`}
              style={{
                paddingInlineStart: depths.get(item.id)! * 12,
                minWidth: depths.get(item.id)! * 12 + 160,
              }}
            >
              <button
                className="print-drag-handle"
                type="button"
                aria-label={t("Reorder {{title}}", { title: item.title })}
                title={t("Drag to reorder; use arrow keys to move.")}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowUp" && event.key !== "ArrowDown")
                    return;
                  event.preventDefault();
                  step(item.id, event.key === "ArrowUp" ? -1 : 1);
                }}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  event.currentTarget.focus();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  drag.current = item.id;
                }}
                onPointerMove={(event) => {
                  if (drag.current !== item.id) return;
                  const row = document
                    .elementFromPoint(event.clientX, event.clientY)
                    ?.closest<HTMLElement>("[data-document-id]");
                  const target = documents.find(
                    (node) => node.id === row?.dataset.documentId,
                  );
                  setDrop(
                    target &&
                      target.id !== item.id &&
                      target.parentId === item.parentId
                      ? {
                          id: target.id,
                          after:
                            event.clientY >
                            row!.getBoundingClientRect().top +
                              row!.offsetHeight / 2,
                        }
                      : null,
                  );
                  const list = event.currentTarget.closest(
                    ".print-document-list",
                  )!;
                  const bounds = list.getBoundingClientRect();
                  if (event.clientY < bounds.top + 28) list.scrollBy(0, -16);
                  if (event.clientY > bounds.bottom - 28) list.scrollBy(0, 16);
                }}
                onPointerUp={() => {
                  if (drag.current === item.id && drop)
                    move(item.id, drop.id, drop.after);
                  drag.current = null;
                  setDrop(null);
                }}
                onPointerCancel={() => {
                  drag.current = null;
                  setDrop(null);
                }}
                onLostPointerCapture={() => {
                  drag.current = null;
                  setDrop(null);
                }}
              >
                ⠿
              </button>
              {parents.has(item.id) ? (
                <button
                  className="print-tree-expand"
                  type="button"
                  aria-expanded={!collapsed.has(item.id)}
                  aria-label={t(
                    collapsed.has(item.id)
                      ? "Expand {{title}}"
                      : "Collapse {{title}}",
                    { title: item.title },
                  )}
                  onClick={() =>
                    setCollapsed((current) => {
                      const next = new Set(current);
                      next.has(item.id)
                        ? next.delete(item.id)
                        : next.add(item.id);
                      return next;
                    })
                  }
                >
                  {collapsed.has(item.id) ? "›" : "⌄"}
                </button>
              ) : (
                <span />
              )}
              <label title={item.title}>
                <input
                  type="checkbox"
                  checked={selected.has(item.id)}
                  onChange={(event) => {
                    const next = new Set(selected);
                    event.target.checked
                      ? next.add(item.id)
                      : next.delete(item.id);
                    onSelect(next);
                  }}
                />
                <span>{item.title}</span>
              </label>
              <select
                className="print-document-actions"
                aria-label={t("Actions for {{title}}", { title: item.title })}
                value=""
                onChange={(event) => {
                  const action = event.target.value;
                  if (action === "up" || action === "down") {
                    step(item.id, action === "up" ? -1 : 1);
                    return;
                  }
                  const next = new Set(selected);
                  for (const id of subtreeIds(documents, item.id))
                    action === "select" ? next.add(id) : next.delete(id);
                  onSelect(next);
                }}
              >
                <option value="" disabled>
                  ⋯
                </option>
                <option value="select">{t("Select subtree")}</option>
                <option value="deselect">{t("Deselect subtree")}</option>
                <option value="up">{t("Move up")}</option>
                <option value="down">{t("Move down")}</option>
              </select>
            </div>
          ))}
      </div>
    </fieldset>
  );
}

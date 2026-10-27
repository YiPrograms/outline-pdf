import { React, RadioGroup, Switch } from "./outline-pdf-bridge.js";
import { usePrintTranslation } from "../utils/printI18n";
import type { PrintSnapshot } from "../../../../src/types";
import type { PageLayout } from "../../../../src/paginate";
import type { PageNumberPosition } from "../../../../src/pageNumbers";

export function PrintRadioGroup<T extends string>({
  label,
  value,
  choices,
  onChange,
  disabled = false,
}: {
  label?: string;
  value: T;
  choices: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="print-radio-group" disabled={disabled}>
      {label && <legend>{label}</legend>}
      <React.Suspense fallback={null}>
        <RadioGroup
          value={value}
          formats={choices.map(([value, title]) => ({ value, title }))}
          onChange={onChange}
        />
      </React.Suspense>
    </fieldset>
  );
}

export function PrintSettings({
  options,
  onChange,
  tree,
  disabled,
  layout,
  setLayout,
  position,
  setPosition,
  language,
}: {
  options: PrintSnapshot["options"];
  onChange: (options: Partial<PrintSnapshot["options"]>) => void;
  tree: boolean;
  disabled: boolean;
  layout: PageLayout;
  setLayout: (layout: PageLayout) => void;
  position: PageNumberPosition;
  setPosition: (position: PageNumberPosition) => void;
  language: string;
}) {
  const { t } = usePrintTranslation(language);
  const [margin, setMargin] = React.useState(String(layout.margin));
  const numbered = options.pageNumbers !== "none";
  const hasToc = (tree && options.includeToc) || options.includeHeadingToc;
  const paginated = numbered && hasToc && options.tocPageNumbers;
  const toggle = (key: keyof PrintSnapshot["options"], label: string) => (
    <Switch
      id={`print-${key}`}
      label={t(label)}
      inForm={false}
      checked={!!options[key]}
      onChange={(checked: boolean) => onChange({ [key]: checked })}
    />
  );
  return (
    <details
      className="print-settings"
      open={window.matchMedia("(min-width: 1000px)").matches}
    >
      <summary>{t("Print settings")}</summary>
      <div className="print-settings-body">
        <fieldset disabled={disabled}>
          <legend>{t("Content")}</legend>
          {toggle("includeCover", "Cover page")}
          {tree && toggle("includeToc", "Document tree table of contents")}
          {toggle("includeHeadingToc", "Document table of contents")}
          {toggle("includeComments", "Show comments")}
        </fieldset>
        <fieldset disabled={disabled}>
          <legend>{t("Page numbering")}</legend>
          <Switch
            id="print-show-numbers"
            label={t("Show page numbers")}
            inForm={false}
            checked={numbered}
            onChange={(checked: boolean) =>
              onChange({ pageNumbers: checked ? "continuous" : "none" })
            }
          />
          {numbered && (
            <>
              <PrintRadioGroup
                value={options.pageNumbers}
                choices={[
                  ["continuous", t("Continuous page numbers")],
                  ["document", t("Per-document page numbers")],
                ]}
                onChange={(pageNumbers) => onChange({ pageNumbers })}
                disabled={disabled}
              />
              <label className="print-field">
                {t("Page number position")}
                <select
                  value={position}
                  aria-label={t("Page number position")}
                  onChange={(e) =>
                    setPosition(e.target.value as PageNumberPosition)
                  }
                >
                  {[
                    ["top-left", "Top left"],
                    ["top-right", "Top right"],
                    ["bottom-left", "Bottom left"],
                    ["bottom-center", "Bottom center"],
                    ["bottom-right", "Bottom right"],
                  ].map(([value, label]) => (
                    <option key={value} value={value}>
                      {t(label)}
                    </option>
                  ))}
                </select>
              </label>
              {hasToc &&
                toggle("tocPageNumbers", "Page numbers in table of contents")}
            </>
          )}
        </fieldset>
        {paginated && (
          <fieldset disabled={disabled}>
            <legend>{t("Page layout")}</legend>
            <label className="print-field">
              {t("Paper size")}
              <select
                aria-label={t("Paper size")}
                value={layout.paper}
                onChange={(e) =>
                  setLayout({
                    ...layout,
                    paper: e.target.value as PageLayout["paper"],
                  })
                }
              >
                {["A4", "A3", "Letter"].map((paper) => (
                  <option key={paper}>{paper}</option>
                ))}
              </select>
            </label>
            <label className="print-field">
              {t("Orientation")}
              <select
                aria-label={t("Orientation")}
                value={layout.orientation}
                onChange={(e) =>
                  setLayout({
                    ...layout,
                    orientation: e.target.value as PageLayout["orientation"],
                  })
                }
              >
                <option value="portrait">{t("Portrait")}</option>
                <option value="landscape">{t("Landscape")}</option>
              </select>
            </label>
            <label className="print-field">
              {t("Margins (mm)")}
              <input
                aria-label={t("Margins (mm)")}
                type="number"
                min="5"
                max="40"
                value={margin}
                onChange={(e) => setMargin(e.target.value)}
                onBlur={() => {
                  const value = Math.min(40, Math.max(5, Number(margin) || 15));
                  setMargin(String(value));
                  if (value !== layout.margin)
                    setLayout({ ...layout, margin: value });
                }}
              />
            </label>
            <p className="print-layout-note">
              {t(
                "Use the same paper size, no margins, and 100% scale in the print dialog.",
              )}
            </p>
          </fieldset>
        )}
      </div>
    </details>
  );
}

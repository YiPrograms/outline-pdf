import { useState } from "react";
import styled from "styled-components";
import Button from "~/components/Button";
import { usePrintTranslation } from "~/utils/printI18n";

interface Props {
  sourceId: string;
  collection?: boolean;
}

export function AdvancedPrintDialog({ sourceId, collection = false }: Props) {
  const { t, language } = usePrintTranslation();
  const [scope, setScope] = useState(collection ? "collection" : "document");
  const [includeCover, setIncludeCover] = useState(false);
  const [includeToc, setIncludeToc] = useState(true);
  const [includeHeadingToc, setIncludeHeadingToc] = useState(false);
  const [includeComments, setIncludeComments] = useState(false);
  const open = () => {
    const query = new URLSearchParams({
      sourceId,
      scope,
      includeCover: String(includeCover),
      includeToc: String(scope !== "document" && includeToc),
      includeHeadingToc: String(includeHeadingToc),
      includeComments: String(includeComments),
      language,
    });
    window.open(`/print?${query}`, "_blank", "noopener,noreferrer");
  };
  return (
    <Layout>
      <Scope>
        <legend>{t("Scope")}</legend>
        {(collection
          ? [["collection", "Entire collection"]]
          : [
              ["document", "Current document"],
              ["document-tree", "Document tree"],
            ]
        ).map(([value, label]) => (
          <label key={value}>
            <input
              type="radio"
              name="print-scope"
              value={value}
              checked={scope === value}
              onChange={(event) => setScope(event.target.value)}
            />
            {t(label)}
          </label>
        ))}
      </Scope>
      <Setting>
        {t("Cover page")}
        <Toggle
          type="checkbox"
          role="switch"
          checked={includeCover}
          onChange={(event) => setIncludeCover(event.target.checked)}
        />
      </Setting>
      {scope !== "document" && (
        <Setting>
          {t("Document tree table of contents")}
          <Toggle
            type="checkbox"
            role="switch"
            checked={includeToc}
            onChange={(event) => setIncludeToc(event.target.checked)}
          />
        </Setting>
      )}
      <Setting>
        {t("Document table of contents")}
        <Toggle
          type="checkbox"
          role="switch"
          checked={includeHeadingToc}
          onChange={(event) => setIncludeHeadingToc(event.target.checked)}
        />
      </Setting>
      <Setting>
        {t("Show comments")}
        <Toggle
          type="checkbox"
          role="switch"
          checked={includeComments}
          onChange={(event) => setIncludeComments(event.target.checked)}
        />
      </Setting>
      <Button type="button" onClick={open}>
        {t("Open print view")}
      </Button>
    </Layout>
  );
}
export function PrintText({ message }: { message: string }) {
  const { t } = usePrintTranslation();
  return <>{t(message)}</>;
}
const Layout = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`;
const Scope = styled.fieldset`
  border: 0;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  legend {
    padding: 0;
    margin-bottom: 12px;
    font-weight: 500;
  }
  label {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }
  input {
    margin: 0;
    width: 16px;
    height: 16px;
    accent-color: ${(props) => props.theme.accent};
  }
`;
const Setting = styled.label`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 28px;
  cursor: pointer;
`;
const Toggle = styled.input`
  appearance: none;
  width: 32px;
  height: 18px;
  flex-shrink: 0;
  margin: 0;
  padding: 3px;
  border: 0;
  border-radius: 18px;
  background: ${(props) => props.theme.slate};
  cursor: pointer;
  transition: background 150ms;
  &::before {
    content: "";
    display: block;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: white;
    transition: transform 150ms;
  }
  &:checked {
    background: ${(props) => props.theme.accent};
  }
  &:checked::before {
    transform: translateX(14px);
  }
  &:focus-visible {
    outline: 2px solid ${(props) => props.theme.accent};
    outline-offset: 3px;
  }
`;

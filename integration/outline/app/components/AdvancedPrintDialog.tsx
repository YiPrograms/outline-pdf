import { React, styled, Button } from "./outline-pdf-bridge.js";
import { usePrintTranslation } from "../utils/printI18n";
import { PrintRadioGroup } from "./PrintSettings";

interface Props {
  sourceId: string;
  collection?: boolean;
}

export function AdvancedPrintDialog({ sourceId, collection = false }: Props) {
  const { t, language } = usePrintTranslation();
  const [scope, setScope] = React.useState(
    collection ? "collection" : "document",
  );
  return (
    <Layout>
      <PrintRadioGroup
        label={t("Scope")}
        value={scope}
        choices={
          collection
            ? [["collection", t("Entire collection")]]
            : [
                ["document", t("Current document")],
                ["document-tree", t("Document tree")],
              ]
        }
        onChange={setScope}
      />
      <Button
        type="button"
        onClick={() => {
          const query = new URLSearchParams({ sourceId, scope, language });
          window.open(`/print?${query}`, "_blank", "noopener,noreferrer");
        }}
      >
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
  fieldset {
    border: 0;
    margin: 0;
    padding: 0;
  }
  legend {
    margin-bottom: 12px;
    padding: 0;
    font-weight: 500;
  }
`;

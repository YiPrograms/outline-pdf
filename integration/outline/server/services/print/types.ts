export interface PrintSettings {
  scope: "document" | "document-tree" | "collection";
  sourceId: string;
  options: {
    includeCover: boolean;
    includeToc: boolean;
    includeHeadingToc: boolean;
    includeComments: boolean;
  };
  language: "en-US" | "zh-TW" | "zh-CN";
}

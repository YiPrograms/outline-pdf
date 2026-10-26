export interface PrintComment {
  id: string;
  parentCommentId: string | null;
  author: string;
  createdAt: string;
  content: Record<string, unknown>;
}
export interface SourceDocument {
  id: string;
  parentId: string | null;
  title: string;
  sourceUrl: string;
  content: Record<string, unknown>;
  headingPrefix?: string;
  comments?: PrintComment[];
}
export interface PrintSnapshot {
  title: string;
  documents: SourceDocument[];
  options: {
    includeCover: boolean;
    includeToc: boolean;
    includeHeadingToc: boolean;
    includeComments: boolean;
    pageNumbers: "none" | "continuous" | "document";
    tocPageNumbers: boolean;
  };
  language: "en-US" | "zh-TW" | "zh-CN";
  excludedBranches: number;
  timeoutMs: number;
}
export type RenderedDocument = Pick<
  SourceDocument,
  "id" | "parentId" | "title" | "sourceUrl"
> & { element: HTMLElement };

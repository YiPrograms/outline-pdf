import { z } from "zod";
import { BaseSchema } from "../schema";

const flag = (fallback: "true" | "false") =>
  z
    .enum(["true", "false"])
    .default(fallback)
    .transform((value) => value === "true");
export const AdvancedPrintSchema = BaseSchema.extend({
  query: z
    .object({
      sourceId: z.uuid(),
      scope: z.enum(["document", "document-tree", "collection"]),
      includeCover: flag("false"),
      includeToc: flag("true"),
      includeHeadingToc: flag("false"),
      includeComments: flag("false"),
      pageNumbers: z.enum(["none", "continuous", "document"]).default("none"),
      tocPageNumbers: flag("false"),
      language: z.enum(["en-US", "zh-TW", "zh-CN"]).default("en-US"),
    })
    .strict(),
});
export type AdvancedPrintReq = z.infer<typeof AdvancedPrintSchema>;

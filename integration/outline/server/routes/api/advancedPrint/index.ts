import Router from "@koa/router";
import auth from "@server/middlewares/authentication";
import { rateLimiter } from "@server/middlewares/rateLimiter";
import validate from "@server/middlewares/validate";
import { AdvancedPrintService } from "@server/services/print/AdvancedPrintService";
import type { APIContext } from "@server/types";
import { AdvancedPrintSchema, type AdvancedPrintReq } from "./schema";

const router = new Router();
router.get(
  "advancedPrint.info",
  auth(),
  rateLimiter({ requests: 5, duration: 60 }),
  validate(AdvancedPrintSchema),
  async (ctx: APIContext<AdvancedPrintReq>) => {
    const {
      sourceId,
      scope,
      includeCover,
      includeToc,
      includeHeadingToc,
      includeComments,
      pageNumbers,
      tocPageNumbers,
      language,
    } = ctx.input.query;
    const view = await AdvancedPrintService.create(ctx.state.auth.user, {
      sourceId,
      scope,
      options: {
        includeCover,
        includeToc,
        includeHeadingToc,
        includeComments,
        pageNumbers,
        tocPageNumbers,
      },
      language,
    });
    ctx.set("Cache-Control", "private, no-store");
    ctx.set("X-Content-Type-Options", "nosniff");
    ctx.set("Referrer-Policy", "no-referrer");
    ctx.body = { data: view };
  },
);
export default router;

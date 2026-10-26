import type { NavigationNode } from "@shared/types";
import { DocumentPreference } from "@shared/types";
import { sortNavigationNodes } from "@shared/utils/collections";
import { AuthorizationError, ValidationError } from "@server/errors";
import { Collection, Document, User, Team, Comment } from "@server/models";
import { DocumentHelper } from "@server/models/helpers/DocumentHelper";
import { authorize, can } from "@server/policies";
import { printConfig } from "./config";
import type { PrintSettings } from "./types";

/** Collects an authorized document snapshot for Outline's native web editor. */
export class AdvancedPrintService {
  /** Reloads the actor with the team required by download policies. */
  static async user(id: string) {
    return User.findByPk(id, {
      include: [{ model: Team, as: "team", required: true }],
      rejectOnEmpty: true,
    });
  }
  /** Checks the selected source without fetching document content. */
  static async source(user: User, settings: PrintSettings) {
    if (user.isSuspended || !printConfig().enabled) {
      throw AuthorizationError();
    }
    if (settings.scope === "collection") {
      const collection = await Collection.findByPk(settings.sourceId, {
        userId: user.id,
        rejectOnEmpty: true,
      });
      authorize(user, "export", collection);
      if (collection.ownerId && collection.ownerId !== user.id) {
        throw AuthorizationError();
      }
      return { collection, document: null };
    }
    const document = await Document.findByPk(settings.sourceId, {
      userId: user.id,
      includeContent: false,
      rejectOnEmpty: true,
    });
    authorize(user, "download", document);
    if (
      document.collection?.ownerId &&
      document.collection.ownerId !== user.id
    ) {
      throw AuthorizationError();
    }
    return { document, collection: document.collection };
  }

  /** Returns document data without invoking the HTML export renderer. */
  static async create(user: User, settings: PrintSettings) {
    const config = printConfig();
    const deadline = Date.now() + config.timeoutMs;
    const source = await this.source(user, settings);
    let tree: Pick<NavigationNode, "id" | "children">[];
    if (settings.scope === "collection") {
      const collection = await Collection.findByPk(settings.sourceId, {
        includeDocumentStructure: true,
        rejectOnEmpty: true,
      });
      tree = sortNavigationNodes(
        collection.documentStructure ?? [],
        collection.sort,
      );
    } else if (
      settings.scope === "document-tree" &&
      source.document?.collectionId
    ) {
      const collection = await Collection.findByPk(
        source.document.collectionId,
        { includeDocumentStructure: true, rejectOnEmpty: true },
      );
      const node = collection.getDocumentTree(settings.sourceId);
      if (!node) {
        throw ValidationError("Document is not in collection tree");
      }
      tree = [{ id: settings.sourceId, children: node.children }];
    } else {
      tree = [{ id: settings.sourceId, children: [] }];
    }
    const documents: {
      id: string;
      parentId: string | null;
      title: string;
      sourceUrl: string;
      content: Record<string, unknown>;
      headingPrefix: string | undefined;
      comments?: {
        id: string;
        parentCommentId: string | null;
        author: string;
        createdAt: string;
        content: Record<string, unknown>;
      }[];
    }[] = [];
    let totalBytes = 0;
    let excludedBranches = 0;
    const seen = new Set<string>();
    const pending: {
      node: Pick<NavigationNode, "id" | "children">;
      parentId: string | null;
    }[] = tree.map((node) => ({ node, parentId: null })).reverse();
    while (pending.length) {
      const item = pending.pop();
      if (!item) {
        break;
      }
      if (Date.now() >= deadline || seen.has(item.node.id)) {
        throw ValidationError("Invalid or oversized print tree");
      }
      seen.add(item.node.id);
      const metadata = await Document.findByPk(item.node.id, {
        userId: user.id,
        includeContent: false,
      });
      if (
        !metadata ||
        !can(user, "download", metadata) ||
        metadata.teamId !== user.teamId ||
        (metadata.collection?.ownerId &&
          metadata.collection.ownerId !== user.id)
      ) {
        excludedBranches++;
        continue;
      }
      if (source.collection && metadata.collectionId !== source.collection.id) {
        throw AuthorizationError();
      }
      if (documents.length >= config.maxDocuments) {
        throw ValidationError("Print document limit exceeded");
      }
      const document = await Document.findByPk(metadata.id, {
        userId: user.id,
        includeState: true,
        rejectOnEmpty: true,
      });
      authorize(user, "download", document);
      const sourceSize =
        (document.state?.byteLength ?? 0) +
        Buffer.byteLength(
          JSON.stringify(document.content ?? document.text ?? ""),
        );
      if (sourceSize > config.maxBytes - totalBytes) {
        throw ValidationError("Print document size limit exceeded");
      }
      const content = DocumentHelper.toProsemirror(document).toJSON();
      totalBytes += Buffer.byteLength(JSON.stringify(content));
      if (totalBytes > config.maxBytes) {
        throw ValidationError("Print document size limit exceeded");
      }
      documents.push({
        id: document.id,
        parentId: item.parentId,
        title: document.title,
        sourceUrl: new URL(document.path, user.team.url).href,
        content,
        headingPrefix: document.getPreference(DocumentPreference.HeadingPrefix),
      });
      for (const child of [...item.node.children].reverse()) {
        pending.push({
          node: child,
          parentId: document.id,
        });
      }
    }
    if (!documents.length) {
      throw ValidationError("No downloadable documents");
    }
    const refreshed = await this.user(user.id);
    await this.source(refreshed, settings);
    for (const item of documents) {
      const document = await Document.findByPk(item.id, {
        userId: refreshed.id,
        includeContent: false,
      });
      if (
        !document ||
        !can(refreshed, "download", document) ||
        document.teamId !== refreshed.teamId ||
        (document.collection?.ownerId &&
          document.collection.ownerId !== refreshed.id)
      ) {
        throw AuthorizationError();
      }
      if (
        settings.options.includeComments &&
        can(refreshed, "read", document)
      ) {
        const { comments } = await Comment.findAllForUser(refreshed, {
          document,
          direction: "ASC",
        });
        item.comments = comments
          .filter((comment) => can(refreshed, "read", comment))
          .map((comment) => ({
            id: comment.id,
            parentCommentId: comment.parentCommentId,
            author: comment.createdBy.name,
            createdAt: comment.createdAt.toISOString(),
            content: comment.data,
          }));
      }
    }
    const snapshot = {
      title: source.document?.title ?? source.collection?.name ?? "Outline",
      documents,
      options: settings.options,
      language: settings.language,
      excludedBranches,
      timeoutMs: config.timeoutMs,
    };
    if (
      Buffer.byteLength(JSON.stringify(snapshot)) > config.maxBytes ||
      Date.now() >= deadline
    ) {
      throw ValidationError("Print view exceeds limits");
    }
    return snapshot;
  }
}

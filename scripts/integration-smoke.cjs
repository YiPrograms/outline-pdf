// Runs only against the isolated Compose integration-test database.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { randomUUID } = require("node:crypto");
const { createRequire } = require("node:module");
const native = createRequire("/opt/outline/package.json");
const { sequelize } = native("./build/server/storage/database");
const { Team, User, Collection, Document, Attachment, FileOperation, Comment } =
  native("./build/server/models");
const FileStorage = native("./build/server/storage/files").default;
const checks = [];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(user, route, body, expected = 200) {
  const response = await fetch(`http://127.0.0.1:3000/api/${route}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${user.getSessionToken()}`,
      "Content-Type": "application/json",
      Accept:
        route === "documents.export" ? "text/markdown" : "application/json",
    },
    body: JSON.stringify(body),
    redirect: "manual",
  });
  const result = await response.json();
  assert.equal(
    response.status,
    expected,
    `${route}: ${JSON.stringify(result)}`,
  );
  return result;
}
async function wait(user, id, state = "complete") {
  for (let attempt = 0; attempt < 150; attempt++) {
    const response = await api(user, "fileOperations.info", { id });
    if (["complete", "error", "expired"].includes(response.data.state)) {
      assert.equal(response.data.state, state, JSON.stringify(response));
      return response.data;
    }
    await pause(500);
  }
  throw new Error("Background export did not finish");
}
async function main() {
  assert.equal(native("./package.json").version, "1.12.0");
  await sequelize.authenticate();
  const fixture = JSON.parse(
    await fs.readFile("/tmp/print-fixture.json", "utf8"),
  );
  const ids = new Map(fixture.documents.map((doc) => [doc.id, randomUUID()]));
  for (const document of fixture.documents) {
    document.id = ids.get(document.id);
    document.parentId = document.parentId ? ids.get(document.parentId) : null;
  }
  const remap = (nodes) => {
    for (const node of nodes) {
      node.id = ids.get(node.id);
      remap(node.children);
    }
  };
  remap(fixture.tree);
  const team = await Team.create({
    name: "PDF integration fixture",
    passkeysEnabled: false,
  });
  const actor = await User.create({
    teamId: team.id,
    name: "PDF actor",
    email: `${randomUUID()}@example.test`,
    role: "admin",
  });
  const other = await User.create({
    teamId: team.id,
    name: "Other admin",
    email: `${randomUUID()}@example.test`,
    role: "admin",
  });
  const collection = await Collection.scope("withDocumentStructure").create({
    teamId: team.id,
    name: fixture.title,
    createdById: actor.id,
    permission: "read_write",
    sort: { field: "index", direction: "asc" },
    documentStructure: [],
  });
  const documents = [];
  for (const input of fixture.documents) {
    const content = JSON.parse(JSON.stringify(input.content));
    const replace = (value) => {
      if (Array.isArray(value)) {
        value.forEach(replace);
        return;
      }
      if (!value || typeof value !== "object") return;
      if (value.href?.includes("outline.example.test/doc/fixture-0000000010"))
        value.href = `/doc/${fixture.documents[9].id}#h-安裝方法-1`;
      Object.values(value).forEach(replace);
    };
    replace(content);
    documents.push(
      await Document.create({
        id: input.id,
        title: input.title,
        teamId: team.id,
        collectionId: collection.id,
        parentDocumentId: input.parentId,
        createdById: actor.id,
        lastModifiedById: actor.id,
        publishedAt: new Date(),
        content,
      }),
    );
  }
  const first = documents[0];
  const comment = await Comment.create({
    documentId: first.id,
    createdById: actor.id,
    data: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "PRINT_COMMENT_BODY" }],
        },
      ],
    },
  });
  await Comment.create({
    documentId: first.id,
    createdById: other.id,
    parentCommentId: comment.id,
    data: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "PRINT_COMMENT_REPLY" }],
        },
      ],
    },
  });
  await Comment.create({
    documentId: first.id,
    createdById: actor.id,
    deletedAt: new Date(),
    data: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "DELETED_COMMENT_SECRET" }],
        },
      ],
    },
  });
  const firstContent = JSON.parse(JSON.stringify(first.content));
  for (const href of [
    `/doc/old-title-${documents[9].urlId}#h-安裝方法-1`,
    `/d/${documents[9].urlId}#h-安裝方法-1`,
  ])
    firstContent.content.push({
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "RENAMED_DOCUMENT_LINK",
          marks: [{ type: "link", attrs: { href } }],
        },
      ],
    });

  const image = firstContent.content
    .find((node) => node.content?.some((child) => child.type === "image"))
    .content.find((node) => node.type === "image");
  const bytes = Buffer.from(image.attrs.src.split(",")[1], "base64");
  const attachmentId = randomUUID();
  const key = `uploads/${actor.id}/${attachmentId}/fixture.png`;
  await FileStorage.store({
    key,
    body: bytes,
    contentLength: bytes.length,
    contentType: "image/png",
    acl: "private",
  });
  await Attachment.create({
    id: attachmentId,
    key,
    size: bytes.length,
    contentType: "image/png",
    acl: "private",
    teamId: team.id,
    userId: actor.id,
    documentId: first.id,
  });
  image.attrs.src = `/api/attachments.redirect?id=${attachmentId}`;
  first.content = firstContent;
  await first.save({ hooks: false });
  await first.reload();
  assert.ok(
    JSON.stringify(first.content).includes(
      `/api/attachments.redirect?id=${attachmentId}`,
    ),
  );
  const nav = (nodes) =>
    nodes.map((node) => {
      const doc = documents.find((doc) => doc.id === node.id);
      return {
        id: doc.id,
        title: doc.title,
        url: doc.path,
        children: nav(node.children),
      };
    });
  const personal = await Collection.scope("withDocumentStructure").create({
    teamId: team.id,
    name: "Other personal",
    ownerId: other.id,
    createdById: other.id,
    permission: null,
    documentStructure: [],
  });
  const secret = await Document.create({
    title: "PRIVATE_TOKEN_MUST_NOT_LEAK",
    teamId: team.id,
    collectionId: personal.id,
    createdById: other.id,
    lastModifiedById: other.id,
    publishedAt: new Date(),
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "PRIVATE_TOKEN_MUST_NOT_LEAK" }],
        },
      ],
    },
  });
  collection.documentStructure = [
    ...nav(fixture.tree),
    // A denied branch must be pruned before its repeated descendants are read.
    {
      id: secret.id,
      title: secret.title,
      url: secret.path,
      children: nav(fixture.tree),
    },
  ];
  await collection.save({ hooks: false });

  async function view(
    sourceId,
    scope = "document",
    expected = 200,
    extra = {},
    user = actor,
  ) {
    const query = new URLSearchParams({ sourceId, scope, ...extra });
    const response = await fetch(
      `http://127.0.0.1:3000/api/advancedPrint.info?${query}`,
      {
        headers: user
          ? { Authorization: `Bearer ${user.getSessionToken()}` }
          : {},
      },
    );
    const result = await response.json();
    assert.equal(
      response.status,
      expected,
      JSON.stringify(result).slice(0, 400),
    );
    if (expected === 200) {
      assert.match(response.headers.get("content-type"), /application\/json/);
      assert.match(response.headers.get("cache-control"), /no-store/);
    }
    return result.data;
  }
  await view(collection.id, "collection", 401, {}, null);
  await view(first.id, "invalid", 400);
  await view(first.id, "document", 400, { includeHeadingToc: "invalid" });
  await view(personal.id, "collection", 403);
  checks.push(
    "unauthenticated, invalid scopes and another user's personal space are rejected",
  );
  const withoutComments = await view(first.id);
  assert.ok(!JSON.stringify(withoutComments).includes("PRINT_COMMENT_BODY"));
  const withComments = await view(first.id, "document", 200, {
    includeComments: "true",
  });
  assert.equal(withComments.documents[0].comments.length, 2);
  assert.ok(JSON.stringify(withComments).includes("PRINT_COMMENT_REPLY"));
  assert.ok(!JSON.stringify(withComments).includes("DELETED_COMMENT_SECRET"));
  checks.push(
    "comments are opt-in, include replies and exclude deleted content",
  );
  const snapshot = await view(collection.id, "collection");
  assert.equal(snapshot.documents.length, 10);
  assert.equal(snapshot.documents[0].parentId, null);
  for (let depth = 1; depth < 8; depth++)
    assert.equal(
      snapshot.documents[depth].parentId,
      snapshot.documents[depth - 1].id,
    );
  assert.ok(
    snapshot.documents.every(
      (d) => d.content.type === "doc" && !Object.hasOwn(d, "html"),
    ),
  );
  assert.ok(!JSON.stringify(snapshot).includes("PRIVATE_TOKEN_MUST_NOT_LEAK"));
  assert.ok(
    JSON.stringify(snapshot).includes(
      `/api/attachments.redirect?id=${attachmentId}`,
    ),
  );
  checks.push(
    "authorized native document snapshots retain hierarchy and native asset URLs",
  );
  await fs.writeFile(
    "/tmp/print-integration-snapshot.json",
    JSON.stringify(snapshot),
  );
  const moved = documents[7];
  await moved.update({ collectionId: personal.id }, { hooks: false });
  const changed = await view(collection.id, "collection");
  assert.equal(changed.documents.length, 9);
  assert.ok(!JSON.stringify(changed).includes("DOC_TOKEN_8"));
  await moved.update({ collectionId: collection.id }, { hooks: false });
  checks.push("permission changes are rechecked when reopening the print page");
  // Revoke an already-read child just before the response snapshot is finalized.
  const { AdvancedPrintService } = native(
    "./build/server/services/print/AdvancedPrintService",
  );
  const originalLookup = Document.findByPk;
  Document.findByPk = async function (id, options) {
    const result = await originalLookup.call(this, id, options);
    if (id === documents[9].id && options?.includeState)
      await moved.update({ collectionId: personal.id }, { hooks: false });
    return result;
  };
  try {
    await assert.rejects(
      AdvancedPrintService.create(await AdvancedPrintService.user(actor.id), {
        sourceId: collection.id,
        scope: "collection",
        options: {
          includeCover: false,
          includeToc: true,
          includeHeadingToc: false,
        },
        language: "en-US",
      }),
      (error) => error.status === 403,
    );
  } finally {
    Document.findByPk = originalLookup;
    await moved.update({ collectionId: collection.id }, { hooks: false });
  }
  checks.push(
    "permission revoked while preparing prevents delivery of the snapshot",
  );
  const draft = await Document.create({
    title: "Draft print",
    teamId: team.id,
    createdById: actor.id,
    lastModifiedById: actor.id,
    content: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "DRAFT_TOKEN" }] },
      ],
    },
  });
  const single = await view(draft.id, "document", 200, { includeToc: "false" });
  assert.equal(single.documents.length, 1);
  assert.equal(single.options.includeToc, false);
  const tree = await view(documents[5].id, "document-tree");
  assert.equal(tree.documents.length, 3);
  checks.push("single draft and document subtree scopes return native content");
  const broken = await Document.create({
    title: "Broken assets",
    teamId: team.id,
    createdById: actor.id,
    lastModifiedById: actor.id,
    content: {
      type: "doc",
      content: [
        {
          type: "code_fence",
          attrs: { language: "mermaid" },
          content: [{ type: "text", text: "invalid diagram" }],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "image",
              attrs: { src: "data:image/png;base64,YmFk", alt: "Broken image" },
            },
          ],
        },
      ],
    },
  });
  await view(broken.id);
  const diagram = await Document.create({
    title: "Draw.io diagram",
    teamId: team.id,
    createdById: actor.id,
    lastModifiedById: actor.id,
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Draw.io preview" }],
        },
      ],
    },
  });
  const svgId = randomUUID();
  const svgKey = `uploads/${actor.id}/${svgId}/diagram.svg`;
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100" viewBox="0 0 300 100" content="%3Cmxfile%3E%3C%2Fmxfile%3E"><rect width="300" height="100" fill="#ae45e8"/><foreignObject width="300" height="100"><div xmlns="http://www.w3.org/1999/xhtml">Draw.io label</div></foreignObject><script>document.documentElement.innerHTML=""</script></svg>',
  );
  await FileStorage.store({
    key: svgKey,
    body: svg,
    contentLength: svg.length,
    contentType: "image/svg+xml",
    acl: "private",
  });
  await Attachment.create({
    id: svgId,
    key: svgKey,
    size: svg.length,
    contentType: "image/svg+xml",
    acl: "private",
    teamId: team.id,
    userId: actor.id,
    documentId: diagram.id,
  });
  await diagram.update(
    {
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "image",
                attrs: {
                  src: `/api/attachments.redirect?id=${svgId}`,
                  source: "diagrams.net",
                  alt: "Draw.io SVG",
                },
              },
            ],
          },
        ],
      },
    },
    { hooks: false },
  );
  const svgView = await view(diagram.id);
  assert.ok(
    JSON.stringify(svgView).includes(`/api/attachments.redirect?id=${svgId}`),
  );
  checks.push("draw.io attachments keep their native renderer references");
  const nativeExport = await api(actor, "documents.export", {
    id: documents[8].id,
    includeChildDocuments: true,
  });
  await wait(actor, nativeExport.data.fileOperation.id);
  const operation = await FileOperation.findByPk(
    nativeExport.data.fileOperation.id,
  );
  assert.match(operation.key, /\.markdown\.zip$/);
  checks.push("native Markdown ZIP export still completes");
  await fs.writeFile(
    "/tmp/print-ui-test.json",
    JSON.stringify({
      token: actor.getSessionToken(),
      documentPath: first.path,
      otherDocumentPath: documents[8].path,
      collectionId: collection.id,
      brokenId: broken.id,
      diagramId: diagram.id,
      firstId: first.id,
    }),
    { mode: 0o600 },
  );
  await fs.writeFile(
    "/tmp/print-integration-report.json",
    JSON.stringify({ status: "passed", checks }, null, 2),
  );
  console.log(JSON.stringify({ status: "passed", checks }, null, 2));
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

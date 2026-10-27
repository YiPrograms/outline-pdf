import { parse } from "acorn";
import path from "node:path";

const text = (code, node) => code.slice(node.start, node.end);
const key = (node) => node?.name ?? node?.value;
const literal = (node) =>
  node?.type === "Literal"
    ? node.value
    : node?.type === "TemplateLiteral" && node.expressions.length === 0
      ? node.quasis[0].value.cooked
      : undefined;
function nodes(root, predicate) {
  const result = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (typeof node.type === "string" && predicate(node)) result.push(node);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  };
  visit(root);
  return result;
}
function one(values, description) {
  if (values.length !== 1)
    throw new Error(
      `Frontend compatibility: expected one ${description}, got ${values.length}`,
    );
  return values[0];
}
function edits(code, replacements) {
  let boundary = code.length + 1;
  for (const [start, end, replacement] of replacements.sort(
    (a, b) => b[0] - a[0],
  )) {
    if (end > boundary) throw new Error("Overlapping frontend edits");
    code = code.slice(0, start) + replacement + code.slice(end);
    boundary = start;
  }
  parse(code, { ecmaVersion: "latest", sourceType: "module" });
  return code;
}
function imports(ast) {
  const result = new Map();
  for (const node of ast.body.filter((n) => n.type === "ImportDeclaration"))
    for (const specifier of node.specifiers)
      result.set(specifier.local.name, {
        name: specifier.imported?.name ?? "default",
        from: node.source.value,
      });
  return result;
}
function imported(binding, name) {
  if (!binding) throw new Error(`Missing native binding for ${name}`);
  return `import {${binding.name} as ${name}} from ${JSON.stringify(binding.from)};`;
}

/** Patch existing UI entry points and bridge the add-on to native React/stores. */
export function planFrontend(assets, widget, id) {
  const docFile = one(
    [...assets].filter(([, s]) => s.includes("Download document as PDF")),
    "document action asset",
  )[0];
  const exportFile = one(
    [...assets].filter(([, s]) =>
      s.includes("Exporting the collection may take some time."),
    ),
    "collection dialog asset",
  )[0];
  const doc = assets.get(docFile),
    exp = assets.get(exportFile);
  if (doc.includes("__OutlinePdf") || exp.includes("__OutlinePdf"))
    throw new Error("Unexpected pre-existing print frontend patch");
  const da = parse(doc, { ecmaVersion: "latest", sourceType: "module" });
  const ea = parse(exp, { ecmaVersion: "latest", sourceType: "module" });
  const action = one(
    nodes(
      da,
      (n) =>
        n.type === "ObjectExpression" &&
        n.properties.some(
          (p) =>
            key(p.key) === "analyticsName" &&
            literal(p.value) === "Download document as PDF",
        ),
    ),
    "PDF action",
  );
  const visible = one(
    action.properties.filter((p) => key(p.key) === "visible"),
    "PDF visibility",
  );
  const flag = one(
    nodes(
      visible,
      (n) =>
        n.type === "MemberExpression" &&
        key(n.property) === "PDF_EXPORT_ENABLED",
    ),
    "PDF feature flag",
  );
  const perform = one(
    action.properties.filter((p) => key(p.key) === "perform"),
    "PDF action handler",
  );
  if (
    !text(doc, perform).includes("download") ||
    !text(doc, visible).includes(".download")
  )
    throw new Error("PDF action semantics changed");
  const envBinding = imports(da).get(text(doc, flag.object));
  const component = one(
    nodes(
      ea,
      (n) =>
        n.type === "ArrowFunctionExpression" &&
        n.body.type === "BlockStatement" &&
        n.params[0]?.type === "ObjectPattern" &&
        n.params[0].properties.some((p) => key(p.key) === "collection") &&
        text(exp, n).includes("Exporting the collection may take some time."),
    ),
    "collection component",
  );
  const collection = one(
    component.params[0].properties.filter((p) => key(p.key) === "collection"),
    "collection prop",
  ).value.name;
  const stateCall = one(
    [
      ...new Set(
        nodes(
          component,
          (n) =>
            n.type === "CallExpression" &&
            n.callee.type === "MemberExpression" &&
            key(n.callee.property) === "useState",
        ).map((n) => text(exp, n.callee.object)),
      ),
    ],
    "native React namespace",
  );
  const reactInit = one(
    nodes(
      ea,
      (n) =>
        n.type === "VariableDeclarator" &&
        n.id.type === "Identifier" &&
        n.id.name === stateCall,
    ),
    "React initializer",
  ).init;
  const styleTag = one(
    [
      ...new Set(
        nodes(
          ea,
          (n) =>
            n.type === "TaggedTemplateExpression" &&
            n.tag.type === "MemberExpression" &&
            key(n.tag.property) === "hr",
        ).map((n) => text(exp, n.tag.object)),
      ),
    ],
    "native styled factory",
  );
  const translationHook = one(
    nodes(
      component,
      (n) =>
        n.type === "VariableDeclarator" &&
        n.id.type === "ObjectPattern" &&
        n.id.properties.some((p) => key(p.key) === "t") &&
        n.init?.type === "CallExpression",
    ),
    "native translation hook",
  ).init;
  const translationBinding = imports(ea).get(text(exp, translationHook.callee));
  const buttonFile = one(
    [...assets.keys()].filter((n) => /^Button\.[^.]+\.js$/.test(n)),
    "native Button asset",
  );
  const ba = parse(assets.get(buttonFile), {
    ecmaVersion: "latest",
    sourceType: "module",
  });
  const functions = new Set(
    ba.body
      .filter((n) => n.type === "FunctionDeclaration")
      .map((n) => n.id.name),
  );
  const buttonExport = one(
    ba.body
      .filter((n) => n.type === "ExportNamedDeclaration")
      .flatMap((n) => n.specifiers)
      .filter((n) => functions.has(n.local.name)),
    "native Button export",
  );
  const nativeAsset = (prefix) => {
    const name = one(
      [...assets.keys()].filter(
        (n) =>
          n.startsWith(prefix + ".") &&
          n.endsWith(".js") &&
          n.split(".").length === 3,
      ),
      "native " + prefix + " asset",
    );
    const code = assets.get(name);
    return {
      name,
      code,
      ast: parse(code, { ecmaVersion: "latest", sourceType: "module" }),
    };
  };
  const switchAsset = nativeAsset("Switch");
  const switchExport = one(
    switchAsset.ast.body
      .filter((n) => n.type === "ExportNamedDeclaration")
      .flatMap((n) => n.specifiers),
    "native Switch export",
  );
  const radioSelector = one(
    ea.body.filter(
      (n) =>
        n.type === "FunctionDeclaration" &&
        nodes(
          n,
          (p) =>
            p.type === "Property" &&
            key(p.key) === "type" &&
            literal(p.value) === "radio",
        ).length,
    ),
    "native radio selector",
  );
  const presentation = nativeAsset("PresentationMode");
  const editorCall = one(
    nodes(
      presentation.ast,
      (n) =>
        n.type === "CallExpression" &&
        n.arguments[1]?.properties?.some(
          (p) => key(p.key) === "defaultValue",
        ) &&
        n.arguments[1].properties.some((p) => key(p.key) === "readOnly") &&
        n.arguments[1].properties.some((p) => key(p.key) === "grow"),
    ),
    "native read-only editor",
  );
  const editorBinding = imports(presentation.ast).get(
    editorCall.arguments[0].name,
  );
  const extensionsName = editorCall.arguments[1].properties.find(
    (p) => key(p.key) === "extensions",
  )?.value.name;
  const extensionsMemo = one(
    nodes(
      presentation.ast,
      (n) => n.type === "VariableDeclarator" && n.id.name === extensionsName,
    ),
    "native editor extensions",
  );
  const extensionsBinding = imports(presentation.ast).get(
    extensionsMemo.init.arguments[0].body.name,
  );
  const themeAsset = nativeAsset("useBuildTheme");
  const themeExport = one(
    themeAsset.ast.body
      .filter((n) => n.type === "ExportNamedDeclaration")
      .flatMap((n) => n.specifiers),
    "native theme hook export",
  );
  const mainAsset = nativeAsset("index");
  const themeCall = one(
    nodes(
      mainAsset.ast,
      (n) =>
        n.type === "CallExpression" &&
        n.arguments[1]?.properties?.some((p) => key(p.key) === "theme") &&
        n.arguments[1].properties.some((p) => key(p.key) === "children"),
    ),
    "native theme provider",
  );
  const themeProviderBinding = imports(mainAsset.ast).get(
    themeCall.arguments[0].name,
  );
  const routes = nativeAsset("authenticated");
  const routesComponent = one(
    nodes(
      routes.ast,
      (n) =>
        n.type === "FunctionDeclaration" &&
        text(routes.code, n).includes("/dashboard"),
    ),
    "authenticated routes component",
  );
  const routesReturn = one(
    routesComponent.body.body.filter((n) => n.type === "ReturnStatement"),
    "authenticated routes return",
  );
  const codeFile = one(
    [...assets].filter(([, source]) =>
      source.includes("Failed to load language"),
    ),
    "native code loader asset",
  )[0];
  const codeSource = assets.get(codeFile);
  const codeAst = parse(codeSource, {
    ecmaVersion: "latest",
    sourceType: "module",
  });
  const commentsExtension = one(
    nodes(codeAst, (n) => {
      const body = n.init?.body;
      return (
        n.type === "VariableDeclarator" &&
        n.init?.type === "ArrowFunctionExpression" &&
        body?.type === "ArrayExpression" &&
        body.elements.length === 3 &&
        body.elements[0]?.type === "Identifier" &&
        body.elements[1]?.type === "Identifier" &&
        body.elements[2]?.type === "SpreadElement" &&
        body.elements[2].argument?.callee?.property?.name === "filter"
      );
    }),
    "native comment extensions",
  );
  const commentsExport = one(
    codeAst.body
      .filter((n) => n.type === "ExportNamedDeclaration")
      .flatMap((n) => n.specifiers)
      .filter((n) => n.local.name === commentsExtension.id.name),
    "native comment extensions export",
  );
  const codeLoader = one(
    codeAst.body.filter(
      (n) =>
        n.type === "FunctionDeclaration" &&
        text(codeSource, n).includes("Failed to load language"),
    ),
    "native code language loader",
  );
  const bridgeName = `outline-pdf-bridge-${id}.js`,
    widgetName = `outline-pdf-widget-${id}.js`;
  // The selector lives in ExportDialog, which imports the widget; load it lazily.
  const bridge =
    ea.body
      .filter((n) => n.type === "ImportDeclaration")
      .map((n) => text(exp, n))
      .join("\n") +
    "\n" +
    imported(envBinding, "__pdfEnv") +
    imported(translationBinding, "__pdfUseTranslation") +
    imported(editorBinding, "__pdfEditor") +
    `import {__outlinePdfLoadCodeLanguage as __pdfLoadCodeLanguage} from ${JSON.stringify("./" + codeFile)};\n` +
    imported(extensionsBinding, "__pdfRichExtensions") +
    `import {${commentsExport.exported.name} as __pdfWithComments} from ${JSON.stringify("./" + codeFile)};\nconst __pdfExtensions=__pdfWithComments(__pdfRichExtensions);\n` +
    imported(themeProviderBinding, "__pdfThemeProvider") +
    `import {${themeExport.exported.name} as __pdfUseBuildTheme} from ${JSON.stringify("./" + themeAsset.name)};\n` +
    `import {${buttonExport.exported.name} as __pdfButton} from ${JSON.stringify("./" + buttonFile)};\n` +
    imported(
      { name: switchExport.exported.name, from: "./" + switchAsset.name },
      "__pdfSwitch",
    ) +
    `const __pdfReact=${text(exp, reactInit)};\nconst __pdfRadioGroup=__pdfReact.lazy(()=>import(${JSON.stringify("./" + exportFile)}).then(m=>({default:m.__outlinePdfRadioGroup})));\nexport {__pdfSwitch as Switch,__pdfRadioGroup as RadioGroup,__pdfReact as React, ${styleTag} as styled, __pdfEnv as env, __pdfButton as Button, __pdfUseTranslation as useTranslation, __pdfLoadCodeLanguage as loadCodeLanguage, __pdfEditor as NativeEditor, __pdfExtensions as nativeExtensions, __pdfThemeProvider as ThemeProvider, __pdfUseBuildTheme as useBuildTheme};`;
  const addonImport = `import {AdvancedPrintDialog as __OutlinePdfDialog,PrintText as __OutlinePdfText,React as __OutlinePdfReact,env as __OutlinePdfEnv,Button as __OutlinePdfButton} from "./${widgetName}";\n`;
  const nameProperty = one(
    action.properties.filter((p) => key(p.key) === "name"),
    "document action label",
  );
  const docChanges = [
    [0, 0, addonImport],
    ...action.properties
      .filter((p) => key(p.key) === "shortcut")
      .map((p) => [p.value.start, p.value.end, "undefined"]),
    [
      nameProperty.value.start,
      nameProperty.value.end,
      `()=>__OutlinePdfReact.createElement(__OutlinePdfText,{message:"Print to PDF…"})`,
    ],
    [flag.start, flag.end, `${text(doc, flag.object)}.ADVANCED_PRINT_ENABLED`],
    [
      perform.value.start,
      perform.value.end,
      `async({activeDocumentId,stores})=>{if(activeDocumentId)stores.dialogs.openModal({title:__OutlinePdfReact.createElement(__OutlinePdfText,{message:"Print to PDF"}),content:__OutlinePdfReact.createElement(__OutlinePdfDialog,{sourceId:activeDocumentId})});}`,
    ],
  ];
  const returnNode = one(
    component.body.body.filter((n) => n.type === "ReturnStatement"),
    "collection return",
  );
  const children = one(
    (returnNode.argument.arguments?.[1]?.properties ?? []).filter(
      (n) => key(n.key) === "children" && n.value.type === "ArrayExpression",
    ),
    "collection dialog children",
  );
  const expChanges = [
    [
      exp.length,
      exp.length,
      `\nexport {${radioSelector.id.name} as __outlinePdfRadioGroup};`,
    ],
    [0, 0, addonImport],
    [
      component.body.start + 1,
      component.body.start + 1,
      `const [__pdfMode,__setPdfMode]=${stateCall}.useState(false);`,
    ],
    [
      returnNode.start,
      returnNode.start,
      `if(__pdfMode&&${collection})return __OutlinePdfReact.createElement(__OutlinePdfDialog,{sourceId:${collection}.id,collection:true});`,
    ],
    [
      children.value.start + 1,
      children.value.start + 1,
      `${collection}&&__OutlinePdfEnv.ADVANCED_PRINT_ENABLED&&__OutlinePdfReact.createElement(__OutlinePdfButton,{type:"button",onClick:()=>__setPdfMode(true)},__OutlinePdfReact.createElement(__OutlinePdfText,{message:"Print to PDF…"})),`,
    ],
  ];
  const routeChanges = [
    [
      0,
      0,
      `import {AdvancedPrintView as __OutlinePdfPrintView,React as __OutlinePdfReact} from "./${widgetName}";\n`,
    ],
    [
      routesReturn.start,
      routesReturn.start,
      'if(window.location.pathname==="/print")return __OutlinePdfReact.createElement(__OutlinePdfPrintView);',
    ],
  ];
  const changed = new Map([
    [docFile, edits(doc, docChanges)],
    [exportFile, edits(exp, expChanges)],
    [routes.name, edits(routes.code, routeChanges)],
    [
      codeFile,
      codeSource +
        `\nexport {${codeLoader.id.name} as __outlinePdfLoadCodeLanguage};`,
    ],
  ]);
  const names = new Set(assets.keys());
  const references = /(["'`])([^"'`\s]+\.js)\1/g;
  const deps = new Map(
    [...assets].map(([name, code]) => [
      name,
      new Set(
        [...code.matchAll(references)]
          .map((m) => path.posix.basename(m[2]))
          .filter((n) => names.has(n)),
      ),
    ]),
  );
  const affected = new Set(changed.keys());
  let more = true;
  while (more) {
    more = false;
    for (const [name, dependencies] of deps)
      if (
        !affected.has(name) &&
        [...dependencies].some((n) => affected.has(n))
      ) {
        affected.add(name);
        more = true;
      }
  }
  const renamed = new Map(
    [...affected].map((n) => [n, n.replace(/\.js$/, `.pdf-${id}.js`)]),
  );
  const rewrite = (code) =>
    code.replace(references, (full, q, ref) => {
      const base = path.posix.basename(ref),
        next = renamed.get(base);
      return next ? q + ref.slice(0, -base.length) + next + q : full;
    });
  const files = new Map();
  for (const name of affected)
    files.set(
      "app/assets/" + renamed.get(name),
      rewrite(changed.get(name) ?? assets.get(name)),
    );
  files.set("app/assets/" + bridgeName, rewrite(bridge));
  files.set(
    "app/assets/" + widgetName,
    widget.replaceAll("./outline-pdf-bridge.js", "./" + bridgeName),
  );
  for (const name of [bridgeName, widgetName])
    parse(files.get("app/assets/" + name), {
      ecmaVersion: "latest",
      sourceType: "module",
    });
  return {
    files,
    rewrite,
    renamed,
    semanticAssets: [docFile, exportFile, routes.name, codeFile],
  };
}

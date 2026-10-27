import assert from "node:assert/strict";
import test from "node:test";
import { planFrontend } from "./frontend.mjs";

const fixture = () =>
  new Map([
    [
      "actions.aaa.js",
      'import {env,client} from "./native.abc.js";const unrelated=42;const action=createAction({name:()=>"PDF",analyticsName:"Download document as PDF",visible:({activeDocumentId,stores})=>!!(activeDocumentId&&stores.policies.abilities(activeDocumentId).download&&env.PDF_EXPORT_ENABLED),perform:async({stores,activeDocumentId})=>{await stores.documents.get(activeDocumentId).download({contentType:"application/pdf"})}});function markdown(){return client.post("/documents.export",{})}',
    ],
    [
      "ExportDialog.bbb.js",
      'import {interop,nativeReact,styled,useStores,Text,useTranslation} from "./native.abc.js";const React=interop(nativeReact());const HR=styled.hr`margin:1px`;function Selector({formats,value,onChange}){return jsx("input",{type:"radio"})}const Dialog=observer(({collection,onSubmit})=>{const [format,setFormat]=React.useState("markdown");const {collections,ui}=useStores();const {t}=useTranslation();return jsx(Confirm,{children:[collection&&jsx(Text,{as:"p",children:"Exporting the collection may take some time."})]})});export {Dialog};',
    ],
    [
      "Button.ccc.js",
      "function Button(props){return props.children}const span=styled.span``;export {Button as t,span as n};",
    ],
    [
      "index.ddd.js",
      'import "./actions.aaa.js";import "./ExportDialog.bbb.js";import "./authenticated.eee.js";import {Provider} from "./native.abc.js";function Root(){return jsx(Provider,{theme:light,children:null})}',
    ],
    [
      "authenticated.eee.js",
      'function Routes(){return jsx(Layout,{path:"/dashboard"})}export{Routes as default};',
    ],
    [
      "PresentationMode.fff.js",
      'import {Editor,extensions} from "./native.abc.js";function Presentation(){const ext=React.useMemo(()=>extensions,[]);return jsx(Editor,{defaultValue:{},extensions:ext,readOnly:true,grow:false,placeholder:""})}',
    ],
    [
      "useBuildTheme.ggg.js",
      "function buildTheme(){return {}}export{buildTheme as t};",
    ],
    [
      "nodes.hhh.js",
      'const withComments=nodes=>[Mention,Comment,...nodes.filter(node=>node!==Mention)];export{withComments as c};async function loadLanguage(language){console.error("Failed to load language",language)}',
    ],
    [
      "Switch.iii.js",
      "function Switch(props){return null}export {Switch as t};",
    ],
    ["native.abc.js", 'export const untouched="original";'],
  ]);

test("frontend patch connects native print rendering and fingerprints importing assets", () => {
  const assets = fixture(),
    before = [...assets];
  const result = planFrontend(
    assets,
    'export {React} from "./outline-pdf-bridge.js";',
    "testpatch",
  );
  assert.deepEqual([...assets], before);
  const bridge = result.files.get("app/assets/outline-pdf-bridge-testpatch.js");
  assert.ok(bridge.includes("as NativeEditor"));
  assert.ok(bridge.includes("as Switch"));
  assert.ok(bridge.includes("as RadioGroup"));
  assert.ok(bridge.includes("as ThemeProvider"));
  assert.ok(bridge.includes("as loadCodeLanguage"));
  assert.ok(
    result.files
      .get("app/assets/authenticated.eee.pdf-testpatch.js")
      .includes('window.location.pathname==="/print"'),
  );
  assert.ok(
    result.files
      .get("app/assets/nodes.hhh.pdf-testpatch.js")
      .includes("export {loadLanguage as __outlinePdfLoadCodeLanguage}"),
  );
  assert.equal(result.semanticAssets.length, 4);
  assert.equal(result.renamed.size, 5);
  assert.ok(!result.renamed.has("native.abc.js"));
  const action = result.files.get("app/assets/actions.aaa.pdf-testpatch.js");
  assert.ok(action.includes("const unrelated=42"));
  assert.ok(action.includes("ADVANCED_PRINT_ENABLED"));
  assert.ok(action.includes('client.post("/documents.export",{})'));
  assert.ok(action.includes("stores.dialogs.openModal"));
  assert.match(
    result.files.get("app/assets/index.ddd.pdf-testpatch.js"),
    /actions.aaa.pdf-testpatch.js/,
  );
  assert.match(
    result.files.get("app/assets/outline-pdf-bridge-testpatch.js"),
    /import \{useTranslation as __pdfUseTranslation\}/,
  );
  assert.match(
    action,
    /title:__OutlinePdfReact.createElement\(__OutlinePdfText/,
  );
  assert.match(
    result.files.get("app/assets/ExportDialog.bbb.pdf-testpatch.js"),
    /createElement\(__OutlinePdfText,\{message:"Print to PDF…"\}/,
  );
  assert.match(
    result.rewrite('"assets/index.ddd.js"'),
    /index.ddd.pdf-testpatch.js/,
  );
});

test("frontend patch requires the native translation hook before editing", () => {
  const assets = fixture();
  assets.set(
    "ExportDialog.bbb.js",
    assets
      .get("ExportDialog.bbb.js")
      .replace("const {t}=useTranslation();", ""),
  );
  const before = [...assets];
  assert.throws(
    () => planFrontend(assets, "", "testpatch"),
    /native translation hook/,
  );
  assert.deepEqual([...assets], before);
});

test("frontend patch refuses changed integration points before producing any edits", () => {
  const assets = fixture();
  assets.set(
    "actions.aaa.js",
    assets
      .get("actions.aaa.js")
      .replace("PDF_EXPORT_ENABLED", "REMOVED_FEATURE"),
  );
  const before = [...assets];
  assert.throws(
    () => planFrontend(assets, "", "testpatch"),
    /PDF feature flag/,
  );
  assert.deepEqual([...assets], before);
});

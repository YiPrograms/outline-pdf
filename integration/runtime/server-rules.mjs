// Validate the installed compiled integration points before changing any files.
export const serverRules = [
  [
    "server/routes/api/index.js",
    "const _fileOperations =",
    'const _advancedPrint = _interop_require_default(require("./advancedPrint"));\nconst _fileOperations =',
  ],
  [
    "server/routes/api/index.js",
    'router.use("/", _fileOperations.default.routes());',
    'router.use("/", _fileOperations.default.routes());\nrouter.use("/", _advancedPrint.default.routes());',
  ],
  [
    "server/env.js",
    "let Environment = class Environment {",
    'let Environment = class Environment {\nADVANCED_PRINT_ENABLED = process.env.ADVANCED_PRINT_ENABLED === "true";',
  ],
  [
    "server/env.js",
    '], Environment.prototype, "ENVIRONMENT", void 0);',
    '], Environment.prototype, "ENVIRONMENT", void 0);\n_ts_decorate([_Public.Public,(0,_classvalidator.IsBoolean)()],Environment.prototype,"ADVANCED_PRINT_ENABLED",void 0);',
  ],
];

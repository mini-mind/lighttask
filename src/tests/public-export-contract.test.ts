import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

const PACKAGE_ROOT = path.resolve(__dirname, "../..");
const PACKAGE_JSON_FILE = path.join(PACKAGE_ROOT, "package.json");
const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_FILE, "utf8")) as {
  exports: Record<string, { default: string; types: string }>;
};
const requireFromPackage = createRequire(PACKAGE_JSON_FILE);

test("公共导出契约：package.json exports 映射保持稳定", () => {
  assert.deepEqual(Object.keys(packageJson.exports), [
    ".",
    "./data-structures",
    "./rules",
    "./ports",
  ]);

  assert.deepEqual(packageJson.exports["."], {
    types: "./dist/index.d.ts",
    default: "./dist/index.js",
  });
  assert.deepEqual(packageJson.exports["./data-structures"], {
    types: "./dist/data-structures/index.d.ts",
    default: "./dist/data-structures/index.js",
  });
  assert.deepEqual(packageJson.exports["./rules"], {
    types: "./dist/rules/index.d.ts",
    default: "./dist/rules/index.js",
  });
  assert.deepEqual(packageJson.exports["./ports"], {
    types: "./dist/ports/index.d.ts",
    default: "./dist/ports/index.js",
  });
});

test("公共导出契约：root 入口只暴露约定的 runtime 符号", () => {
  const rootExports = requireFromPackage("lighttask") as Record<string, unknown>;

  assert.deepEqual(Object.keys(rootExports).sort(), ["LightTaskError", "createLightTask"]);
  assert.equal(typeof rootExports.createLightTask, "function");
  assert.equal(typeof rootExports.LightTaskError, "function");
});

test("公共导出契约：data-structures 子入口保持关键 runtime 导出", () => {
  const dataStructuresExports = requireFromPackage("lighttask/data-structures") as Record<
    string,
    unknown
  >;

  assert.equal(typeof dataStructuresExports.createCoreError, "function");
  assert.equal(typeof dataStructuresExports.throwCoreError, "function");
  assert.equal(typeof dataStructuresExports.createInitialRevision, "function");
  assert.equal(typeof dataStructuresExports.bumpRevision, "function");
  assert.equal(typeof dataStructuresExports.createTaskRecord, "function");
  assert.equal(typeof dataStructuresExports.createPlanSessionRecord, "function");
  assert.equal(typeof dataStructuresExports.createRuntimeRecord, "function");
  assert.equal(typeof dataStructuresExports.createGraphSnapshot, "function");
  assert.equal(typeof dataStructuresExports.createDomainEvent, "function");
  assert.equal(typeof dataStructuresExports.isTaskTerminalStatus, "function");
  assert.equal(typeof dataStructuresExports.isPlanTerminalStatus, "function");
  assert.equal(typeof dataStructuresExports.isRuntimeTerminalStatus, "function");
  assert.ok("CORE_ERROR_CODES" in dataStructuresExports);
  assert.ok("LightTaskError" in dataStructuresExports);
});

test("公共导出契约：rules 子入口保持关键 runtime 导出", () => {
  const rulesExports = requireFromPackage("lighttask/rules") as Record<string, unknown>;

  assert.equal(typeof rulesExports.canTaskTransition, "function");
  assert.equal(typeof rulesExports.getNextTaskStatus, "function");
  assert.equal(typeof rulesExports.resolveTaskStepProgress, "function");
  assert.equal(typeof rulesExports.selectDefaultTaskAction, "function");
  assert.equal(typeof rulesExports.transitionTaskStatus, "function");
  assert.equal(typeof rulesExports.listTaskActions, "function");
  assert.equal(typeof rulesExports.canPlanTransition, "function");
  assert.equal(typeof rulesExports.getNextPlanStatus, "function");
  assert.equal(typeof rulesExports.transitionPlanStatus, "function");
  assert.equal(typeof rulesExports.listPlanActions, "function");
  assert.equal(typeof rulesExports.canRuntimeTransition, "function");
  assert.equal(typeof rulesExports.getNextRuntimeStatus, "function");
  assert.equal(typeof rulesExports.transitionRuntimeStatus, "function");
  assert.equal(typeof rulesExports.listRuntimeActions, "function");
  assert.equal(typeof rulesExports.selectDefaultRuntimeAction, "function");
  assert.equal(typeof rulesExports.findReadyNodeIds, "function");
  assert.equal(typeof rulesExports.topologicalSort, "function");
  assert.equal(typeof rulesExports.validateDagSnapshot, "function");
  assert.equal(typeof rulesExports.decideIdempotency, "function");
  assert.equal(typeof rulesExports.assertExpectedRevision, "function");
  assert.equal(typeof rulesExports.assertNextRevision, "function");
});

test("公共导出契约：ports 子入口保持 type-only runtime 语义", () => {
  const portsExports = requireFromPackage("lighttask/ports") as Record<string, unknown>;

  assert.deepEqual(Object.keys(portsExports), []);
  assert.equal(
    requireFromPackage.resolve("lighttask/ports"),
    path.join(PACKAGE_ROOT, "dist/ports/index.js"),
  );
  assert.equal(fs.existsSync(path.join(PACKAGE_ROOT, "dist/ports/index.d.ts")), true);
});

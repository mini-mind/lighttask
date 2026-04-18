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

test("公共导出契约：package exports 只保留 root/models/policies/adapters/memory", () => {
  assert.deepEqual(Object.keys(packageJson.exports), [
    ".",
    "./models",
    "./policies",
    "./adapters",
    "./adapters/memory",
  ]);
});

test("公共导出契约：root 入口只暴露 createLightTask 与 LightTaskError", () => {
  const rootExports = requireFromPackage("lighttask") as Record<string, unknown>;
  assert.deepEqual(Object.keys(rootExports).sort(), ["LightTaskError", "createLightTask"]);
});

test("公共导出契约：models 只暴露当前领域模型构造能力", () => {
  const exportsMap = requireFromPackage("lighttask/models") as Record<string, unknown>;
  assert.equal(typeof exportsMap.createTaskRecord, "function");
  assert.equal(typeof exportsMap.createPlanRecord, "function");
  assert.equal("createGraphSnapshot" in exportsMap, false);
  assert.equal("isPlanTerminalStatus" in exportsMap, false);
  assert.equal("TaskLifecycleStatus" in exportsMap, false);
});

test("公共导出契约：policies 只暴露当前策略与运行时规则", () => {
  const exportsMap = requireFromPackage("lighttask/policies") as Record<string, unknown>;
  assert.equal(typeof exportsMap.createTaskLifecyclePolicy, "function");
  assert.equal(typeof exportsMap.transitionRuntimeStatus, "function");
  assert.equal("topologicalSort" in exportsMap, false);
  assert.equal("canPlanTransition" in exportsMap, false);
});

test("公共导出契约：adapters/memory 只暴露当前内存适配器", () => {
  const exportsMap = requireFromPackage("lighttask/adapters/memory") as Record<string, unknown>;
  assert.equal(typeof exportsMap.createInMemoryLightTaskPorts, "function");
  assert.equal(typeof exportsMap.createInMemoryTaskRepository, "function");
  assert.equal("createInMemoryGraphRepository" in exportsMap, false);
});

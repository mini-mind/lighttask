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
    "./ports/in-memory",
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
  assert.deepEqual(packageJson.exports["./ports/in-memory"], {
    types: "./dist/ports/in-memory.d.ts",
    default: "./dist/ports/in-memory.js",
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
  assert.equal(typeof dataStructuresExports.createOutputRecord, "function");
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

test("公共导出契约：ports/in-memory 子入口暴露可用的内存适配器", () => {
  const portsExports = requireFromPackage("lighttask/ports/in-memory") as Record<string, unknown>;

  assert.equal(typeof portsExports.createInMemoryLightTaskPorts, "function");
  assert.equal(typeof portsExports.createInMemoryTaskRepository, "function");
  assert.equal(typeof portsExports.createInMemoryPlanRepository, "function");
  assert.equal(typeof portsExports.createInMemoryGraphRepository, "function");
  assert.equal(typeof portsExports.createInMemoryRuntimeRepository, "function");
  assert.equal(typeof portsExports.createInMemoryOutputRepository, "function");
  assert.equal(typeof portsExports.createInMemoryNotifyCollector, "function");
  assert.equal(typeof portsExports.createNoopConsistencyPort, "function");
  assert.equal(typeof portsExports.createSystemClock, "function");
  assert.equal(typeof portsExports.createTaskIdGenerator, "function");
  assert.equal(
    requireFromPackage.resolve("lighttask/ports/in-memory"),
    path.join(PACKAGE_ROOT, "dist/ports/in-memory.js"),
  );
  assert.equal(fs.existsSync(path.join(PACKAGE_ROOT, "dist/ports/in-memory.d.ts")), true);
});

test("公共导出契约：README 和接入指南里的最小启动路径可直接工作", () => {
  const rootExports = requireFromPackage("lighttask") as Record<string, unknown>;
  const portsExports = requireFromPackage("lighttask/ports/in-memory") as Record<string, unknown>;
  const createLightTask = rootExports.createLightTask as (options: unknown) => {
    createPlan(input: { id: string; title: string }): unknown;
    createTask(input: { title: string; planId: string }): { id: string };
    saveGraph(
      planId: string,
      input: {
        nodes: { id: string; taskId: string; label: string }[];
        edges: [];
      },
    ): unknown;
    publishGraph(planId: string, input: { expectedRevision: number }): unknown;
    getPlanSchedulingFacts(
      planId: string,
      input: { expectedPublishedGraphRevision: number },
    ): { runnableNodeIds: string[] };
  };
  const createInMemoryLightTaskPorts = portsExports.createInMemoryLightTaskPorts as () => unknown;

  assert.equal(typeof createLightTask, "function");
  assert.equal(typeof createInMemoryLightTaskPorts, "function");

  const lighttask = createLightTask(createInMemoryLightTaskPorts());

  lighttask.createPlan({
    id: "plan_public_exports_smoke",
    title: "public exports smoke",
  });
  const task = lighttask.createTask({
    title: "任务 A",
    planId: "plan_public_exports_smoke",
  });
  lighttask.saveGraph("plan_public_exports_smoke", {
    nodes: [{ id: "node_a", taskId: task.id, label: "任务 A" }],
    edges: [],
  });
  lighttask.publishGraph("plan_public_exports_smoke", { expectedRevision: 1 });

  assert.deepEqual(
    lighttask.getPlanSchedulingFacts("plan_public_exports_smoke", {
      expectedPublishedGraphRevision: 1,
    }).runnableNodeIds,
    ["node_a"],
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import { LightTaskError, type LightTaskPlan, createLightTask } from "../index";
import { assertInvalidDependencyCases, createTestLightTaskOptions } from "./ports-fixture";

test("LightTask Plan API 支持创建与读取计划", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());

  const plan = lighttask.createPlan({
    id: " plan_alpha ",
    title: " 调查编排模型 ",
    metadata: { owner: "tester" },
  });

  assert.equal(plan.id, "plan_alpha");
  assert.equal(plan.title, "调查编排模型");
  assert.equal(plan.status, "draft");
  assert.equal(plan.revision, 1);
  assert.deepEqual(plan.metadata, { owner: "tester" });

  const stored = lighttask.getPlan("plan_alpha");
  assert.ok(stored);
  assert.equal(stored.title, "调查编排模型");
});

test("LightTask Plan API 查询不存在计划时返回 undefined", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  assert.equal(lighttask.getPlan("plan_missing"), undefined);
});

test("LightTask Plan API 查询时会标准化 planId", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  lighttask.createPlan({
    id: " plan_query_trim ",
    title: "标准化查询",
  });

  const stored = lighttask.getPlan("  plan_query_trim  ");
  assert.ok(stored);
  assert.equal(stored.id, "plan_query_trim");
});

test("LightTask Plan API 查询空白 planId 时会抛校验错误", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());

  assert.throws(
    () => lighttask.getPlan("   "),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.equal(error.coreError.message, "计划 ID 不能为空");
      assert.equal(error.details?.planId, "   ");
      return true;
    },
  );
});

test("LightTask Plan API 会拒绝空白 planId", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());

  assert.throws(
    () =>
      lighttask.createPlan({
        id: "   ",
        title: "计划标题",
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.equal(error.coreError.message, "计划 ID 不能为空");
      assert.equal(error.details?.planId, "   ");
      return true;
    },
  );
});

test("LightTask Plan API 会拒绝空白标题", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());

  assert.throws(
    () =>
      lighttask.createPlan({
        id: "plan_blank_title",
        title: "   ",
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.equal(error.coreError.message, "计划标题不能为空");
      assert.equal(error.details?.title, "   ");
      return true;
    },
  );
});

test("LightTask Plan API 在重复 planId 创建时会拒绝覆盖已有计划", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  lighttask.createPlan({
    id: "plan_duplicate",
    title: "第一次创建",
  });

  assert.throws(
    () =>
      lighttask.createPlan({
        id: "plan_duplicate",
        title: "第二次创建",
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "STATE_CONFLICT");
      assert.equal(error.coreError.message, "计划 ID 已存在，禁止覆盖已有记录");
      assert.equal(error.details?.planId, "plan_duplicate");
      return true;
    },
  );

  const stored = lighttask.getPlan("plan_duplicate");
  assert.ok(stored);
  assert.equal(stored.title, "第一次创建");
});

test("LightTask Plan API 返回快照应与内部状态隔离", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  const plan = lighttask.createPlan({
    id: "plan_snapshot",
    title: "快照隔离",
    metadata: { owner: { name: "tester" } },
  });

  plan.title = "外部篡改";
  assert.ok(plan.metadata);
  plan.metadata.owner = { name: "mutated" };

  const stored = lighttask.getPlan("plan_snapshot");
  assert.ok(stored);
  assert.equal(stored.title, "快照隔离");
  assert.deepEqual(stored.metadata, { owner: { name: "tester" } });
});

test("LightTask Plan API 在端口直接抛出原生异常时会归一化为 LightTaskError", () => {
  const lighttask = createLightTask({
    ...createTestLightTaskOptions(),
    planRepository: {
      get() {
        throw new TypeError("计划仓储 get 异常");
      },
      create() {
        return {
          ok: true as const,
          plan: {} as LightTaskPlan,
        };
      },
    },
  });

  assert.throws(
    () => lighttask.getPlan("plan_error"),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "INVARIANT_VIOLATION");
      assert.equal(error.coreError.message, "计划仓储 get 异常");
      assert.equal(error.details?.originalErrorName, "TypeError");
      return true;
    },
  );
});

test("LightTask Plan API 在 create 写路径直接抛出原生异常时会归一化为 LightTaskError", () => {
  const lighttask = createLightTask({
    ...createTestLightTaskOptions(),
    planRepository: {
      get() {
        return undefined;
      },
      create() {
        throw new TypeError("计划仓储 create 异常");
      },
    },
  });

  assert.throws(
    () =>
      lighttask.createPlan({
        id: "plan_create_error",
        title: "create error",
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "INVARIANT_VIOLATION");
      assert.equal(error.coreError.message, "计划仓储 create 异常");
      assert.equal(error.details?.originalErrorName, "TypeError");
      return true;
    },
  );
});

test("LightTask Plan API 在注入坏依赖时会逐项报告缺失 plan 端口函数", () => {
  const invalidOptionsCases = [
    {
      name: "planRepository.get",
      options: {
        planRepository: {
          create() {
            return { ok: true as const, plan: {} as LightTaskPlan };
          },
        },
      },
      invoke(lighttask: ReturnType<typeof createLightTask>) {
        lighttask.getPlan("plan_missing");
      },
    },
    {
      name: "planRepository.create",
      options: {
        planRepository: {
          get() {
            return undefined;
          },
        },
      },
      invoke(lighttask: ReturnType<typeof createLightTask>) {
        lighttask.createPlan({
          id: "plan_invalid_dependency",
          title: "坏依赖校验",
        });
      },
    },
  ];

  assertInvalidDependencyCases(invalidOptionsCases);
});

test("LightTask Plan API 只要求当前已落地 plan 依赖，不前置耦合 task/graph 能力", () => {
  let storedPlan: LightTaskPlan | undefined;
  const lighttask = createLightTask({
    ...createTestLightTaskOptions(),
    taskRepository: {},
    planRepository: {
      get(planId: string) {
        return storedPlan && planId === storedPlan.id ? structuredClone(storedPlan) : undefined;
      },
      create(plan: LightTaskPlan) {
        storedPlan = structuredClone(plan);
        return {
          ok: true as const,
          plan: structuredClone(plan),
        };
      },
    },
    graphRepository: {},
    idGenerator: {},
  });

  const plan = lighttask.createPlan({
    id: "plan_minimal_repo",
    title: "最小计划仓储",
  });

  assert.equal(plan.id, "plan_minimal_repo");
  assert.equal(lighttask.getPlan("plan_minimal_repo")?.title, "最小计划仓储");
});

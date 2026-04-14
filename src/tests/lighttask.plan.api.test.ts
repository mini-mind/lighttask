import assert from "node:assert/strict";
import test from "node:test";
import { LightTaskError, type LightTaskPlan, createLightTask } from "../index";
import { assertInvalidDependencyCases, createTestLightTaskOptions } from "./ports-fixture";

test("LightTask Plan API 支持创建、读取与推进计划", () => {
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

  const advanced = lighttask.advancePlan("plan_alpha", {
    expectedRevision: 1,
  });
  assert.equal(advanced.status, "planning");
  assert.equal(advanced.revision, 2);
  assert.ok(lighttask.getPlan("plan_alpha"));
  assert.equal(lighttask.getPlan("plan_alpha")?.status, "planning");
});

test("LightTask Plan API 省略 action 时会按默认链路推进到终态", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  lighttask.createPlan({
    id: "plan_default_progression",
    title: "默认推进",
  });

  const planning = lighttask.advancePlan("plan_default_progression", { expectedRevision: 1 });
  assert.equal(planning.status, "planning");
  const ready = lighttask.advancePlan("plan_default_progression", { expectedRevision: 2 });
  assert.equal(ready.status, "ready");
  const confirmed = lighttask.advancePlan("plan_default_progression", { expectedRevision: 3 });
  assert.equal(confirmed.status, "confirmed");
  const archived = lighttask.advancePlan("plan_default_progression", { expectedRevision: 4 });
  assert.equal(archived.status, "archived");
});

test("LightTask Plan API 支持显式 fail 动作", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  lighttask.createPlan({
    id: "plan_fail",
    title: "失败分支",
  });

  const failed = lighttask.advancePlan("plan_fail", {
    expectedRevision: 1,
    action: "fail",
  });
  assert.equal(failed.status, "failed");
  assert.equal(failed.revision, 2);
});

test("LightTask Plan API 推进时会标准化 planId", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  lighttask.createPlan({
    id: "plan_advance_trim",
    title: "推进标准化",
  });

  const advanced = lighttask.advancePlan("  plan_advance_trim  ", {
    expectedRevision: 1,
  });
  assert.equal(advanced.status, "planning");
});

test("LightTask Plan API 推进空白 planId 时会抛校验错误", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());

  assert.throws(
    () =>
      lighttask.advancePlan("   ", {
        expectedRevision: 1,
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

test("LightTask Plan API 推进不存在计划时返回 NOT_FOUND", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());

  assert.throws(
    () =>
      lighttask.advancePlan("plan_missing", {
        expectedRevision: 1,
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "NOT_FOUND");
      assert.equal(error.coreError.message, "未找到计划");
      assert.equal(error.details?.planId, "plan_missing");
      return true;
    },
  );
});

test("LightTask Plan API 缺失 expectedRevision 时会抛校验错误", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  lighttask.createPlan({
    id: "plan_missing_revision",
    title: "缺失 revision",
  });

  assert.throws(
    () => lighttask.advancePlan("plan_missing_revision", {} as never),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.equal(error.coreError.message, "expectedRevision 为必填字段");
      assert.equal(error.details?.planId, "plan_missing_revision");
      return true;
    },
  );
});

test("LightTask Plan API expectedRevision 不匹配时返回 REVISION_CONFLICT", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  lighttask.createPlan({
    id: "plan_revision_conflict",
    title: "revision 冲突",
  });

  assert.throws(
    () =>
      lighttask.advancePlan("plan_revision_conflict", {
        expectedRevision: 2,
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "REVISION_CONFLICT");
      assert.equal(error.coreError.message, "expectedRevision 与当前 revision 不一致");
      assert.equal(error.details?.currentRevision, 1);
      assert.equal(error.details?.expectedRevision, 2);
      return true;
    },
  );
});

test("LightTask Plan API 非法状态迁移返回 STATE_CONFLICT", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  lighttask.createPlan({
    id: "plan_invalid_transition",
    title: "非法迁移",
  });

  assert.throws(
    () =>
      lighttask.advancePlan("plan_invalid_transition", {
        expectedRevision: 1,
        action: "confirm",
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "STATE_CONFLICT");
      assert.equal(error.coreError.message, "计划状态迁移冲突");
      assert.equal(error.details?.currentStatus, "draft");
      assert.equal(error.details?.action, "confirm");
      return true;
    },
  );
});

test("LightTask Plan API 终态继续默认推进会返回 STATE_CONFLICT", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  lighttask.createPlan({
    id: "plan_terminal",
    title: "终态计划",
  });
  lighttask.advancePlan("plan_terminal", { expectedRevision: 1, action: "fail" });

  assert.throws(
    () =>
      lighttask.advancePlan("plan_terminal", {
        expectedRevision: 2,
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "STATE_CONFLICT");
      assert.equal(error.coreError.message, "当前计划没有可推进动作");
      assert.equal(error.details?.currentStatus, "failed");
      return true;
    },
  );
});

test("LightTask Plan API 推进返回快照应与内部状态隔离", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  lighttask.createPlan({
    id: "plan_advance_snapshot",
    title: "推进快照隔离",
    metadata: { owner: { name: "tester" } },
  });

  const advanced = lighttask.advancePlan("plan_advance_snapshot", {
    expectedRevision: 1,
  });
  advanced.title = "外部篡改";
  assert.ok(advanced.metadata);
  advanced.metadata.owner = { name: "mutated" };

  const stored = lighttask.getPlan("plan_advance_snapshot");
  assert.ok(stored);
  assert.equal(stored.title, "推进快照隔离");
  assert.deepEqual(stored.metadata, { owner: { name: "tester" } });
  assert.equal(stored.status, "planning");
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

test("LightTask Plan API 在 advance 写路径直接抛出原生异常时会归一化为 LightTaskError", () => {
  const lighttask = createLightTask({
    ...createTestLightTaskOptions(),
    planRepository: {
      get() {
        return {
          id: "plan_advance_error",
          title: "advance error",
          status: "draft",
          revision: 1,
          createdAt: "2026-04-14T00:00:00.000Z",
          updatedAt: "2026-04-14T00:00:00.000Z",
        } as LightTaskPlan;
      },
      create() {
        return {
          ok: true as const,
          plan: {} as LightTaskPlan,
        };
      },
      saveIfRevisionMatches() {
        throw new TypeError("计划仓储 save 异常");
      },
    },
  });

  assert.throws(
    () =>
      lighttask.advancePlan("plan_advance_error", {
        expectedRevision: 1,
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "INVARIANT_VIOLATION");
      assert.equal(error.coreError.message, "计划仓储 save 异常");
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
          saveIfRevisionMatches() {
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
          saveIfRevisionMatches() {
            return { ok: true as const, plan: {} as LightTaskPlan };
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
    {
      name: "planRepository.saveIfRevisionMatches",
      options: {
        planRepository: {
          get() {
            return {
              id: "plan_invalid_advance_dependency",
              title: "坏推进依赖",
              status: "draft",
              revision: 1,
              createdAt: "2026-04-14T00:00:00.000Z",
              updatedAt: "2026-04-14T00:00:00.000Z",
            } as LightTaskPlan;
          },
          create() {
            return { ok: true as const, plan: {} as LightTaskPlan };
          },
        },
      },
      invoke(lighttask: ReturnType<typeof createLightTask>) {
        lighttask.advancePlan("plan_invalid_advance_dependency", {
          expectedRevision: 1,
        });
      },
    },
    {
      name: "clock.now",
      options: {
        clock: {},
        planRepository: {
          get() {
            return {
              id: "plan_invalid_clock_dependency",
              title: "坏时钟依赖",
              status: "draft",
              revision: 1,
              createdAt: "2026-04-14T00:00:00.000Z",
              updatedAt: "2026-04-14T00:00:00.000Z",
            } as LightTaskPlan;
          },
          create() {
            return { ok: true as const, plan: {} as LightTaskPlan };
          },
          saveIfRevisionMatches() {
            return { ok: true as const, plan: {} as LightTaskPlan };
          },
        },
      },
      invoke(lighttask: ReturnType<typeof createLightTask>) {
        lighttask.advancePlan("plan_invalid_clock_dependency", {
          expectedRevision: 1,
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
      saveIfRevisionMatches(plan: LightTaskPlan, expectedRevision: number) {
        if (!storedPlan || storedPlan.revision !== expectedRevision) {
          return {
            ok: false as const,
            error: {
              code: "REVISION_CONFLICT" as const,
              message: "计划 revision 冲突，保存被拒绝",
            },
          };
        }
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
  assert.equal(
    lighttask.advancePlan("plan_minimal_repo", { expectedRevision: 1 }).status,
    "planning",
  );
});

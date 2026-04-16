import assert from "node:assert/strict";
import test from "node:test";
import { LightTaskError, type LightTaskTask, createLightTask } from "../index";
import type { TaskRepository } from "../ports";
import { createTestLightTaskOptions } from "./ports-fixture";

type TaskRecordFixture = LightTaskTask & {
  lastAdvanceFingerprint?: string;
};

test("LightTask 公共 API 支持创建和推进任务", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  const task = lighttask.createTask({
    title: "验证编排主流程",
  });

  assert.equal(task.steps.length, 5);
  assert.equal(task.designStatus, "ready");
  assert.equal(task.executionStatus, "queued");
  assert.equal(task.revision, 1);
  assert.equal(task.steps[0].status, "doing");
  assert.equal(task.steps[1].status, "todo");

  const advancedTask = lighttask.advanceTask(task.id, {
    expectedRevision: 1,
  });
  assert.equal(advancedTask.executionStatus, "dispatched");
  assert.equal(advancedTask.revision, 2);
  assert.equal(advancedTask.steps[0].status, "done");
  assert.equal(advancedTask.steps[1].status, "doing");
  assert.equal(lighttask.listTasks().length, 1);
});

test("LightTask 公共 API 支持创建 draft 设计态任务且不会误入执行推进", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  const task = lighttask.createTask({
    title: "草稿任务",
    designStatus: "draft",
  });

  assert.equal(task.designStatus, "draft");
  assert.equal(task.executionStatus, "queued");
  assert.ok(task.steps.every((step) => step.status === "todo"));

  assert.throws(
    () =>
      lighttask.advanceTask(task.id, {
        expectedRevision: 1,
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "STATE_CONFLICT");
      assert.equal(error.coreError.message, "当前任务未处于 ready 设计态，不能推进执行状态");
      assert.equal(error.details?.taskId, task.id);
      assert.equal(error.details?.currentDesignStatus, "draft");
      return true;
    },
  );
});

test("LightTask 公共 API 支持更新任务设计态并补齐 draft -> ready 的执行入口", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  const task = lighttask.createTask({
    title: "待完善草稿",
    designStatus: "draft",
  });

  const updated = lighttask.updateTask(task.id, {
    expectedRevision: 1,
    title: "  已完成设计  ",
    summary: "  补齐设计说明  ",
    designStatus: " ready " as never,
    metadata: { owner: { name: "tester" } },
  });

  assert.equal(updated.title, "已完成设计");
  assert.equal(updated.summary, "补齐设计说明");
  assert.equal(updated.designStatus, "ready");
  assert.equal(updated.executionStatus, "queued");
  assert.equal(updated.revision, 2);
  assert.equal(updated.steps[0].status, "doing");
  assert.equal(updated.steps[1].status, "todo");

  const advanced = lighttask.advanceTask(task.id, {
    expectedRevision: 2,
  });

  assert.equal(advanced.executionStatus, "dispatched");
  assert.equal(advanced.steps[0].status, "done");
  assert.equal(advanced.steps[1].status, "doing");
});

test("LightTask 公共 API 创建任务时会拒绝非法 designStatus", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());

  assert.throws(
    () =>
      lighttask.createTask({
        title: "非法设计态",
        designStatus: "reviewing" as never,
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.equal(error.coreError.message, "designStatus 仅支持 draft 或 ready");
      assert.equal(error.details?.designStatus, "reviewing");
      return true;
    },
  );
});

test("LightTask 公共 API 更新任务时会拒绝非法 designStatus", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  const task = lighttask.createTask({
    title: "更新非法设计态",
  });

  assert.throws(
    () =>
      lighttask.updateTask(task.id, {
        expectedRevision: 1,
        designStatus: "reviewing" as never,
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.equal(error.coreError.message, "designStatus 仅支持 draft 或 ready");
      assert.equal(error.details?.taskId, task.id);
      assert.equal(error.details?.designStatus, "reviewing");
      return true;
    },
  );
});

test("LightTask 公共 API updateTask 支持显式清空 summary/metadata/extensions", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  const task = lighttask.createTask({
    title: "清空任务字段",
    summary: "初始摘要",
    metadata: { owner: { name: "tester" } },
    extensions: {
      properties: { priority: "p1" },
      namespaces: { planner: { lane: "core" } },
    },
  });

  const updated = lighttask.updateTask(task.id, {
    expectedRevision: 1,
    summary: null,
    metadata: null,
    extensions: null,
  });

  assert.equal(updated.summary, undefined);
  assert.equal(updated.metadata, undefined);
  assert.equal(updated.extensions, undefined);
  assert.equal(updated.revision, 2);
});

test("LightTask 公共 API 在不存在任务时推进会抛错", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  assert.throws(
    () =>
      lighttask.advanceTask("  task_missing  ", {
        expectedRevision: 1,
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "NOT_FOUND");
      assert.equal(error.coreError.message, "未找到任务");
      assert.equal(error.details?.taskId, "task_missing");
      return true;
    },
  );
});

test("LightTask 公共 API 查询不存在任务时返回 undefined", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  assert.equal(lighttask.getTask("task_missing"), undefined);
});

test("LightTask 公共 API updateTask 只以 executionStatus 作为执行态真源", () => {
  const taskRepository: TaskRepository<TaskRecordFixture> = {
    list() {
      return [];
    },
    get(taskId) {
      if (taskId !== "task_status_alias_update") {
        return undefined;
      }

      return {
        id: "task_status_alias_update",
        title: "状态别名更新",
        designStatus: "draft",
        executionStatus: "queued",
        revision: 1,
        createdAt: "2026-04-14T00:00:00.000Z",
        steps: [
          {
            id: "task_status_alias_update_investigate",
            title: "investigate",
            stage: "investigate",
            status: "todo",
          },
          {
            id: "task_status_alias_update_design",
            title: "design",
            stage: "design",
            status: "todo",
          },
        ],
      };
    },
    create() {
      throw new Error("本用例不应走 create");
    },
    saveIfRevisionMatches(task) {
      return {
        ok: true as const,
        task: structuredClone(task),
      };
    },
  };
  const lighttask = createLightTask(createTestLightTaskOptions({ taskRepository }));

  const updated = lighttask.updateTask("task_status_alias_update", {
    expectedRevision: 1,
    designStatus: "ready",
  });

  assert.equal(updated.executionStatus, "queued");
  assert.equal(updated.steps[0].status, "doing");
});

test("LightTask 公共 API 支持按计划列出任务且返回快照与内部状态隔离", () => {
  const planTasks: TaskRecordFixture[] = [
    {
      id: "task_plan_a_1",
      planId: "plan_alpha",
      title: "计划 Alpha 任务一",
      executionStatus: "queued",
      revision: 1,
      createdAt: "2026-04-14T00:00:00.000Z",
      steps: [
        {
          id: "task_plan_a_1_investigate",
          title: "investigate",
          stage: "investigate",
          status: "doing",
        },
      ],
      metadata: { owner: { name: "tester" } },
    },
    {
      id: "task_plan_b_1",
      planId: "plan_beta",
      title: "计划 Beta 任务一",
      executionStatus: "queued",
      revision: 1,
      createdAt: "2026-04-14T00:00:00.000Z",
      steps: [
        {
          id: "task_plan_b_1_investigate",
          title: "investigate",
          stage: "investigate",
          status: "doing",
        },
      ],
    },
  ];
  const taskRepository: TaskRepository<TaskRecordFixture> = {
    list() {
      return planTasks.map((task) => structuredClone(task));
    },
    get(taskId) {
      const task = planTasks.find((item) => item.id === taskId);
      return task ? structuredClone(task) : undefined;
    },
    create() {
      throw new Error("本用例不应走 create");
    },
    saveIfRevisionMatches() {
      throw new Error("本用例不应走 save");
    },
  };
  const lighttask = createLightTask(createTestLightTaskOptions({ taskRepository }));

  const listed = lighttask.listTasksByPlan("  plan_alpha  ");
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, "task_plan_a_1");
  assert.equal(listed[0].planId, "plan_alpha");

  listed[0].title = "外部篡改";
  assert.ok(listed[0].metadata);
  listed[0].metadata.owner = { name: "mutated" };

  const refetched = lighttask.getTask("task_plan_a_1");
  assert.ok(refetched);
  assert.equal(refetched.title, "计划 Alpha 任务一");
  assert.equal(refetched.planId, "plan_alpha");
  assert.deepEqual(refetched.metadata, { owner: { name: "tester" } });
});

test("LightTask listTasks 查询只按 executionStatus 过滤任务执行态", () => {
  const taskRepository: TaskRepository<TaskRecordFixture> = {
    list() {
      return [
        {
          id: "task_status_alias_list",
          title: "状态别名查询",
          designStatus: "ready",
          executionStatus: "running",
          revision: 1,
          createdAt: "2026-04-14T00:00:00.000Z",
          steps: [
            {
              id: "task_status_alias_list_investigate",
              title: "investigate",
              stage: "investigate",
              status: "done",
            },
          ],
        },
      ];
    },
    get() {
      throw new Error("本用例不应走 get");
    },
    create() {
      throw new Error("本用例不应走 create");
    },
    saveIfRevisionMatches() {
      throw new Error("本用例不应走 save");
    },
  };
  const lighttask = createLightTask(createTestLightTaskOptions({ taskRepository }));

  assert.equal(lighttask.listTasks({ executionStatus: "running" }).length, 1);
  assert.equal(lighttask.listTasks({ executionStatus: "queued" }).length, 0);
});

test("LightTask 公共 API 查询时会标准化 taskId", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  const task = lighttask.createTask({
    title: "task 查询标准化",
  });

  const stored = lighttask.getTask(`  ${task.id}  `);
  assert.ok(stored);
  assert.equal(stored.id, task.id);
});

test("LightTask 公共 API 推进时会标准化 taskId", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  const task = lighttask.createTask({
    title: "task 推进标准化",
  });

  const advanced = lighttask.advanceTask(`  ${task.id}  `, {
    expectedRevision: 1,
  });
  assert.equal(advanced.id, task.id);
  assert.equal(advanced.executionStatus, "dispatched");
});

test("LightTask 公共 API 查询空白 taskId 时会抛校验错误", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());

  assert.throws(
    () => lighttask.getTask("   "),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.equal(error.coreError.message, "任务 ID 不能为空");
      assert.equal(error.details?.taskId, "   ");
      return true;
    },
  );
});

test("LightTask 公共 API 按计划列任务时空白 planId 会抛校验错误", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());

  assert.throws(
    () => lighttask.listTasksByPlan("   "),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.equal(error.coreError.message, "计划 ID 不能为空");
      assert.equal(error.details?.planId, "   ");
      return true;
    },
  );
});

test("LightTask 公共 API 推进空白 taskId 时会抛校验错误", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());

  assert.throws(
    () =>
      lighttask.advanceTask("   ", {
        expectedRevision: 1,
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.equal(error.coreError.message, "任务 ID 不能为空");
      assert.equal(error.details?.taskId, "   ");
      return true;
    },
  );
});

test("LightTask 公共 API 在任务已全部完成后再次推进会抛错", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  const task = lighttask.createTask({
    title: "推进到终态",
  });

  for (let i = 0; i < 3; i += 1) {
    lighttask.advanceTask(task.id, {
      expectedRevision: i + 1,
    });
  }

  assert.throws(
    () =>
      lighttask.advanceTask(task.id, {
        expectedRevision: 4,
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "STATE_CONFLICT");
      assert.equal(error.coreError.message, "任务没有可推进的进行中阶段");
      assert.equal(error.details?.taskId, task.id);
      assert.equal(error.details?.currentStatus, "completed");
      return true;
    },
  );
});

test("LightTask 公共 API 在脏步骤快照缺少 doing 阶段时会拒绝 advance_one", () => {
  const brokenTask: TaskRecordFixture = {
    id: "task_dirty_advance_one",
    title: "脏步骤快照",
    executionStatus: "queued",
    revision: 1,
    createdAt: "2026-04-13T10:00:00.000Z",
    steps: [
      {
        id: "task_dirty_advance_one_investigate",
        title: "investigate",
        stage: "investigate",
        status: "todo",
      },
      { id: "task_dirty_advance_one_design", title: "design", stage: "design", status: "todo" },
      {
        id: "task_dirty_advance_one_implement",
        title: "implement",
        stage: "implement",
        status: "todo",
      },
      { id: "task_dirty_advance_one_verify", title: "verify", stage: "verify", status: "todo" },
      {
        id: "task_dirty_advance_one_converge",
        title: "converge",
        stage: "converge",
        status: "todo",
      },
    ],
  };
  let saveCalled = false;
  const taskRepository: TaskRepository<TaskRecordFixture> = {
    list() {
      return [structuredClone(brokenTask)];
    },
    get(taskId) {
      return taskId === brokenTask.id ? structuredClone(brokenTask) : undefined;
    },
    create() {
      throw new Error("本用例不应走 create");
    },
    saveIfRevisionMatches() {
      saveCalled = true;
      return {
        ok: true as const,
        task: structuredClone(brokenTask),
      };
    },
  };
  const lighttask = createLightTask(createTestLightTaskOptions({ taskRepository }));

  assert.throws(
    () =>
      lighttask.advanceTask(brokenTask.id, {
        action: "dispatch",
        expectedRevision: 1,
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "STATE_CONFLICT");
      assert.equal(error.coreError.message, "任务没有可推进的进行中阶段");
      assert.equal(error.details?.taskId, brokenTask.id);
      return true;
    },
  );
  assert.equal(saveCalled, false);

  const stored = lighttask.getTask(brokenTask.id);
  assert.ok(stored);
  assert.ok(stored.steps.every((step) => step.status === "todo"));
});

test("LightTask 公共 API 在已收敛脏步骤快照上仍可执行 complete 收口", () => {
  let storedTask: TaskRecordFixture = {
    id: "task_dirty_complete_all",
    title: "已收敛脏步骤快照",
    executionStatus: "running",
    revision: 3,
    createdAt: "2026-04-13T10:10:00.000Z",
    steps: [
      {
        id: "task_dirty_complete_all_investigate",
        title: "investigate",
        stage: "investigate",
        status: "done",
      },
      { id: "task_dirty_complete_all_design", title: "design", stage: "design", status: "done" },
      {
        id: "task_dirty_complete_all_implement",
        title: "implement",
        stage: "implement",
        status: "done",
      },
      { id: "task_dirty_complete_all_verify", title: "verify", stage: "verify", status: "done" },
      {
        id: "task_dirty_complete_all_converge",
        title: "converge",
        stage: "converge",
        status: "done",
      },
    ],
  };
  const taskRepository: TaskRepository<TaskRecordFixture> = {
    list() {
      return [structuredClone(storedTask)];
    },
    get(taskId) {
      return taskId === storedTask.id ? structuredClone(storedTask) : undefined;
    },
    create() {
      throw new Error("本用例不应走 create");
    },
    saveIfRevisionMatches(task, expectedRevision) {
      assert.equal(expectedRevision, 3);
      const snapshot = structuredClone(task);
      storedTask = snapshot;
      return {
        ok: true as const,
        task: snapshot,
      };
    },
  };
  const lighttask = createLightTask(createTestLightTaskOptions({ taskRepository }));

  const completed = lighttask.advanceTask(storedTask.id, {
    action: "complete",
    expectedRevision: 3,
  });

  assert.equal(completed.executionStatus, "completed");
  assert.equal(completed.revision, 4);
  assert.ok(completed.steps.every((step) => step.status === "done"));
});

test("LightTask 公共 API 会拒绝空白标题", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  assert.throws(
    () =>
      lighttask.createTask({
        title: "   ",
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.equal(error.coreError.message, "任务标题不能为空");
      assert.equal(error.details?.title, "   ");
      return true;
    },
  );
  assert.equal(lighttask.listTasks().length, 0);
});

test("LightTask 返回快照应与内部状态隔离", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  const task = lighttask.createTask({
    title: "隔离验证",
    metadata: { source: { name: "tester" } },
    extensions: {
      properties: { priority: "high" },
      namespaces: { worker: { batch: "1A" } },
    },
  });

  task.title = "外部篡改标题";
  task.executionStatus = "failed";
  task.revision = 999;
  task.steps[0].status = "done";
  assert.ok(task.metadata);
  task.metadata.source = { name: "mutated" };
  assert.ok(task.extensions);
  task.extensions.properties = { priority: "low" };

  const stored = lighttask.getTask(task.id);
  assert.ok(stored);
  assert.equal(stored.title, "隔离验证");
  assert.equal(stored.executionStatus, "queued");
  assert.equal(stored.revision, 1);
  assert.equal(stored.steps[0].status, "doing");
  assert.deepEqual(stored.metadata, { source: { name: "tester" } });
  assert.deepEqual(stored.extensions, {
    properties: { priority: "high" },
    namespaces: { worker: { batch: "1A" } },
  });
});

test("LightTask listTasks 返回值与内部状态隔离", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  const task = lighttask.createTask({
    title: "列表隔离验证",
  });

  const listed = lighttask.listTasks();
  listed[0].title = "外部改写";
  listed[0].executionStatus = "cancelled";
  listed[0].revision = 500;
  listed[0].steps[0].status = "done";

  const stored = lighttask.getTask(task.id);
  assert.ok(stored);
  assert.equal(stored.title, "列表隔离验证");
  assert.equal(stored.executionStatus, "queued");
  assert.equal(stored.revision, 1);
  assert.equal(stored.steps[0].status, "doing");
});

test("LightTask 连续创建任务时 ID 应保持唯一", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  const first = lighttask.createTask({ title: "任务一" });
  const second = lighttask.createTask({ title: "任务二" });

  assert.notEqual(first.id, second.id);
});

test("LightTask createTask 会标准化 idGenerator 返回的 taskId", () => {
  const lighttask = createLightTask(
    createTestLightTaskOptions({
      idGenerator: {
        nextTaskId() {
          return "  task_trimmed  ";
        },
      },
    }),
  );

  const created = lighttask.createTask({
    title: "taskId trim 校验",
  });

  assert.equal(created.id, "task_trimmed");
  assert.equal(created.steps[0].id, "task_trimmed_investigate");

  const stored = lighttask.getTask("task_trimmed");
  assert.ok(stored);
  assert.equal(stored.id, "task_trimmed");
});

test("LightTask createTask 会拒绝空白 taskId", () => {
  const lighttask = createLightTask(
    createTestLightTaskOptions({
      idGenerator: {
        nextTaskId() {
          return "   ";
        },
      },
    }),
  );

  assert.throws(
    () =>
      lighttask.createTask({
        title: "非法 taskId",
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.equal(error.coreError.message, "任务 ID 不能为空");
      assert.equal(error.details?.taskId, "");
      return true;
    },
  );
});

test("LightTask 公共 API 支持摘要 trim 与空白归一化", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  const withSummary = lighttask.createTask({
    title: "任务",
    summary: "  需要验证摘要  ",
  });
  const blankSummary = lighttask.createTask({
    title: "任务二",
    summary: "   ",
  });

  assert.equal(withSummary.summary, "需要验证摘要");
  assert.equal(blankSummary.summary, undefined);
});

test("LightTask 公共 API 支持 expectedRevision 校验", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  const task = lighttask.createTask({
    title: "revision 校验",
  });

  assert.throws(
    () =>
      lighttask.advanceTask(task.id, {
        expectedRevision: 2,
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "REVISION_CONFLICT");
      assert.equal(error.coreError.message, "expectedRevision 与当前 revision 不一致");
      assert.equal(error.details?.expectedRevision, 2);
      assert.equal(error.details?.currentRevision, 1);
      return true;
    },
  );
  const stored = lighttask.getTask(task.id);
  assert.ok(stored);
  assert.equal(stored.executionStatus, "queued");
  assert.equal(stored.revision, 1);
});

test("LightTask 公共 API 在缺少 expectedRevision 时会抛出校验错误", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  const task = lighttask.createTask({
    title: "required revision 校验",
  });

  assert.throws(
    () => lighttask.advanceTask(task.id, {} as never),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.equal(error.coreError.message, "expectedRevision 为必填字段");
      assert.equal(error.details?.taskId, task.id);
      return true;
    },
  );
  const stored = lighttask.getTask(task.id);
  assert.ok(stored);
  assert.equal(stored.executionStatus, "queued");
  assert.equal(stored.revision, 1);
});

test("LightTask 公共 API 支持显式 fail/cancel 动作", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  const task = lighttask.createTask({
    title: "动作能力校验",
  });

  const failed = lighttask.advanceTask(task.id, {
    action: "fail",
    expectedRevision: 1,
  });
  assert.equal(failed.executionStatus, "failed");
  assert.equal(failed.revision, 2);
  assert.equal(failed.steps.find((step) => step.stage === "investigate")?.status, "doing");

  const task2 = lighttask.createTask({
    title: "动作能力校验2",
  });
  const cancelled = lighttask.advanceTask(task2.id, {
    action: "cancel",
    expectedRevision: 1,
  });
  assert.equal(cancelled.executionStatus, "cancelled");
  assert.equal(cancelled.revision, 2);
  assert.equal(cancelled.steps.find((step) => step.stage === "investigate")?.status, "doing");
});

test("LightTask 公共 API 在 failed/cancelled 终态后再次推进会拒绝请求", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  const failedTask = lighttask.createTask({
    title: "终态 failed 校验",
  });
  lighttask.advanceTask(failedTask.id, {
    action: "fail",
    expectedRevision: 1,
  });

  assert.throws(
    () =>
      lighttask.advanceTask(failedTask.id, {
        expectedRevision: 2,
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "STATE_CONFLICT");
      assert.equal(error.coreError.message, "任务没有可推进的进行中阶段");
      assert.equal(error.details?.taskId, failedTask.id);
      assert.equal(error.details?.currentStatus, "failed");
      return true;
    },
  );

  const cancelledTask = lighttask.createTask({
    title: "终态 cancelled 校验",
  });
  lighttask.advanceTask(cancelledTask.id, {
    action: "cancel",
    expectedRevision: 1,
  });

  assert.throws(
    () =>
      lighttask.advanceTask(cancelledTask.id, {
        expectedRevision: 2,
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "STATE_CONFLICT");
      assert.equal(error.coreError.message, "任务没有可推进的进行中阶段");
      assert.equal(error.details?.taskId, cancelledTask.id);
      assert.equal(error.details?.currentStatus, "cancelled");
      return true;
    },
  );
});

test("LightTask 公共 API 在审批阻塞与通过阶段不会推进步骤游标", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  const task = lighttask.createTask({
    title: "审批步进校验",
  });

  lighttask.advanceTask(task.id, { action: "dispatch", expectedRevision: 1 });
  const started = lighttask.advanceTask(task.id, { action: "start", expectedRevision: 2 });
  const blocked = lighttask.advanceTask(task.id, {
    action: "request_approval",
    expectedRevision: 3,
  });
  const approved = lighttask.advanceTask(task.id, { action: "approve", expectedRevision: 4 });

  assert.equal(started.steps.find((step) => step.status === "doing")?.stage, "implement");
  assert.equal(blocked.executionStatus, "blocked_by_approval");
  assert.equal(blocked.steps.find((step) => step.status === "doing")?.stage, "implement");
  assert.equal(approved.executionStatus, "running");
  assert.equal(approved.steps.find((step) => step.status === "doing")?.stage, "implement");
});

test("LightTask 公共 API 在 blocked_by_approval 且省略 action 时默认走 approve", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  const task = lighttask.createTask({
    title: "默认 approve 校验",
  });

  lighttask.advanceTask(task.id, { action: "dispatch", expectedRevision: 1 });
  lighttask.advanceTask(task.id, { action: "start", expectedRevision: 2 });
  lighttask.advanceTask(task.id, { action: "request_approval", expectedRevision: 3 });
  const approved = lighttask.advanceTask(task.id, {
    expectedRevision: 4,
  });

  assert.equal(approved.executionStatus, "running");
  assert.equal(approved.revision, 5);
  assert.equal(approved.steps.find((step) => step.status === "doing")?.stage, "implement");
});

test("LightTask 公共 API 对显式非法动作抛出状态冲突", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  const task = lighttask.createTask({
    title: "非法动作校验",
  });

  assert.throws(
    () =>
      lighttask.advanceTask(task.id, {
        action: "start",
        expectedRevision: 1,
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "STATE_CONFLICT");
      assert.equal(error.coreError.message, "任务状态迁移冲突");
      assert.equal(error.details?.currentStatus, "queued");
      assert.equal(error.details?.action, "start");
      return true;
    },
  );
  const stored = lighttask.getTask(task.id);
  assert.ok(stored);
  assert.equal(stored.executionStatus, "queued");
  assert.equal(stored.revision, 1);
});

test("LightTask 公共 API 在 complete 动作后会把剩余步骤全部收敛为 done", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  const task = lighttask.createTask({
    title: "步骤收敛校验",
  });

  lighttask.advanceTask(task.id, { action: "dispatch", expectedRevision: 1 });
  lighttask.advanceTask(task.id, { action: "start", expectedRevision: 2 });
  const completed = lighttask.advanceTask(task.id, { action: "complete", expectedRevision: 3 });

  assert.equal(completed.executionStatus, "completed");
  assert.ok(completed.steps.every((step) => step.status === "done"));
});

test("LightTask 公共 API 会拦截非法 expectedRevision 输入", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  const task = lighttask.createTask({
    title: "非法 revision 输入",
  });

  for (const invalidExpectedRevision of [0, -1, 1.5]) {
    assert.throws(
      () =>
        lighttask.advanceTask(task.id, {
          expectedRevision: invalidExpectedRevision,
        }),
      (error) => {
        assert.ok(error instanceof LightTaskError);
        assert.equal(error.code, "VALIDATION_ERROR");
        assert.equal(error.coreError.message, "expectedRevision 必须是大于等于 1 的整数");
        assert.equal(error.details?.expectedRevision, invalidExpectedRevision);
        return true;
      },
    );
  }
});

test("LightTask 公共 API 支持注入最小系统端口与任务仓储", () => {
  const snapshots: TaskRecordFixture[] = [];
  const taskRepository: TaskRepository<TaskRecordFixture> = {
    list() {
      return snapshots.map((task) => structuredClone(task));
    },
    get(taskId) {
      const task = snapshots.find((item) => item.id === taskId);
      return task ? structuredClone(task) : undefined;
    },
    create(task) {
      const snapshot: TaskRecordFixture = {
        ...structuredClone(task),
        createdAt: "2026-04-13T08:00:01.000Z",
        summary: "由仓储补齐摘要",
      };
      const existed = snapshots.some((item) => item.id === snapshot.id);
      if (existed) {
        return {
          ok: false,
          error: {
            code: "STATE_CONFLICT" as const,
            message: "重复 taskId",
          },
        };
      }
      snapshots.push(snapshot);
      return {
        ok: true as const,
        task: snapshot,
      };
    },
    saveIfRevisionMatches(task, expectedRevision) {
      const snapshot: TaskRecordFixture = {
        ...structuredClone(task),
        idempotencyKey: "repo_dispatch_1",
        summary: "由仓储回写推进摘要",
      };
      const index = snapshots.findIndex((item) => item.id === snapshot.id);
      if (index === -1) {
        return {
          ok: false,
          error: {
            code: "NOT_FOUND" as const,
            message: "任务不存在",
          },
        };
      }
      if (snapshots[index].revision !== expectedRevision) {
        return {
          ok: false,
          error: {
            code: "REVISION_CONFLICT" as const,
            message: "revision 冲突",
          },
        };
      }
      snapshots[index] = snapshot;
      return {
        ok: true as const,
        task: snapshot,
      };
    },
  };
  const lighttask = createLightTask(
    createTestLightTaskOptions({
      taskRepository,
      clock: {
        now() {
          return "2026-04-13T08:00:00.000Z";
        },
      },
      idGenerator: {
        nextTaskId() {
          return "task_fixed";
        },
      },
    }),
  );

  const task = lighttask.createTask({
    title: "端口注入校验",
  });

  assert.equal(task.id, "task_fixed");
  assert.equal(task.createdAt, "2026-04-13T08:00:01.000Z");
  assert.equal(task.summary, "由仓储补齐摘要");
  assert.equal(snapshots.length, 1);

  const advanced = lighttask.advanceTask(task.id, {
    action: "dispatch",
    expectedRevision: 1,
  });
  assert.equal(advanced.executionStatus, "dispatched");
  assert.equal(advanced.idempotencyKey, "repo_dispatch_1");
  assert.equal(advanced.summary, "由仓储回写推进摘要");
  assert.equal(snapshots[0].revision, 2);
  assert.equal(snapshots[0].steps[0].status, "done");
  assert.equal(snapshots[0].steps[1].status, "doing");
});

test("LightTask Task API 只要求当前 task 用例依赖，不前置耦合 plan/graph 能力", () => {
  let storedTask: TaskRecordFixture | undefined;
  const lighttask = createLightTask({
    taskRepository: {
      list() {
        return storedTask ? [structuredClone(storedTask)] : [];
      },
      get(taskId: string) {
        return storedTask && taskId === storedTask.id ? structuredClone(storedTask) : undefined;
      },
      create(task: TaskRecordFixture) {
        storedTask = structuredClone(task);
        return {
          ok: true as const,
          task: structuredClone(task),
        };
      },
      saveIfRevisionMatches(task: TaskRecordFixture, expectedRevision: number) {
        assert.ok(storedTask);
        assert.equal(expectedRevision, storedTask.revision);
        storedTask = structuredClone(task);
        return {
          ok: true as const,
          task: structuredClone(task),
        };
      },
    },
    planRepository: {},
    graphRepository: {},
    clock: {
      now() {
        return "2026-04-14T00:00:00.000Z";
      },
    },
    idGenerator: {
      nextTaskId() {
        return "task_minimal_repo";
      },
    },
  });

  const created = lighttask.createTask({
    title: "最小任务依赖",
  });
  const listed = lighttask.listTasks();
  const fetched = lighttask.getTask("task_minimal_repo");
  const advanced = lighttask.advanceTask("task_minimal_repo", {
    expectedRevision: 1,
  });

  assert.equal(created.id, "task_minimal_repo");
  assert.equal(listed.length, 1);
  assert.equal(fetched?.title, "最小任务依赖");
  assert.equal(advanced.revision, 2);
});

test("LightTask listTasksByPlan 走查询路径时不前置要求 get/create/save/clock/idGenerator", () => {
  const lighttask = createLightTask({
    taskRepository: {
      list() {
        return [
          {
            id: "task_plan_query_minimal",
            planId: "plan_query_minimal",
            title: "最小计划任务查询",
            executionStatus: "queued",
            revision: 1,
            createdAt: "2026-04-14T00:00:00.000Z",
            steps: [
              {
                id: "task_plan_query_minimal_investigate",
                title: "investigate",
                stage: "investigate",
                status: "doing",
              },
            ],
          },
        ];
      },
    },
    planRepository: {},
    graphRepository: {},
    clock: {},
    idGenerator: {},
  });

  const listed = lighttask.listTasksByPlan("plan_query_minimal");

  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, "task_plan_query_minimal");
  assert.equal(listed[0].planId, "plan_query_minimal");
});

test("LightTask advanceTask 走推进路径时不前置要求 list/create/clock/idGenerator", () => {
  let storedTask: TaskRecordFixture = {
    id: "task_advance_minimal",
    title: "推进最小依赖",
    executionStatus: "queued",
    revision: 1,
    createdAt: "2026-04-14T00:00:00.000Z",
    steps: [
      {
        id: "task_advance_minimal_investigate",
        title: "investigate",
        stage: "investigate",
        status: "doing",
      },
      {
        id: "task_advance_minimal_design",
        title: "design",
        stage: "design",
        status: "todo",
      },
      {
        id: "task_advance_minimal_implement",
        title: "implement",
        stage: "implement",
        status: "todo",
      },
      {
        id: "task_advance_minimal_verify",
        title: "verify",
        stage: "verify",
        status: "todo",
      },
      {
        id: "task_advance_minimal_converge",
        title: "converge",
        stage: "converge",
        status: "todo",
      },
    ],
  };
  const lighttask = createLightTask({
    taskRepository: {
      get(taskId: string) {
        return taskId === storedTask.id ? structuredClone(storedTask) : undefined;
      },
      saveIfRevisionMatches(task: TaskRecordFixture, expectedRevision: number) {
        assert.equal(expectedRevision, storedTask.revision);
        storedTask = structuredClone(task);
        return {
          ok: true as const,
          task: structuredClone(task),
        };
      },
    },
    planRepository: {},
    graphRepository: {},
    clock: {},
    idGenerator: {},
  });

  const advanced = lighttask.advanceTask("task_advance_minimal", {
    expectedRevision: 1,
  });

  assert.equal(advanced.executionStatus, "dispatched");
  assert.equal(advanced.revision, 2);
});

test("LightTask updateTask 走更新路径时不前置要求 list/create/clock/idGenerator", () => {
  let storedTask: TaskRecordFixture = {
    id: "task_update_minimal",
    title: "更新最小依赖",
    designStatus: "draft",
    executionStatus: "queued",
    revision: 1,
    createdAt: "2026-04-14T00:00:00.000Z",
    steps: [
      {
        id: "task_update_minimal_investigate",
        title: "investigate",
        stage: "investigate",
        status: "todo",
      },
      {
        id: "task_update_minimal_design",
        title: "design",
        stage: "design",
        status: "todo",
      },
    ],
  };
  const lighttask = createLightTask({
    taskRepository: {
      get(taskId: string) {
        return taskId === storedTask.id ? structuredClone(storedTask) : undefined;
      },
      saveIfRevisionMatches(task: TaskRecordFixture, expectedRevision: number) {
        assert.equal(expectedRevision, storedTask.revision);
        storedTask = structuredClone(task);
        return {
          ok: true as const,
          task: structuredClone(task),
        };
      },
    },
    planRepository: {},
    graphRepository: {},
    clock: {},
    idGenerator: {},
  });

  const updated = lighttask.updateTask("task_update_minimal", {
    expectedRevision: 1,
    designStatus: "ready",
  });

  assert.equal(updated.designStatus, "ready");
  assert.equal(updated.executionStatus, "queued");
  assert.equal(updated.revision, 2);
  assert.equal(updated.steps[0].status, "doing");
});

import assert from "node:assert/strict";
import test from "node:test";
import type { PersistedLightTask } from "../core/types";
import { LightTaskError, createLightTask } from "../index";
import type { TaskRepository } from "../ports";
import { createTestLightTaskOptions } from "./ports-fixture";

test("LightTask 公共 API 支持创建和推进任务", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  const task = lighttask.createTask({
    title: "验证编排主流程",
  });

  assert.equal(task.steps.length, 5);
  assert.equal(task.status, "queued");
  assert.equal(task.revision, 1);
  assert.equal(task.steps[0].status, "doing");
  assert.equal(task.steps[1].status, "todo");

  const advancedTask = lighttask.advanceTask(task.id, {
    expectedRevision: 1,
  });
  assert.equal(advancedTask.status, "dispatched");
  assert.equal(advancedTask.revision, 2);
  assert.equal(advancedTask.steps[0].status, "done");
  assert.equal(advancedTask.steps[1].status, "doing");
  assert.equal(lighttask.listTasks().length, 1);
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
      assert.equal(error.details?.taskId, "task_missing");
      return true;
    },
  );
});

test("LightTask 公共 API 查询不存在任务时返回 undefined", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  assert.equal(lighttask.getTask("task_missing"), undefined);
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
  assert.equal(advanced.status, "dispatched");
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
      assert.equal(error.details?.taskId, task.id);
      return true;
    },
  );
});

test("LightTask 公共 API 在脏步骤快照缺少 doing 阶段时会拒绝 advance_one", () => {
  const brokenTask: PersistedLightTask = {
    id: "task_dirty_advance_one",
    title: "脏步骤快照",
    status: "queued",
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
  const taskRepository: TaskRepository<PersistedLightTask> = {
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
      return true;
    },
  );
  assert.equal(saveCalled, false);

  const stored = lighttask.getTask(brokenTask.id);
  assert.ok(stored);
  assert.ok(stored.steps.every((step) => step.status === "todo"));
});

test("LightTask 公共 API 在已收敛脏步骤快照上仍可执行 complete 收口", () => {
  let storedTask: PersistedLightTask = {
    id: "task_dirty_complete_all",
    title: "已收敛脏步骤快照",
    status: "running",
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
  const taskRepository: TaskRepository<PersistedLightTask> = {
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

  assert.equal(completed.status, "completed");
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
  });

  task.title = "外部篡改标题";
  task.status = "failed";
  task.revision = 999;
  task.steps[0].status = "done";

  const stored = lighttask.getTask(task.id);
  assert.ok(stored);
  assert.equal(stored.title, "隔离验证");
  assert.equal(stored.status, "queued");
  assert.equal(stored.revision, 1);
  assert.equal(stored.steps[0].status, "doing");
});

test("LightTask listTasks 返回值与内部状态隔离", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  const task = lighttask.createTask({
    title: "列表隔离验证",
  });

  const listed = lighttask.listTasks();
  listed[0].title = "外部改写";
  listed[0].status = "cancelled";
  listed[0].revision = 500;
  listed[0].steps[0].status = "done";

  const stored = lighttask.getTask(task.id);
  assert.ok(stored);
  assert.equal(stored.title, "列表隔离验证");
  assert.equal(stored.status, "queued");
  assert.equal(stored.revision, 1);
  assert.equal(stored.steps[0].status, "doing");
});

test("LightTask 连续创建任务时 ID 应保持唯一", () => {
  const lighttask = createLightTask(createTestLightTaskOptions());
  const first = lighttask.createTask({ title: "任务一" });
  const second = lighttask.createTask({ title: "任务二" });

  assert.notEqual(first.id, second.id);
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
      return true;
    },
  );
  const stored = lighttask.getTask(task.id);
  assert.ok(stored);
  assert.equal(stored.status, "queued");
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
  assert.equal(stored.status, "queued");
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
  assert.equal(failed.status, "failed");
  assert.equal(failed.revision, 2);
  assert.equal(failed.steps.find((step) => step.stage === "investigate")?.status, "doing");

  const task2 = lighttask.createTask({
    title: "动作能力校验2",
  });
  const cancelled = lighttask.advanceTask(task2.id, {
    action: "cancel",
    expectedRevision: 1,
  });
  assert.equal(cancelled.status, "cancelled");
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
      assert.equal(error.details?.taskId, failedTask.id);
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
      assert.equal(error.details?.taskId, cancelledTask.id);
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
  assert.equal(blocked.status, "blocked_by_approval");
  assert.equal(blocked.steps.find((step) => step.status === "doing")?.stage, "implement");
  assert.equal(approved.status, "running");
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

  assert.equal(approved.status, "running");
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
      return true;
    },
  );
  const stored = lighttask.getTask(task.id);
  assert.ok(stored);
  assert.equal(stored.status, "queued");
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

  assert.equal(completed.status, "completed");
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
        return true;
      },
    );
  }
});

test("LightTask 公共 API 支持注入最小系统端口与任务仓储", () => {
  const snapshots: PersistedLightTask[] = [];
  const taskRepository: TaskRepository<PersistedLightTask> = {
    list() {
      return snapshots.map((task) => structuredClone(task));
    },
    get(taskId) {
      const task = snapshots.find((item) => item.id === taskId);
      return task ? structuredClone(task) : undefined;
    },
    create(task) {
      const snapshot: PersistedLightTask = {
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
      const snapshot: PersistedLightTask = {
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
  assert.equal(advanced.status, "dispatched");
  assert.equal(advanced.idempotencyKey, "repo_dispatch_1");
  assert.equal(advanced.summary, "由仓储回写推进摘要");
  assert.equal(snapshots[0].revision, 2);
  assert.equal(snapshots[0].steps[0].status, "done");
  assert.equal(snapshots[0].steps[1].status, "doing");
});

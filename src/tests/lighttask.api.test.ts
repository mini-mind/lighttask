import assert from "node:assert/strict";
import test from "node:test";
import type { PersistedLightTask } from "../core/types";
import { createLightTask } from "../index";
import type { TaskRepository } from "../ports";

test("LightTask 公共 API 支持创建和推进任务", () => {
  const lighttask = createLightTask();
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
  const lighttask = createLightTask();
  assert.throws(
    () =>
      lighttask.advanceTask("task_missing", {
        expectedRevision: 1,
      }),
    /未找到任务/,
  );
});

test("LightTask 公共 API 查询不存在任务时返回 undefined", () => {
  const lighttask = createLightTask();
  assert.equal(lighttask.getTask("task_missing"), undefined);
});

test("LightTask 公共 API 在任务已全部完成后再次推进会抛错", () => {
  const lighttask = createLightTask();
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
    /没有可推进的进行中阶段/,
  );
});

test("LightTask 公共 API 会拒绝空白标题", () => {
  const lighttask = createLightTask();
  assert.throws(
    () =>
      lighttask.createTask({
        title: "   ",
      }),
    /VALIDATION_ERROR: 任务标题不能为空/,
  );
  assert.equal(lighttask.listTasks().length, 0);
});

test("LightTask 返回快照应与内部状态隔离", () => {
  const lighttask = createLightTask();
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
  const lighttask = createLightTask();
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
  const lighttask = createLightTask();
  const first = lighttask.createTask({ title: "任务一" });
  const second = lighttask.createTask({ title: "任务二" });

  assert.notEqual(first.id, second.id);
});

test("LightTask 公共 API 支持摘要 trim 与空白归一化", () => {
  const lighttask = createLightTask();
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
  const lighttask = createLightTask();
  const task = lighttask.createTask({
    title: "revision 校验",
  });

  assert.throws(
    () =>
      lighttask.advanceTask(task.id, {
        expectedRevision: 2,
      }),
    /REVISION_CONFLICT/,
  );
  const stored = lighttask.getTask(task.id);
  assert.ok(stored);
  assert.equal(stored.status, "queued");
  assert.equal(stored.revision, 1);
});

test("LightTask 公共 API 在缺少 expectedRevision 时会抛出校验错误", () => {
  const lighttask = createLightTask();
  const task = lighttask.createTask({
    title: "required revision 校验",
  });

  assert.throws(
    () => lighttask.advanceTask(task.id, {} as never),
    /VALIDATION_ERROR: expectedRevision 为必填字段/,
  );
  const stored = lighttask.getTask(task.id);
  assert.ok(stored);
  assert.equal(stored.status, "queued");
  assert.equal(stored.revision, 1);
});

test("LightTask 公共 API 在同幂等键重复推进时会拒绝语义不一致请求", () => {
  const lighttask = createLightTask();
  const task = lighttask.createTask({
    title: "幂等冲突校验",
  });

  lighttask.advanceTask(task.id, {
    expectedRevision: 1,
    idempotencyKey: "req_1",
  });

  assert.throws(
    () =>
      lighttask.advanceTask(task.id, {
        expectedRevision: 2,
        idempotencyKey: "req_1",
      }),
    /STATE_CONFLICT/,
  );
});

test("LightTask 公共 API 在同幂等键同版本重复推进时返回 replay 快照", () => {
  const lighttask = createLightTask();
  const task = lighttask.createTask({
    title: "幂等重放校验",
  });

  const first = lighttask.advanceTask(task.id, {
    action: "dispatch",
    expectedRevision: 1,
    idempotencyKey: "req_replay_1",
  });
  const replay = lighttask.advanceTask(task.id, {
    action: "dispatch",
    expectedRevision: 1,
    idempotencyKey: "req_replay_1",
  });

  assert.equal(first.status, "dispatched");
  assert.equal(first.revision, 2);
  assert.deepEqual(replay, first);
});

test("LightTask 幂等 replay 返回快照也必须与内部状态隔离", () => {
  const lighttask = createLightTask();
  const task = lighttask.createTask({
    title: "幂等隔离校验",
  });

  lighttask.advanceTask(task.id, {
    action: "dispatch",
    expectedRevision: 1,
    idempotencyKey: "req_replay_2",
  });
  const replay = lighttask.advanceTask(task.id, {
    action: "dispatch",
    expectedRevision: 1,
    idempotencyKey: "req_replay_2",
  });

  replay.title = "被外部篡改";
  replay.steps[0].status = "todo";

  const stored = lighttask.getTask(task.id);
  assert.ok(stored);
  assert.equal(stored.title, "幂等隔离校验");
  assert.equal(stored.steps[0].status, "done");
});

test("LightTask 公共 API 传入空白幂等键时会回退为历史幂等键", () => {
  const lighttask = createLightTask();
  const task = lighttask.createTask({
    title: "幂等键回退校验",
  });

  lighttask.advanceTask(task.id, {
    expectedRevision: 1,
    idempotencyKey: "req_keep",
  });
  const second = lighttask.advanceTask(task.id, {
    expectedRevision: 2,
    idempotencyKey: "   ",
  });

  assert.equal(second.status, "running");
  assert.equal(second.revision, 3);
  assert.equal(second.idempotencyKey, "req_keep");
});

test("LightTask 公共 API 支持显式 fail/cancel 动作", () => {
  const lighttask = createLightTask();
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

test("LightTask 公共 API 在审批阻塞与通过阶段不会推进步骤游标", () => {
  const lighttask = createLightTask();
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

test("LightTask 公共 API 对显式非法动作抛出状态冲突", () => {
  const lighttask = createLightTask();
  const task = lighttask.createTask({
    title: "非法动作校验",
  });

  assert.throws(
    () =>
      lighttask.advanceTask(task.id, {
        action: "start",
        expectedRevision: 1,
      }),
    /STATE_CONFLICT/,
  );
  const stored = lighttask.getTask(task.id);
  assert.ok(stored);
  assert.equal(stored.status, "queued");
  assert.equal(stored.revision, 1);
});

test("LightTask 公共 API 在 complete 动作后会把剩余步骤全部收敛为 done", () => {
  const lighttask = createLightTask();
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
  const lighttask = createLightTask();
  const task = lighttask.createTask({
    title: "非法 revision 输入",
  });

  for (const invalidExpectedRevision of [0, -1, 1.5]) {
    assert.throws(
      () =>
        lighttask.advanceTask(task.id, {
          expectedRevision: invalidExpectedRevision,
        }),
      /VALIDATION_ERROR/,
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
      const snapshot = structuredClone(task);
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
      const snapshot = structuredClone(task);
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
  const lighttask = createLightTask({
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
  });

  const task = lighttask.createTask({
    title: "端口注入校验",
  });

  assert.equal(task.id, "task_fixed");
  assert.equal(task.createdAt, "2026-04-13T08:00:00.000Z");
  assert.equal(snapshots.length, 1);

  const advanced = lighttask.advanceTask(task.id, {
    action: "dispatch",
    expectedRevision: 1,
  });
  assert.equal(advanced.status, "dispatched");
  assert.equal(snapshots[0].revision, 2);
  assert.equal(snapshots[0].steps[0].status, "done");
  assert.equal(snapshots[0].steps[1].status, "doing");
});

test("LightTask 公共 API 在仓储条件写冲突时会拒绝覆盖并保留存量状态", () => {
  const snapshots: PersistedLightTask[] = [];
  let shouldInjectConcurrentWrite = true;
  const taskRepository: TaskRepository<PersistedLightTask> = {
    list() {
      return snapshots.map((task) => structuredClone(task));
    },
    get(taskId) {
      const task = snapshots.find((item) => item.id === taskId);
      return task ? structuredClone(task) : undefined;
    },
    create(task) {
      const snapshot = structuredClone(task);
      snapshots.push(snapshot);
      return {
        ok: true as const,
        task: snapshot,
      };
    },
    saveIfRevisionMatches(task, expectedRevision) {
      if (shouldInjectConcurrentWrite) {
        shouldInjectConcurrentWrite = false;
        snapshots[0] = {
          ...snapshots[0],
          revision: snapshots[0].revision + 1,
          status: "dispatched",
        };
      }
      if (snapshots[0].revision !== expectedRevision) {
        return {
          ok: false,
          error: {
            code: "REVISION_CONFLICT" as const,
            message: "任务 revision 冲突，保存被拒绝",
          },
        };
      }
      const snapshot = structuredClone(task);
      snapshots[0] = snapshot;
      return {
        ok: true as const,
        task: snapshot,
      };
    },
  };
  const lighttask = createLightTask({
    taskRepository,
    idGenerator: {
      nextTaskId() {
        return "task_conflict";
      },
    },
    clock: {
      now() {
        return "2026-04-13T09:00:00.000Z";
      },
    },
  });

  lighttask.createTask({
    title: "仓储条件写冲突",
  });

  assert.throws(
    () =>
      lighttask.advanceTask("task_conflict", {
        action: "dispatch",
        expectedRevision: 1,
      }),
    /REVISION_CONFLICT/,
  );
  assert.equal(snapshots[0].status, "dispatched");
  assert.equal(snapshots[0].revision, 2);
});

test("LightTask 公共 API 在重复 taskId 创建时会拒绝覆盖已有任务", () => {
  const lighttask = createLightTask({
    idGenerator: {
      nextTaskId() {
        return "task_duplicate";
      },
    },
  });

  lighttask.createTask({
    title: "第一次创建",
  });

  assert.throws(
    () =>
      lighttask.createTask({
        title: "第二次创建",
      }),
    /STATE_CONFLICT/,
  );
  const stored = lighttask.getTask("task_duplicate");
  assert.ok(stored);
  assert.equal(stored.title, "第一次创建");
});

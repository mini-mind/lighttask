import assert from "node:assert/strict";
import test from "node:test";
import { createCoreError } from "../data-structures";
import { LightTaskError, createLightTask } from "../index";
import { createTestLightTask, createTestLightTaskOptions } from "./ports-fixture";

test("Task 幂等：相同 idempotencyKey + 相同语义返回 replay 快照", () => {
  const { lighttask, planId } = createTestLightTask();
  const task = lighttask.createTask({
    planId,
    title: "幂等任务",
  });
  const todo = lighttask.advanceTask(task.id, {
    action: "finalize",
    expectedRevision: task.revision,
    idempotencyKey: "req_final_1",
  });
  const replay = lighttask.advanceTask(task.id, {
    action: "finalize",
    expectedRevision: task.revision,
    idempotencyKey: "req_final_1",
  });

  assert.deepEqual(replay, todo);
});

test("Task 幂等：相同 idempotencyKey + 不同语义返回冲突", () => {
  const { lighttask, planId } = createTestLightTask();
  const task = lighttask.createTask({
    planId,
    title: "幂等冲突任务",
  });
  lighttask.advanceTask(task.id, {
    action: "finalize",
    expectedRevision: task.revision,
    idempotencyKey: "req_same",
  });

  assert.throws(
    () =>
      lighttask.advanceTask(task.id, {
        action: "dispatch",
        expectedRevision: task.revision,
        idempotencyKey: "req_same",
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "STATE_CONFLICT");
      return true;
    },
  );
});

test("Task 幂等：上一次带 key，这一次不带 key 仍应按新请求处理", () => {
  const { lighttask, planId } = createTestLightTask();
  const task = lighttask.createTask({
    planId,
    title: "幂等任务",
  });
  const todo = lighttask.advanceTask(task.id, {
    action: "finalize",
    expectedRevision: task.revision,
    idempotencyKey: "req_final_1",
  });

  const draftAgain = lighttask.advanceTask(task.id, {
    action: "return_to_draft",
    expectedRevision: todo.revision,
  });

  assert.equal(draftAgain.status, "draft");
  assert.equal(draftAgain.idempotencyKey, undefined);
});

test("Task 幂等：deleteTask 在共享仓储的不同实例之间可重放", () => {
  const sharedOptions = createTestLightTaskOptions();
  const lighttaskA = createLightTask(
    createTestLightTaskOptions({
      planRepository: sharedOptions.planRepository,
      taskRepository: sharedOptions.taskRepository,
    }),
  );
  const lighttaskB = createLightTask(
    createTestLightTaskOptions({
      planRepository: sharedOptions.planRepository,
      taskRepository: sharedOptions.taskRepository,
    }),
  );

  lighttaskA.createPlan({
    id: "plan_shared",
    title: "共享计划",
  });
  const task = lighttaskA.createTask({
    planId: "plan_shared",
    title: "待删除任务",
  });

  const deleted = lighttaskA.deleteTask(task.id, {
    expectedRevision: task.revision,
    idempotencyKey: "req_delete_1",
  });
  const replay = lighttaskB.deleteTask(task.id, {
    expectedRevision: task.revision,
    idempotencyKey: "req_delete_1",
  });

  assert.deepEqual(replay, deleted);
});

test("Task 幂等：不同计划删除不同任务时可复用同一个 idempotencyKey", () => {
  const sharedOptions = createTestLightTaskOptions();
  const lighttask = createLightTask(sharedOptions);
  lighttask.createPlan({
    id: "plan_a",
    title: "计划 A",
  });
  lighttask.createPlan({
    id: "plan_b",
    title: "计划 B",
  });
  const taskA = lighttask.createTask({
    planId: "plan_a",
    title: "任务 A",
  });
  const taskB = lighttask.createTask({
    planId: "plan_b",
    title: "任务 B",
  });

  const deletedA = lighttask.deleteTask(taskA.id, {
    expectedRevision: taskA.revision,
    idempotencyKey: "req_delete_shared",
  });
  const deletedB = lighttask.deleteTask(taskB.id, {
    expectedRevision: taskB.revision,
    idempotencyKey: "req_delete_shared",
  });

  assert.equal(deletedA.planId, "plan_a");
  assert.equal(deletedB.planId, "plan_b");
});

test("Task 幂等：若无法预先持久化 replay sidecar，应在删除前失败而不是留下半提交删除", () => {
  const sharedOptions = createTestLightTaskOptions();
  const basePlanRepository = sharedOptions.planRepository;
  const flakyPlanRepository = {
    ...basePlanRepository,
    saveIfRevisionMatches(
      plan: Parameters<NonNullable<typeof basePlanRepository.saveIfRevisionMatches>>[0],
      expectedRevision: number,
    ) {
      if (plan.deleteTaskReplayByIdempotencyKey) {
        return {
          ok: false as const,
          error: createCoreError("INVARIANT_VIOLATION", "模拟 delete replay sidecar 持久化失败"),
        };
      }
      return (
        basePlanRepository.saveIfRevisionMatches?.(plan, expectedRevision) ?? {
          ok: false as const,
          error: createCoreError(
            "INVARIANT_VIOLATION",
            "缺少 planRepository.saveIfRevisionMatches",
          ),
        }
      );
    },
  };
  const lighttask = createLightTask(
    createTestLightTaskOptions({
      ...sharedOptions,
      planRepository: flakyPlanRepository,
    }),
  );
  lighttask.createPlan({
    id: "plan_flaky_replay",
    title: "计划",
  });
  const task = lighttask.createTask({
    planId: "plan_flaky_replay",
    title: "待删除任务",
  });

  assert.throws(
    () =>
      lighttask.deleteTask(task.id, {
        expectedRevision: task.revision,
        idempotencyKey: "req_delete_flaky",
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "INVARIANT_VIOLATION");
      return true;
    },
  );
  assert.equal(lighttask.getTask(task.id)?.id, task.id);
});

test("Task 幂等：若删除在 sidecar 预持久化之后失败，同 key 重试不应被过早 replay", () => {
  const sharedOptions = createTestLightTaskOptions();
  const baseTaskRepository = sharedOptions.taskRepository;
  let shouldFailDelete = true;
  const flakyTaskRepository = {
    ...baseTaskRepository,
    deleteIfRevisionMatches(taskId: string, expectedRevision: number) {
      if (shouldFailDelete) {
        shouldFailDelete = false;
        return {
          ok: false as const,
          error: createCoreError("INVARIANT_VIOLATION", "模拟删除失败"),
        };
      }
      return (
        baseTaskRepository.deleteIfRevisionMatches?.(taskId, expectedRevision) ?? {
          ok: false as const,
          error: createCoreError(
            "INVARIANT_VIOLATION",
            "缺少 taskRepository.deleteIfRevisionMatches",
          ),
        }
      );
    },
  };
  const lighttask = createLightTask(
    createTestLightTaskOptions({
      ...sharedOptions,
      taskRepository: flakyTaskRepository,
    }),
  );
  lighttask.createPlan({
    id: "plan_retry_delete",
    title: "计划",
  });
  const task = lighttask.createTask({
    planId: "plan_retry_delete",
    title: "待删除任务",
  });

  assert.throws(
    () =>
      lighttask.deleteTask(task.id, {
        expectedRevision: task.revision,
        idempotencyKey: "req_delete_retry",
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "INVARIANT_VIOLATION");
      return true;
    },
  );
  assert.equal(lighttask.getTask(task.id)?.id, task.id);

  const deleted = lighttask.deleteTask(task.id, {
    expectedRevision: task.revision,
    idempotencyKey: "req_delete_retry",
  });
  assert.equal(deleted.taskId, task.id);
  assert.equal(lighttask.getTask(task.id), undefined);
});

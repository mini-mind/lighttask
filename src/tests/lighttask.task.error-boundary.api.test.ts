import assert from "node:assert/strict";
import test from "node:test";
import type { PersistedLightTask } from "../core/types";
import { LightTaskError, createLightTask } from "../index";
import type { TaskRepository } from "../ports";
import { createTestLightTaskOptions } from "./ports-fixture";

test("LightTask 在注入坏依赖时会统一抛出 LightTaskError", () => {
  assert.throws(
    () =>
      createLightTask({
        ...createTestLightTaskOptions(),
        taskRepository: {
          get() {
            return undefined;
          },
          create() {
            return {
              ok: true as const,
              task: {} as PersistedLightTask,
            };
          },
          saveIfRevisionMatches() {
            return {
              ok: true as const,
              task: {} as PersistedLightTask,
            };
          },
        } as unknown as TaskRepository<PersistedLightTask>,
        clock: {
          now() {
            return "2026-04-14T00:00:00.000Z";
          },
        },
        idGenerator: {
          nextTaskId() {
            return "task_invalid_options";
          },
        },
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.equal(error.details?.path, "taskRepository.list");
      return true;
    },
  );
});

test("LightTask 在端口直接抛出原生异常时会归一化为 LightTaskError", () => {
  const lighttask = createLightTask({
    ...createTestLightTaskOptions(),
    taskRepository: {
      list() {
        return [];
      },
      get() {
        return undefined;
      },
      create() {
        throw new TypeError("仓储 create 异常");
      },
      saveIfRevisionMatches() {
        throw new Error("不应触达 save");
      },
    },
    clock: {
      now() {
        return "2026-04-14T00:10:00.000Z";
      },
    },
    idGenerator: {
      nextTaskId() {
        return "task_port_error";
      },
    },
  });

  assert.throws(
    () =>
      lighttask.createTask({
        title: "端口异常归一化",
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "INVARIANT_VIOLATION");
      assert.deepEqual(error.details, {
        originalErrorName: "TypeError",
      });
      return true;
    },
  );
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
  const lighttask = createLightTask(
    createTestLightTaskOptions({
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
    }),
  );

  lighttask.createTask({
    title: "仓储条件写冲突",
  });

  assert.throws(
    () =>
      lighttask.advanceTask("task_conflict", {
        action: "dispatch",
        expectedRevision: 1,
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "REVISION_CONFLICT");
      return true;
    },
  );
  assert.equal(snapshots[0].status, "dispatched");
  assert.equal(snapshots[0].revision, 2);
});

test("LightTask 公共 API 在读取成功后若任务被并发删除会抛出 NOT_FOUND", () => {
  let storedTask: PersistedLightTask | undefined;
  const taskRepository: TaskRepository<PersistedLightTask> = {
    list() {
      return storedTask ? [structuredClone(storedTask)] : [];
    },
    get(taskId) {
      return storedTask && taskId === storedTask.id ? structuredClone(storedTask) : undefined;
    },
    create(task) {
      storedTask = structuredClone(task);
      return {
        ok: true as const,
        task: structuredClone(task),
      };
    },
    saveIfRevisionMatches(task) {
      storedTask = undefined;
      return {
        ok: false,
        error: {
          code: "NOT_FOUND" as const,
          message: "任务已被并发删除",
          details: {
            taskId: task.id,
          },
        },
      };
    },
  };
  const lighttask = createLightTask(createTestLightTaskOptions({ taskRepository }));
  const task = lighttask.createTask({
    title: "并发删除校验",
  });

  assert.throws(
    () =>
      lighttask.advanceTask(task.id, {
        action: "dispatch",
        expectedRevision: 1,
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "NOT_FOUND");
      assert.equal(error.details?.taskId, task.id);
      return true;
    },
  );
  assert.equal(lighttask.getTask(task.id), undefined);
});

test("LightTask 公共 API 在重复 taskId 创建时会拒绝覆盖已有任务", () => {
  const lighttask = createLightTask(
    createTestLightTaskOptions({
      idGenerator: {
        nextTaskId() {
          return "task_duplicate";
        },
      },
    }),
  );

  lighttask.createTask({
    title: "第一次创建",
  });

  assert.throws(
    () =>
      lighttask.createTask({
        title: "第二次创建",
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "STATE_CONFLICT");
      return true;
    },
  );
  const stored = lighttask.getTask("task_duplicate");
  assert.ok(stored);
  assert.equal(stored.title, "第一次创建");
});

test("LightTask 在注入坏依赖时会逐项报告缺失端口函数", () => {
  const invalidOptionsCases = [
    {
      name: "taskRepository.get",
      options: {
        taskRepository: {
          list() {
            return [];
          },
          create() {
            return { ok: true as const, task: {} as PersistedLightTask };
          },
          saveIfRevisionMatches() {
            return { ok: true as const, task: {} as PersistedLightTask };
          },
        } as unknown as TaskRepository<PersistedLightTask>,
      },
    },
    {
      name: "taskRepository.create",
      options: {
        taskRepository: {
          list() {
            return [];
          },
          get() {
            return undefined;
          },
          saveIfRevisionMatches() {
            return { ok: true as const, task: {} as PersistedLightTask };
          },
        } as unknown as TaskRepository<PersistedLightTask>,
      },
    },
    {
      name: "taskRepository.saveIfRevisionMatches",
      options: {
        taskRepository: {
          list() {
            return [];
          },
          get() {
            return undefined;
          },
          create() {
            return { ok: true as const, task: {} as PersistedLightTask };
          },
        } as unknown as TaskRepository<PersistedLightTask>,
      },
    },
    {
      name: "clock.now",
      options: {
        clock: {} as never,
      },
    },
    {
      name: "idGenerator.nextTaskId",
      options: {
        idGenerator: {} as never,
      },
    },
  ];

  for (const invalidCase of invalidOptionsCases) {
    assert.throws(
      () =>
        createLightTask({
          ...createTestLightTaskOptions(),
          ...invalidCase.options,
        }),
      (error) => {
        assert.ok(error instanceof LightTaskError);
        assert.equal(error.code, "VALIDATION_ERROR");
        assert.equal(error.details?.path, invalidCase.name);
        return true;
      },
      `${invalidCase.name} 缺失时应报对应 path`,
    );
  }
});

test("LightTask listTasks 在端口直接抛出原生异常时会归一化为 LightTaskError", () => {
  const lighttask = createLightTask({
    ...createTestLightTaskOptions(),
    taskRepository: {
      list() {
        throw new TypeError("仓储 list 异常");
      },
      get() {
        return undefined;
      },
      create() {
        return {
          ok: true as const,
          task: {} as PersistedLightTask,
        };
      },
      saveIfRevisionMatches() {
        return {
          ok: true as const,
          task: {} as PersistedLightTask,
        };
      },
    },
  });

  assert.throws(
    () => lighttask.listTasks(),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "INVARIANT_VIOLATION");
      assert.equal(error.details?.originalErrorName, "TypeError");
      return true;
    },
  );
});

test("LightTask getTask 在端口直接抛出原生异常时会归一化为 LightTaskError", () => {
  const lighttask = createLightTask({
    ...createTestLightTaskOptions(),
    taskRepository: {
      list() {
        return [];
      },
      get() {
        throw new TypeError("仓储 get 异常");
      },
      create() {
        return {
          ok: true as const,
          task: {} as PersistedLightTask,
        };
      },
      saveIfRevisionMatches() {
        return {
          ok: true as const,
          task: {} as PersistedLightTask,
        };
      },
    },
  });

  assert.throws(
    () => lighttask.getTask("task_port_get_error"),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "INVARIANT_VIOLATION");
      assert.equal(error.details?.originalErrorName, "TypeError");
      return true;
    },
  );
});

test("LightTask advanceTask 在端口直接抛出原生异常时会归一化为 LightTaskError", () => {
  const storedTask: PersistedLightTask = {
    id: "task_advance_port_error",
    title: "推进异常归一化",
    status: "queued",
    revision: 1,
    createdAt: "2026-04-14T00:20:00.000Z",
    steps: [
      {
        id: "task_advance_port_error_investigate",
        title: "investigate",
        stage: "investigate",
        status: "doing",
      },
      {
        id: "task_advance_port_error_design",
        title: "design",
        stage: "design",
        status: "todo",
      },
      {
        id: "task_advance_port_error_implement",
        title: "implement",
        stage: "implement",
        status: "todo",
      },
      {
        id: "task_advance_port_error_verify",
        title: "verify",
        stage: "verify",
        status: "todo",
      },
      {
        id: "task_advance_port_error_converge",
        title: "converge",
        stage: "converge",
        status: "todo",
      },
    ],
  };
  const lighttask = createLightTask({
    ...createTestLightTaskOptions(),
    taskRepository: {
      list() {
        return [structuredClone(storedTask)];
      },
      get(taskId) {
        return taskId === storedTask.id ? structuredClone(storedTask) : undefined;
      },
      create() {
        return {
          ok: true as const,
          task: structuredClone(storedTask),
        };
      },
      saveIfRevisionMatches() {
        throw new TypeError("仓储 save 异常");
      },
    },
  });

  assert.throws(
    () =>
      lighttask.advanceTask(storedTask.id, {
        action: "dispatch",
        expectedRevision: 1,
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "INVARIANT_VIOLATION");
      assert.equal(error.details?.originalErrorName, "TypeError");
      return true;
    },
  );
});

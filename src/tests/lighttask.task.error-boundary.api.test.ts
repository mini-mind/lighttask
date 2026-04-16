import assert from "node:assert/strict";
import test from "node:test";
import { LightTaskError, type LightTaskTask, createLightTask } from "../index";
import type { TaskRepository } from "../ports";
import { assertInvalidDependencyCases, createTestLightTaskOptions } from "./ports-fixture";

type TaskRecordFixture = LightTaskTask & {
  lastAdvanceFingerprint?: string;
};

test("LightTask 在调用依赖缺失的方法时会统一抛出 LightTaskError", () => {
  const lighttask = createLightTask({
    ...createTestLightTaskOptions(),
    taskRepository: {
      get() {
        return undefined;
      },
      create() {
        return {
          ok: true as const,
          task: {} as TaskRecordFixture,
        };
      },
      saveIfRevisionMatches() {
        return {
          ok: true as const,
          task: {} as TaskRecordFixture,
        };
      },
    },
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
  });

  assert.throws(
    () => lighttask.listTasks(),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.equal(error.coreError.message, "taskRepository.list 必须是函数");
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
  const snapshots: TaskRecordFixture[] = [];
  let shouldInjectConcurrentWrite = true;
  const taskRepository: TaskRepository<TaskRecordFixture> = {
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
          executionStatus: "dispatched",
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
      assert.equal(error.coreError.message, "任务 revision 冲突，保存被拒绝");
      return true;
    },
  );
  assert.equal(snapshots[0].executionStatus, "dispatched");
  assert.equal(snapshots[0].revision, 2);
});

test("LightTask 公共 API 在读取成功后若任务被并发删除会抛出 NOT_FOUND", () => {
  let storedTask: TaskRecordFixture | undefined;
  const taskRepository: TaskRepository<TaskRecordFixture> = {
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
      assert.equal(error.coreError.message, "任务已被并发删除");
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
      assert.equal(error.coreError.message, "任务 ID 已存在，禁止覆盖已有记录");
      assert.equal(error.details?.taskId, "task_duplicate");
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
            return { ok: true as const, task: {} as TaskRecordFixture };
          },
          saveIfRevisionMatches() {
            return { ok: true as const, task: {} as TaskRecordFixture };
          },
        },
      },
      invoke(lighttask: ReturnType<typeof createLightTask>) {
        lighttask.getTask("task_missing");
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
            return { ok: true as const, task: {} as TaskRecordFixture };
          },
        },
      },
      invoke(lighttask: ReturnType<typeof createLightTask>) {
        lighttask.createTask({
          title: "坏依赖 create 校验",
        });
      },
    },
    {
      name: "taskRepository.saveIfRevisionMatches",
      options: (() => {
        const taskRepository = createTestLightTaskOptions().taskRepository;
        return {
          taskRepository: {
            list() {
              const listTasks = taskRepository.list;
              assert.ok(listTasks);
              return listTasks();
            },
            get(taskId: string) {
              const getTask = taskRepository.get;
              assert.ok(getTask);
              return getTask(taskId);
            },
            create(task: TaskRecordFixture) {
              const createTask = taskRepository.create;
              assert.ok(createTask);
              return createTask(task);
            },
          },
        };
      })(),
      invoke(lighttask: ReturnType<typeof createLightTask>) {
        const task = lighttask.createTask({
          title: "坏依赖 advance 校验",
        });
        lighttask.advanceTask(task.id, {
          expectedRevision: 1,
        });
      },
    },
    {
      name: "clock.now",
      options: {
        clock: {},
      },
      invoke(lighttask: ReturnType<typeof createLightTask>) {
        lighttask.createTask({
          title: "坏依赖 clock 校验",
        });
      },
    },
    {
      name: "idGenerator.nextTaskId",
      options: {
        idGenerator: {},
      },
      invoke(lighttask: ReturnType<typeof createLightTask>) {
        lighttask.createTask({
          title: "坏依赖 idGenerator 校验",
        });
      },
    },
    {
      name: "planRepository.get",
      options: {
        planRepository: {
          create() {
            return { ok: true as const, plan: {} as never };
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
          id: "plan_invalid_dep",
          title: "坏依赖 plan create 校验",
        });
      },
    },
    {
      name: "graphRepository.get",
      options: {
        graphRepository: {
          create() {
            return { ok: true as const, graph: {} as never };
          },
          saveIfRevisionMatches() {
            return { ok: true as const, graph: {} as never };
          },
        },
      },
      invoke(lighttask: ReturnType<typeof createLightTask>) {
        lighttask.getGraph("plan_missing");
      },
    },
    {
      name: "graphRepository.create",
      options: {
        graphRepository: {
          get() {
            return undefined;
          },
          saveIfRevisionMatches() {
            return { ok: true as const, graph: {} as never };
          },
        },
      },
      invoke(lighttask: ReturnType<typeof createLightTask>) {
        lighttask.createPlan({
          id: "plan_invalid_graph_create_dep",
          title: "坏依赖 graph create 校验",
        });
        lighttask.saveGraph("plan_invalid_graph_create_dep", {
          nodes: [],
          edges: [],
        });
      },
    },
    {
      name: "graphRepository.saveIfRevisionMatches",
      options: {
        graphRepository: {
          get(planId: string) {
            if (planId !== "plan_invalid_graph_save_dep") {
              return undefined;
            }
            return {
              nodes: [],
              edges: [],
              revision: 1,
              createdAt: "2026-04-14T00:00:00.000Z",
              updatedAt: "2026-04-14T00:00:00.000Z",
            };
          },
          create() {
            return { ok: true as const, graph: {} as never };
          },
        },
      },
      invoke(lighttask: ReturnType<typeof createLightTask>) {
        lighttask.createPlan({
          id: "plan_invalid_graph_save_dep",
          title: "坏依赖 graph save 校验",
        });
        lighttask.saveGraph("plan_invalid_graph_save_dep", {
          expectedRevision: 1,
          nodes: [],
          edges: [],
        });
      },
    },
  ];

  assertInvalidDependencyCases(invalidOptionsCases);
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
          task: {} as TaskRecordFixture,
        };
      },
      saveIfRevisionMatches() {
        return {
          ok: true as const,
          task: {} as TaskRecordFixture,
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
          task: {} as TaskRecordFixture,
        };
      },
      saveIfRevisionMatches() {
        return {
          ok: true as const,
          task: {} as TaskRecordFixture,
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
  const storedTask: TaskRecordFixture = {
    id: "task_advance_port_error",
    title: "推进异常归一化",
    executionStatus: "queued",
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

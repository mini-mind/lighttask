import assert from "node:assert/strict";
import test from "node:test";
import { LightTaskError, createLightTask } from "../index";
import type { TaskRepository } from "../ports";
import { createTestLightTaskOptions } from "./ports-fixture";

test("Error Boundary：缺失端口方法时统一抛出 LightTaskError", () => {
  const lighttask = createLightTask({
    ...createTestLightTaskOptions(),
    taskRepository: {
      get() {
        return undefined;
      },
      create() {
        throw new Error("不应走到 create");
      },
      saveIfRevisionMatches() {
        throw new Error("不应走到 save");
      },
      deleteIfRevisionMatches() {
        throw new Error("不应走到 delete");
      },
    },
  });

  assert.throws(
    () => lighttask.listTasks(),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "VALIDATION_ERROR");
      return true;
    },
  );
});

test("Error Boundary：仓储抛出原生异常时归一化为 INVARIANT_VIOLATION", () => {
  const taskRepository: TaskRepository<{
    id: string;
    revision: number;
    planId: string;
    title: string;
    status: "draft";
    dependsOnTaskIds: string[];
    createdAt: string;
    updatedAt: string;
    steps: [];
  }> = {
    list() {
      return [];
    },
    get() {
      return undefined;
    },
    create() {
      throw new TypeError("底层 create 异常");
    },
    saveIfRevisionMatches() {
      throw new Error("不应走到 save");
    },
    deleteIfRevisionMatches() {
      throw new Error("不应走到 delete");
    },
  };
  const lighttask = createLightTask(createTestLightTaskOptions({ taskRepository }));
  lighttask.createPlan({
    id: "plan_error",
    title: "错误计划",
  });

  assert.throws(
    () =>
      lighttask.createTask({
        planId: "plan_error",
        title: "任务一",
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "INVARIANT_VIOLATION");
      return true;
    },
  );
});

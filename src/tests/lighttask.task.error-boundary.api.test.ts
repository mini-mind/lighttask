import assert from "node:assert/strict";
import test from "node:test";
import type { TaskRepository } from "../adapters";
import { LightTaskError, createLightTask } from "../index";
import { DEFAULT_TASK_POLICY_ID, createTestLightTaskOptions } from "./adapters-fixture";

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
    () => lighttask.tasks.list(),
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
  lighttask.plans.create({
    id: "plan_error",
    title: "错误计划",
    taskPolicyId: DEFAULT_TASK_POLICY_ID,
  });

  assert.throws(
    () =>
      lighttask.tasks.create({
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

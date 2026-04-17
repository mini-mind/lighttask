import assert from "node:assert/strict";
import test from "node:test";
import { createTestLightTask } from "./ports-fixture";

test("Query API：listTasks/listTasksByPlan 统一围绕 status 过滤", () => {
  const { lighttask, planId } = createTestLightTask("plan_query");
  lighttask.createPlan({
    id: "plan_other",
    title: "其他计划",
  });
  const draft = lighttask.createTask({
    planId,
    title: "草稿",
  });
  const todo = lighttask.createTask({
    planId,
    title: "待做",
  });
  lighttask.createTask({
    planId: "plan_other",
    title: "其他计划任务",
  });

  lighttask.advanceTask(todo.id, {
    action: "finalize",
    expectedRevision: todo.revision,
  });

  assert.deepEqual(
    lighttask.listTasks({ status: "draft" }).map((task) => task.id),
    [draft.id, lighttask.listTasks({ planId: "plan_other" })[0].id],
  );
  assert.deepEqual(
    lighttask.listTasksByPlan(planId, { status: "todo" }).map((task) => task.id),
    [todo.id],
  );
});

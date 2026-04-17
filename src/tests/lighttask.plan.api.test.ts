import assert from "node:assert/strict";
import test from "node:test";
import { createTestLightTask } from "./ports-fixture";

test("Plan API：支持创建、读取、列出和更新计划", () => {
  const { lighttask, planId } = createTestLightTask("plan_alpha");

  const created = lighttask.getPlan(planId);
  assert.ok(created);
  assert.equal(created.title, "计划 plan_alpha");

  const updated = lighttask.updatePlan(planId, {
    expectedRevision: created.revision,
    title: "计划 Alpha",
  });
  assert.equal(updated.title, "计划 Alpha");
  assert.equal(updated.revision, 2);
  assert.deepEqual(
    lighttask.listPlans().map((plan) => plan.id),
    ["plan_alpha"],
  );
});

test("Plan API：deleteTask 的内部幂等侧车不应污染 Plan revision", () => {
  const { lighttask, planId } = createTestLightTask("plan_delete_sidecar");
  const planBeforeDelete = lighttask.getPlan(planId);
  assert.ok(planBeforeDelete);
  const task = lighttask.createTask({
    planId,
    title: "待删除任务",
  });

  lighttask.deleteTask(task.id, {
    expectedRevision: task.revision,
    idempotencyKey: "req_delete_plan_1",
  });

  const planAfterDelete = lighttask.getPlan(planId);
  assert.ok(planAfterDelete);
  assert.equal(planAfterDelete.revision, planBeforeDelete.revision);
  assert.equal(planAfterDelete.updatedAt, planBeforeDelete.updatedAt);
});

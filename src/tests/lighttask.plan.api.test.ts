import assert from "node:assert/strict";
import test from "node:test";
import { LightTaskError } from "../index";
import { DEFAULT_TASK_POLICY_ID, createTestLightTask } from "./adapters-fixture";

test("Plan API：支持创建、读取、列出和更新计划", () => {
  const { lighttask, planId } = createTestLightTask("plan_alpha");

  const created = lighttask.plans.get(planId);
  assert.ok(created);
  assert.equal(created.title, "计划 plan_alpha");
  assert.equal(created.taskPolicyId, DEFAULT_TASK_POLICY_ID);

  const updated = lighttask.plans.update(planId, {
    expectedRevision: created.revision,
    title: "计划 Alpha",
  });
  assert.equal(updated.title, "计划 Alpha");
  assert.equal(updated.revision, 2);
  assert.deepEqual(
    lighttask.plans.list().map((plan) => plan.id),
    ["plan_alpha"],
  );
});

test("Plan API：plans.create 会拒绝未注册的 taskPolicyId，plans.update 也不允许改它", () => {
  const { lighttask, planId } = createTestLightTask("plan_policy_guard");

  assert.throws(
    () =>
      lighttask.plans.create({
        id: "plan_unknown_policy",
        title: "非法策略计划",
        taskPolicyId: "missing_policy",
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "INVARIANT_VIOLATION");
      return true;
    },
  );

  const plan = lighttask.plans.get(planId);
  assert.ok(plan);
  assert.throws(
    () =>
      lighttask.plans.update(planId, {
        expectedRevision: plan.revision,
        taskPolicyId: "another_policy",
      } as Parameters<typeof lighttask.plans.update>[1] & { taskPolicyId: string }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "VALIDATION_ERROR");
      return true;
    },
  );
});

test("Plan API：tasks.remove 的内部幂等侧车不应污染 Plan revision", () => {
  const { lighttask, planId } = createTestLightTask("plan_delete_sidecar");
  const planBeforeDelete = lighttask.plans.get(planId);
  assert.ok(planBeforeDelete);
  const task = lighttask.tasks.create({
    planId,
    title: "待删除任务",
  });

  lighttask.tasks.remove(task.id, {
    expectedRevision: task.revision,
    idempotencyKey: "req_delete_plan_1",
  });

  const planAfterDelete = lighttask.plans.get(planId);
  assert.ok(planAfterDelete);
  assert.equal(planAfterDelete.revision, planBeforeDelete.revision);
  assert.equal(planAfterDelete.updatedAt, planBeforeDelete.updatedAt);
});

test("Plan API：plans.remove 只允许删除空计划", () => {
  const { lighttask, planId } = createTestLightTask("plan_remove_guard");
  const plan = lighttask.plans.get(planId);
  assert.ok(plan);
  const task = lighttask.tasks.create({
    planId,
    title: "仍在计划里的任务",
  });

  assert.throws(
    () =>
      lighttask.plans.remove(planId, {
        expectedRevision: plan.revision,
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "STATE_CONFLICT");
      return true;
    },
  );

  lighttask.tasks.remove(task.id, {
    expectedRevision: task.revision,
  });
  const removed = lighttask.plans.remove(planId, {
    expectedRevision: plan.revision,
  });
  assert.deepEqual(removed, { planId });
  assert.equal(lighttask.plans.get(planId), undefined);
});

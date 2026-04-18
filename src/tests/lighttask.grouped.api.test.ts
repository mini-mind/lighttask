import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_TASK_POLICY_ID, createTestLightTask } from "./adapters-fixture";

test("Grouped API：plans/tasks/runs/outputs 短名接口可直连现有主链", () => {
  const { lighttask } = createTestLightTask("plan_grouped_default");
  const plan = lighttask.plans.create({
    id: "plan_grouped",
    title: "分组接口计划",
    taskPolicyId: DEFAULT_TASK_POLICY_ID,
  });
  const task = lighttask.tasks.create({
    planId: plan.id,
    title: "分组任务",
  });
  const todo = lighttask.tasks.move(task.id, {
    action: "finalize",
    expectedRevision: task.revision,
  });
  const schedule = lighttask.plans.schedule(plan.id);
  const runtime = lighttask.runs.create({
    id: "runtime_grouped",
    kind: "agent_run",
    title: "分组运行时",
  });
  const output = lighttask.outputs.create({
    id: "output_grouped",
    kind: "artifact",
  });

  assert.equal(todo.status, "todo");
  assert.deepEqual(schedule.runnableTaskIds, [task.id]);
  assert.equal(lighttask.tasks.get(task.id)?.id, task.id);
  assert.equal(lighttask.runs.get(runtime.id)?.id, runtime.id);
  assert.equal(lighttask.outputs.get(output.id)?.id, output.id);
  assert.equal("createTask" in lighttask, false);
  assert.equal("advanceTask" in lighttask, false);
  assert.equal("getPlanSchedulingFacts" in lighttask, false);
});

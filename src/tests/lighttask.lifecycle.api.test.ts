import assert from "node:assert/strict";
import test from "node:test";
import { LightTaskError, createLightTask } from "../index";
import { createTaskLifecyclePolicy } from "../rules";
import { createTestLightTaskOptions } from "./ports-fixture";

test("Lifecycle API：createLightTask 支持注入自定义 taskLifecycle", () => {
  const customTaskLifecycle = createTaskLifecyclePolicy({
    initialStatus: "ready_for_work",
    statusDefinitions: [
      {
        key: "ready_for_work",
        label: "ready_for_work",
        editable: false,
        schedulable: true,
        active: false,
        terminal: false,
      },
      {
        key: "in_execution",
        label: "in_execution",
        editable: false,
        schedulable: false,
        active: true,
        terminal: false,
      },
      {
        key: "done_for_now",
        label: "done_for_now",
        editable: false,
        schedulable: false,
        active: false,
        terminal: true,
        completionOutcome: "success",
      },
    ],
    transitionDefinitions: [
      {
        from: "ready_for_work",
        action: "dispatch",
        to: "in_execution",
      },
      {
        from: "in_execution",
        action: "complete",
        to: "done_for_now",
      },
    ],
    terminalStatuses: ["done_for_now"],
    stepProgressByAction: {
      dispatch: "advance_one",
      complete: "complete_all",
    },
  });

  const lighttask = createLightTask(
    createTestLightTaskOptions({
      taskLifecycle: customTaskLifecycle,
    }),
  );
  lighttask.createPlan({
    id: "plan_custom_lifecycle",
    title: "自定义生命周期计划",
  });

  const task = lighttask.createTask({
    planId: "plan_custom_lifecycle",
    title: "直接进入待办",
  });
  assert.equal(task.status, "ready_for_work");
  assert.deepEqual(lighttask.getPlanSchedulingFacts("plan_custom_lifecycle").runnableTaskIds, [
    task.id,
  ]);

  assert.throws(
    () =>
      lighttask.updateTask(task.id, {
        expectedRevision: task.revision,
        title: "不应可编辑",
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "STATE_CONFLICT");
      return true;
    },
  );

  const dispatched = lighttask.advanceTask(task.id, {
    action: "dispatch",
    expectedRevision: task.revision,
  });
  assert.equal(dispatched.status, "in_execution");

  const completed = lighttask.advanceTask(task.id, {
    action: "complete",
    expectedRevision: dispatched.revision,
  });
  assert.equal(completed.status, "done_for_now");
  assert.deepEqual(lighttask.getPlanSchedulingFacts("plan_custom_lifecycle").terminalTaskIds, [
    task.id,
  ]);
});

import assert from "node:assert/strict";
import test from "node:test";
import { LightTaskError, createLightTask } from "../index";
import { defineTaskPolicies, defineTaskPolicy } from "../policies";
import { createExampleTaskLifecycle, createTestLightTaskOptions } from "./adapters-fixture";

const CUSTOM_TASK_POLICY_ID = "custom_lifecycle";

test("Lifecycle API：createLightTask 支持注入自定义 taskPolicies", () => {
  const customTaskLifecycle = defineTaskPolicy({
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
    actionDefinitions: [
      { key: "dispatch", requiresRunnable: true, stepProgress: "advance_one" },
      { key: "complete", stepProgress: "complete_all" },
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
  });

  const lighttask = createLightTask(
    createTestLightTaskOptions({
      taskPolicies: defineTaskPolicies({
        policies: {
          [CUSTOM_TASK_POLICY_ID]: customTaskLifecycle,
        },
      }),
    }),
  );
  lighttask.plans.create({
    id: "plan_custom_lifecycle",
    title: "自定义生命周期计划",
    taskPolicyId: CUSTOM_TASK_POLICY_ID,
  });

  const task = lighttask.tasks.create({
    planId: "plan_custom_lifecycle",
    title: "直接进入待办",
  });
  assert.equal(task.status, "ready_for_work");
  assert.deepEqual(lighttask.plans.schedule("plan_custom_lifecycle").runnableTaskIds, [task.id]);

  assert.throws(
    () =>
      lighttask.tasks.update(task.id, {
        expectedRevision: task.revision,
        title: "不应可编辑",
      }),
    (error) => {
      assert.ok(error instanceof LightTaskError);
      assert.equal(error.code, "STATE_CONFLICT");
      return true;
    },
  );

  const dispatched = lighttask.tasks.move(task.id, {
    action: "dispatch",
    expectedRevision: task.revision,
  });
  assert.equal(dispatched.status, "in_execution");

  const completed = lighttask.tasks.move(task.id, {
    action: "complete",
    expectedRevision: dispatched.revision,
  });
  assert.equal(completed.status, "done_for_now");
  assert.deepEqual(lighttask.plans.schedule("plan_custom_lifecycle").terminalTaskIds, [task.id]);
});

test("Lifecycle API：同一个内核实例里的不同 Plan 可绑定不同 taskPolicy", () => {
  const readyPolicyId = "ready_policy";
  const lighttask = createLightTask(
    createTestLightTaskOptions({
      taskPolicies: defineTaskPolicies({
        policies: {
          default: createExampleTaskLifecycle(),
          [readyPolicyId]: defineTaskPolicy({
            initialStatus: "ready_for_work",
            statusDefinitions: [
              {
                key: "ready_for_work",
                editable: false,
                schedulable: true,
                active: false,
                terminal: false,
              },
              {
                key: "done_for_now",
                editable: false,
                schedulable: false,
                active: false,
                terminal: true,
                completionOutcome: "success",
              },
            ],
            actionDefinitions: [{ key: "complete", requiresRunnable: true }],
            transitionDefinitions: [
              {
                from: "ready_for_work",
                action: "complete",
                to: "done_for_now",
              },
            ],
            terminalStatuses: ["done_for_now"],
          }),
        },
      }),
    }),
  );

  lighttask.plans.create({
    id: "plan_default_policy",
    title: "默认策略计划",
    taskPolicyId: "default",
  });
  lighttask.plans.create({
    id: "plan_ready_policy",
    title: "就绪策略计划",
    taskPolicyId: readyPolicyId,
  });

  const defaultTask = lighttask.tasks.create({
    planId: "plan_default_policy",
    title: "默认任务",
  });
  const readyTask = lighttask.tasks.create({
    planId: "plan_ready_policy",
    title: "就绪任务",
  });

  assert.equal(defaultTask.status, "draft");
  assert.equal(readyTask.status, "ready_for_work");
  assert.deepEqual(lighttask.plans.schedule("plan_default_policy").editableTaskIds, [
    defaultTask.id,
  ]);
  assert.deepEqual(lighttask.plans.schedule("plan_ready_policy").runnableTaskIds, [readyTask.id]);
});

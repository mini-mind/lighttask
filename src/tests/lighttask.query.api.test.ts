import assert from "node:assert/strict";
import test from "node:test";
import { createLightTask } from "../index";
import { createTaskLifecyclePolicy, createTaskPolicyRegistry } from "../policies";
import {
  DEFAULT_TASK_POLICY_ID,
  createTestLightTask,
  createTestLightTaskOptions,
} from "./adapters-fixture";

test("Query API：tasks.list 统一围绕 status 与 planId 过滤", () => {
  const { lighttask, planId } = createTestLightTask("plan_query");
  lighttask.plans.create({
    id: "plan_other",
    title: "其他计划",
    taskPolicyId: DEFAULT_TASK_POLICY_ID,
  });
  const draft = lighttask.tasks.create({
    planId,
    title: "草稿",
  });
  const todo = lighttask.tasks.create({
    planId,
    title: "待做",
  });
  lighttask.tasks.create({
    planId: "plan_other",
    title: "其他计划任务",
  });

  lighttask.tasks.move(todo.id, {
    action: "finalize",
    expectedRevision: todo.revision,
  });

  assert.deepEqual(
    lighttask.tasks.list({ status: "draft" }).map((task) => task.id),
    [draft.id, lighttask.tasks.list({ planId: "plan_other" })[0].id],
  );
  assert.deepEqual(
    lighttask.tasks.list({ planId, status: "todo" }).map((task) => task.id),
    [todo.id],
  );
});

test("Query API：自定义 taskPolicy 的陌生状态 key 也能被正常过滤", () => {
  const lighttask = createLightTask(
    createTestLightTaskOptions({
      taskPolicies: createTaskPolicyRegistry({
        policies: {
          custom_query: createTaskLifecyclePolicy({
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
    id: "plan_query_custom_status",
    title: "自定义状态查询计划",
    taskPolicyId: "custom_query",
  });
  const task = lighttask.tasks.create({
    planId: "plan_query_custom_status",
    title: "使用陌生状态 key",
  });

  assert.deepEqual(
    lighttask.tasks.list({ status: "ready_for_work" }).map((item) => item.id),
    [task.id],
  );
  assert.deepEqual(
    lighttask.tasks
      .list({ planId: "plan_query_custom_status", status: "ready_for_work" })
      .map((item) => item.id),
    [task.id],
  );
});

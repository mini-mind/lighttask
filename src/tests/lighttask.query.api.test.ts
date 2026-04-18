import assert from "node:assert/strict";
import test from "node:test";
import { createLightTask } from "../index";
import { createTaskLifecyclePolicy } from "../rules";
import { createTestLightTask } from "./ports-fixture";
import { createTestLightTaskOptions } from "./ports-fixture";

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

test("Query API：自定义 taskLifecycle 的陌生状态 key 也能被正常过滤", () => {
  const lighttask = createLightTask(
    createTestLightTaskOptions({
      taskLifecycle: createTaskLifecyclePolicy({
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
    }),
  );
  lighttask.createPlan({
    id: "plan_query_custom_status",
    title: "自定义状态查询计划",
  });
  const task = lighttask.createTask({
    planId: "plan_query_custom_status",
    title: "使用陌生状态 key",
  });

  assert.deepEqual(
    lighttask.listTasks({ status: "ready_for_work" }).map((item) => item.id),
    [task.id],
  );
  assert.deepEqual(
    lighttask
      .listTasksByPlan("plan_query_custom_status", { status: "ready_for_work" })
      .map((item) => item.id),
    [task.id],
  );
});

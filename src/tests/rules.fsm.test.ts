import assert from "node:assert/strict";
import test from "node:test";
import {
  createTaskLifecyclePolicy,
  defaultRuntimeLifecyclePolicy,
  defaultTaskLifecyclePolicy,
  getNextTaskStatus,
  getTaskStatusDefinition,
  isTaskEditableStatus,
  isTaskSchedulableStatus,
  listTaskActions,
  listTaskStatuses,
  listTaskTransitions,
  transitionRuntimeStatus,
  transitionTaskStatus,
} from "../rules";

test("规则层：Task FSM 只允许终局动作集合", () => {
  assert.equal(defaultTaskLifecyclePolicy.initialStatus, "draft");
  assert.deepEqual(listTaskActions("draft"), ["finalize"]);
  assert.equal(getNextTaskStatus("todo", "dispatch"), "dispatched");
  assert.deepEqual(transitionTaskStatus("running", "complete"), {
    ok: true,
    status: "completed",
  });
});

test("规则层：默认 Task 生命周期策略暴露状态定义与转移定义", () => {
  assert.equal(defaultTaskLifecyclePolicy.hasStatus("draft"), true);
  assert.deepEqual(getTaskStatusDefinition("draft"), {
    key: "draft",
    label: "draft",
    editable: true,
    schedulable: false,
    active: false,
    terminal: false,
    completionOutcome: undefined,
  });
  assert.equal(isTaskEditableStatus("draft"), true);
  assert.equal(isTaskSchedulableStatus("todo"), true);
  assert.equal(getTaskStatusDefinition("completed")?.completionOutcome, "success");
  assert.equal(listTaskStatuses().length, 8);
  assert.deepEqual(listTaskTransitions("running"), [
    {
      from: "running",
      action: "request_approval",
      to: "blocked_by_approval",
      hooks: undefined,
    },
    {
      from: "running",
      action: "complete",
      to: "completed",
      hooks: undefined,
    },
    {
      from: "running",
      action: "fail",
      to: "failed",
      hooks: undefined,
    },
    {
      from: "running",
      action: "cancel",
      to: "cancelled",
      hooks: undefined,
    },
  ]);
});

test("规则层：非法 Task 迁移会返回状态冲突", () => {
  const result = transitionTaskStatus("draft", "dispatch");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "STATE_CONFLICT");
  }
});

test("规则层：自定义 Task 生命周期策略支持 guard hooks", () => {
  const customPolicy = createTaskLifecyclePolicy({
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
        key: "in_progress",
        label: "in_progress",
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
        action: "start",
        to: "in_progress",
        hooks: {
          guard() {
            return {
              code: "STATE_CONFLICT",
              message: "自定义 guard 拦截",
              details: {},
            };
          },
        },
      },
      {
        from: "in_progress",
        action: "complete",
        to: "done_for_now",
      },
    ],
    terminalStatuses: ["done_for_now"],
  });

  const blocked = customPolicy.transition("ready_for_work", "start");
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.equal(blocked.error.code, "STATE_CONFLICT");
    assert.equal(blocked.error.message, "自定义 guard 拦截");
  }
});

test("规则层：自定义状态若未注册到状态定义，会在构建策略时直接失败", () => {
  assert.throws(
    () =>
      createTaskLifecyclePolicy({
        initialStatus: "ready_for_work",
        statusDefinitions: [
          {
            key: "ready_for_work",
            editable: false,
            schedulable: true,
            active: false,
            terminal: false,
          },
        ],
        transitionDefinitions: [
          {
            from: "ready_for_work",
            action: "dispatch",
            to: "missing_status_definition",
          },
        ],
      }),
    /未注册转移终点状态/,
  );
});

test("规则层：Runtime FSM 保持最小生命周期", () => {
  assert.equal(defaultRuntimeLifecyclePolicy.initialStatus, "queued");
  assert.deepEqual(transitionRuntimeStatus("queued", "start"), {
    ok: true,
    status: "running",
  });
});

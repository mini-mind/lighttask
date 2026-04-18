import assert from "node:assert/strict";
import test from "node:test";
import {
  createTaskLifecyclePolicy,
  defaultRuntimeLifecyclePolicy,
  transitionRuntimeStatus,
} from "../policies";
import { createExampleTaskLifecycle } from "./adapters-fixture";

test("规则层：Task 生命周期策略按显式注册的状态与动作工作", () => {
  const policy = createExampleTaskLifecycle();
  assert.equal(policy.initialStatus, "draft");
  assert.equal(policy.hasStatus("draft"), true);
  assert.equal(policy.hasAction("dispatch"), true);
  assert.deepEqual(policy.listActions("draft"), ["finalize"]);
  assert.equal(policy.getNextStatus("todo", "dispatch"), "dispatched");
  assert.equal(policy.requiresRunnable("dispatch"), true);
  assert.equal(policy.resolveStepProgress("complete"), "complete_all");
  assert.deepEqual(policy.transition("running", "complete"), {
    ok: true,
    status: "completed",
    hooks: undefined,
  });
});

test("规则层：Task 生命周期策略暴露状态定义、动作定义与转移定义", () => {
  const policy = createExampleTaskLifecycle();
  assert.deepEqual(policy.getStatusDefinition("draft"), {
    key: "draft",
    editable: true,
    schedulable: false,
    active: false,
    terminal: false,
  });
  assert.deepEqual(policy.getActionDefinition("dispatch"), {
    key: "dispatch",
    requiresRunnable: true,
    stepProgress: "advance_one",
  });
  assert.equal(policy.getStatusDefinition("completed")?.completionOutcome, "success");
  assert.equal(policy.listStatuses().length, 8);
  assert.deepEqual(policy.listTransitions("running"), [
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
  const policy = createExampleTaskLifecycle();
  const result = policy.transition("draft", "dispatch");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "STATE_CONFLICT");
  }
});

test("规则层：自定义 Task 生命周期策略支持 guard/apply/notify hooks", () => {
  const events: string[] = [];
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
    actionDefinitions: [
      { key: "start", requiresRunnable: true, stepProgress: "advance_one" },
      { key: "complete", stepProgress: "complete_all" },
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
        hooks: {
          apply(input) {
            events.push(`apply:${input.currentStatus}->${input.nextStatus}`);
          },
          notify(input) {
            events.push(`notify:${input.currentStatus}->${input.nextStatus}`);
          },
        },
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

  const completed = customPolicy.transition("in_progress", "complete");
  assert.equal(completed.ok, true);
  if (completed.ok) {
    completed.hooks?.apply?.({
      currentStatus: "in_progress",
      action: "complete",
      nextStatus: completed.status,
    });
    completed.hooks?.notify?.({
      currentStatus: "in_progress",
      action: "complete",
      nextStatus: completed.status,
    });
  }
  assert.deepEqual(events, ["apply:in_progress->done_for_now", "notify:in_progress->done_for_now"]);
});

test("规则层：自定义状态或动作若未注册，会在构建策略时直接失败", () => {
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
        actionDefinitions: [{ key: "dispatch" }],
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
          {
            key: "done_for_now",
            editable: false,
            schedulable: false,
            active: false,
            terminal: true,
            completionOutcome: "success",
          },
        ],
        actionDefinitions: [],
        transitionDefinitions: [
          {
            from: "ready_for_work",
            action: "dispatch",
            to: "done_for_now",
          },
        ],
      }),
    /未注册转移动作/,
  );
});

test("规则层：Runtime FSM 保持最小生命周期", () => {
  assert.equal(defaultRuntimeLifecyclePolicy.initialStatus, "queued");
  assert.deepEqual(transitionRuntimeStatus("queued", "start"), {
    ok: true,
    status: "running",
  });
});

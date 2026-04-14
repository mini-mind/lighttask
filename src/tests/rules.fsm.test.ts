import assert from "node:assert/strict";
import test from "node:test";
import type { PlanLifecycleStatus, TaskLifecycleStatus } from "../data-structures";
import {
  type PlanAction,
  type TaskAction,
  canPlanTransition,
  canTaskTransition,
  getNextPlanStatus,
  getNextTaskStatus,
  listPlanActions,
  listTaskActions,
  resolveTaskStepProgress,
  selectDefaultPlanAction,
  selectDefaultTaskAction,
  transitionPlanStatus,
  transitionTaskStatus,
} from "../rules";

test("规则层 FSM：Task happy path 可按标准流程推进", () => {
  const dispatched = transitionTaskStatus("queued", "dispatch");
  assert.equal(dispatched.ok, true);
  if (!dispatched.ok) {
    assert.fail("queued -> dispatch 应成功");
  }

  const running = transitionTaskStatus(dispatched.status, "start");
  assert.equal(running.ok, true);
  if (!running.ok) {
    assert.fail("dispatched -> start 应成功");
  }

  const completed = transitionTaskStatus(running.status, "complete");
  assert.equal(completed.ok, true);
  if (!completed.ok) {
    assert.fail("running -> complete 应成功");
  }

  assert.equal(completed.status, "completed");
});

test("规则层 FSM：Task 支持 approval gate 与 cancel 分支", () => {
  const blocked = transitionTaskStatus("running", "request_approval");
  assert.equal(blocked.ok, true);
  if (!blocked.ok) {
    assert.fail("running -> request_approval 应成功");
  }
  assert.equal(blocked.status, "blocked_by_approval");
  assert.deepEqual(listTaskActions("blocked_by_approval"), ["approve", "fail", "cancel"]);

  const approved = transitionTaskStatus("blocked_by_approval", "approve");
  assert.equal(approved.ok, true);
  if (!approved.ok) {
    assert.fail("blocked_by_approval -> approve 应成功");
  }
  assert.equal(approved.status, "running");

  const cancelled = transitionTaskStatus("blocked_by_approval", "cancel");
  assert.equal(cancelled.ok, true);
  if (!cancelled.ok) {
    assert.fail("blocked_by_approval -> cancel 应成功");
  }
  assert.equal(cancelled.status, "cancelled");
});

test("规则层 FSM：Plan happy path 与 terminal 约束", () => {
  const planning = transitionPlanStatus("draft", "start_planning");
  assert.equal(planning.ok, true);
  if (!planning.ok) {
    assert.fail("draft -> start_planning 应成功");
  }

  const ready = transitionPlanStatus(planning.status, "mark_ready");
  assert.equal(ready.ok, true);
  if (!ready.ok) {
    assert.fail("planning -> mark_ready 应成功");
  }

  const confirmed = transitionPlanStatus(ready.status, "confirm");
  assert.equal(confirmed.ok, true);
  if (!confirmed.ok) {
    assert.fail("ready -> confirm 应成功");
  }

  const archived = transitionPlanStatus(confirmed.status, "archive");
  assert.equal(archived.ok, true);
  if (!archived.ok) {
    assert.fail("confirmed -> archive 应成功");
  }
  assert.equal(archived.status, "archived");
  assert.deepEqual(listPlanActions("archived"), []);
});

test("规则层 FSM：非法迁移返回 STATE_CONFLICT", () => {
  const taskDenied = transitionTaskStatus("completed", "cancel");
  assert.equal(taskDenied.ok, false);
  if (taskDenied.ok) {
    assert.fail("completed 不应再允许 cancel");
  }
  assert.equal(taskDenied.error.code, "STATE_CONFLICT");
  assert.equal(taskDenied.error.details?.currentStatus, "completed");
  assert.equal(taskDenied.error.details?.action, "cancel");

  const planDenied = transitionPlanStatus("archived", "confirm");
  assert.equal(planDenied.ok, false);
  if (planDenied.ok) {
    assert.fail("archived 不应再允许 confirm");
  }
  assert.equal(planDenied.error.code, "STATE_CONFLICT");
  assert.equal(planDenied.error.details?.currentStatus, "archived");
  assert.equal(planDenied.error.details?.action, "confirm");
});

test("规则层 FSM：can/get/list/transition 结果保持一致", () => {
  const taskStatuses: readonly TaskLifecycleStatus[] = [
    "queued",
    "dispatched",
    "running",
    "blocked_by_approval",
    "completed",
    "failed",
    "cancelled",
  ];
  const taskActions: readonly TaskAction[] = [
    "dispatch",
    "start",
    "request_approval",
    "approve",
    "complete",
    "fail",
    "cancel",
  ];

  for (const status of taskStatuses) {
    const listed = listTaskActions(status);
    for (const action of taskActions) {
      const can = canTaskTransition(status, action);
      const next = getNextTaskStatus(status, action);
      const transitioned = transitionTaskStatus(status, action);

      assert.equal(can, next !== undefined);
      assert.equal(listed.includes(action), can);

      if (can) {
        assert.equal(transitioned.ok, true);
        if (!transitioned.ok) {
          assert.fail("can=true 时 transition 必须成功");
        }
        assert.equal(transitioned.status, next);
      } else {
        assert.equal(transitioned.ok, false);
        if (transitioned.ok) {
          assert.fail("can=false 时 transition 必须失败");
        }
        assert.equal(transitioned.error.code, "STATE_CONFLICT");
      }
    }
  }

  const planStatuses: readonly PlanLifecycleStatus[] = [
    "draft",
    "planning",
    "ready",
    "confirmed",
    "archived",
    "failed",
  ];
  const planActions: readonly PlanAction[] = [
    "start_planning",
    "mark_ready",
    "confirm",
    "archive",
    "fail",
  ];

  for (const status of planStatuses) {
    const listed = listPlanActions(status);
    for (const action of planActions) {
      const can = canPlanTransition(status, action);
      const next = getNextPlanStatus(status, action);
      const transitioned = transitionPlanStatus(status, action);

      assert.equal(can, next !== undefined);
      assert.equal(listed.includes(action), can);

      if (can) {
        assert.equal(transitioned.ok, true);
        if (!transitioned.ok) {
          assert.fail("can=true 时 transition 必须成功");
        }
        assert.equal(transitioned.status, next);
      } else {
        assert.equal(transitioned.ok, false);
        if (transitioned.ok) {
          assert.fail("can=false 时 transition 必须失败");
        }
        assert.equal(transitioned.error.code, "STATE_CONFLICT");
      }
    }
  }
});

test("规则层 FSM：默认动作选择遵循规则层优先级", () => {
  assert.equal(selectDefaultTaskAction("queued"), "dispatch");
  assert.equal(selectDefaultTaskAction("dispatched"), "start");
  assert.equal(selectDefaultTaskAction("running"), "complete");
  assert.equal(selectDefaultTaskAction("blocked_by_approval"), "approve");
  assert.equal(selectDefaultTaskAction("completed"), undefined);

  assert.equal(selectDefaultPlanAction("draft"), "start_planning");
  assert.equal(selectDefaultPlanAction("planning"), "mark_ready");
  assert.equal(selectDefaultPlanAction("ready"), "confirm");
  assert.equal(selectDefaultPlanAction("confirmed"), "archive");
  assert.equal(selectDefaultPlanAction("archived"), undefined);
  assert.equal(selectDefaultPlanAction("failed"), undefined);
});

test("规则层 FSM：步骤推进策略由规则层统一给出", () => {
  assert.equal(resolveTaskStepProgress("dispatch"), "advance_one");
  assert.equal(resolveTaskStepProgress("start"), "advance_one");
  assert.equal(resolveTaskStepProgress("complete"), "complete_all");
  assert.equal(resolveTaskStepProgress("request_approval"), "none");
  assert.equal(resolveTaskStepProgress("approve"), "none");
  assert.equal(resolveTaskStepProgress("cancel"), "none");
});

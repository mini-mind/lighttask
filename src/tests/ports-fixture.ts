import { createLightTask } from "../index";
import {
  createInMemoryNotifyCollector,
  createInMemoryOutputRepository,
  createInMemoryPlanRepository,
  createInMemoryRuntimeRepository,
  createInMemoryTaskRepository,
  createNoopConsistencyPort,
  createSystemClock,
  createTaskIdGenerator,
} from "../ports/in-memory";
import { createTaskLifecyclePolicy } from "../rules";

type TestLightTaskOptions = Parameters<typeof createLightTask>[0];

export function createExampleTaskLifecycle() {
  return createTaskLifecyclePolicy({
    initialStatus: "draft",
    statusDefinitions: [
      {
        key: "draft",
        editable: true,
        schedulable: false,
        active: false,
        terminal: false,
      },
      {
        key: "todo",
        editable: false,
        schedulable: true,
        active: false,
        terminal: false,
      },
      {
        key: "dispatched",
        editable: false,
        schedulable: false,
        active: true,
        terminal: false,
      },
      {
        key: "running",
        editable: false,
        schedulable: false,
        active: true,
        terminal: false,
      },
      {
        key: "blocked_by_approval",
        editable: false,
        schedulable: false,
        active: true,
        terminal: false,
      },
      {
        key: "completed",
        editable: false,
        schedulable: false,
        active: false,
        terminal: true,
        completionOutcome: "success",
      },
      {
        key: "failed",
        editable: false,
        schedulable: false,
        active: false,
        terminal: true,
        completionOutcome: "failed",
      },
      {
        key: "cancelled",
        editable: false,
        schedulable: false,
        active: false,
        terminal: true,
        completionOutcome: "cancelled",
      },
    ],
    actionDefinitions: [
      { key: "finalize", stepProgress: "reset_all_to_todo" },
      { key: "return_to_draft", stepProgress: "reset_all_to_todo" },
      { key: "dispatch", requiresRunnable: true, stepProgress: "advance_one" },
      { key: "start", stepProgress: "advance_one" },
      { key: "request_approval" },
      { key: "approve" },
      { key: "complete", stepProgress: "complete_all" },
      { key: "fail" },
      { key: "cancel" },
    ],
    transitionDefinitions: [
      { from: "draft", action: "finalize", to: "todo" },
      { from: "todo", action: "return_to_draft", to: "draft" },
      { from: "todo", action: "dispatch", to: "dispatched" },
      { from: "todo", action: "fail", to: "failed" },
      { from: "todo", action: "cancel", to: "cancelled" },
      { from: "dispatched", action: "start", to: "running" },
      { from: "dispatched", action: "fail", to: "failed" },
      { from: "dispatched", action: "cancel", to: "cancelled" },
      { from: "running", action: "request_approval", to: "blocked_by_approval" },
      { from: "running", action: "complete", to: "completed" },
      { from: "running", action: "fail", to: "failed" },
      { from: "running", action: "cancel", to: "cancelled" },
      { from: "blocked_by_approval", action: "approve", to: "running" },
      { from: "blocked_by_approval", action: "fail", to: "failed" },
      { from: "blocked_by_approval", action: "cancel", to: "cancelled" },
    ],
    terminalStatuses: ["completed", "failed", "cancelled"],
  });
}

export function createTestLightTaskOptions(
  overrides: Partial<TestLightTaskOptions> = {},
): TestLightTaskOptions {
  return {
    taskRepository: overrides.taskRepository ?? createInMemoryTaskRepository(),
    planRepository: overrides.planRepository ?? createInMemoryPlanRepository(),
    runtimeRepository: overrides.runtimeRepository ?? createInMemoryRuntimeRepository(),
    outputRepository: overrides.outputRepository ?? createInMemoryOutputRepository(),
    notify: overrides.notify ?? createInMemoryNotifyCollector(),
    consistency: overrides.consistency ?? createNoopConsistencyPort(),
    clock: overrides.clock ?? createSystemClock(),
    idGenerator: overrides.idGenerator ?? createTaskIdGenerator(),
    taskLifecycle: overrides.taskLifecycle ?? createExampleTaskLifecycle(),
    runtimeLifecycle: overrides.runtimeLifecycle,
  };
}

export function createTestLightTask(planId = "plan_test") {
  const lighttask = createLightTask(createTestLightTaskOptions());
  lighttask.createPlan({
    id: planId,
    title: `计划 ${planId}`,
  });
  return {
    lighttask,
    planId,
  };
}

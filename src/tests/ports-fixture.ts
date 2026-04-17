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

type TestLightTaskOptions = Parameters<typeof createLightTask>[0];

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

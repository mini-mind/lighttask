import type { LightTaskGraph, LightTaskPlan, LightTaskTask, createLightTask } from "../index";
import {
  createInMemoryGraphRepository,
  createInMemoryPlanRepository,
  createInMemoryTaskRepository,
  createSystemClock,
  createTaskIdGenerator,
} from "../ports/in-memory";

type TaskRecordFixture = LightTaskTask & {
  lastAdvanceFingerprint?: string;
};

type TestLightTaskOptions = Parameters<typeof createLightTask>[0];

export function createTestLightTaskOptions(
  overrides: Partial<TestLightTaskOptions> = {},
): TestLightTaskOptions {
  return {
    taskRepository: overrides.taskRepository ?? createInMemoryTaskRepository<TaskRecordFixture>(),
    planRepository: overrides.planRepository ?? createInMemoryPlanRepository<LightTaskPlan>(),
    graphRepository: overrides.graphRepository ?? createInMemoryGraphRepository<LightTaskGraph>(),
    clock: overrides.clock ?? createSystemClock(),
    idGenerator: overrides.idGenerator ?? createTaskIdGenerator(),
  };
}

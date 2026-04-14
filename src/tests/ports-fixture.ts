import type {
  CreateLightTaskOptions,
  PersistedLightGraph,
  PersistedLightPlan,
  PersistedLightTask,
} from "../core/types";
import {
  createInMemoryGraphRepository,
  createInMemoryPlanRepository,
  createInMemoryTaskRepository,
  createSystemClock,
  createTaskIdGenerator,
} from "../ports/in-memory";

export function createTestLightTaskOptions(
  overrides: Partial<CreateLightTaskOptions> = {},
): CreateLightTaskOptions {
  return {
    taskRepository: overrides.taskRepository ?? createInMemoryTaskRepository<PersistedLightTask>(),
    planRepository: overrides.planRepository ?? createInMemoryPlanRepository<PersistedLightPlan>(),
    graphRepository:
      overrides.graphRepository ?? createInMemoryGraphRepository<PersistedLightGraph>(),
    clock: overrides.clock ?? createSystemClock(),
    idGenerator: overrides.idGenerator ?? createTaskIdGenerator(),
  };
}

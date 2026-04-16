import assert from "node:assert/strict";
import {
  LightTaskError,
  type LightTaskGraph,
  type LightTaskOutput,
  type LightTaskPlan,
  type LightTaskRuntime,
  type LightTaskTask,
  createLightTask,
} from "../index";
import {
  createInMemoryGraphRepository,
  createInMemoryNotifyCollector,
  createInMemoryOutputRepository,
  createInMemoryPlanRepository,
  createInMemoryRuntimeRepository,
  createInMemoryTaskRepository,
  createNoopConsistencyPort,
  createSystemClock,
  createTaskIdGenerator,
} from "../ports/in-memory";

type TaskRecordFixture = LightTaskTask & {
  lastAdvanceFingerprint?: string;
};
type RuntimeRecordFixture = LightTaskRuntime;
type OutputRecordFixture = LightTaskOutput;

type TestLightTaskOptions = Parameters<typeof createLightTask>[0];
type TestLightTask = ReturnType<typeof createLightTask>;

type InvalidDependencyCase = {
  name: string;
  options: Partial<TestLightTaskOptions>;
  invoke(lighttask: TestLightTask): void;
};

export function createTestLightTaskOptions(
  overrides: Partial<TestLightTaskOptions> = {},
): TestLightTaskOptions {
  const options: TestLightTaskOptions = {
    taskRepository: overrides.taskRepository ?? createInMemoryTaskRepository<TaskRecordFixture>(),
    planRepository: overrides.planRepository ?? createInMemoryPlanRepository<LightTaskPlan>(),
    graphRepository: overrides.graphRepository ?? createInMemoryGraphRepository<LightTaskGraph>(),
    runtimeRepository:
      overrides.runtimeRepository ?? createInMemoryRuntimeRepository<RuntimeRecordFixture>(),
    outputRepository:
      overrides.outputRepository ?? createInMemoryOutputRepository<OutputRecordFixture>(),
    notify: overrides.notify ?? createInMemoryNotifyCollector(),
    consistency: overrides.consistency ?? createNoopConsistencyPort(),
    clock: overrides.clock ?? createSystemClock(),
    idGenerator: overrides.idGenerator ?? createTaskIdGenerator(),
  };

  if (overrides.taskLifecycle) {
    options.taskLifecycle = overrides.taskLifecycle;
  }
  if (overrides.planLifecycle) {
    options.planLifecycle = overrides.planLifecycle;
  }
  if (overrides.runtimeLifecycle) {
    options.runtimeLifecycle = overrides.runtimeLifecycle;
  }
  if (overrides.scheduling) {
    options.scheduling = overrides.scheduling;
  }
  return options;
}

export function assertInvalidDependencyCases(
  invalidDependencyCases: readonly InvalidDependencyCase[],
): void {
  // 这里只复用坏依赖统一校验边界，避免把具体 API 行为一起抽象掉。
  for (const invalidCase of invalidDependencyCases) {
    const lighttask = createLightTask({
      ...createTestLightTaskOptions(),
      ...invalidCase.options,
    });

    assert.throws(
      () => invalidCase.invoke(lighttask),
      (error) => {
        assert.ok(error instanceof LightTaskError);
        assert.equal(error.code, "VALIDATION_ERROR");
        assert.equal(error.coreError.message, `${invalidCase.name} 必须是函数`);
        assert.equal(error.details?.path, invalidCase.name);
        return true;
      },
      `${invalidCase.name} 在对应 API 调用时应报对应 path`,
    );
  }
}

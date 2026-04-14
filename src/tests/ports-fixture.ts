import assert from "node:assert/strict";
import {
  LightTaskError,
  createLightTask,
  type LightTaskGraph,
  type LightTaskPlan,
  type LightTaskTask,
} from "../index";
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
type TestLightTask = ReturnType<typeof createLightTask>;

type InvalidDependencyCase = {
  name: string;
  options: Partial<TestLightTaskOptions>;
  invoke(lighttask: TestLightTask): void;
};

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

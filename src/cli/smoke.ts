import { createLightTaskError } from "../core/lighttask-error";
import { LightTaskError, createLightTask } from "../index";
import {
  createInMemoryPlanRepository,
  createInMemoryTaskRepository,
  createNoopConsistencyPort,
  createSystemClock,
  createTaskIdGenerator,
} from "../ports/in-memory";

function printHelp(): void {
  console.log("LightTask CLI");
  console.log("用法:");
  console.log("  npm run dev:cli -- demo");
  console.log('  npm run dev:cli -- create "任务标题"');
}

function ensurePlan(lighttask: ReturnType<typeof createLightTask>, planId: string): void {
  if (!lighttask.getPlan(planId)) {
    lighttask.createPlan({
      id: planId,
      title: "CLI 默认计划",
    });
  }
}

function run(): void {
  const [, , command, ...rest] = process.argv;
  const lighttask = createLightTask({
    taskRepository: createInMemoryTaskRepository(),
    planRepository: createInMemoryPlanRepository(),
    consistency: createNoopConsistencyPort(),
    clock: createSystemClock(),
    idGenerator: createTaskIdGenerator(),
  });

  if (!command || command === "help") {
    printHelp();
    return;
  }

  if (command === "demo") {
    ensurePlan(lighttask, "plan_cli_demo");
    const task = lighttask.createTask({
      planId: "plan_cli_demo",
      title: "演示：收敛 LightTask 通用内核",
      summary: "通过 CLI 冒烟验证公共 API",
    });
    const finalized = lighttask.advanceTask(task.id, {
      action: "finalize",
      expectedRevision: task.revision,
    });
    const dispatched = lighttask.advanceTask(task.id, {
      action: "dispatch",
      expectedRevision: finalized.revision,
    });
    console.log(JSON.stringify(lighttask.getTask(dispatched.id), null, 2));
    return;
  }

  if (command === "create") {
    const title = rest.join(" ").trim();
    if (!title) {
      throw new LightTaskError(createLightTaskError("VALIDATION_ERROR", "create 命令需要任务标题"));
    }

    ensurePlan(lighttask, "plan_cli_default");
    console.log(
      JSON.stringify(
        lighttask.createTask({
          planId: "plan_cli_default",
          title,
        }),
        null,
        2,
      ),
    );
    return;
  }

  throw new LightTaskError(createLightTaskError("VALIDATION_ERROR", `未知命令: ${command}`));
}

try {
  run();
} catch (error) {
  const message =
    error instanceof LightTaskError
      ? error.message
      : error instanceof Error
        ? error.message
        : String(error);
  console.error(message);
  process.exitCode = 1;
}

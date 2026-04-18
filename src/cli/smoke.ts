import {
  createInMemoryPlanRepository,
  createInMemoryTaskRepository,
  createNoopConsistencyPort,
  createSystemClock,
  createTaskIdGenerator,
} from "../adapters/memory";
import { createLightTaskError } from "../api/lighttask-error";
import { LightTaskError, createLightTask } from "../index";

const CLI_TASK_POLICY_ID = "cli_default";

function printHelp(): void {
  console.log("LightTask CLI");
  console.log("用法:");
  console.log("  npm run dev:cli -- demo");
  console.log('  npm run dev:cli -- create "任务标题"');
}

function ensurePlan(lighttask: ReturnType<typeof createLightTask>, planId: string): void {
  if (!lighttask.plans.get(planId)) {
    lighttask.plans.create({
      id: planId,
      title: "CLI 默认计划",
      taskPolicyId: CLI_TASK_POLICY_ID,
    });
  }
}

function createCliTaskPolicy() {
  const statuses = new Map([
    ["draft", { key: "draft", editable: true, schedulable: false, active: false, terminal: false }],
    ["todo", { key: "todo", editable: false, schedulable: true, active: false, terminal: false }],
    [
      "dispatched",
      { key: "dispatched", editable: false, schedulable: false, active: true, terminal: false },
    ],
    [
      "running",
      { key: "running", editable: false, schedulable: false, active: true, terminal: false },
    ],
    [
      "completed",
      {
        key: "completed",
        editable: false,
        schedulable: false,
        active: false,
        terminal: true,
        completionOutcome: "success" as const,
      },
    ],
  ]);
  const actions = new Map([
    ["finalize", { key: "finalize", stepProgress: "reset_all_to_todo" as const }],
    ["dispatch", { key: "dispatch", requiresRunnable: true, stepProgress: "advance_one" as const }],
    ["start", { key: "start", stepProgress: "advance_one" as const }],
    ["complete", { key: "complete", stepProgress: "complete_all" as const }],
  ]);
  const transitions = [
    { from: "draft", action: "finalize", to: "todo" },
    { from: "todo", action: "dispatch", to: "dispatched" },
    { from: "dispatched", action: "start", to: "running" },
    { from: "running", action: "complete", to: "completed" },
  ] as const;
  const transitionsByKey = new Map(
    transitions.map((transition) => [`${transition.from}\u0000${transition.action}`, transition]),
  );

  return {
    initialStatus: "draft",
    hasAction(action: string) {
      return actions.has(action);
    },
    getActionDefinition(action: string) {
      const definition = actions.get(action);
      return definition ? { ...definition } : undefined;
    },
    listActionDefinitions() {
      return [...actions.values()].map((definition) => ({ ...definition }));
    },
    hasStatus(status: string) {
      return statuses.has(status);
    },
    getStatusDefinition(status: string) {
      const definition = statuses.get(status);
      return definition ? { ...definition } : undefined;
    },
    listStatuses() {
      return [...statuses.values()].map((definition) => ({ ...definition }));
    },
    listTransitions(currentStatus?: string) {
      return transitions
        .filter((transition) => currentStatus === undefined || transition.from === currentStatus)
        .map((transition) => ({ ...transition }));
    },
    isTerminal(status: string) {
      return statuses.get(status)?.terminal ?? false;
    },
    canTransition(currentStatus: string, action: string) {
      return transitionsByKey.has(`${currentStatus}\u0000${action}`);
    },
    getNextStatus(currentStatus: string, action: string) {
      return transitionsByKey.get(`${currentStatus}\u0000${action}`)?.to;
    },
    transition(currentStatus: string, action: string) {
      const transition = transitionsByKey.get(`${currentStatus}\u0000${action}`);
      if (!transition) {
        return {
          ok: false as const,
          error: {
            code: "STATE_CONFLICT" as const,
            message: "任务状态迁移冲突",
            details: { currentStatus, action },
          },
        };
      }
      return {
        ok: true as const,
        status: transition.to,
        hooks: undefined,
      };
    },
    listActions(currentStatus: string) {
      return transitions
        .filter((transition) => transition.from === currentStatus)
        .map((transition) => transition.action);
    },
    resolveStepProgress(action: string) {
      return actions.get(action)?.stepProgress ?? "none";
    },
    requiresRunnable(action: string) {
      return actions.get(action)?.requiresRunnable ?? false;
    },
  };
}

function createCliTaskPolicies(taskPolicy: ReturnType<typeof createCliTaskPolicy>) {
  return {
    get(policyId: string) {
      return policyId === CLI_TASK_POLICY_ID ? taskPolicy : undefined;
    },
    list() {
      return [
        {
          id: CLI_TASK_POLICY_ID,
          initialStatus: taskPolicy.initialStatus,
          statusKeys: taskPolicy.listStatuses().map((status) => status.key),
          actionKeys: taskPolicy.listActionDefinitions().map((action) => action.key),
        },
      ];
    },
  };
}

function run(): void {
  const [, , command, ...rest] = process.argv;
  const taskPolicy = createCliTaskPolicy();
  const taskPolicies = createCliTaskPolicies(taskPolicy);
  const lighttask = createLightTask({
    taskRepository: createInMemoryTaskRepository(),
    planRepository: createInMemoryPlanRepository(),
    consistency: createNoopConsistencyPort(),
    clock: createSystemClock(),
    idGenerator: createTaskIdGenerator(),
    taskPolicies,
  });

  if (!command || command === "help") {
    printHelp();
    return;
  }

  if (command === "demo") {
    ensurePlan(lighttask, "plan_cli_demo");
    const task = lighttask.tasks.create({
      planId: "plan_cli_demo",
      title: "演示：收敛 LightTask 通用内核",
      summary: "通过 CLI 冒烟验证公共 API",
    });
    const finalized = lighttask.tasks.move(task.id, {
      action: "finalize",
      expectedRevision: task.revision,
    });
    const dispatched = lighttask.tasks.move(task.id, {
      action: "dispatch",
      expectedRevision: finalized.revision,
    });
    console.log(JSON.stringify(lighttask.tasks.get(dispatched.id), null, 2));
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
        lighttask.tasks.create({
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

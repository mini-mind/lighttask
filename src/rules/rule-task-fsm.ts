import { type CoreError, type TaskStatus, createCoreError } from "../data-structures";

export type TaskAction = string;

export type TaskTransitionResult =
  | {
      ok: true;
      status: TaskStatus;
      hooks?: TaskLifecycleHooks;
    }
  | {
      ok: false;
      error: CoreError;
    };

export type TaskStepProgressPolicy = "none" | "advance_one" | "complete_all" | "reset_all_to_todo";

export interface TaskActionDefinition {
  key: TaskAction;
  label?: string;
  requiresRunnable?: boolean;
  stepProgress?: TaskStepProgressPolicy;
}

export interface TaskStatusDefinition {
  key: TaskStatus;
  label?: string;
  editable: boolean;
  schedulable: boolean;
  active: boolean;
  terminal: boolean;
  completionOutcome?: "success" | "failed" | "cancelled";
}

export interface TaskLifecycleGuardInput {
  currentStatus: TaskStatus;
  action: TaskAction;
  nextStatus: TaskStatus;
}

export interface TaskLifecycleApplyInput extends TaskLifecycleGuardInput {}

export interface TaskLifecycleNotifyInput extends TaskLifecycleGuardInput {}

export interface TaskLifecycleHooks {
  guard?: (input: TaskLifecycleGuardInput) => CoreError | undefined;
  apply?: (input: TaskLifecycleApplyInput) => void;
  notify?: (input: TaskLifecycleNotifyInput) => void;
}

export interface TaskStatusTransitionDefinition {
  from: TaskStatus;
  action: TaskAction;
  to: TaskStatus;
  hooks?: TaskLifecycleHooks;
}

export interface TaskLifecyclePolicy {
  initialStatus: TaskStatus;
  hasAction(action: TaskAction): boolean;
  getActionDefinition(action: TaskAction): TaskActionDefinition | undefined;
  listActionDefinitions(): TaskActionDefinition[];
  hasStatus(status: TaskStatus): boolean;
  getStatusDefinition(status: TaskStatus): TaskStatusDefinition | undefined;
  listStatuses(): TaskStatusDefinition[];
  listTransitions(currentStatus?: TaskStatus): TaskStatusTransitionDefinition[];
  isTerminal(status: TaskStatus): boolean;
  canTransition(currentStatus: TaskStatus, action: TaskAction): boolean;
  getNextStatus(currentStatus: TaskStatus, action: TaskAction): TaskStatus | undefined;
  transition(currentStatus: TaskStatus, action: TaskAction): TaskTransitionResult;
  listActions(currentStatus: TaskStatus): TaskAction[];
  resolveStepProgress(action: TaskAction): TaskStepProgressPolicy;
  requiresRunnable(action: TaskAction): boolean;
}

export interface CreateTaskLifecyclePolicyInput {
  initialStatus: TaskStatus;
  statusDefinitions: readonly TaskStatusDefinition[];
  actionDefinitions: readonly TaskActionDefinition[];
  transitionDefinitions: readonly TaskStatusTransitionDefinition[];
  terminalStatuses?: readonly TaskStatus[];
  validateTransition?: (input: {
    currentStatus: TaskStatus;
    action: TaskAction;
    nextStatus: TaskStatus;
  }) => CoreError | undefined;
}

function createTransitionTableFromDefinitions(
  transitionDefinitions: readonly TaskStatusTransitionDefinition[],
): Readonly<Record<TaskStatus, Readonly<Partial<Record<TaskAction, TaskStatus>>>>> {
  const transitionTable: Record<TaskStatus, Partial<Record<TaskAction, TaskStatus>>> = {};

  for (const definition of transitionDefinitions) {
    transitionTable[definition.from] ??= {};
    transitionTable[definition.from][definition.action] = definition.to;
  }

  return transitionTable;
}

function cloneTaskStatusDefinition(definition: TaskStatusDefinition): TaskStatusDefinition {
  return { ...definition };
}

function cloneTaskTransitionDefinition(
  definition: TaskStatusTransitionDefinition,
): TaskStatusTransitionDefinition {
  return {
    ...definition,
    hooks: definition.hooks ? { ...definition.hooks } : undefined,
  };
}

function cloneTaskActionDefinition(definition: TaskActionDefinition): TaskActionDefinition {
  return { ...definition };
}

export function createTaskLifecyclePolicy(
  input: CreateTaskLifecyclePolicyInput,
): TaskLifecyclePolicy {
  const statusDefinitions = input.statusDefinitions.map(cloneTaskStatusDefinition);
  if (statusDefinitions.length === 0) {
    throw new Error("Task lifecycle policy 至少需要一个状态定义");
  }
  const actionDefinitions = input.actionDefinitions.map(cloneTaskActionDefinition);
  const statusDefinitionKeys = new Set<string>();
  const actionDefinitionKeys = new Set<string>();
  for (const definition of statusDefinitions) {
    if (!definition.key.trim()) {
      throw new Error("Task lifecycle policy 不允许空白状态 key");
    }
    if (statusDefinitionKeys.has(definition.key)) {
      throw new Error(`Task lifecycle policy 存在重复状态定义: ${definition.key}`);
    }
    statusDefinitionKeys.add(definition.key);
  }
  for (const definition of actionDefinitions) {
    if (!definition.key.trim()) {
      throw new Error("Task lifecycle policy 不允许空白动作 key");
    }
    if (actionDefinitionKeys.has(definition.key)) {
      throw new Error(`Task lifecycle policy 存在重复动作定义: ${definition.key}`);
    }
    actionDefinitionKeys.add(definition.key);
  }
  const statusDefinitionMap = new Map(
    statusDefinitions.map((definition) => [definition.key, cloneTaskStatusDefinition(definition)]),
  );
  const actionDefinitionMap = new Map(
    actionDefinitions.map((definition) => [definition.key, cloneTaskActionDefinition(definition)]),
  );
  const transitionDefinitions = input.transitionDefinitions.map(cloneTaskTransitionDefinition);
  if (!statusDefinitionMap.has(input.initialStatus)) {
    throw new Error(`Task lifecycle policy 未注册 initialStatus: ${input.initialStatus}`);
  }
  const terminalStatuses = new Set(input.terminalStatuses ?? []);
  for (const terminalStatus of terminalStatuses) {
    if (!statusDefinitionMap.has(terminalStatus)) {
      throw new Error(`Task lifecycle policy 未注册 terminalStatus: ${terminalStatus}`);
    }
  }
  for (const definition of statusDefinitions) {
    if (terminalStatuses.has(definition.key)) {
      definition.terminal = true;
    }
  }
  for (const definition of transitionDefinitions) {
    if (!statusDefinitionMap.has(definition.from)) {
      throw new Error(`Task lifecycle policy 未注册转移起点状态: ${definition.from}`);
    }
    if (!statusDefinitionMap.has(definition.to)) {
      throw new Error(`Task lifecycle policy 未注册转移终点状态: ${definition.to}`);
    }
    if (!actionDefinitionMap.has(definition.action)) {
      throw new Error(`Task lifecycle policy 未注册转移动作: ${definition.action}`);
    }
  }
  const transitionTable = createTransitionTableFromDefinitions(transitionDefinitions);
  const transitionDefinitionMap = new Map(
    transitionDefinitions.map((definition) => [
      `${definition.from}\u0000${definition.action}`,
      cloneTaskTransitionDefinition(definition),
    ]),
  );

  function getTransitionDefinition(
    currentStatus: TaskStatus,
    action: TaskAction,
  ): TaskStatusTransitionDefinition | undefined {
    return transitionDefinitionMap.get(`${currentStatus}\u0000${action}`);
  }

  function isTerminal(status: TaskStatus): boolean {
    return terminalStatuses.has(status);
  }

  function getNextStatus(currentStatus: TaskStatus, action: TaskAction): TaskStatus | undefined {
    if (isTerminal(currentStatus)) {
      return undefined;
    }

    return transitionTable[currentStatus]?.[action];
  }

  function transition(currentStatus: TaskStatus, action: TaskAction): TaskTransitionResult {
    const nextStatus = getNextStatus(currentStatus, action);
    if (nextStatus === undefined) {
      return {
        ok: false,
        error: createCoreError("STATE_CONFLICT", "任务状态迁移冲突", {
          currentStatus,
          action,
        }),
      };
    }

    const validationError = input.validateTransition?.({
      currentStatus,
      action,
      nextStatus,
    });
    if (validationError) {
      return {
        ok: false,
        error: validationError,
      };
    }

    const guardError = getTransitionDefinition(currentStatus, action)?.hooks?.guard?.({
      currentStatus,
      action,
      nextStatus,
    });
    if (guardError) {
      return {
        ok: false,
        error: guardError,
      };
    }

    return {
      ok: true,
      status: nextStatus,
      hooks: getTransitionDefinition(currentStatus, action)?.hooks
        ? { ...getTransitionDefinition(currentStatus, action)?.hooks }
        : undefined,
    };
  }

  function listActions(currentStatus: TaskStatus): TaskAction[] {
    if (isTerminal(currentStatus)) {
      return [];
    }

    return Object.keys(transitionTable[currentStatus] ?? {}) as TaskAction[];
  }

  return {
    initialStatus: input.initialStatus,
    hasAction(action) {
      return actionDefinitionMap.has(action);
    },
    getActionDefinition(action) {
      const definition = actionDefinitionMap.get(action);
      return definition ? cloneTaskActionDefinition(definition) : undefined;
    },
    listActionDefinitions() {
      return actionDefinitions.map(cloneTaskActionDefinition);
    },
    hasStatus(status) {
      return statusDefinitionMap.has(status);
    },
    getStatusDefinition(status) {
      const definition = statusDefinitionMap.get(status);
      return definition ? cloneTaskStatusDefinition(definition) : undefined;
    },
    listStatuses() {
      return statusDefinitions.map(cloneTaskStatusDefinition);
    },
    listTransitions(currentStatus) {
      const definitions = currentStatus
        ? transitionDefinitions.filter((definition) => definition.from === currentStatus)
        : transitionDefinitions;
      return definitions.map(cloneTaskTransitionDefinition);
    },
    isTerminal,
    canTransition(currentStatus, action) {
      return getNextStatus(currentStatus, action) !== undefined;
    },
    getNextStatus,
    transition,
    listActions,
    resolveStepProgress(action) {
      return actionDefinitionMap.get(action)?.stepProgress ?? "none";
    },
    requiresRunnable(action) {
      return actionDefinitionMap.get(action)?.requiresRunnable ?? false;
    },
  };
}

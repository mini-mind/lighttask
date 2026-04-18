import {
  type CoreError,
  DEFAULT_TASK_ACTIVE_STATUSES,
  DEFAULT_TASK_TERMINAL_STATUSES,
  TASK_STATUSES,
  type TaskStatus,
  createCoreError,
} from "../data-structures";

export type TaskAction =
  | "finalize"
  | "return_to_draft"
  | "dispatch"
  | "start"
  | "request_approval"
  | "approve"
  | "complete"
  | "fail"
  | "cancel";

export type TaskTransitionResult =
  | {
      ok: true;
      status: TaskStatus;
    }
  | {
      ok: false;
      error: CoreError;
    };

export type TaskStepProgressPolicy = "none" | "advance_one" | "complete_all";

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
}

export interface CreateTaskLifecyclePolicyInput {
  initialStatus: TaskStatus;
  statusDefinitions?: readonly TaskStatusDefinition[];
  transitionDefinitions?: readonly TaskStatusTransitionDefinition[];
  transitionTable?: Readonly<Record<TaskStatus, Readonly<Partial<Record<TaskAction, TaskStatus>>>>>;
  terminalStatuses?: readonly TaskStatus[];
  stepProgressByAction?: Readonly<Partial<Record<TaskAction, TaskStepProgressPolicy>>>;
  validateTransition?: (input: {
    currentStatus: TaskStatus;
    action: TaskAction;
    nextStatus: TaskStatus;
  }) => CoreError | undefined;
}

function resolveDefaultTaskCompletionOutcome(
  status: TaskStatus,
): TaskStatusDefinition["completionOutcome"] {
  if (status === "completed") {
    return "success";
  }
  if (status === "failed") {
    return "failed";
  }
  if (status === "cancelled") {
    return "cancelled";
  }
  return undefined;
}

const DEFAULT_TASK_STATUS_DEFINITIONS: readonly TaskStatusDefinition[] = TASK_STATUSES.map(
  (key) => ({
    key,
    label: key,
    editable: key === "draft",
    schedulable: key === "todo",
    active: (DEFAULT_TASK_ACTIVE_STATUSES as readonly TaskStatus[]).includes(key),
    terminal: (DEFAULT_TASK_TERMINAL_STATUSES as readonly TaskStatus[]).includes(key),
    completionOutcome: resolveDefaultTaskCompletionOutcome(key),
  }),
);

const TASK_TRANSITION_TABLE: Readonly<
  Record<TaskStatus, Readonly<Partial<Record<TaskAction, TaskStatus>>>>
> = {
  draft: {
    finalize: "todo",
  },
  todo: {
    return_to_draft: "draft",
    dispatch: "dispatched",
    fail: "failed",
    cancel: "cancelled",
  },
  dispatched: {
    start: "running",
    fail: "failed",
    cancel: "cancelled",
  },
  running: {
    request_approval: "blocked_by_approval",
    complete: "completed",
    fail: "failed",
    cancel: "cancelled",
  },
  blocked_by_approval: {
    approve: "running",
    fail: "failed",
    cancel: "cancelled",
  },
  completed: {},
  failed: {},
  cancelled: {},
} as const;

const DEFAULT_TASK_STEP_PROGRESS_BY_ACTION = {
  finalize: "none",
  return_to_draft: "none",
  dispatch: "advance_one",
  start: "advance_one",
  complete: "complete_all",
} satisfies Readonly<Partial<Record<TaskAction, TaskStepProgressPolicy>>>;

const DEFAULT_TASK_TRANSITION_DEFINITIONS =
  createTransitionDefinitionsFromTable(TASK_TRANSITION_TABLE);

function createTransitionDefinitionsFromTable(
  transitionTable: Readonly<Record<TaskStatus, Readonly<Partial<Record<TaskAction, TaskStatus>>>>>,
): TaskStatusTransitionDefinition[] {
  const definitions: TaskStatusTransitionDefinition[] = [];
  for (const [from, transitions] of Object.entries(transitionTable)) {
    for (const [action, to] of Object.entries(transitions)) {
      definitions.push({
        from,
        action: action as TaskAction,
        to: to as TaskStatus,
      });
    }
  }

  return definitions;
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

function normalizeTaskStatusDefinitions(
  input: CreateTaskLifecyclePolicyInput,
): TaskStatusDefinition[] {
  if (input.statusDefinitions && input.statusDefinitions.length > 0) {
    const statusDefinitions = input.statusDefinitions.map(cloneTaskStatusDefinition);
    const terminalStatuses = new Set(input.terminalStatuses ?? []);

    for (const definition of statusDefinitions) {
      if (terminalStatuses.has(definition.key)) {
        definition.terminal = true;
      }
    }

    return statusDefinitions;
  }

  const terminalStatuses = new Set(input.terminalStatuses ?? []);
  const transitionTable = input.transitionTable ?? TASK_TRANSITION_TABLE;
  const candidateStatuses = new Set<TaskStatus>([input.initialStatus, ...terminalStatuses]);

  for (const [from, transitions] of Object.entries(transitionTable)) {
    candidateStatuses.add(from);
    for (const to of Object.values(transitions)) {
      if (to !== undefined) {
        candidateStatuses.add(to);
      }
    }
  }

  return [...candidateStatuses].map((status) => ({
    key: status,
    label: status,
    editable: status === "draft",
    schedulable: status === "todo",
    active: (DEFAULT_TASK_ACTIVE_STATUSES as readonly TaskStatus[]).includes(status),
    terminal: terminalStatuses.has(status),
    completionOutcome: resolveDefaultTaskCompletionOutcome(status),
  }));
}

function normalizeTaskTransitionDefinitions(
  input: CreateTaskLifecyclePolicyInput,
): TaskStatusTransitionDefinition[] {
  if (input.transitionDefinitions && input.transitionDefinitions.length > 0) {
    return input.transitionDefinitions.map(cloneTaskTransitionDefinition);
  }

  return createTransitionDefinitionsFromTable(input.transitionTable ?? TASK_TRANSITION_TABLE);
}

export function createTaskLifecyclePolicy(
  input: CreateTaskLifecyclePolicyInput,
): TaskLifecyclePolicy {
  const statusDefinitions = normalizeTaskStatusDefinitions(input);
  if (statusDefinitions.length === 0) {
    throw new Error("Task lifecycle policy 至少需要一个状态定义");
  }
  const statusDefinitionMap = new Map(
    statusDefinitions.map((definition) => [definition.key, cloneTaskStatusDefinition(definition)]),
  );
  const transitionDefinitions = normalizeTaskTransitionDefinitions(input);
  if (!statusDefinitionMap.has(input.initialStatus)) {
    throw new Error(`Task lifecycle policy 未注册 initialStatus: ${input.initialStatus}`);
  }
  for (const definition of transitionDefinitions) {
    if (!statusDefinitionMap.has(definition.from)) {
      throw new Error(`Task lifecycle policy 未注册转移起点状态: ${definition.from}`);
    }
    if (!statusDefinitionMap.has(definition.to)) {
      throw new Error(`Task lifecycle policy 未注册转移终点状态: ${definition.to}`);
    }
  }
  const transitionTable = createTransitionTableFromDefinitions(transitionDefinitions);
  const transitionDefinitionMap = new Map(
    transitionDefinitions.map((definition) => [
      `${definition.from}\u0000${definition.action}`,
      cloneTaskTransitionDefinition(definition),
    ]),
  );
  const terminalStatuses = new Set(
    input.terminalStatuses ??
      statusDefinitions
        .filter((definition) => definition.terminal)
        .map((definition) => definition.key),
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
      return input.stepProgressByAction?.[action] ?? "none";
    },
  };
}

export const defaultTaskLifecyclePolicy = createTaskLifecyclePolicy({
  initialStatus: "draft",
  statusDefinitions: DEFAULT_TASK_STATUS_DEFINITIONS,
  transitionDefinitions: DEFAULT_TASK_TRANSITION_DEFINITIONS,
  terminalStatuses: DEFAULT_TASK_TERMINAL_STATUSES,
  stepProgressByAction: DEFAULT_TASK_STEP_PROGRESS_BY_ACTION,
});

export function canTaskTransition(currentStatus: TaskStatus, action: TaskAction): boolean {
  return defaultTaskLifecyclePolicy.canTransition(currentStatus, action);
}

export function getNextTaskStatus(
  currentStatus: TaskStatus,
  action: TaskAction,
): TaskStatus | undefined {
  return defaultTaskLifecyclePolicy.getNextStatus(currentStatus, action);
}

export function transitionTaskStatus(
  currentStatus: TaskStatus,
  action: TaskAction,
): TaskTransitionResult {
  return defaultTaskLifecyclePolicy.transition(currentStatus, action);
}

export function listTaskActions(currentStatus: TaskStatus): TaskAction[] {
  return defaultTaskLifecyclePolicy.listActions(currentStatus);
}

export function listTaskStatuses(): TaskStatusDefinition[] {
  return defaultTaskLifecyclePolicy.listStatuses();
}

export function listTaskTransitions(currentStatus?: TaskStatus): TaskStatusTransitionDefinition[] {
  return defaultTaskLifecyclePolicy.listTransitions(currentStatus);
}

export function getTaskStatusDefinition(status: TaskStatus): TaskStatusDefinition | undefined {
  return defaultTaskLifecyclePolicy.getStatusDefinition(status);
}

export function isTaskEditableStatus(status: TaskStatus): boolean {
  return defaultTaskLifecyclePolicy.getStatusDefinition(status)?.editable ?? false;
}

export function isTaskSchedulableStatus(status: TaskStatus): boolean {
  return defaultTaskLifecyclePolicy.getStatusDefinition(status)?.schedulable ?? false;
}

export function resolveTaskStepProgress(action: TaskAction): TaskStepProgressPolicy {
  return defaultTaskLifecyclePolicy.resolveStepProgress(action);
}

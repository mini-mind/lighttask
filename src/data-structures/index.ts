export type {
  ExtensionNamespaceMap,
  ExtensionValueMap,
  StructuredEntityExtensions,
} from "./ds-extension";

export type {
  TaskDesignStatus,
  TaskLifecycleStatus,
  PlanLifecycleStatus,
  RuntimeLifecycleStatus,
} from "./ds-status";
export {
  DEFAULT_PLAN_TERMINAL_STATUSES,
  DEFAULT_RUNTIME_TERMINAL_STATUSES,
  DEFAULT_TASK_TERMINAL_STATUSES,
  TASK_DESIGN_STATUSES,
  isTaskDesignStatus,
  isTaskTerminalStatus,
  isPlanTerminalStatus,
  isRuntimeTerminalStatus,
} from "./ds-status";

export type { CoreErrorCode, CoreError } from "./ds-error";
export {
  CORE_ERROR_CODES,
  LightTaskError,
  createCoreError,
  throwCoreError,
} from "./ds-error";

export type { RevisionState } from "./ds-revision";
export {
  createInitialRevision,
  bumpRevision,
  assertRevisionMonotonic,
} from "./ds-revision";

export type {
  TaskRecord,
  CreateTaskRecordInput,
} from "./ds-task";
export { createTaskRecord } from "./ds-task";

export type {
  PlanSessionRecord,
  CreatePlanSessionRecordInput,
} from "./ds-plan";
export { createPlanSessionRecord } from "./ds-plan";

export type {
  RuntimeParentRef,
  RuntimeOwnerRef,
  RuntimeRelatedRef,
  RuntimeRecord,
  CreateRuntimeRecordInput,
} from "./ds-runtime";
export { createRuntimeRecord } from "./ds-runtime";

export type {
  OutputLifecycleStatus,
  OutputItemStatus,
  OutputRuntimeRef,
  OutputOwnerRef,
  OutputItemRecord,
  OutputRecord,
  CreateOutputRecordInput,
} from "./ds-output";
export { createOutputRecord } from "./ds-output";

export type {
  DependencyKind,
  GraphNodeRecord,
  GraphEdgeRecord,
  GraphSnapshot,
  CreateGraphSnapshotInput,
} from "./ds-graph";
export { createGraphSnapshot } from "./ds-graph";

export type {
  DomainEventAggregate,
  DomainEventType,
  DomainEvent,
  CreateDomainEventInput,
} from "./ds-event";
export { createDomainEvent } from "./ds-event";

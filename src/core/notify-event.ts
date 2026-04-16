import { createDomainEvent } from "../data-structures";
import type { NotifyPort } from "../ports";
import { requireLightTaskFunction } from "./lighttask-error";
import type {
  CreateLightTaskOptions,
  GraphPublishedEvent,
  GraphSavedEvent,
  LightTaskDomainEvent,
  LightTaskGraph,
  LightTaskOutput,
  LightTaskPlan,
  LightTaskRuntime,
  LightTaskTask,
  OutputAdvancedEvent,
  OutputCreatedEvent,
  PlanAdvancedEvent,
  PlanCreatedEvent,
  PlanLaunchedEvent,
  PlanTaskProvenanceSyncedEvent,
  PlanUpdatedEvent,
  RuntimeAdvancedEvent,
  RuntimeCreatedEvent,
  TaskAdvancedEvent,
  TaskCreatedEvent,
  TaskUpdatedEvent,
} from "./types";

type EventPublisher = NotifyPort<LightTaskDomainEvent>["publish"];

const NOOP_EVENT_PUBLISHER: EventPublisher = () => {};

function createEventId(type: LightTaskDomainEvent["type"], aggregateId: string, revision: number) {
  return `${type}:${aggregateId}:r${revision}`;
}

function createTaskEvent<
  TType extends TaskCreatedEvent["type"] | TaskUpdatedEvent["type"] | TaskAdvancedEvent["type"],
>(type: TType, task: LightTaskTask): Extract<LightTaskDomainEvent, { type: TType }> {
  return createDomainEvent({
    id: createEventId(type, task.id, task.revision),
    type,
    aggregate: "task",
    aggregateId: task.id,
    occurredAt: task.updatedAt ?? task.createdAt,
    revision: task.revision,
    idempotencyKey: task.idempotencyKey,
    payload: {
      task,
    },
  }) as Extract<LightTaskDomainEvent, { type: TType }>;
}

function createPlanEvent<
  TType extends PlanCreatedEvent["type"] | PlanUpdatedEvent["type"] | PlanAdvancedEvent["type"],
>(type: TType, plan: LightTaskPlan): Extract<LightTaskDomainEvent, { type: TType }> {
  return createDomainEvent({
    id: createEventId(type, plan.id, plan.revision),
    type,
    aggregate: "plan",
    aggregateId: plan.id,
    occurredAt: plan.updatedAt,
    revision: plan.revision,
    idempotencyKey: plan.idempotencyKey,
    payload: {
      plan,
    },
  }) as Extract<LightTaskDomainEvent, { type: TType }>;
}

function createPlanOrchestrationEvent<
  TType extends PlanTaskProvenanceSyncedEvent["type"] | PlanLaunchedEvent["type"],
>(
  type: TType,
  input: {
    plan: LightTaskPlan;
    publishedGraph: LightTaskGraph;
    tasks: LightTaskTask[];
    revision: number;
    occurredAt: string;
    idempotencyKey?: string;
  },
): Extract<LightTaskDomainEvent, { type: TType }> {
  return createDomainEvent({
    id: createEventId(type, input.plan.id, input.revision),
    type,
    aggregate: "plan",
    aggregateId: input.plan.id,
    occurredAt: input.occurredAt,
    revision: input.revision,
    idempotencyKey: input.idempotencyKey,
    payload: {
      plan: input.plan,
      publishedGraph: input.publishedGraph,
      tasks: input.tasks,
    },
  }) as Extract<LightTaskDomainEvent, { type: TType }>;
}

function createGraphEvent<TType extends GraphSavedEvent["type"] | GraphPublishedEvent["type"]>(
  type: TType,
  planId: string,
  graph: LightTaskGraph,
  scope: Extract<LightTaskDomainEvent, { type: TType }>["payload"]["scope"],
): Extract<LightTaskDomainEvent, { type: TType }> {
  return createDomainEvent({
    id: createEventId(type, planId, graph.revision),
    type,
    aggregate: "graph",
    aggregateId: planId,
    occurredAt: graph.updatedAt,
    revision: graph.revision,
    idempotencyKey: graph.idempotencyKey,
    payload: {
      scope,
      graph,
    },
  }) as Extract<LightTaskDomainEvent, { type: TType }>;
}

function createRuntimeEvent<
  TType extends RuntimeCreatedEvent["type"] | RuntimeAdvancedEvent["type"],
>(type: TType, runtime: LightTaskRuntime): Extract<LightTaskDomainEvent, { type: TType }> {
  return createDomainEvent({
    id: createEventId(type, runtime.id, runtime.revision),
    type,
    aggregate: "runtime",
    aggregateId: runtime.id,
    occurredAt: runtime.updatedAt,
    revision: runtime.revision,
    idempotencyKey: runtime.idempotencyKey,
    payload: {
      runtime,
    },
  }) as Extract<LightTaskDomainEvent, { type: TType }>;
}

function createOutputEvent<TType extends OutputCreatedEvent["type"] | OutputAdvancedEvent["type"]>(
  type: TType,
  output: LightTaskOutput,
): Extract<LightTaskDomainEvent, { type: TType }> {
  return createDomainEvent({
    id: createEventId(type, output.id, output.revision),
    type,
    aggregate: "output",
    aggregateId: output.id,
    occurredAt: output.updatedAt,
    revision: output.revision,
    idempotencyKey: output.idempotencyKey,
    payload: {
      output,
    },
  }) as Extract<LightTaskDomainEvent, { type: TType }>;
}

export function resolveNotifyPublisher(options: CreateLightTaskOptions): EventPublisher {
  if (!options.notify) {
    return NOOP_EVENT_PUBLISHER;
  }

  return requireLightTaskFunction(options.notify.publish, "notify.publish");
}

export function publishTaskCreatedEvent(
  publish: EventPublisher,
  task: LightTaskTask,
): TaskCreatedEvent {
  const event = createTaskEvent("task.created", task);
  publish(event);
  return event;
}

export function publishTaskUpdatedEvent(
  publish: EventPublisher,
  task: LightTaskTask,
): TaskUpdatedEvent {
  const event = createTaskEvent("task.updated", task);
  publish(event);
  return event;
}

export function publishTaskAdvancedEvent(
  publish: EventPublisher,
  task: LightTaskTask,
): TaskAdvancedEvent {
  const event = createTaskEvent("task.advanced", task);
  publish(event);
  return event;
}

export function publishPlanCreatedEvent(
  publish: EventPublisher,
  plan: LightTaskPlan,
): PlanCreatedEvent {
  const event = createPlanEvent("plan.created", plan);
  publish(event);
  return event;
}

export function publishPlanUpdatedEvent(
  publish: EventPublisher,
  plan: LightTaskPlan,
): PlanUpdatedEvent {
  const event = createPlanEvent("plan.updated", plan);
  publish(event);
  return event;
}

export function publishPlanAdvancedEvent(
  publish: EventPublisher,
  plan: LightTaskPlan,
): PlanAdvancedEvent {
  const event = createPlanEvent("plan.advanced", plan);
  publish(event);
  return event;
}

export function publishPlanTaskProvenanceSyncedEvent(
  publish: EventPublisher,
  input: {
    plan: LightTaskPlan;
    publishedGraph: LightTaskGraph;
    tasks: LightTaskTask[];
  },
): PlanTaskProvenanceSyncedEvent {
  const event = createPlanOrchestrationEvent("plan.task_provenance_synced", {
    ...input,
    // 事件绑定到已发布图 revision，表示这批任务已完成该版本关系 provenance 同步。
    revision: input.publishedGraph.revision,
    occurredAt: input.publishedGraph.updatedAt,
    idempotencyKey: input.publishedGraph.idempotencyKey,
  });
  publish(event);
  return event;
}

export function publishPlanLaunchedEvent(
  publish: EventPublisher,
  input: {
    plan: LightTaskPlan;
    publishedGraph: LightTaskGraph;
    tasks: LightTaskTask[];
  },
): PlanLaunchedEvent {
  const event = createPlanOrchestrationEvent("plan.launched", {
    ...input,
    // launched 绑定确认后的计划 revision，表示 ready -> confirmed 的闭环已完成。
    revision: input.plan.revision,
    occurredAt: input.plan.updatedAt,
    idempotencyKey: input.plan.idempotencyKey,
  });
  publish(event);
  return event;
}

export function publishGraphSavedEvent(
  publish: EventPublisher,
  planId: string,
  graph: LightTaskGraph,
): GraphSavedEvent {
  const event = createGraphEvent("graph.saved", planId, graph, "draft");
  publish(event);
  return event;
}

export function publishGraphPublishedEvent(
  publish: EventPublisher,
  planId: string,
  graph: LightTaskGraph,
): GraphPublishedEvent {
  const event = createGraphEvent("graph.published", planId, graph, "published");
  publish(event);
  return event;
}

export function publishRuntimeCreatedEvent(
  publish: EventPublisher,
  runtime: LightTaskRuntime,
): RuntimeCreatedEvent {
  const event = createRuntimeEvent("runtime.created", runtime);
  publish(event);
  return event;
}

export function publishRuntimeAdvancedEvent(
  publish: EventPublisher,
  runtime: LightTaskRuntime,
): RuntimeAdvancedEvent {
  const event = createRuntimeEvent("runtime.advanced", runtime);
  publish(event);
  return event;
}

export function publishOutputCreatedEvent(
  publish: EventPublisher,
  output: LightTaskOutput,
): OutputCreatedEvent {
  const event = createOutputEvent("output.created", output);
  publish(event);
  return event;
}

export function publishOutputAdvancedEvent(
  publish: EventPublisher,
  output: LightTaskOutput,
): OutputAdvancedEvent {
  const event = createOutputEvent("output.advanced", output);
  publish(event);
  return event;
}

import { createDomainEvent } from "../data-structures";
import type { NotifyPort } from "../ports";
import { requireLightTaskFunction } from "./lighttask-error";
import type {
  CreateLightTaskOptions,
  GraphPublishedEvent,
  GraphSavedEvent,
  LightTaskDomainEvent,
  LightTaskGraph,
  LightTaskPlan,
  LightTaskRuntime,
  LightTaskTask,
  PlanAdvancedEvent,
  PlanCreatedEvent,
  PlanUpdatedEvent,
  RuntimeAdvancedEvent,
  RuntimeCreatedEvent,
  TaskAdvancedEvent,
  TaskCreatedEvent,
} from "./types";

type EventPublisher = NotifyPort<LightTaskDomainEvent>["publish"];

const NOOP_EVENT_PUBLISHER: EventPublisher = () => {};

function createEventId(type: LightTaskDomainEvent["type"], aggregateId: string, revision: number) {
  return `${type}:${aggregateId}:r${revision}`;
}

function createTaskEvent<TType extends TaskCreatedEvent["type"] | TaskAdvancedEvent["type"]>(
  type: TType,
  task: LightTaskTask,
): Extract<LightTaskDomainEvent, { type: TType }> {
  return createDomainEvent({
    id: createEventId(type, task.id, task.revision),
    type,
    aggregate: "task",
    aggregateId: task.id,
    occurredAt: task.createdAt,
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

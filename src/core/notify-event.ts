import { createDomainEvent } from "../data-structures";
import { requireLightTaskFunction } from "./lighttask-error";
import type {
  CreateLightTaskOptions,
  DeleteTaskResult,
  LightTaskDomainEvent,
  LightTaskOutput,
  LightTaskPlan,
  LightTaskRuntime,
  LightTaskTask,
  OutputAdvancedEvent,
  OutputCreatedEvent,
  PlanCreatedEvent,
  PlanUpdatedEvent,
  RuntimeAdvancedEvent,
  RuntimeCreatedEvent,
  TaskAdvancedEvent,
  TaskCreatedEvent,
  TaskDeletedEvent,
  TaskUpdatedEvent,
} from "./types";

type PublishEvent = (event: LightTaskDomainEvent) => void;

function createEventId(type: string, aggregateId: string, revision: number): string {
  return `event:${type}:${aggregateId}:${revision}`;
}

function createTaskEvent<TType extends "task.created" | "task.updated" | "task.advanced">(
  type: TType,
  task: LightTaskTask,
): Extract<TaskCreatedEvent | TaskUpdatedEvent | TaskAdvancedEvent, { type: TType }> {
  return createDomainEvent({
    id: createEventId(type, task.id, task.revision),
    type,
    aggregate: "task",
    aggregateId: task.id,
    occurredAt: task.updatedAt,
    revision: task.revision,
    idempotencyKey: task.idempotencyKey,
    payload: { task },
  }) as Extract<TaskCreatedEvent | TaskUpdatedEvent | TaskAdvancedEvent, { type: TType }>;
}

function createPlanEvent<TType extends "plan.created" | "plan.updated">(
  type: TType,
  plan: LightTaskPlan,
): Extract<PlanCreatedEvent | PlanUpdatedEvent, { type: TType }> {
  return createDomainEvent({
    id: createEventId(type, plan.id, plan.revision),
    type,
    aggregate: "plan",
    aggregateId: plan.id,
    occurredAt: plan.updatedAt,
    revision: plan.revision,
    idempotencyKey: plan.idempotencyKey,
    payload: { plan },
  }) as Extract<PlanCreatedEvent | PlanUpdatedEvent, { type: TType }>;
}

function createRuntimeEvent<TType extends "runtime.created" | "runtime.advanced">(
  type: TType,
  runtime: LightTaskRuntime,
): Extract<RuntimeCreatedEvent | RuntimeAdvancedEvent, { type: TType }> {
  return createDomainEvent({
    id: createEventId(type, runtime.id, runtime.revision),
    type,
    aggregate: "runtime",
    aggregateId: runtime.id,
    occurredAt: runtime.updatedAt,
    revision: runtime.revision,
    idempotencyKey: runtime.idempotencyKey,
    payload: { runtime },
  }) as Extract<RuntimeCreatedEvent | RuntimeAdvancedEvent, { type: TType }>;
}

function createOutputEvent<TType extends "output.created" | "output.advanced">(
  type: TType,
  output: LightTaskOutput,
): Extract<OutputCreatedEvent | OutputAdvancedEvent, { type: TType }> {
  return createDomainEvent({
    id: createEventId(type, output.id, output.revision),
    type,
    aggregate: "output",
    aggregateId: output.id,
    occurredAt: output.updatedAt,
    revision: output.revision,
    idempotencyKey: output.idempotencyKey,
    payload: { output },
  }) as Extract<OutputCreatedEvent | OutputAdvancedEvent, { type: TType }>;
}

export function resolveNotifyPublisher(options: CreateLightTaskOptions): PublishEvent {
  const publish = options.notify?.publish;
  if (!publish) {
    return () => {};
  }
  return requireLightTaskFunction(publish, "notify.publish");
}

export function publishTaskCreatedEvent(
  publishEvent: PublishEvent,
  task: LightTaskTask,
): TaskCreatedEvent {
  const event = createTaskEvent("task.created", task);
  publishEvent(event);
  return event;
}

export function publishTaskUpdatedEvent(
  publishEvent: PublishEvent,
  task: LightTaskTask,
): TaskUpdatedEvent {
  const event = createTaskEvent("task.updated", task);
  publishEvent(event);
  return event;
}

export function publishTaskAdvancedEvent(
  publishEvent: PublishEvent,
  task: LightTaskTask,
): TaskAdvancedEvent {
  const event = createTaskEvent("task.advanced", task);
  publishEvent(event);
  return event;
}

export function publishTaskDeletedEvent(
  publishEvent: PublishEvent,
  input: {
    result: DeleteTaskResult;
    occurredAt: string;
    revision: number;
    idempotencyKey?: string;
  },
): TaskDeletedEvent {
  const event = createDomainEvent({
    id: createEventId("task.deleted", input.result.taskId, input.revision),
    type: "task.deleted",
    aggregate: "task",
    aggregateId: input.result.taskId,
    occurredAt: input.occurredAt,
    revision: input.revision,
    idempotencyKey: input.idempotencyKey,
    payload: { result: input.result },
  }) as TaskDeletedEvent;
  publishEvent(event);
  return event;
}

export function publishPlanCreatedEvent(
  publishEvent: PublishEvent,
  plan: LightTaskPlan,
): PlanCreatedEvent {
  const event = createPlanEvent("plan.created", plan);
  publishEvent(event);
  return event;
}

export function publishPlanUpdatedEvent(
  publishEvent: PublishEvent,
  plan: LightTaskPlan,
): PlanUpdatedEvent {
  const event = createPlanEvent("plan.updated", plan);
  publishEvent(event);
  return event;
}

export function publishRuntimeCreatedEvent(
  publishEvent: PublishEvent,
  runtime: LightTaskRuntime,
): RuntimeCreatedEvent {
  const event = createRuntimeEvent("runtime.created", runtime);
  publishEvent(event);
  return event;
}

export function publishRuntimeAdvancedEvent(
  publishEvent: PublishEvent,
  runtime: LightTaskRuntime,
): RuntimeAdvancedEvent {
  const event = createRuntimeEvent("runtime.advanced", runtime);
  publishEvent(event);
  return event;
}

export function publishOutputCreatedEvent(
  publishEvent: PublishEvent,
  output: LightTaskOutput,
): OutputCreatedEvent {
  const event = createOutputEvent("output.created", output);
  publishEvent(event);
  return event;
}

export function publishOutputAdvancedEvent(
  publishEvent: PublishEvent,
  output: LightTaskOutput,
): OutputAdvancedEvent {
  const event = createOutputEvent("output.advanced", output);
  publishEvent(event);
  return event;
}

import { cloneValue } from "./ds-clone";

export type DomainEventType =
  | "task.created"
  | "task.updated"
  | "task.advanced"
  | "task.deleted"
  | "plan.created"
  | "plan.updated"
  | "plan.deleted"
  | "runtime.created"
  | "runtime.advanced"
  | "runtime.deleted"
  | "output.created"
  | "output.advanced"
  | "output.deleted";

export type DomainEventAggregate = "task" | "plan" | "runtime" | "output";

export interface DomainEvent<
  TType extends DomainEventType = DomainEventType,
  TPayload = Record<string, unknown>,
> {
  id: string;
  type: TType;
  aggregate: DomainEventAggregate;
  aggregateId: string;
  occurredAt: string;
  revision: number;
  version: 1;
  idempotencyKey?: string;
  payload: TPayload;
}

export interface CreateDomainEventInput<
  TType extends DomainEventType = DomainEventType,
  TPayload = Record<string, unknown>,
> {
  id: string;
  type: TType;
  aggregate: DomainEventAggregate;
  aggregateId: string;
  occurredAt: string;
  revision: number;
  idempotencyKey?: string;
  payload: TPayload;
}

export function createDomainEvent<
  TType extends DomainEventType = DomainEventType,
  TPayload = Record<string, unknown>,
>(input: CreateDomainEventInput<TType, TPayload>): DomainEvent<TType, TPayload> {
  return {
    id: input.id,
    type: input.type,
    aggregate: input.aggregate,
    aggregateId: input.aggregateId,
    occurredAt: input.occurredAt,
    revision: input.revision,
    version: 1,
    idempotencyKey: input.idempotencyKey,
    payload: cloneValue(input.payload),
  };
}

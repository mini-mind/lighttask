import { cloneValue } from "./ds-clone";

export type DomainEventType =
  | "task.created"
  | "task.advanced"
  | "plan.created"
  | "plan.updated"
  | "plan.advanced"
  | "graph.saved"
  | "graph.published"
  | "runtime.created"
  | "runtime.advanced";

export type DomainEventAggregate = "task" | "plan" | "graph" | "runtime";

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
  // 显式 version 字段用于后续协议演进。
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

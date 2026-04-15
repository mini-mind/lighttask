import {
  type RuntimeOwnerRef,
  type RuntimeParentRef,
  type RuntimeRelatedRef,
  createRuntimeRecord,
} from "../data-structures";
import {
  createLightTaskError,
  requireLightTaskFunction,
  throwLightTaskError,
} from "./lighttask-error";
import { publishRuntimeCreatedEvent, resolveNotifyPublisher } from "./notify-event";
import { toPublicRuntime } from "./runtime-snapshot";
import type {
  CreateLightTaskOptions,
  CreateRuntimeInput,
  LightTaskRuntime,
  PersistedLightRuntime,
} from "./types";

type RuntimeRelationRef = RuntimeParentRef | RuntimeOwnerRef | RuntimeRelatedRef;

function normalizeRuntimeRelationRef<TRef extends RuntimeRelationRef>(
  fieldName: string,
  ref: TRef | undefined,
): TRef | undefined {
  if (!ref) {
    return undefined;
  }

  if (typeof ref !== "object" || ref === null || Array.isArray(ref)) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", `运行时 ${fieldName} 只允许对象引用`, {
        [fieldName]: ref,
      }),
    );
  }

  const kind = typeof ref.kind === "string" ? ref.kind.trim() : "";
  const id = typeof ref.id === "string" ? ref.id.trim() : "";

  // runtime 关系切片只承担稳定关系标识，不在这里引入跨聚合查验或更复杂语义。
  if (!kind) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", `运行时 ${fieldName}.kind 不能为空`, {
        [fieldName]: ref,
      }),
    );
  }

  if (!id) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", `运行时 ${fieldName}.id 不能为空`, {
        [fieldName]: ref,
      }),
    );
  }

  return {
    ...ref,
    kind,
    id,
  };
}

function normalizeRuntimeRelatedRefs(
  relatedRefs: CreateRuntimeInput["relatedRefs"],
): RuntimeRelatedRef[] | undefined {
  if (relatedRefs === undefined) {
    return undefined;
  }

  if (!Array.isArray(relatedRefs)) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "运行时 relatedRefs 必须是数组", {
        relatedRefs,
      }),
    );
  }

  // relatedRefs 仅提供 create-only 的补充关系表达，不在运行时聚合内扩展查询语义。
  return relatedRefs.map((relatedRef, index) => {
    const normalizedRelatedRef = normalizeRuntimeRelationRef(`relatedRefs[${index}]`, relatedRef);

    if (!normalizedRelatedRef) {
      throwLightTaskError(
        createLightTaskError("VALIDATION_ERROR", `运行时 relatedRefs[${index}] 不能为空`, {
          relatedRef,
        }),
      );
    }

    return normalizedRelatedRef;
  });
}

export function createRuntimeUseCase(
  options: CreateLightTaskOptions,
  input: CreateRuntimeInput,
): LightTaskRuntime {
  const publishEvent = resolveNotifyPublisher(options);
  const clockNow = requireLightTaskFunction(options.clock?.now, "clock.now");
  const createRuntime = requireLightTaskFunction(
    options.runtimeRepository?.create,
    "runtimeRepository.create",
  );
  const runtimeId = input.id.trim();
  const kind = input.kind.trim();
  const title = input.title.trim();

  if (!runtimeId) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "运行时 ID 不能为空", {
        runtimeId: input.id,
      }),
    );
  }

  if (!kind) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "运行时 kind 不能为空", {
        kind: input.kind,
      }),
    );
  }

  if (!title) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "运行时标题不能为空", {
        title: input.title,
      }),
    );
  }

  const parentRef = normalizeRuntimeRelationRef("parentRef", input.parentRef);
  const ownerRef = normalizeRuntimeRelationRef("ownerRef", input.ownerRef);
  const relatedRefs = normalizeRuntimeRelatedRefs(input.relatedRefs);
  const runtime: PersistedLightRuntime = createRuntimeRecord({
    id: runtimeId,
    kind,
    title,
    createdAt: clockNow(),
    parentRef,
    ownerRef,
    relatedRefs,
    context: input.context,
    result: input.result,
    metadata: input.metadata,
    extensions: input.extensions,
  });
  const created = createRuntime(runtime);

  if (!created.ok) {
    throwLightTaskError(created.error);
  }

  const publicRuntime = toPublicRuntime(created.runtime);
  publishRuntimeCreatedEvent(publishEvent, publicRuntime);
  return publicRuntime;
}

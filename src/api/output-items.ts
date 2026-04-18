import type { OutputItemRecord } from "../models";
import { cloneOptional } from "./clone";
import { createLightTaskError, throwLightTaskError } from "./lighttask-error";
import type { LightTaskOutputItemInput } from "./types";

function hasOwnField(record: Record<string, unknown>, fieldName: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, fieldName);
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function normalizeOutputItem(item: LightTaskOutputItemInput, itemIndex: number): OutputItemRecord {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "输出 items 只允许对象条目", {
        item,
        itemIndex,
      }),
    );
  }

  const rawItem = item as unknown as Record<string, unknown>;
  const id = normalizeOptionalString(rawItem.id);
  const kind = normalizeOptionalString(rawItem.kind);
  const normalizedStatus = normalizeOptionalString(rawItem.status);
  const statusProvided = hasOwnField(rawItem, "status");

  if (!id) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "输出 item.id 不能为空", {
        item,
        itemIndex,
      }),
    );
  }

  if (!kind) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "输出 item.kind 不能为空", {
        item,
        itemIndex,
      }),
    );
  }

  if (statusProvided && !normalizedStatus) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "输出 item.status 不能为空", {
        item,
        itemIndex,
      }),
    );
  }

  const normalizedItem: OutputItemRecord = {
    id,
    kind,
    status: normalizedStatus ?? "declared",
  };

  const role = normalizeOptionalString(rawItem.role);
  const label = normalizeOptionalString(rawItem.label);
  const contentType = normalizeOptionalString(rawItem.contentType);
  const schema = normalizeOptionalString(rawItem.schema);
  const metadata = cloneOptional(item.metadata);
  const extensions = cloneOptional(item.extensions);

  if (role) {
    normalizedItem.role = role;
  }

  if (label) {
    normalizedItem.label = label;
  }

  if (contentType) {
    normalizedItem.contentType = contentType;
  }

  if (schema) {
    normalizedItem.schema = schema;
  }

  if (metadata !== undefined) {
    normalizedItem.metadata = metadata;
  }

  if (extensions !== undefined) {
    normalizedItem.extensions = extensions;
  }

  return normalizedItem;
}

export function normalizeOutputItems(
  items: LightTaskOutputItemInput[] | null | undefined,
): OutputItemRecord[] | undefined {
  if (items == null) {
    return undefined;
  }

  if (!Array.isArray(items)) {
    throwLightTaskError(
      createLightTaskError("VALIDATION_ERROR", "输出 items 必须是数组", {
        items,
      }),
    );
  }

  const seenIds = new Set<string>();
  const normalizedItems = items.map((item, itemIndex) => {
    const normalizedItem = normalizeOutputItem(item, itemIndex);

    if (seenIds.has(normalizedItem.id)) {
      throwLightTaskError(
        createLightTaskError("VALIDATION_ERROR", "输出 items 中存在重复 id", {
          itemId: normalizedItem.id,
          itemIndex,
        }),
      );
    }

    seenIds.add(normalizedItem.id);
    return normalizedItem;
  });

  return normalizedItems;
}

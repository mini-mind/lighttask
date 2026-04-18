export function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

export function cloneOptional<T>(value: T | undefined): T | undefined {
  if (value === undefined) {
    return undefined;
  }
  return cloneValue(value);
}

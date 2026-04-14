import type { CoreError } from "../data-structures";

export type RepositoryWriteResult<TKey extends string, TValue> =
  | ({ ok: true } & Record<TKey, TValue>)
  | {
      ok: false;
      error: CoreError;
    };

import type { CoreError } from "../models";

export type RepositoryWriteResult<TKey extends string, TValue> =
  | ({ ok: true } & Record<TKey, TValue>)
  | {
      ok: false;
      error: CoreError;
    };

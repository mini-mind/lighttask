import type { CoreError } from "../data-structures";

export type TaskRepositoryWriteResult<TTask> =
  | {
      ok: true;
      task: TTask;
    }
  | {
      ok: false;
      error: CoreError;
    };

export interface TaskRepository<TTask extends { id: string; revision: number }> {
  list(): TTask[];
  get(taskId: string): TTask | undefined;
  create(task: TTask): TaskRepositoryWriteResult<TTask>;
  saveIfRevisionMatches(task: TTask, expectedRevision: number): TaskRepositoryWriteResult<TTask>;
}

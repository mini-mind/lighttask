import type { RepositoryWriteResult } from "./port-repo-write-result";

export type TaskRepositoryWriteResult<TTask> = RepositoryWriteResult<"task", TTask>;

export interface TaskRepository<TTask extends { id: string; revision: number }> {
  list(): TTask[];
  get(taskId: string): TTask | undefined;
  create(task: TTask): TaskRepositoryWriteResult<TTask>;
  saveIfRevisionMatches(task: TTask, expectedRevision: number): TaskRepositoryWriteResult<TTask>;
}

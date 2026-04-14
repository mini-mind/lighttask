import type { RepositoryWriteResult } from "./port-repo-write-result";

export type TaskRepositoryWriteResult<TTask> = RepositoryWriteResult<"task", TTask>;

export interface TaskRepository<TTask extends { id: string; revision: number }> {
  /**
   * 返回任务快照集合；调用方修改返回值时，不得污染仓储内部状态。
   */
  list(): TTask[];
  /**
   * 返回单个任务快照；若存在记录，返回值必须与存储态隔离。
   */
  get(taskId: string): TTask | undefined;
  /**
   * 仓储不得原地修改调用方传入对象。
   * 常规失败应通过 ok:false 返回结构化错误；直接抛异常仅视为违约/防御路径。
   */
  create(task: TTask): TaskRepositoryWriteResult<TTask>;
  /**
   * 仓储不得原地修改调用方传入对象。
   * 常规失败应通过 ok:false 返回结构化错误；成功返回的任务也必须与存储态隔离。
   */
  saveIfRevisionMatches(task: TTask, expectedRevision: number): TaskRepositoryWriteResult<TTask>;
}

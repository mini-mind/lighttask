export interface ConsistencyPort {
  /**
   * 设计意图：让多聚合写入在同一一致性边界内执行。
   * 具体是否映射为数据库事务、乐观并发 session 或其他机制，由应用层适配器决定。
   */
  run<TResult>(scope: string, work: () => TResult): TResult;
}

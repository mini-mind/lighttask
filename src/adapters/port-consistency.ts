export interface ConsistencyPort {
  /**
   * 设计意图：让多聚合写入在同一一致性边界内执行。
   * 对共享存储适配器来说，同一 scope 至少要做到“串行化或事务化”其一，
   * 否则跨聚合写入只能算尽力而为。
   * 具体是否映射为数据库事务、乐观并发 session 或其他机制，由应用层适配器决定。
   */
  run<TResult>(scope: string, work: () => TResult): TResult;
}

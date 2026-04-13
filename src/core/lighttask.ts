import type {
  CreateTaskInput,
  LightTaskKernel,
  LightTaskTask,
  TaskStage
} from './types'

const DEFAULT_STAGES: ReadonlyArray<TaskStage> = [
  'investigate',
  'design',
  'implement',
  'verify',
  'converge'
]

/**
 * 这里先只实现通用编排模型，不混入应用层的 UI、平台适配和持久化策略。
 */
class InMemoryLightTask implements LightTaskKernel {
  private readonly tasks: LightTaskTask[] = []

  createTask(input: CreateTaskInput): LightTaskTask {
    const taskId = `task_${Date.now()}`
    const task: LightTaskTask = {
      id: taskId,
      title: input.title.trim(),
      summary: input.summary?.trim() || undefined,
      createdAt: new Date().toISOString(),
      steps: DEFAULT_STAGES.map((stage) => ({
        id: `${taskId}_${stage}`,
        title: this.getStageLabel(stage),
        stage,
        status: stage === 'investigate' ? 'doing' : 'todo'
      }))
    }

    this.tasks.push(task)
    return this.cloneTask(task)
  }

  listTasks(): LightTaskTask[] {
    return this.tasks.map((task) => this.cloneTask(task))
  }

  getTask(taskId: string): LightTaskTask | undefined {
    const task = this.tasks.find((item) => item.id === taskId)
    return task ? this.cloneTask(task) : undefined
  }

  advanceTask(taskId: string): LightTaskTask {
    const task = this.tasks.find((item) => item.id === taskId)
    if (!task) {
      throw new Error(`未找到任务: ${taskId}`)
    }

    const currentStepIndex = task.steps.findIndex((step) => step.status === 'doing')
    if (currentStepIndex === -1) {
      throw new Error(`任务没有可推进的进行中阶段: ${taskId}`)
    }

    task.steps[currentStepIndex].status = 'done'
    const nextStep = task.steps[currentStepIndex + 1]
    if (nextStep) {
      nextStep.status = 'doing'
    }

    return this.cloneTask(task)
  }

  private cloneTask(task: LightTaskTask): LightTaskTask {
    return {
      ...task,
      steps: task.steps.map((step) => ({ ...step }))
    }
  }

  /**
   * 阶段名保持中文，应用层接入时不必再重复做一层翻译。
   */
  private getStageLabel(stage: TaskStage): string {
    const labels: Record<TaskStage, string> = {
      investigate: '调查',
      design: '设计',
      implement: '实现',
      verify: '验证',
      converge: '收敛'
    }

    return labels[stage]
  }
}

export function createLightTask(): LightTaskKernel {
  return new InMemoryLightTask()
}

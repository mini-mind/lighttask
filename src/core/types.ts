export type TaskStage =
  | 'investigate'
  | 'design'
  | 'implement'
  | 'verify'
  | 'converge'

export type TaskStatus = 'todo' | 'doing' | 'done'

export interface LightTaskStep {
  id: string
  title: string
  stage: TaskStage
  status: TaskStatus
}

export interface LightTaskTask {
  id: string
  title: string
  summary?: string
  createdAt: string
  steps: LightTaskStep[]
}

export interface CreateTaskInput {
  title: string
  summary?: string
}

export interface LightTaskKernel {
  createTask(input: CreateTaskInput): LightTaskTask
  listTasks(): LightTaskTask[]
  getTask(taskId: string): LightTaskTask | undefined
  advanceTask(taskId: string): LightTaskTask
}

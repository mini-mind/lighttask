import test from 'node:test'
import assert from 'node:assert/strict'
import { createLightTask } from '../index'

test('LightTask 公共 API 支持创建和推进任务', () => {
  const lighttask = createLightTask()
  const task = lighttask.createTask({
    title: '验证编排主流程'
  })

  assert.equal(task.steps.length, 5)
  assert.equal(task.steps[0].status, 'doing')
  assert.equal(task.steps[1].status, 'todo')

  const advancedTask = lighttask.advanceTask(task.id)
  assert.equal(advancedTask.steps[0].status, 'done')
  assert.equal(advancedTask.steps[1].status, 'doing')
  assert.equal(lighttask.listTasks().length, 1)
})

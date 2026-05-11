import { createError, getRouterParam } from 'h3'
import { requireUser, isAdminUser } from '../../../utils/auth'
import {
  canReadImageGenerationJob,
  getImageGenerationJob,
  serializeImageGenerationJob,
} from '../../../utils/image-generation-queue'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = String(getRouterParam(event, 'id') || '').trim()
  if (!id) throw createError({ statusCode: 400, statusMessage: '任务 ID 无效' })

  const job = getImageGenerationJob(id)
  if (!job) throw createError({ statusCode: 404, statusMessage: '生成任务不存在或已过期' })
  if (!isAdminUser(user) && !canReadImageGenerationJob(user, job)) {
    throw createError({ statusCode: 403, statusMessage: '无权查看该生成任务' })
  }

  return serializeImageGenerationJob(job)
})

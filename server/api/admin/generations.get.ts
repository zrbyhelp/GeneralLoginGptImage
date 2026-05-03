import { getQuery } from 'h3'
import { requireAdmin } from '../../utils/auth'
import { filterAudits, readCompletedAudits } from '../../utils/audits'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const query = getQuery(event)
  const page = Math.max(1, Math.floor(Number(query.page || 1)) || 1)
  const pageSize = Math.min(100, Math.max(10, Math.floor(Number(query.pageSize || 20)) || 20))
  const filtered = filterAudits(await readCompletedAudits(), {
    q: typeof query.q === 'string' ? query.q : '',
    model: typeof query.model === 'string' ? query.model : '',
    from: typeof query.from === 'string' ? query.from : '',
    to: typeof query.to === 'string' ? query.to : '',
  })
  const start = (page - 1) * pageSize
  return {
    total: filtered.length,
    page,
    pageSize,
    items: filtered.slice(start, start + pageSize).map((audit) => ({
      ...audit,
      outputImages: audit.outputImages.map((image) => ({
        ...image,
        url: `/api/admin/generation-images/${image.id}`,
      })),
    })),
  }
})

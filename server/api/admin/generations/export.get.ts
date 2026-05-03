import { getQuery, setHeader } from 'h3'
import { requireAdmin } from '../../../utils/auth'
import { filterAudits, readAudits } from '../../../utils/audits'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const query = getQuery(event)
  const filtered = filterAudits(await readAudits(), {
    q: typeof query.q === 'string' ? query.q : '',
    status: typeof query.status === 'string' ? query.status : '',
    model: typeof query.model === 'string' ? query.model : '',
    from: typeof query.from === 'string' ? query.from : '',
    to: typeof query.to === 'string' ? query.to : '',
  })
  setHeader(event, 'Content-Type', 'application/json; charset=utf-8')
  setHeader(event, 'Content-Disposition', `attachment; filename="generation-audits-${Date.now()}.json"`)
  return JSON.stringify({ exportedAt: new Date().toISOString(), total: filtered.length, items: filtered }, null, 2)
})

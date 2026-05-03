import { getQuery, setHeader } from 'h3'
import { requireAdmin } from '../../../utils/auth'
import { buildAuditExportZip } from '../../../utils/audit-export'
import { filterAudits, readCompletedAudits } from '../../../utils/audits'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const query = getQuery(event)
  const filtered = filterAudits(await readCompletedAudits(), {
    q: typeof query.q === 'string' ? query.q : '',
    model: typeof query.model === 'string' ? query.model : '',
    from: typeof query.from === 'string' ? query.from : '',
    to: typeof query.to === 'string' ? query.to : '',
  })
  const zip = await buildAuditExportZip(filtered)
  setHeader(event, 'Content-Type', 'application/zip')
  setHeader(event, 'Content-Disposition', `attachment; filename="generation-audits-${Date.now()}.zip"`)
  setHeader(event, 'Content-Length', String(zip.byteLength))
  return zip
})

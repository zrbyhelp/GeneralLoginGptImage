import { requireUser } from '../../utils/auth'
import { countTotalGeneratedImages } from '../../utils/generation-usage'

export default defineEventHandler(async (event) => {
  await requireUser(event)

  return {
    totalGeneratedImages: countTotalGeneratedImages(),
  }
})

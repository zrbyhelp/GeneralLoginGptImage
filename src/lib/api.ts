import { getApiErrorMessage, type CallApiOptions, type CallApiResult } from './imageApiShared'

export type { CallApiOptions, CallApiResult } from './imageApiShared'
export { normalizeBaseUrl } from './devProxy'

export async function callImageApi(opts: CallApiOptions): Promise<CallApiResult> {
  const response = await fetch('/api/images/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
    body: JSON.stringify({
      prompt: opts.prompt,
      params: opts.params,
      inputImageDataUrls: opts.inputImageDataUrls,
      maskDataUrl: opts.maskDataUrl,
    }),
  })

  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response))
  }

  return response.json() as Promise<CallApiResult>
}

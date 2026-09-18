export interface SSEEvent {
  event: string
  data: string
}

/**
 * Parses a `text/event-stream` response body incrementally.
 * Used instead of `EventSource` because chat requests are POST with a JSON
 * body (conversation id, message, model), which EventSource cannot send.
 */
export async function* parseSSEStream(response: Response): AsyncGenerator<SSEEvent> {
  if (!response.body) return
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let boundary = buffer.indexOf('\n\n')
    while (boundary !== -1) {
      const rawEvent = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)

      let eventName = 'message'
      const dataLines: string[] = []
      for (const line of rawEvent.split('\n')) {
        if (line.startsWith('event:')) eventName = line.slice(6).trim()
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
      }
      if (dataLines.length) {
        yield { event: eventName, data: dataLines.join('\n') }
      }

      boundary = buffer.indexOf('\n\n')
    }
  }
}

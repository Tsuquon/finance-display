import { USAGE_SENTINEL_PREFIX } from './tokenUsage';

export async function readStream(
  response: Response,
  onChunk: (text: string) => void,
  onUsage?: (input: number, output: number, cacheRead: number) => void
): Promise<void> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      if (chunk.startsWith(USAGE_SENTINEL_PREFIX)) {
        if (onUsage) {
          try {
            const json = chunk.slice(USAGE_SENTINEL_PREFIX.length).replace(/\x1E$/, '');
            const { i = 0, o = 0, c = 0 } = JSON.parse(json);
            onUsage(i, o, c);
          } catch { /* malformed sentinel — ignore */ }
        }
      } else if (chunk) {
        onChunk(chunk);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

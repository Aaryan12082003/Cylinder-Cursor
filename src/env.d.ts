export {}

declare global {
  interface Window {
    cylinderflow?: {
      invoke(channel: string, payload?: unknown): Promise<{ ok: true; data: unknown } | { ok: false; error: string }>
      on(channel: string, callback: (data: unknown) => void): () => void
    }
  }
}

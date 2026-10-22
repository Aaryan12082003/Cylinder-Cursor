import { ZodError } from 'zod'
import type { Channel } from '@shared/channels'
import { isChannel } from '@shared/channels'
import { BusinessError } from './services/errors'

export type HandlerMap = Record<Channel, (payload: unknown) => Promise<unknown> | unknown>

export async function invokeHandler(handlers: HandlerMap, channel: string, payload: unknown) {
  if (!isChannel(channel)) return { ok: false as const, error: 'This action is not available.' }
  try {
    const data = await handlers[channel](payload)
    return { ok: true as const, data }
  } catch (error) {
    if (error instanceof ZodError) {
      return { ok: false as const, error: error.issues[0]?.message ?? 'Please check the form and try again.' }
    }
    if (error instanceof BusinessError) return { ok: false as const, error: error.message }
    console.error(error)
    return { ok: false as const, error: 'Something went wrong. Please try again.' }
  }
}

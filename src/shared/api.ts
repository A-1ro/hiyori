import { hc } from 'hono/client'
import type { AppType } from '../server/index'

export const createApi = (baseUrl = '') => hc<AppType>(baseUrl)
export type Api = ReturnType<typeof createApi>

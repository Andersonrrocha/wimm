import type { UseQueryResult } from '@tanstack/react-query'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../context/auth-context'
import { apiClient } from './api-client'
import { type ChatGptStatus, readChatGptStatus } from './chatgpt-connection-state'

/**
 * The React Query key for `GET /api/ai/chatgpt/status`.
 *
 * Exported because `ChatGptConnection` invalidates it after a connect or a
 * disconnect. One key, declared beside the one `queryFn` that fills it.
 */
export const CHATGPT_STATUS_QUERY_KEY = ['chatgpt-status']

/**
 * `GET /api/ai/chatgpt/status` as one React Query entry, shared by every
 * caller.
 *
 * Here in `renderer/lib`, beside `readChatGptStatus`, which it calls: it is
 * transport, not a component. Two readers need it -- the ChatGPT panel and
 * the Preferences tab, which wants the same `connected` flag to decide
 * whether the credential-source choice is real at all -- and one query key
 * reading one route is how both learn it. A second `useQuery` with its own
 * `queryFn` would be a second definition of the same server state, free to
 * disagree with this one.
 *
 * Disabled outside local mode: `ChatGptController` is registered by
 * `LocalOnlyAiModule`, so in hosted mode the route does not exist.
 */
export function useChatGptStatus(): UseQueryResult<ChatGptStatus> {
  const { mode } = useAuth()
  return useQuery({
    queryKey: CHATGPT_STATUS_QUERY_KEY,
    enabled: mode?.mode === 'local',
    queryFn: async () => {
      const { data } = await apiClient.get<unknown>('/ai/chatgpt/status')
      return readChatGptStatus(data)
    },
  })
}

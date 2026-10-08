import { useEffect, useMemo, useState } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { AiByokSource, AiCategorizationMode } from '@wimm/shared'
import { useAuth } from '../../context/auth-context'
import { apiClient } from '../../lib/api-client'
import {
  type ChatGptFailure,
  type ChatGptStatus,
  type ChatGptTone,
  describeChatGptState,
  readChatGptFailure,
  readChatGptStatus,
} from '../../lib/chatgpt-connection-state'
import { cn } from '../../lib/cn'
import { dateFnsLocaleForLang } from '../../lib/date-fns-locale'
import { formatDateTime } from '../../lib/dates'
import { Button } from '../ui/button'

const STATUS_QUERY_KEY = ['chatgpt-status']

const NO_CONNECTION: ChatGptStatus = readChatGptStatus(undefined)
const NO_FAILURE: ChatGptFailure = { failed: false, declined: false, errorCode: undefined }

/** Colours come from `theme.css` tokens only -- never a literal. */
const toneClass: Record<ChatGptTone, string> = {
  invite: 'text-fg-muted',
  info: 'text-info',
  error: 'text-negative',
}

/**
 * `GET /api/ai/chatgpt/status` as one React Query entry, shared by every
 * caller.
 *
 * Exported because the Preferences tab needs the same `connected` flag to
 * decide whether the credential-source choice is real at all, and one query
 * key reading one route is how both learn it. A second `useQuery` with its
 * own `queryFn` would be a second definition of the same server state, free
 * to disagree with this one.
 *
 * Disabled outside local mode: `ChatGptController` is registered by
 * `LocalOnlyAiModule`, so in hosted mode the route does not exist.
 */
export function useChatGptStatus(): UseQueryResult<ChatGptStatus> {
  const { mode } = useAuth()
  return useQuery({
    queryKey: STATUS_QUERY_KEY,
    enabled: mode?.mode === 'local',
    queryFn: async () => {
      const { data } = await apiClient.get<unknown>('/ai/chatgpt/status')
      return readChatGptStatus(data)
    },
  })
}

interface ChatGptConnectionProps {
  /**
   * The user's current `aiCategorizationMode`. Taken as a prop rather than
   * read from the auth context again, so this section and the mode selector
   * above it can never disagree about which mode is selected.
   */
  aiMode: AiCategorizationMode
  /**
   * `User.hasAiApiKey`. Same reasoning as `aiMode`: the credential-source
   * selector above decides whether to show itself from this very value, so
   * passing it down is what keeps the two from disagreeing about whether a
   * second source exists.
   */
  hasAnthropicKey: boolean
  /** `User.aiByokSource` -- the source chosen above, or `null`. */
  byokSource: AiByokSource | null
}

/**
 * The ChatGPT plan-usage connection, as one block inside the AI section of
 * the Preferences tab.
 *
 * **It sits beside the Anthropic key field, under the mode that means "my own
 * credential".** `BYOK` says *whose* credential, not *which vendor* (see
 * `AiProvider`), and there are two kinds: an Anthropic key, and a ChatGPT
 * plan. `ChatGptConnectFlow` sets `OFF` to `BYOK` on a successful connect
 * precisely because a ChatGPT connection *is* the user's own credential, so
 * showing only an `sk-ant-...` field under that mode told a user who had just
 * connected ChatGPT that something had broken.
 *
 * **Visible under any mode once a connection exists**, not only under `BYOK`.
 * That is the other half of the same contradiction: choosing `OFF` stops
 * every suggestion, and choosing `SERVER` hands them to the server's own
 * Anthropic key, so with ChatGPT connected either choice leaves a connection
 * that reads as connected and is not used. `describeChatGptState` has a
 * message for each, keyed on its `mode` input, and they would be unreachable
 * if this rendered only inside the `BYOK` branch, since `OFF` and `SERVER`
 * are each mutually exclusive with it.
 *
 * **It reports when the choice above leaves it idle.** Under `BYOK` with an
 * Anthropic key stored as well, `AiCategorizerSelector` either suggests
 * nothing at all (no source chosen) or routes to the key, and the connection
 * reads as connected through both. `describeChatGptState` has a message for
 * each, which is why `hasAnthropicKey` and `byokSource` are inputs here.
 *
 * **Local mode only.** `ChatGptController` is registered by
 * `LocalOnlyAiModule`, which only `app.local.module.ts` composes -- in hosted
 * mode these three routes do not exist, so there is nothing to show and
 * nothing to ask. Mirrors `ProfileSwitcher` / `ProfileBackupsSection`.
 *
 * **No credential reaches this component.** `readChatGptStatus` rebuilds the
 * payload from four named fields, so even a future API that grew a token
 * field could not deliver one into React state here.
 *
 * Every decision -- which message, which tone, whether a retry is worth
 * offering -- is `describeChatGptState`, which is unit-tested in
 * `renderer/lib`. This file renders that result and nothing else. It carries
 * no automated test of its own, as no renderer component in this repository
 * does today: `jest.config.js` reaches only `src/main` and
 * `src/renderer/lib`, with `testEnvironment: 'node'` and `**\/*.spec.ts`.
 */
export function ChatGptConnection({
  aiMode,
  hasAnthropicKey,
  byokSource,
}: ChatGptConnectionProps): JSX.Element | null {
  const { t, i18n } = useTranslation()
  const { mode, refreshUser } = useAuth()
  const qc = useQueryClient()
  const isLocal = mode?.mode === 'local'

  const [failure, setFailure] = useState<ChatGptFailure>(NO_FAILURE)
  const [online, setOnline] = useState(() => navigator.onLine)

  useEffect(() => {
    const update = (): void => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  const statusQuery = useChatGptStatus()

  // Both mutations refresh the user: `connect` moves `OFF` to `BYOK` and
  // `disconnect` moves `BYOK` back to `OFF` (while no Anthropic key remains),
  // and `aiMode` here comes from that same user record.
  const settle = async (): Promise<void> => {
    setFailure(NO_FAILURE)
    await qc.invalidateQueries({ queryKey: STATUS_QUERY_KEY })
    await refreshUser()
  }

  // `onMutate` clears the last failure: `settle()` runs only on a success or
  // a "Try again" click, so without this a second "Connect" left the previous
  // error on screen for the whole of the attempt -- including the stretch
  // where the system browser is open and the message is the only thing the
  // panel is saying.
  const connectMut = useMutation({
    mutationFn: async () => {
      await apiClient.post('/ai/chatgpt/connect')
    },
    onMutate: () => setFailure(NO_FAILURE),
    onSuccess: () => void settle(),
    onError: (error: unknown) => setFailure(readChatGptFailure(error)),
  })

  const disconnectMut = useMutation({
    mutationFn: async () => {
      await apiClient.post('/ai/chatgpt/disconnect')
    },
    onMutate: () => setFailure(NO_FAILURE),
    onSuccess: () => void settle(),
    onError: (error: unknown) => setFailure(readChatGptFailure(error)),
  })

  const status = statusQuery.data ?? NO_CONNECTION
  const dfLocale = useMemo(
    () => dateFnsLocaleForLang(i18n.language),
    [i18n.language],
  )

  const description = describeChatGptState({
    connected: status.connected,
    sharing: status.sharing,
    online,
    mode: aiMode,
    hasAnthropicKey,
    byokSource,
    declined: failure.declined,
    failed: failure.failed,
    errorCode: failure.errorCode,
  })

  if (!isLocal) return null
  // Under `BYOK` this is one of the two credential sources and always shows.
  // Under any other mode it shows only when there is a live connection to
  // say something about -- see the doc comment.
  if (aiMode !== 'BYOK' && !status.connected) return null

  const busy = connectMut.isPending || disconnectMut.isPending

  return (
    <div className="flex flex-col gap-3 rounded-sm border border-line bg-surface-2 p-3">
      <div>
        <p className="m-0 text-wm-sm font-medium normal-case tracking-normal text-fg">
          {t('ai.chatgpt.title')}
        </p>
        <p className="mt-1 text-wm-xs normal-case leading-relaxed tracking-normal text-fg-muted">
          {t('ai.chatgpt.subtitle')}
        </p>
      </div>

      {statusQuery.isLoading ? (
        <p className="m-0 text-wm-xs normal-case tracking-normal text-fg-muted">
          {t('ai.chatgpt.loading')}
        </p>
      ) : null}

      {statusQuery.isError ? (
        <p className="m-0 text-wm-xs normal-case tracking-normal text-negative">
          {t('ai.chatgpt.statusFailed')}
        </p>
      ) : null}

      {status.connected ? (
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-wm-xs normal-case tracking-normal">
          <dt className="text-fg-muted">{t('ai.chatgpt.accountLabel')}</dt>
          <dd className="m-0 text-fg">
            {status.accountLabel ?? t('ai.chatgpt.accountUnknown')}
          </dd>
          <dt className="text-fg-muted">{t('ai.chatgpt.expiresLabel')}</dt>
          <dd className="m-0 text-fg">
            {status.expiresAt === null
              ? t('ai.chatgpt.expiresUnknown')
              : formatDateTime(status.expiresAt, dfLocale)}
          </dd>
        </dl>
      ) : null}

      {/* Suppressed while the status call is failing: every input to
          `describeChatGptState` is then unknown, and "not connected" would be
          a claim about a connection nobody could read. */}
      {statusQuery.isError ? null : (
        <p
          className={cn(
            'm-0 text-wm-xs normal-case leading-relaxed tracking-normal',
            toneClass[description.tone],
          )}
        >
          {t(description.messageKey)}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {status.connected ? (
          <Button
            variant="danger"
            size="sm"
            onClick={() => disconnectMut.mutate()}
            disabled={busy}
          >
            {disconnectMut.isPending
              ? t('ai.chatgpt.disconnecting')
              : t('ai.chatgpt.disconnect')}
          </Button>
        ) : (
          <Button
            variant="primary"
            size="sm"
            onClick={() => connectMut.mutate()}
            disabled={busy}
          >
            {connectMut.isPending
              ? t('ai.chatgpt.connecting')
              : // `clearTokens` keeps the account label on purpose, so a
                // previously connected account can be offered back by name.
                status.accountLabel === null
                ? t('ai.chatgpt.connect')
                : t('ai.chatgpt.reconnect')}
          </Button>
        )}

        {/* `retryable` is the mapping's judgement about the connection and
            is right as it stands -- a failed connect could succeed on a
            second try. Whether that deserves a *second button* is this
            component's call, and with nothing connected it does not:
            "Connect" is the retry, while "Try again" would only clear the
            message and re-read a status that says not-connected. A failed
            status call is its own reason to offer the button regardless,
            since re-checking is exactly what it needs. */}
        {(description.retryable && status.connected) || statusQuery.isError ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void settle()}
            disabled={busy}
          >
            {t('ai.chatgpt.retry')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

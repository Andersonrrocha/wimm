import AsyncStorage from '@react-native-async-storage/async-storage'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Tiny `useState`-like hook backed by AsyncStorage. Use for non-sensitive
 * UI preferences (chart view mode, sort order). For tokens/secrets use
 * `secureTokenStore` instead.
 *
 * Returns the value with the synchronous default until storage hydrates,
 * then swaps in the persisted value (no flash on second mount because
 * AsyncStorage typically resolves within a frame).
 */
export function usePersistedPreference<T>(
  key: string,
  defaultValue: T,
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(defaultValue)
  const hydrated = useRef(false)

  useEffect(() => {
    let cancelled = false
    AsyncStorage.getItem(key)
      .then((raw) => {
        if (cancelled || raw == null) return
        try {
          setValue(JSON.parse(raw) as T)
        } catch {
          // Stored value is corrupt; keep default.
        }
      })
      .catch(() => {
        // Storage read failed; keep default.
      })
      .finally(() => {
        hydrated.current = true
      })
    return () => {
      cancelled = true
    }
  }, [key])

  const update = useCallback(
    (next: T) => {
      setValue(next)
      void AsyncStorage.setItem(key, JSON.stringify(next)).catch(() => {})
    },
    [key],
  )

  return [value, update]
}

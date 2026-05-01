/**
 * Replaces the desktop's `window.dispatchEvent('auth:logout')` channel.
 * The api-client emits when refresh fails so the AuthContext can flip
 * the session to unauthenticated without a circular import.
 */
type Listener = () => void

let listeners: Listener[] = []

export const authEvents = {
  onLogout(fn: Listener): () => void {
    listeners.push(fn)
    return () => {
      listeners = listeners.filter((l) => l !== fn)
    }
  },
  emitLogout(): void {
    listeners.forEach((l) => l())
  },
}

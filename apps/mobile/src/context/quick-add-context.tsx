import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react'
import {
  QuickAddModal,
  type QuickAddTab,
} from '../components/quick-add/quick-add-modal'

interface QuickAddContextValue {
  open: (tab?: QuickAddTab) => void
}

const QuickAddContext = createContext<QuickAddContextValue | null>(null)

/**
 * Hosts the global QuickAdd modal so any screen can open it via
 * `useQuickAdd().open('transaction' | 'category' | 'source')`.
 * Mounted above NavigationContainer so the modal sits over the whole app.
 */
export function QuickAddProvider({
  children,
}: {
  children: ReactNode
}): JSX.Element {
  const [visible, setVisible] = useState(false)
  const [initialTab, setInitialTab] = useState<QuickAddTab>('transaction')

  const open = useCallback((tab: QuickAddTab = 'transaction') => {
    setInitialTab(tab)
    setVisible(true)
  }, [])

  return (
    <QuickAddContext.Provider value={{ open }}>
      {children}
      <QuickAddModal
        visible={visible}
        onClose={() => setVisible(false)}
        initialTab={initialTab}
      />
    </QuickAddContext.Provider>
  )
}

export function useQuickAdd(): QuickAddContextValue {
  const ctx = useContext(QuickAddContext)
  if (!ctx) throw new Error('useQuickAdd must be used within QuickAddProvider')
  return ctx
}

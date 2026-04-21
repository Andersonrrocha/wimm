import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from 'react'

interface TabsContextValue {
  value: string
  setValue: (v: string) => void
}

const TabsContext = createContext<TabsContextValue | undefined>(undefined)

interface TabsProps {
  defaultValue: string
  value?: string
  onValueChange?: (value: string) => void
  children: ReactNode
}

/**
 * Accessible tabs (compound component). Controlled or uncontrolled.
 * Subcomponents: `Tabs.List` wraps the strip, `Tabs.Trigger` is a button,
 * and `Tabs.Panel` renders only when its value matches.
 */
export function Tabs({
  defaultValue,
  value,
  onValueChange,
  children,
}: TabsProps): JSX.Element {
  const [internal, setInternal] = useState(defaultValue)
  const active = value ?? internal
  const setValue = (v: string): void => {
    if (value === undefined) setInternal(v)
    onValueChange?.(v)
  }

  return (
    <TabsContext.Provider value={{ value: active, setValue }}>
      {children}
    </TabsContext.Provider>
  )
}

function useTabs(): TabsContextValue {
  const ctx = useContext(TabsContext)
  if (!ctx) throw new Error('Tabs.* must be used within a <Tabs> root')
  return ctx
}

interface TabListProps {
  children: ReactNode
  ariaLabel?: string
}

Tabs.List = function TabList({ children, ariaLabel }: TabListProps): JSX.Element {
  return (
    <div role="tablist" aria-label={ariaLabel} className="wm-tabs">
      {children}
    </div>
  )
}

interface TabTriggerProps {
  value: string
  children: ReactNode
}

Tabs.Trigger = function TabTrigger({
  value,
  children,
}: TabTriggerProps): JSX.Element {
  const { value: active, setValue } = useTabs()
  const selected = active === value
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      className="wm-tab"
      onClick={() => setValue(value)}
    >
      {children}
    </button>
  )
}

interface TabPanelProps {
  value: string
  children: ReactNode
}

Tabs.Panel = function TabPanel({
  value,
  children,
}: TabPanelProps): JSX.Element | null {
  const { value: active } = useTabs()
  if (active !== value) return null
  return (
    <div role="tabpanel" style={{ paddingTop: 16 }}>
      {children}
    </div>
  )
}

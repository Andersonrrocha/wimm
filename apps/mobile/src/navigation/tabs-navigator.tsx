import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import {
  ArrowLeftRight,
  Home,
  Repeat,
  Settings,
  Upload,
} from 'lucide-react-native'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'
import {
  QuickAddModal,
  type QuickAddTab,
} from '../components/quick-add/quick-add-modal'
import { Fab } from '../components/ui/fab'
import { HomeScreen } from '../screens/home-screen'
import { ImportsScreen } from '../screens/imports-screen'
import { RecurrencesScreen } from '../screens/recurrences-screen'
import { TransactionsScreen } from '../screens/transactions-screen'
import { SettingsNavigator } from './settings-navigator'
import { colors, fontSize } from '../theme/tokens'

export type TabsParamList = {
  Home: undefined
  Transactions: undefined
  Imports: undefined
  Recurrences: undefined
  Settings: undefined
}

const Tab = createBottomTabNavigator<TabsParamList>()

const ICON_SIZE = 22

export function TabsNavigator(): JSX.Element {
  const { t } = useTranslation()
  const [quickAddOpen, setQuickAddOpen] = useState(false)
  const [initialTab, setInitialTab] = useState<QuickAddTab>('transaction')

  const openQuickAdd = (tab: QuickAddTab = 'transaction'): void => {
    setInitialTab(tab)
    setQuickAddOpen(true)
  }

  return (
    <View style={styles.container}>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            backgroundColor: colors.bgRaised,
            borderTopColor: colors.lineSoft,
            borderTopWidth: 1,
          },
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: colors.fgMuted,
          tabBarLabelStyle: {
            fontSize: 10,
            fontWeight: '500',
          },
        }}
      >
        <Tab.Screen
          name="Home"
          component={HomeScreen}
          options={{
            title: t('nav.home'),
            tabBarIcon: ({ color }) => <Home color={color} size={ICON_SIZE} />,
          }}
        />
        <Tab.Screen
          name="Transactions"
          component={TransactionsScreen}
          options={{
            title: t('nav.transactions'),
            tabBarIcon: ({ color }) => (
              <ArrowLeftRight color={color} size={ICON_SIZE} />
            ),
          }}
        />
        <Tab.Screen
          name="Imports"
          component={ImportsScreen}
          options={{
            title: t('nav.imports'),
            tabBarIcon: ({ color }) => (
              <Upload color={color} size={ICON_SIZE} />
            ),
          }}
        />
        <Tab.Screen
          name="Recurrences"
          component={RecurrencesScreen}
          options={{
            title: t('nav.recurrences'),
            tabBarIcon: ({ color }) => (
              <Repeat color={color} size={ICON_SIZE} />
            ),
          }}
        />
        <Tab.Screen
          name="Settings"
          component={SettingsNavigator}
          options={{
            title: t('nav.settings'),
            tabBarIcon: ({ color }) => (
              <Settings color={color} size={ICON_SIZE} />
            ),
          }}
        />
      </Tab.Navigator>

      <Fab
        onPress={() => openQuickAdd('transaction')}
        ariaLabel={t('layout.add')}
      />

      <QuickAddModal
        visible={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
        initialTab={initialTab}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
})

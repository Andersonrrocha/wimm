import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
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
import { colors, fontSize, tracking } from '../theme/tokens'

export type TabsParamList = {
  Home: undefined
  Transactions: undefined
  Imports: undefined
  Recurrences: undefined
  Settings: undefined
}

const Tab = createBottomTabNavigator<TabsParamList>()

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
            fontSize: fontSize.xs,
            fontWeight: '500',
            letterSpacing: tracking.label,
            textTransform: 'uppercase',
          },
        }}
      >
        <Tab.Screen
          name="Home"
          component={HomeScreen}
          options={{ title: t('nav.home') }}
        />
        <Tab.Screen
          name="Transactions"
          component={TransactionsScreen}
          options={{ title: t('nav.transactions') }}
        />
        <Tab.Screen
          name="Imports"
          component={ImportsScreen}
          options={{ title: t('nav.imports') }}
        />
        <Tab.Screen
          name="Recurrences"
          component={RecurrencesScreen}
          options={{ title: t('nav.recurrences') }}
        />
        <Tab.Screen
          name="Settings"
          component={SettingsNavigator}
          options={{ title: t('nav.settings') }}
        />
      </Tab.Navigator>

      <Fab onPress={() => openQuickAdd('transaction')} ariaLabel={t('layout.add')} />

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

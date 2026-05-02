import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from '@react-navigation/native-stack'
import { useTranslation } from 'react-i18next'
import { CategoriesScreen } from '../screens/settings/categories-screen'
import { PreferencesScreen } from '../screens/settings/preferences-screen'
import { RulesScreen } from '../screens/settings/rules-screen'
import { SettingsHomeScreen } from '../screens/settings/settings-home-screen'
import { SourcesScreen } from '../screens/settings/sources-screen'
import { colors } from '../theme/tokens'

export type SettingsStackParamList = {
  SettingsHome: undefined
  Categories: undefined
  Sources: undefined
  Rules: undefined
  Preferences: undefined
}

export type SettingsStackScreenProps<T extends keyof SettingsStackParamList> =
  NativeStackScreenProps<SettingsStackParamList, T>

const Stack = createNativeStackNavigator<SettingsStackParamList>()

export function SettingsNavigator(): JSX.Element {
  const { t } = useTranslation()
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTitleStyle: { color: colors.fg, fontWeight: '600' },
        headerTintColor: colors.accent,
      }}
    >
      <Stack.Screen
        name="SettingsHome"
        component={SettingsHomeScreen}
        options={{ headerShown: false, title: t('nav.settings') }}
      />
      <Stack.Screen
        name="Categories"
        component={CategoriesScreen}
        options={{ title: t('settings.tabCategories') }}
      />
      <Stack.Screen
        name="Sources"
        component={SourcesScreen}
        options={{ title: t('settings.tabSources') }}
      />
      <Stack.Screen
        name="Rules"
        component={RulesScreen}
        options={{ title: t('settings.tabRules') }}
      />
      <Stack.Screen
        name="Preferences"
        component={PreferencesScreen}
        options={{ title: t('settings.tabPreferences') }}
      />
    </Stack.Navigator>
  )
}

import './i18n/config'
import { NavigationContainer } from '@react-navigation/native'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { RootNavigator } from './navigation/root-navigator'
import { navTheme } from './navigation/nav-theme'

export function App(): JSX.Element {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <NavigationContainer theme={navTheme}>
        <RootNavigator />
      </NavigationContainer>
    </SafeAreaProvider>
  )
}

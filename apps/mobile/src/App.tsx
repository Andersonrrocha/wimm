import './i18n/config'
import { NavigationContainer } from '@react-navigation/native'
import { QueryClientProvider } from '@tanstack/react-query'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { AuthProvider } from './context/auth-context'
import { QuickAddProvider } from './context/quick-add-context'
import { queryClient } from './lib/query-client'
import { RootNavigator } from './navigation/root-navigator'
import { navTheme } from './navigation/nav-theme'

export function App(): JSX.Element {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <QuickAddProvider>
              <NavigationContainer theme={navTheme}>
                <RootNavigator />
              </NavigationContainer>
            </QuickAddProvider>
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

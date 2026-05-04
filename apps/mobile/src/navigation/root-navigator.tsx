import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from '@react-navigation/native-stack'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { useAuth } from '../context/auth-context'
import { OnboardingScreen } from '../screens/onboarding-screen'
import { colors } from '../theme/tokens'
import { AuthNavigator } from './auth-navigator'
import { TabsNavigator } from './tabs-navigator'

export type RootStackParamList = {
  App: undefined
  Auth: undefined
  Onboarding: undefined
}

export type RootStackScreenProps<T extends keyof RootStackParamList> =
  NativeStackScreenProps<RootStackParamList, T>

const Stack = createNativeStackNavigator<RootStackParamList>()

export function RootNavigator(): JSX.Element {
  const { state } = useAuth()

  if (state.status === 'loading') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} />
      </View>
    )
  }

  // First-run gate: authenticated users without an onboardedAt go through
  // the onboarding stack before reaching the tabs.
  return (
    <Stack.Navigator
      screenOptions={{ headerShown: false, animation: 'fade' }}
    >
      {state.status === 'authenticated' ? (
        state.user.onboardedAt === null ? (
          <Stack.Screen name="Onboarding" component={OnboardingScreen} />
        ) : (
          <Stack.Screen name="App" component={TabsNavigator} />
        )
      ) : (
        <Stack.Screen name="Auth" component={AuthNavigator} />
      )}
    </Stack.Navigator>
  )
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
})

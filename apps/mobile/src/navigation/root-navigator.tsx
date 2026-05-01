import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { TabsNavigator } from './tabs-navigator'

/**
 * Root stack. M3 will introduce an `Auth` group with login/register and
 * gate access to `App` based on session state. Until then the stack only
 * exposes the tabs.
 */
export type RootStackParamList = {
  App: undefined
}

const Stack = createNativeStackNavigator<RootStackParamList>()

export function RootNavigator(): JSX.Element {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="App" component={TabsNavigator} />
    </Stack.Navigator>
  )
}

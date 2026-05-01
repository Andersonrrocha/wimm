import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from '@react-navigation/native-stack'
import { LoginScreen } from '../screens/login-screen'
import { RegisterScreen } from '../screens/register-screen'

export type AuthStackParamList = {
  Login: undefined
  Register: undefined
}

export type AuthStackScreenProps<T extends keyof AuthStackParamList> =
  NativeStackScreenProps<AuthStackParamList, T>

const Stack = createNativeStackNavigator<AuthStackParamList>()

export function AuthNavigator(): JSX.Element {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Register" component={RegisterScreen} />
    </Stack.Navigator>
  )
}

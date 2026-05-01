import { StatusBar } from 'expo-status-bar'
import { StyleSheet, Text, View } from 'react-native'
import type { SourceType } from '@wimm/shared'

const SOURCE_TYPES: SourceType[] = [
  'BANK_ACCOUNT',
  'CREDIT_CARD',
  'CASH',
  'MANUAL',
]

export function App(): JSX.Element {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'unset'

  return (
    <View style={styles.container}>
      <Text style={styles.title}>WIMM</Text>
      <Text style={styles.subtitle}>Where is my money?</Text>
      <View style={styles.divider} />
      <Text style={styles.label}>Workspace</Text>
      <Text style={styles.value}>
        @wimm/shared OK · {SOURCE_TYPES.length} source types
      </Text>
      <Text style={styles.label}>API</Text>
      <Text style={styles.value}>{apiUrl}</Text>
      <StatusBar style="light" />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0c',
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 4,
  },
  title: {
    color: '#ececf0',
    fontSize: 32,
    fontWeight: '600',
    letterSpacing: -0.5,
  },
  subtitle: {
    color: '#8a8a95',
    fontSize: 16,
    marginTop: 4,
  },
  divider: {
    height: 1,
    width: 40,
    backgroundColor: '#ff6a3d',
    marginVertical: 24,
  },
  label: {
    color: '#5a5a63',
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 12,
  },
  value: {
    color: '#5ccf9a',
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
})

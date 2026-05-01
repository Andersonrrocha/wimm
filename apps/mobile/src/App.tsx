import { StatusBar } from 'expo-status-bar'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { Button } from './components/ui/button'
import { Chip } from './components/ui/chip'
import { EmptyState } from './components/ui/empty-state'
import { Field } from './components/ui/field'
import { Input } from './components/ui/input'
import { PageHeader } from './components/ui/page-header'
import { Panel } from './components/ui/panel'
import { colors, fontSize, spacing, tracking } from './theme/tokens'

export function App(): JSX.Element {
  return (
    <View style={styles.app}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.container}>
        <PageHeader
          eyebrow="M1 · Showcase"
          title="WIMM"
          subtitle="UI primitives — financial terminal direction"
          trailing={<Chip label="dev" tone="accent" />}
        />

        <Section title="Buttons">
          <Panel>
            <View style={styles.row}>
              <Button label="Primary" variant="primary" />
              <Button label="Ghost" variant="ghost" />
            </View>
            <View style={[styles.row, styles.rowSpaced]}>
              <Button label="Subtle" variant="subtle" />
              <Button label="Danger" variant="danger" />
            </View>
            <View style={[styles.row, styles.rowSpaced]}>
              <Button label="Small" variant="primary" size="sm" />
              <Button label="Loading" variant="ghost" loading />
              <Button label="Disabled" variant="ghost" disabled />
            </View>
          </Panel>
        </Section>

        <Section title="Form">
          <Panel>
            <Field label="Amount" hint="In your account currency">
              <Input placeholder="0,00" keyboardType="decimal-pad" />
            </Field>
            <View style={styles.spacer} />
            <Field label="Description" error="Description is required">
              <Input placeholder="Coffee at Starbucks" invalid />
            </Field>
          </Panel>
        </Section>

        <Section title="Chips">
          <Panel>
            <View style={styles.chipRow}>
              <Chip label="neutral" tone="neutral" />
              <Chip label="positive" tone="positive" />
              <Chip label="negative" tone="negative" />
              <Chip label="info" tone="info" />
              <Chip label="warning" tone="warning" />
              <Chip label="accent" tone="accent" />
            </View>
          </Panel>
        </Section>

        <Section title="Empty state">
          <Panel>
            <EmptyState
              title="No transactions yet"
              subtitle="Import a statement or add one manually to start tracking."
              action={<Button label="Add transaction" variant="primary" />}
            />
          </Panel>
        </Section>
      </ScrollView>
    </View>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{title}</Text>
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  app: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  container: {
    paddingHorizontal: spacing.lg,
    paddingTop: 72,
    paddingBottom: spacing.xxl,
  },
  section: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  sectionLabel: {
    color: colors.fgMuted,
    fontSize: fontSize.xs,
    textTransform: 'uppercase',
    letterSpacing: tracking.label,
    fontWeight: '500',
    marginBottom: 2,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  rowSpaced: {
    marginTop: 8,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  spacer: {
    height: spacing.md,
  },
})

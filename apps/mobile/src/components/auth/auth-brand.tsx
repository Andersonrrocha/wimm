import { useTranslation } from 'react-i18next'
import { Image, StyleSheet, View } from 'react-native'
import { spacing } from '../../theme/tokens'

const wimmLogoIcon = require('../../../assets/images/wimm-logo-icon.png')
const wimmLogoLabel = require('../../../assets/images/wimm-logo-label.png')

interface AuthBrandProps {
  size?: 'md' | 'sm'
}

export function AuthBrand({ size = 'md' }: AuthBrandProps): JSX.Element {
  const { t } = useTranslation()
  const dims = size === 'sm' ? SMALL : LARGE
  return (
    <View style={[styles.container, { gap: dims.gap }]}>
      <Image
        source={wimmLogoIcon}
        style={{ width: dims.iconW, height: dims.iconH }}
        resizeMode="contain"
        accessible={false}
      />
      <Image
        source={wimmLogoLabel}
        style={{ width: dims.labelW, height: dims.labelH }}
        resizeMode="contain"
        accessibilityLabel={t('auth.brandAlt')}
      />
    </View>
  )
}

// Aspect ratios from source PNGs:
//   icon-only  337×225  →  1.498
//   label      596×203  →  2.936

const LARGE = {
  iconW: 72,
  iconH: 48,
  labelW: 153,
  labelH: 52,
  gap: 10,
}

const SMALL = {
  iconW: 48,
  iconH: 32,
  labelW: 106,
  labelH: 36,
  gap: 6,
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
})

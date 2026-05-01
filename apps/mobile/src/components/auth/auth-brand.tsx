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
  iconW: 93,
  iconH: 62,
  labelW: 200,
  labelH: 68,
  gap: 12,
}

const SMALL = {
  iconW: 78,
  iconH: 52,
  labelW: 170,
  labelH: 58,
  gap: 10,
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
})

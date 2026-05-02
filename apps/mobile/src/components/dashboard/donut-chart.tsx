import { useEffect, useRef, type ReactNode } from 'react'
import { Animated, Easing, StyleSheet, View } from 'react-native'
import Svg, { Circle, G } from 'react-native-svg'

const AnimatedCircle = Animated.createAnimatedComponent(Circle)

export interface DonutSlice {
  id: string
  value: number
  color: string
}

interface DonutChartProps {
  slices: DonutSlice[]
  /** Outer diameter of the ring. */
  size: number
  /** Ring thickness — drawn as SVG stroke. */
  strokeWidth: number
  /** Sweep duration in ms. */
  duration?: number
  /** Absolute-positioned content rendered inside the donut hole. */
  centerComponent?: ReactNode
}

/**
 * Custom SVG donut. Each slice is an SVG Circle with `strokeDasharray`
 * limiting the visible arc; `strokeDashoffset` animates from full
 * (invisible) to 0 (drawn) so each slice sweeps in clockwise.
 *
 * Rotated -90° so the first slice starts at 12 o'clock. Stroke animations
 * can't use the native driver, but a single 600ms tween is cheap.
 */
export function DonutChart({
  slices,
  size,
  strokeWidth,
  duration = 600,
  centerComponent,
}: DonutChartProps): JSX.Element {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const total = slices.reduce((s, x) => s + x.value, 0) || 1

  const progress = useRef(new Animated.Value(0)).current

  useEffect(() => {
    progress.setValue(0)
    Animated.timing(progress, {
      toValue: 1,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start()
  }, [progress, duration, slices])

  let cumValue = 0

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        <G rotation={-90} originX={size / 2} originY={size / 2}>
          {slices.map((s) => {
            const arcLength = (s.value / total) * circumference
            const startAngle = (cumValue / total) * 360
            cumValue += s.value
            const dashoffset = progress.interpolate({
              inputRange: [0, 1],
              outputRange: [arcLength, 0],
            })
            return (
              <G
                key={s.id}
                rotation={startAngle}
                originX={size / 2}
                originY={size / 2}
              >
                <AnimatedCircle
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  stroke={s.color}
                  strokeWidth={strokeWidth}
                  fill="none"
                  strokeDasharray={`${arcLength}, ${circumference}`}
                  strokeDashoffset={dashoffset}
                />
              </G>
            )
          })}
        </G>
      </Svg>
      {centerComponent ? (
        <View style={styles.center} pointerEvents="none">
          {centerComponent}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
})

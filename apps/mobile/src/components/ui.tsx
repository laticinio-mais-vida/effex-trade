import { Image } from 'expo-image'
import { useEffect, useState, type ReactNode } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type ViewStyle,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { resolveUrl } from '@/lib/config'
import { colors, radius, space } from '@/lib/theme'

export function Screen({
  children,
  refreshing,
  onRefresh,
  padded = true,
  footer,
}: {
  children: ReactNode
  refreshing?: boolean
  onRefresh?: () => void
  padded?: boolean
  footer?: ReactNode
}) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[padded && { padding: space.lg, gap: space.md }, { paddingBottom: 40 }]}
        refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} colors={[colors.primary]} /> : undefined}
      >
        {children}
      </ScrollView>
      {footer}
    </View>
  )
}

export function Card({ children, style, onPress }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }, style]}>
        {children}
      </Pressable>
    )
  }
  return <View style={[styles.card, style]}>{children}</View>
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success'

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading,
  disabled,
  small,
  style,
}: {
  title: string
  onPress: () => void
  variant?: ButtonVariant
  loading?: boolean
  disabled?: boolean
  small?: boolean
  style?: StyleProp<ViewStyle>
}) {
  const palette: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
    primary: { bg: colors.primary, fg: '#fff', border: colors.primary },
    success: { bg: colors.success, fg: '#fff', border: colors.success },
    danger: { bg: colors.danger, fg: '#fff', border: colors.danger },
    secondary: { bg: colors.surface, fg: colors.primary, border: colors.primary },
    ghost: { bg: 'transparent', fg: colors.primary, border: 'transparent' },
  }
  const p = palette[variant]
  const off = disabled || loading
  return (
    <Pressable
      accessibilityRole="button"
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        { backgroundColor: p.bg, borderColor: p.border },
        off && { opacity: 0.5 },
        pressed && !off && { opacity: 0.8 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={p.fg} /> : <Text style={[styles.buttonText, small && { fontSize: 14 }, { color: p.fg }]}>{title}</Text>}
    </Pressable>
  )
}

export function Badge({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  )
}

export function Field({ label, hint, error, ...props }: TextInputProps & { label?: string; hint?: string; error?: string | null }) {
  return (
    <View style={{ gap: 4 }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.faint}
        {...props}
        style={[styles.input, props.multiline && { minHeight: 90, textAlignVertical: 'top' }, error ? { borderColor: colors.danger } : null, props.style]}
      />
      {error ? <Text style={styles.errorSmall}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  )
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={styles.segmented}>
      {options.map((o) => (
        <Pressable key={o.value} onPress={() => onChange(o.value)} style={[styles.segment, value === o.value && styles.segmentActive]}>
          <Text style={[styles.segmentText, value === o.value && styles.segmentTextActive]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  )
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.sm }}>
      <Text style={styles.sectionTitle}>{children}</Text>
      {right}
    </View>
  )
}

export function Muted({ children, style, ...props }: TextProps & { children: ReactNode }) {
  return (
    <Text {...props} style={[styles.muted, style]}>
      {children}
    </Text>
  )
}

export function LoadingView({ text }: { text?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={colors.primary} />
      {text ? <Text style={[styles.muted, { marginTop: space.md }]}>{text}</Text> : null}
    </View>
  )
}

export function ErrorView({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.center}>
      <Text style={[styles.sectionTitle, { textAlign: 'center' }]}>Não foi possível carregar</Text>
      <Text style={[styles.muted, { textAlign: 'center', marginVertical: space.md }]}>{message}</Text>
      {onRetry ? <Button title="Tentar de novo" onPress={onRetry} variant="secondary" /> : null}
    </View>
  )
}

export function Banner({ text, tone = 'info' }: { text: string; tone?: 'info' | 'warning' | 'danger' | 'success' }) {
  const map = {
    info: [colors.info, colors.infoSoft],
    warning: [colors.warning, colors.warningSoft],
    danger: [colors.danger, colors.dangerSoft],
    success: [colors.success, colors.successSoft],
  } as const
  const [fg, bg] = map[tone]
  return (
    <View style={[styles.banner, { backgroundColor: bg, borderLeftColor: fg }]}>
      <Text style={{ color: colors.text, fontSize: 14, lineHeight: 20 }}>{text}</Text>
    </View>
  )
}

export function EmptyState({ title, text }: { title: string; text?: string }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 40, paddingHorizontal: space.lg }}>
      <Text style={[styles.sectionTitle, { textAlign: 'center' }]}>{title}</Text>
      {text ? <Text style={[styles.muted, { textAlign: 'center', marginTop: space.sm }]}>{text}</Text> : null}
    </View>
  )
}

export function PhotoThumb({ url, size = 96, label, onPress }: { url: string; size?: number; label?: string; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ width: size }}>
      <Image source={{ uri: resolveUrl(url) }} style={{ width: size, height: size, borderRadius: radius.sm, backgroundColor: colors.neutralSoft }} contentFit="cover" transition={150} />
      {label ? (
        <Text numberOfLines={1} style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
          {label}
        </Text>
      ) : null}
    </Pressable>
  )
}

/** Folha inferior simples (modal) com título. */
export function Sheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetBackdrop}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.md }}>
            <Text style={styles.sectionTitle}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={{ color: colors.primary, fontWeight: '600', fontSize: 15 }}>Fechar</Text>
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 520 }} contentContainerStyle={{ gap: space.md }}>
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

/** Lista de opções em folha inferior. */
export function PickerSheet<T extends string>({
  visible,
  title,
  options,
  value,
  onSelect,
  onClose,
}: {
  visible: boolean
  title: string
  options: { value: T; label: string; detail?: string }[]
  value?: T | null
  onSelect: (value: T) => void
  onClose: () => void
}) {
  return (
    <Sheet visible={visible} title={title} onClose={onClose}>
      {options.map((o) => (
        <Pressable
          key={o.value}
          onPress={() => {
            onSelect(o.value)
            onClose()
          }}
          style={[styles.option, value === o.value && styles.optionActive]}
        >
          <Text style={[styles.optionText, value === o.value && { color: colors.primary }]}>{o.label}</Text>
          {o.detail ? <Text style={styles.muted}>{o.detail}</Text> : null}
        </Pressable>
      ))}
    </Sheet>
  )
}

/** Folha com campo de texto (justificativas, observações). */
export function PromptSheet({
  visible,
  title,
  message,
  placeholder,
  minLength = 0,
  confirmLabel = 'Confirmar',
  confirmVariant = 'primary',
  onConfirm,
  onClose,
}: {
  visible: boolean
  title: string
  message?: string
  placeholder?: string
  minLength?: number
  confirmLabel?: string
  confirmVariant?: ButtonVariant
  onConfirm: (text: string) => Promise<void> | void
  onClose: () => void
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (visible) setText('')
  }, [visible])
  const ok = text.trim().length >= minLength
  return (
    <Sheet visible={visible} title={title} onClose={onClose}>
      {message ? <Text style={{ color: colors.text, fontSize: 15 }}>{message}</Text> : null}
      <Field
        value={text}
        onChangeText={setText}
        placeholder={placeholder}
        multiline
        hint={minLength > 0 ? `${text.trim().length}/${minLength} caracteres no mínimo` : 'Opcional'}
      />
      <Button
        title={confirmLabel}
        variant={confirmVariant}
        disabled={!ok}
        loading={busy}
        onPress={async () => {
          setBusy(true)
          try {
            await onConfirm(text.trim())
          } finally {
            setBusy(false)
          }
        }}
      />
    </Sheet>
  )
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }, style]}>{children}</View>
}

export const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: space.sm,
  },
  button: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
  },
  buttonSmall: { minHeight: 40, paddingHorizontal: space.md },
  buttonText: { fontSize: 16, fontWeight: '700' },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, alignSelf: 'flex-start' },
  badgeText: { fontSize: 12, fontWeight: '700' },
  label: { fontSize: 14, fontWeight: '600', color: colors.text },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
  },
  hint: { fontSize: 12, color: colors.muted },
  errorSmall: { fontSize: 12, color: colors.danger },
  segmented: { flexDirection: 'row', backgroundColor: colors.neutralSoft, borderRadius: radius.md, padding: 3 },
  segment: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: radius.sm },
  segmentActive: { backgroundColor: colors.surface, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 3, elevation: 1 },
  segmentText: { fontSize: 14, color: colors.muted, fontWeight: '600' },
  segmentTextActive: { color: colors.text },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
  title: { fontSize: 20, fontWeight: '800', color: colors.text },
  muted: { fontSize: 14, color: colors.muted },
  text: { fontSize: 15, color: colors.text },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, backgroundColor: colors.bg },
  banner: { borderLeftWidth: 4, borderRadius: radius.sm, padding: space.md },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 32, 0.45)' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: space.lg },
  option: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: space.md, gap: 2 },
  optionActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  optionText: { fontSize: 16, color: colors.text, fontWeight: '600' },
})

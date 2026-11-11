import Ionicons from '@expo/vector-icons/Ionicons'
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
import { borders, colors, elevated, radius, sizes, space, tabular, tones, type, type Tone } from '@/lib/theme'

// Componentes da base comum (briefing, seção 6). As telas montam com eles; cor, fonte e medida vêm de @/lib/theme.

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
    <View style={{ flex: 1, backgroundColor: colors.fundo }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[padded && { padding: space.lg, gap: space.sm }, { paddingBottom: space.xxl + space.sm }]}
        refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} colors={[colors.marinho]} /> : undefined}
      >
        {children}
      </ScrollView>
      {footer}
    </View>
  )
}

/** Destaque do cartão: o próximo cliente (borda marinho) ou o atendimento aberto (borda azul). */
export type CardVariant = 'normal' | 'proximo' | 'emAtendimento'

/** Cartão: branco, borda fina, sem sombra. */
export function Card({
  children,
  style,
  onPress,
  variant = 'normal',
}: {
  children: ReactNode
  style?: StyleProp<ViewStyle>
  onPress?: () => void
  variant?: CardVariant
}) {
  const highlight = variant === 'proximo' ? styles.cardProximo : variant === 'emAtendimento' ? styles.cardEmAtendimento : null
  if (onPress) {
    return (
      <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.card, highlight, pressed && styles.pressed, style]}>
        {children}
      </Pressable>
    )
  }
  return <View style={[styles.card, highlight, style]}>{children}</View>
}

/**
 * primary: ação principal (marinho cheio), uma por tela ou passo. secondary: fundo branco com borda marinho.
 * approve/reject: decisões, na cor do resultado. exit: ação rara destrutiva (Sair). text: ação de texto.
 * Os nomes antigos continuam valendo: success = approve, danger = reject, ghost = text.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'approve' | 'reject' | 'exit' | 'text' | 'success' | 'danger' | 'ghost'

const buttonPalette: Record<'primary' | 'secondary' | 'approve' | 'reject' | 'exit', { bg: string; fg: string; border: string; borderWidth: number }> = {
  primary: { bg: colors.marinho, fg: colors.branco, border: colors.marinho, borderWidth: 0 },
  secondary: { bg: colors.superficie, fg: colors.marinho, border: colors.marinho, borderWidth: borders.botao },
  approve: { bg: colors.feito, fg: colors.branco, border: colors.feito, borderWidth: 0 },
  reject: { bg: colors.naoFeito, fg: colors.branco, border: colors.naoFeito, borderWidth: 0 },
  exit: { bg: colors.superficie, fg: colors.naoFeito, border: colors.naoFeito, borderWidth: borders.botao },
}

function normalizeVariant(variant: ButtonVariant) {
  if (variant === 'success') return 'approve'
  if (variant === 'danger') return 'reject'
  if (variant === 'ghost') return 'text'
  return variant
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading,
  disabled,
  missing,
  small,
  style,
}: {
  title: string
  onPress: () => void
  variant?: ButtonVariant
  loading?: boolean
  disabled?: boolean
  /** Desabilitado: linha abaixo do botão dizendo o que falta (ex.: "Escreva pelo menos 10 caracteres") */
  missing?: string | null
  /** Menos espaço nas laterais; a altura de toque continua 48 */
  small?: boolean
  style?: StyleProp<ViewStyle>
}) {
  const kind = normalizeVariant(variant)
  if (kind === 'text') return <TextAction title={title} onPress={onPress} disabled={disabled || loading} style={style} />
  const p = buttonPalette[kind]
  const blocked = !!disabled && !loading
  const fg = blocked ? colors.desabilitadoTexto : p.fg
  const button = (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: blocked, busy: !!loading }}
      onPress={disabled || loading ? undefined : onPress}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        { backgroundColor: p.bg, borderColor: p.border, borderWidth: p.borderWidth },
        blocked && styles.buttonDisabled,
        pressed && !disabled && !loading && styles.pressed,
        missing && blocked ? null : style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[styles.buttonText, { color: fg }]} numberOfLines={2}>
          {title}
        </Text>
      )}
    </Pressable>
  )
  if (!(missing && blocked)) return button
  return (
    <View style={[{ gap: space.xs }, style]}>
      {button}
      <Text style={styles.muted}>{missing}</Text>
    </View>
  )
}

/** Ação de texto: marinho, SemiBold 15, com área de toque de 48dp. */
export function TextAction({ title, onPress, disabled, style }: { title: string; onPress: () => void; disabled?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [styles.textAction, pressed && !disabled && styles.pressed, style]}
    >
      <Text style={[type.acaoTexto, disabled && { color: colors.desabilitadoTexto }]}>{title}</Text>
    </Pressable>
  )
}

type DecisionButton = { title: string; onPress: () => void; loading?: boolean; disabled?: boolean }

/** Par de decisão: lado a lado, na cor do resultado. Negativa à esquerda, positiva à direita. */
export function DecisionPair({ negative, positive }: { negative: DecisionButton; positive: DecisionButton }) {
  return (
    <View style={styles.pair}>
      <Button variant="reject" {...negative} style={{ flex: 1 }} />
      <Button variant="approve" {...positive} style={{ flex: 1 }} />
    </View>
  )
}

/**
 * Selo: fundo suave, texto forte, sem bolinha. `tone` usa as cores de status; `marinho` é o selo cheio (ex.:
 * "Próximo"); `outline` é o contorno marinho (ex.: "Pode contestar"). color/bg avulsos continuam aceitos.
 */
export function Badge({
  label,
  tone,
  marinho,
  outline,
  color,
  bg,
}: {
  label: string
  tone?: Tone
  marinho?: boolean
  outline?: boolean
  color?: string
  bg?: string
}) {
  const t = tone ? tones[tone] : null
  const fg = marinho ? colors.branco : outline ? colors.marinho : (t?.forte ?? color ?? colors.neutro)
  const background = marinho ? colors.marinho : outline ? 'transparent' : (t?.suave ?? bg ?? colors.neutroSuave)
  return (
    <View style={[styles.badge, { backgroundColor: background }, outline && styles.badgeOutline]}>
      <Text style={[styles.badgeText, { color: fg }]}>{label}</Text>
    </View>
  )
}

/** Andamento do dia: feito, justificado e em atendimento sobre o fundo cinza (o resto é o que falta). */
export function ProgressBar({ done, justified, inProgress, total }: { done: number; justified: number; inProgress: number; total: number }) {
  const rest = Math.max(0, total - done - justified - inProgress)
  return (
    <View
      style={styles.progress}
      accessibilityRole="progressbar"
      accessibilityLabel={`${done} feitos, ${justified} justificados, ${inProgress} em atendimento de ${total}`}
    >
      <View style={{ flex: done, backgroundColor: colors.feito }} />
      <View style={{ flex: justified, backgroundColor: colors.justificado }} />
      <View style={{ flex: inProgress, backgroundColor: colors.emAtendimento }} />
      <View style={{ flex: rest }} />
    </View>
  )
}

/** Número em círculo (ordem no roteiro): marinho no próximo cliente, azul suave no atendimento aberto. */
export function NumberCircle({ n, tone = 'neutro' }: { n: number; tone?: 'marinho' | Tone }) {
  const t = tone === 'marinho' ? { forte: colors.branco, suave: colors.marinho } : tones[tone]
  return (
    <View style={[styles.numberCircle, { backgroundColor: t.suave }]}>
      <Text style={[styles.numberCircleText, { color: tone === 'marinho' ? colors.branco : t.forte }]}>{n}</Text>
    </View>
  )
}

/** Campo: rótulo acima, ajuda ou erro abaixo. Borda de 2px; em foco, 4px marinho. */
export function Field({ label, hint, error, ...props }: TextInputProps & { label?: string; hint?: string; error?: string | null }) {
  const [focused, setFocused] = useState(false)
  return (
    <View style={{ gap: space.xs }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.bordaCampo}
        selectionColor={colors.marinho}
        cursorColor={colors.marinho}
        {...props}
        onFocus={(e) => {
          setFocused(true)
          props.onFocus?.(e)
        }}
        onBlur={(e) => {
          setFocused(false)
          props.onBlur?.(e)
        }}
        style={[
          styles.input,
          props.multiline && styles.inputMultiline,
          error ? { borderColor: colors.naoFeito } : null,
          focused && styles.inputFocused,
          props.style,
        ]}
      />
      {error ? <Text style={styles.errorSmall}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  )
}

/** Seletor (ex.: Pendentes / Auditadas / Todas). */
export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={styles.segmented} accessibilityRole="tablist">
      {options.map((o) => {
        const active = value === o.value
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(o.value)}
            style={[styles.segment, active && styles.segmentActive]}
          >
            <Text style={[styles.segmentText, active && styles.segmentTextActive]} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={styles.sectionRow}>
      <Text style={[styles.sectionTitle, { flex: 1 }]}>{children}</Text>
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
      <ActivityIndicator size="large" color={colors.marinho} />
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

/**
 * Aviso em faixa. O âmbar é só de Justificado e o azul só de Em atendimento, então: success = verde, danger =
 * vermelho, info = cinza com barra marinho, warning = cinza com barra vermelha.
 */
export function Banner({ text, tone = 'info' }: { text: string; tone?: 'info' | 'warning' | 'danger' | 'success' }) {
  const map = {
    info: [colors.marinho, colors.neutroSuave],
    warning: [colors.naoFeito, colors.neutroSuave],
    danger: [colors.naoFeito, colors.naoFeitoSuave],
    success: [colors.feito, colors.feitoSuave],
  } as const
  const [bar, bg] = map[tone]
  return (
    <View style={[styles.banner, { backgroundColor: bg, borderLeftColor: bar }]}>
      <Text style={styles.bannerText}>{text}</Text>
    </View>
  )
}

export function EmptyState({ title, text }: { title: string; text?: string }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: space.xxl + space.sm, paddingHorizontal: space.lg }}>
      <Text style={[styles.sectionTitle, { textAlign: 'center' }]}>{title}</Text>
      {text ? <Text style={[styles.muted, { textAlign: 'center', marginTop: space.sm }]}>{text}</Text> : null}
    </View>
  )
}

export function PhotoThumb({ url, size = 96, label, onPress }: { url: string; size?: number; label?: string; onPress?: () => void }) {
  return (
    <Pressable accessibilityRole="imagebutton" onPress={onPress} style={{ width: size }}>
      <Image
        source={{ uri: resolveUrl(url) }}
        style={{ width: size, height: size, borderRadius: radius.sm, backgroundColor: colors.neutroSuave }}
        contentFit="cover"
        transition={150}
      />
      {label ? (
        <Text numberOfLines={1} style={[styles.muted, { marginTop: space.xs / 2 }]}>
          {label}
        </Text>
      ) : null}
    </Pressable>
  )
}

/** Folha que sobe de baixo, com título e "Fechar". */
export function Sheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetBackdrop}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Fechar" />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}>
          <View style={styles.sectionRow}>
            <Text style={[styles.sectionTitle, { flex: 1 }]}>{title}</Text>
            <TextAction title="Fechar" onPress={onClose} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 520 }} contentContainerStyle={{ gap: space.sm, paddingTop: space.sm }}>
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
          accessibilityRole="button"
          accessibilityState={{ selected: value === o.value }}
          onPress={() => {
            onSelect(o.value)
            onClose()
          }}
          style={[styles.option, value === o.value && styles.optionActive]}
        >
          <Text style={styles.optionText}>{o.label}</Text>
          {o.detail ? <Text style={styles.muted}>{o.detail}</Text> : null}
        </Pressable>
      ))}
    </Sheet>
  )
}

/** Opção com caixa de marcar, para listas de múltipla escolha. */
export function CheckOption({ label, detail, checked, onPress }: { label: string; detail?: string; checked: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={onPress}
      style={[styles.option, styles.checkOption, checked && styles.optionActive]}
    >
      <View style={[styles.checkBox, checked && styles.checkBoxOn]}>
        {checked ? <Ionicons name="checkmark" size={sizes.iconeComTexto - 2} color={colors.branco} /> : null}
      </View>
      <View style={{ flex: 1, gap: space.xs / 2 }}>
        <Text style={styles.optionText}>{label}</Text>
        {detail ? <Text style={styles.muted}>{detail}</Text> : null}
      </View>
    </Pressable>
  )
}

/** Lista de múltipla escolha em folha inferior: cada toque marca ou desmarca na hora; a primeira opção desmarca todas. */
export function MultiPickerSheet<T extends string>({
  visible,
  title,
  allLabel,
  options,
  values,
  onChange,
  onClose,
}: {
  visible: boolean
  title: string
  allLabel: string
  options: { value: T; label: string; detail?: string }[]
  values: T[]
  onChange: (values: T[]) => void
  onClose: () => void
}) {
  return (
    <Sheet visible={visible} title={title} onClose={onClose}>
      <CheckOption label={allLabel} checked={values.length === 0} onPress={() => onChange([])} />
      {options.map((o) => {
        const checked = values.includes(o.value)
        return (
          <CheckOption
            key={o.value}
            label={o.label}
            detail={o.detail}
            checked={checked}
            onPress={() => onChange(checked ? values.filter((v) => v !== o.value) : [...values, o.value])}
          />
        )
      })}
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
      {message ? <Text style={styles.text}>{message}</Text> : null}
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
        missing={ok ? null : `Escreva pelo menos ${minLength} caracteres`}
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
  pressed: { opacity: 0.85 },
  card: {
    backgroundColor: colors.superficie,
    borderRadius: radius.md,
    padding: space.lg,
    borderWidth: borders.fina,
    borderColor: colors.divisoria,
    gap: space.sm,
  },
  // Borda grossa: o padding encolhe o mesmo tanto, para o conteúdo não pular de lugar
  cardProximo: { borderWidth: borders.destaque, borderColor: colors.marinho, padding: space.lg - (borders.destaque - borders.fina) },
  cardEmAtendimento: { borderWidth: borders.destaque, borderColor: colors.emAtendimento, padding: space.lg - (borders.destaque - borders.fina) },
  button: {
    minHeight: sizes.toque,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  buttonSmall: { paddingHorizontal: space.md },
  buttonDisabled: { backgroundColor: colors.desabilitadoFundo, borderColor: colors.desabilitadoFundo },
  buttonText: { ...type.botao, textAlign: 'center' },
  textAction: { minHeight: sizes.toque, justifyContent: 'center', paddingHorizontal: space.xs },
  pair: { flexDirection: 'row', gap: space.sm },
  badge: { paddingHorizontal: space.sm, paddingVertical: space.xs / 2, borderRadius: radius.sm, alignSelf: 'flex-start' },
  badgeOutline: { borderWidth: borders.fina, borderColor: colors.marinho },
  badgeText: { ...type.selo },
  progress: { flexDirection: 'row', height: space.sm, borderRadius: space.sm / 2, overflow: 'hidden', backgroundColor: colors.neutroSuave },
  numberCircle: { width: space.xxl, height: space.xxl, borderRadius: space.xxl / 2, alignItems: 'center', justifyContent: 'center' },
  numberCircleText: { ...type.textoForte, ...tabular },
  label: { ...type.rotulo },
  input: {
    minHeight: sizes.toque,
    borderWidth: borders.campo,
    borderColor: colors.bordaCampo,
    backgroundColor: colors.superficie,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + space.xs / 2,
    ...type.texto,
  },
  inputMultiline: { minHeight: sizes.toque * 2, textAlignVertical: 'top' },
  // Borda de 4px no foco: o padding encolhe a diferença, para o texto não mudar de lugar
  inputFocused: {
    borderWidth: borders.destaque,
    borderColor: colors.marinho,
    paddingHorizontal: space.md - (borders.destaque - borders.campo),
    paddingVertical: space.sm + space.xs / 2 - (borders.destaque - borders.campo),
  },
  hint: { ...type.secundario },
  errorSmall: { ...type.secundario, color: colors.naoFeito },
  segmented: { flexDirection: 'row', backgroundColor: colors.neutroSuave, borderRadius: radius.md, padding: space.xs / 2, gap: space.xs / 2 },
  segment: {
    flex: 1,
    minHeight: sizes.seletor - space.xs,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md - space.xs / 2,
    borderWidth: borders.campo,
    borderColor: 'transparent',
    paddingHorizontal: space.xs,
  },
  segmentActive: { backgroundColor: colors.superficie, borderColor: colors.marinho },
  segmentText: { ...type.selo, fontSize: type.secundario.fontSize, color: colors.textoSecundario },
  segmentTextActive: { color: colors.marinho },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, marginTop: space.sm },
  sectionTitle: { ...type.secao },
  title: { ...type.titulo },
  muted: { ...type.secundario },
  text: { ...type.texto },
  number: { ...tabular },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, backgroundColor: colors.fundo },
  banner: { borderLeftWidth: borders.destaque, borderRadius: radius.sm, padding: space.md },
  bannerText: { ...type.texto },
  sheetBackdrop: { flex: 1, backgroundColor: colors.veu },
  sheet: {
    backgroundColor: colors.fundo,
    borderTopLeftRadius: radius.folha,
    borderTopRightRadius: radius.folha,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    ...elevated,
  },
  option: {
    minHeight: sizes.toque,
    justifyContent: 'center',
    backgroundColor: colors.superficie,
    borderRadius: radius.md,
    borderWidth: borders.fina,
    borderColor: colors.divisoria,
    padding: space.md,
    gap: space.xs / 2,
  },
  optionActive: { borderWidth: borders.campo, borderColor: colors.marinho, padding: space.md - (borders.campo - borders.fina) },
  optionText: { ...type.textoForte },
  checkOption: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  checkBox: {
    width: sizes.icone,
    height: sizes.icone,
    borderRadius: radius.sm,
    borderWidth: borders.campo,
    borderColor: colors.bordaCampo,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBoxOn: { backgroundColor: colors.marinho, borderColor: colors.marinho },
})

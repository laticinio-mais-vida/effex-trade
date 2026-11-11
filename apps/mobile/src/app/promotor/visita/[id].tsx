import Ionicons from '@expo/vector-icons/Ionicons'
import { File as FsFile } from 'expo-file-system'
import * as ImagePicker from 'expo-image-picker'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ActivityIndicator, Alert, Keyboard, Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Badge, Banner, Button, Card, ErrorView, Field, LoadingView, Muted, NumberCircle, PhotoThumb, Row, Screen, SectionTitle, Sheet, styles, TextAction } from '@/components/ui'
import { dayClosed, onLunch, permissionLabels, useDay } from '@/features/promotor/DayContext'
import { PhotoInfoSheet, type PhotoExtra } from '@/features/promotor/PhotoInfoSheet'
import { ProductPicker } from '@/features/promotor/ProductPicker'
import { RuptureSheet } from '@/features/promotor/RuptureSheet'
import { PhotoViewer } from '@/features/PhotoViewer'
import { api, ApiError, errorMessage } from '@/lib/api'
import { resolveUrl } from '@/lib/config'
import {
  DEFAULT_MODULES,
  formatDistance,
  formatMinutes,
  formatSessions,
  formatTime,
  isDefaultStructure,
  minutesSince,
  originLabels,
  photoTypeLabels,
  placeOf,
  recurrenceLabels,
  structureLabel,
  visitMinutes,
  visitStatusInfo,
} from '@/lib/format'
import { distanceMeters, getPreciseLocation, getQuickLocation, LocationError, type CurrentLocation } from '@/lib/location'
import { borders, colors, elevated, sizes, space, type } from '@/lib/theme'
import type { CheckinResult, Photo, PhotoType, Visit, VisitStep, VisitTask } from '@/lib/types'
import { useQuery } from '@/lib/useQuery'
import { stepLine, visitSteps, type StepKey } from '@/lib/visitSteps'

type Action = 'checkin' | 'reopen' | 'checkout' | 'justify' | 'remove' | 'stock'
type OpenMode = 'checkin' | 'reopen'
type Asset = ImagePicker.ImagePickerAsset
type UploadExtra = PhotoExtra & { productIds?: string[]; takenAt?: string }

const stepNames: Record<VisitStep, string> = {
  ANTES: 'foto de antes',
  DEPOIS: 'fotos de depois',
  PRODUTOS: 'produtos nas fotos de depois',
  RUPTURA: 'confirmação de ruptura',
  ESTOQUE: 'confirmação da contagem de estoque',
  CHECKOUT: 'check-out',
}
const PHOTO_STEPS: VisitStep[] = ['ANTES', 'DEPOIS', 'PRODUTOS', 'RUPTURA']

async function takePicture(): Promise<Asset | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync()
  if (!perm.granted) {
    Alert.alert('Câmera bloqueada', 'Permita o uso da câmera nas configurações do celular para registrar as fotos.')
    return null
  }
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.6, allowsEditing: false, exif: false })
  if (result.canceled || !result.assets?.[0]) return null
  return result.assets[0]
}

/**
 * Anexa a foto ao formulário. O fetch do Expo (SDK 58) não aceita o formato antigo do React Native
 * ({ uri, name, type }); precisa de um arquivo que implemente Blob, como o File do expo-file-system.
 */
function appendFile(form: FormData, asset: Asset) {
  form.append('file', new FsFile(asset.uri) as unknown as Blob)
}

const metaLabels: Record<string, string> = {
  produto: 'Produto',
  validade: 'Validade',
  quantidade: 'Quantidade',
  avisoIntervaloCurto: 'Aviso de foto rápida confirmado',
  minutosAposAntes: 'Minutos após a foto de antes',
}

function formatMeta(meta: Record<string, unknown>) {
  return Object.entries(meta)
    .map(([k, v]) => `${metaLabels[k] ?? k}: ${typeof v === 'boolean' ? (v ? 'sim' : 'não') : String(v)}`)
    .join(' · ')
}


/**
 * Passo do atendimento. Concluído: uma linha só ("Fachada · 20:57"), que abre a foto ao tocar. Atual: cartão em
 * destaque, sem botão próprio (o botão fica na barra fixa). Pendente: número e título; com a sequência obrigatória
 * desligada, mantém o próprio botão (children).
 */
function Step({
  n,
  title,
  state,
  detail,
  onPressDone,
  doneAction,
  children,
}: {
  n: number
  title: string
  state: 'done' | 'current' | 'todo'
  detail?: string
  onPressDone?: () => void
  doneAction?: ReactNode
  children?: ReactNode
}) {
  if (state === 'done') {
    // A linha abre a foto; a ação ao lado ("+ outra") é um botão à parte, não dentro dela
    return (
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs }}>
        <Pressable
          accessibilityRole="button"
          onPress={onPressDone}
          disabled={!onPressDone}
          style={({ pressed }) => [{ flex: 1, minHeight: sizes.toque, flexDirection: 'row', alignItems: 'center', gap: space.md }, pressed && styles.pressed]}
        >
          <View style={localStyles.doneCircle}>
            <Ionicons name="checkmark" size={sizes.iconeComTexto} color={colors.feito} />
          </View>
          <Text style={[styles.text, { flex: 1 }]} numberOfLines={2}>
            {title}
            {detail ? <Text style={styles.muted}> · {detail}</Text> : null}
          </Text>
        </Pressable>
        {doneAction}
      </Card>
    )
  }
  const current = state === 'current'
  return (
    <Card variant={current ? 'proximo' : 'normal'}>
      <Row style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <NumberCircle n={n} tone={current ? 'marinho' : 'neutro'} />
        <View style={{ flex: 1, gap: space.xs / 2 }}>
          <Text style={current ? styles.sectionTitle : [type.textoForte, { color: colors.textoSecundario }]}>{title}</Text>
          {detail ? <Muted>{detail}</Muted> : null}
        </View>
      </Row>
      {children}
    </Card>
  )
}

export default function VisitaScreen() {
  // abrir=1: veio do botão "Abrir atendimento" do Meu dia; abre direto (cerca e foto da fachada)
  const { id, abrir } = useLocalSearchParams<{ id: string; abrir?: string }>()
  const router = useRouter()
  const { day, reload: reloadDay } = useDay()
  const query = useQuery(() => api<Visit>(`/promotor/visits/${id}`), [id])
  const visit = query.data
  const [busy, setBusy] = useState<Action | null>(null)
  const [uploading, setUploading] = useState<PhotoType | null>(null)
  const [infoFor, setInfoFor] = useState<PhotoType | null>(null)
  const [viewing, setViewing] = useState<Photo | null>(null)
  const [pendingAfter, setPendingAfter] = useState<{ asset: Asset; takenAt: string; warning: { minutesAfterBefore: number } | null } | null>(null)
  const [editingPhoto, setEditingPhoto] = useState<Photo | null>(null)
  const [ruptureOpen, setRuptureOpen] = useState(false)
  const [justifyOpen, setJustifyOpen] = useState(false)
  const [completingTask, setCompletingTask] = useState<VisitTask | null>(null)
  const [highlightTasks, setHighlightTasks] = useState<Set<string>>(new Set())
  const [notes, setNotes] = useState('')
  const [, setTick] = useState(0)
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  const insets = useSafeAreaInsets()
  const openNow = useRef<(() => void) | null>(null)
  const autoOpened = useRef(false)

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])
  // A barra fixa some quando o teclado abre (observações do atendimento)
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardOpen(true))
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardOpen(false))
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])
  useEffect(() => {
    if (abrir === '1' && query.data?.status === 'PENDENTE' && !autoOpened.current && openNow.current) {
      autoOpened.current = true
      openNow.current()
    }
  }, [abrir, query.data?.status, day])

  if (query.loading && !visit) return <LoadingView />
  if (query.error && !visit) return <ErrorView message={query.error} onRetry={query.refresh} />
  if (!visit || !day) return null

  const rules = day.rules
  const status = visitStatusInfo[visit.status]
  const photos = visit.photos ?? []
  const tasks = visit.tasks ?? []
  const pendingRequests = visit.requests?.filter((r) => r.status === 'PENDENTE') ?? []
  const dayEnded = dayClosed(day)
  const lunch = onLunch(day)
  const isNext = day.nextVisitId === visit.id
  const blockedByOrder =
    rules.enforceRouteOrder &&
    visit.status === 'PENDENTE' &&
    visit.origin !== 'EXTRA' &&
    visit.origin !== 'PONTUAL' &&
    !visit.routeOrderWaived &&
    !!day.nextVisitId &&
    !isNext
  const nextVisit = day.visits.find((v) => v.id === day.nextVisitId)
  const radius = rules.geofenceRadiusMeters
  const needsFacade = rules.requireFacadePhotoOnCheckin && !visit.photosWaived
  const sessions = visit.sessions ?? []
  const reopened = sessions.length > 1
  const openSession = sessions.find((x) => !x.checkoutAt)
  const openSince = openSession?.checkinAt ?? visit.checkinAt
  // Cliente já atendido hoje pode ser reaberto para continuar de onde parou
  const canReopen = visit.status === 'CONCLUIDA' && day.isToday && !dayEnded

  // Estrutura do atendimento: quais etapas esta visita tem
  const modules = visit.modules ?? DEFAULT_MODULES
  const hasPhotoStep = modules.includes('FOTOS')
  const hasActivities = modules.includes('ATIVIDADES')
  const hasStock = modules.includes('ESTOQUE')
  const progress = visit.progress
  const enforced = progress?.enforced ?? false
  const next: VisitStep = progress?.next ?? 'CHECKOUT'
  const facadePhotos = photos.filter((p) => p.type === 'FACHADA')
  const beforePhotos = photos.filter((p) => p.type === 'ANTES')
  const afterPhotos = photos.filter((p) => p.type === 'DEPOIS')
  const otherPhotos = photos.filter((p) => !['FACHADA', 'ANTES', 'DEPOIS'].includes(p.type))
  const afterWithoutProducts = afterPhotos.filter((p) => !p.products?.length).length
  const markedProducts = new Set(afterPhotos.flatMap((p) => p.products?.map((x) => x.id) ?? [])).size
  const canBefore = !enforced || afterPhotos.length === 0
  const canAfter = !enforced || beforePhotos.length > 0
  const canRupture = !enforced || (afterPhotos.length > 0 && afterWithoutProducts === 0)
  // Atividade de foto não trava quando o supervisor dispensou as fotos (pode ser concluída sem foto)
  const needsPhoto = (t: VisitTask) => t.requiresPhoto && !visit.photosWaived
  const pendingRequired = tasks.filter((t) => t.required && !t.done && !(t.requiresPhoto && visit.photosWaived))
  // Tudo pronto para o check-out: etapas da estrutura completas e atividades obrigatórias feitas
  const ready = (progress?.missing.length ?? 0) === 0 && pendingRequired.length === 0

  async function refreshAll() {
    await Promise.all([query.reload(), reloadDay()])
  }

  function goRequest(type: string) {
    router.push({ pathname: '/promotor/pedido', params: { type, visitId: visit!.id } })
  }

  function askOrderChange() {
    Alert.alert(
      'Fora da ordem do roteiro',
      `Pela ordem do roteiro, o próximo cliente é ${nextVisit?.client.name ?? 'outro'}. Para atender este antes, peça para antecipá-lo ou para não seguir a ordem (só neste cliente ou no dia inteiro).`,
      [
        { text: 'Fechar', style: 'cancel' },
        { text: 'Antecipar', onPress: () => router.push({ pathname: '/promotor/ordem', params: { first: visit!.id } }) },
        { text: 'Não seguir a ordem', onPress: () => goRequest('LIVRE_ORDEM_CLIENTE') },
      ],
    )
  }

  /** noRelease: a liberação de cerca não se aplica (reabertura ou justificativa na volta do almoço). */
  function handleError(e: unknown, title: string, opts: { noRelease?: boolean } = {}) {
    if (e instanceof LocationError) return Alert.alert('Localização', e.message)
    if (!(e instanceof ApiError)) return Alert.alert(title, errorMessage(e))
    const close = { text: 'Fechar', style: 'cancel' as const }
    switch (e.code) {
      case 'FORA_DA_CERCA':
        return Alert.alert(
          'Fora da cerca eletrônica',
          e.message,
          opts.noRelease || visit!.status !== 'PENDENTE' ? [close] : [close, { text: 'Pedir liberação', onPress: () => goRequest('CHECKIN_FORA_CERCA') }],
        )
      case 'FORA_DA_ORDEM':
        return askOrderChange()
      case 'ATENDIMENTO_EM_ANDAMENTO':
        return Alert.alert(
          'Atendimento em andamento',
          e.message,
          e.details?.visitId ? [close, { text: 'Ir para o atendimento', onPress: () => router.replace(`/promotor/visita/${e.details.visitId}`) }] : [close],
        )
      case 'SEQUENCIA_INCOMPLETA':
      case 'FOTOS_OBRIGATORIAS': {
        const missing: VisitStep[] = e.details?.missing ?? []
        const text = missing.length ? `Falta: ${missing.map((m) => stepNames[m]).join(', ')}.` : e.message
        // A dispensa do supervisor vale para as fotos; a confirmação da contagem de estoque continua obrigatória
        const photosMissing = missing.length === 0 || missing.some((m) => PHOTO_STEPS.includes(m))
        return Alert.alert('Atendimento incompleto', text, photosMissing ? [close, { text: 'Pedir dispensa das fotos', onPress: () => goRequest('DISPENSA_FOTOS') }] : [close])
      }
      case 'SEQUENCIA':
      case 'PRODUTOS_NAO_IDENTIFICADOS':
        return Alert.alert('Siga a ordem do atendimento', e.message)
      case 'FOTO_FACHADA':
        return Alert.alert('Foto da fachada', e.message)
      case 'ATIVIDADE_PENDENTE': {
        const pendingIds: string[] = (e.details?.tasks ?? []).map((t: { id: string }) => t.id)
        setHighlightTasks(new Set(pendingIds))
        return Alert.alert('Atividade obrigatória pendente', e.message)
      }
      case 'FOTO_OBRIGATORIA':
        return Alert.alert('Atividade com foto', e.message)
      case 'PRODUTO_FORA_DO_MIX':
        return Alert.alert('Produto fora do mix', e.message)
      case 'EM_ALMOCO':
        void refreshAll()
        return Alert.alert('Horário de almoço', e.message)
      case 'LOCALIZACAO_OBRIGATORIA':
        return Alert.alert('Localização', e.message)
      case 'ROTEIRO_ENCERRADO':
        void refreshAll()
        return Alert.alert('Roteiro encerrado', e.message)
      case 'STATUS_INVALIDO':
        void refreshAll()
        return Alert.alert(title, e.message)
      default:
        return Alert.alert(title, e.message)
    }
  }

  /** Avisos da abertura: volta do almoço e atendimentos esquecidos encerrados pelo sistema. */
  function notifyCheckin(result: CheckinResult) {
    const messages: string[] = []
    if (result.reopened) messages.push('Continue de onde parou: fotos, produtos, ruptura e atividades já feitos continuam valendo. Faça o check-out ao terminar.')
    if (result.lunchEndedAt) messages.push(`Almoço encerrado às ${formatTime(result.lunchEndedAt)}.`)
    for (const c of result.autoClosedVisits ?? []) {
      messages.push(`O atendimento em ${c.clientName} foi encerrado automaticamente às ${formatTime(c.checkoutAt)} (horário da última foto tirada).`)
    }
    if (messages.length === 0) return
    const title = result.reopened ? 'Atendimento reaberto' : result.lunchEndedAt && !result.autoClosedVisits?.length ? 'Volta do almoço' : 'Atendimento aberto'
    Alert.alert(title, messages.join('\n\n'))
  }

  async function sendCheckin(loc: CurrentLocation, facade: { asset: Asset; takenAt: string } | null, mode: OpenMode = 'checkin') {
    const path = `/promotor/visits/${visit!.id}/${mode === 'reopen' ? 'reopen' : 'checkin'}`
    let result: CheckinResult
    if (facade) {
      const form = new FormData()
      form.append('latitude', String(loc.latitude))
      form.append('longitude', String(loc.longitude))
      if (loc.accuracy != null) form.append('accuracy', String(loc.accuracy))
      form.append('mocked', loc.mocked ? 'true' : 'false')
      form.append('takenAt', facade.takenAt)
      appendFile(form, facade.asset)
      result = await api<CheckinResult>(path, { form })
    } else {
      result = await api<CheckinResult>(path, { body: loc })
    }
    await refreshAll()
    notifyCheckin(result)
  }

  /**
   * Abertura (ou reabertura) do atendimento: confere cerca e ordem antes de abrir a câmera para a fachada.
   * A ordem do roteiro não vale para reabrir um cliente já atendido.
   */
  async function checkin(mode: OpenMode = 'checkin') {
    if (mode === 'checkin' && blockedByOrder) return askOrderChange()
    const failTitle = mode === 'reopen' ? 'Atendimento não reaberto' : 'Atendimento não aberto'
    setBusy(mode)
    let loc: CurrentLocation | null = null
    let facade: { asset: Asset; takenAt: string } | null = null
    try {
      loc = await getPreciseLocation()
      // Mesmas recusas da API, antes de abrir a câmera, para não perder a foto da fachada
      if (rules.blockMockedLocation && loc.mocked) {
        return Alert.alert('Localização simulada', 'Localização simulada detectada. Desative apps de GPS falso para continuar.')
      }
      if (rules.maxLocationAccuracyMeters > 0 && loc.accuracy != null && loc.accuracy > rules.maxLocationAccuracyMeters) {
        return Alert.alert('GPS impreciso', `Sinal de GPS impreciso (${Math.round(loc.accuracy)} m). Vá para um local aberto e tente de novo.`)
      }
      const distance = distanceMeters(loc.latitude, loc.longitude, visit!.client.latitude, visit!.client.longitude)
      if (distance > radius && !visit!.geofenceWaived && !visit!.client.geofenceExempt) {
        if (mode === 'reopen') {
          return Alert.alert('Fora da cerca eletrônica', `Você está a ${formatDistance(distance)} do cliente. Para reabrir o atendimento, esteja a até ${radius} m da loja.`)
        }
        return Alert.alert(
          'Fora da cerca eletrônica',
          `Você está a ${formatDistance(distance)} do cliente. O atendimento só abre a até ${radius} m. Se estiver no local, peça liberação ao supervisor.`,
          [
            { text: 'Fechar', style: 'cancel' },
            { text: 'Pedir liberação', onPress: () => goRequest('CHECKIN_FORA_CERCA') },
          ],
        )
      }
      if (needsFacade) {
        const asset = await takePicture()
        if (!asset) return
        facade = { asset, takenAt: new Date().toISOString() }
      }
      await sendCheckin(loc, facade, mode)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'SEM_CONEXAO' && loc) {
        const retryLoc = loc
        const retryFacade = facade
        Alert.alert('Sem conexão', e.message, [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Tentar de novo', onPress: () => void sendCheckin(retryLoc, retryFacade, mode).catch((err) => handleError(err, failTitle, { noRelease: mode === 'reopen' })) },
        ])
      } else {
        handleError(e, failTitle, { noRelease: mode === 'reopen' })
      }
    } finally {
      setBusy(null)
    }
  }

  async function checkout() {
    setBusy('checkout')
    try {
      // GPS falhando não trava o check-out; a API recusa se a regra exigir a cerca no check-out
      const loc = await getPreciseLocation().catch(() => getQuickLocation())
      await api(`/promotor/visits/${visit!.id}/checkout`, { body: { ...(loc ?? {}), notes: notes.trim() || undefined } })
      await refreshAll()
      Alert.alert('Atendimento finalizado', 'Bom trabalho! Siga para o próximo cliente.', [{ text: 'OK', onPress: () => router.back() }])
    } catch (e) {
      handleError(e, 'Check-out não realizado')
    } finally {
      setBusy(null)
    }
  }

  async function removeExtra() {
    Alert.alert('Remover cliente extra?', visit!.client.name, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover',
        style: 'destructive',
        onPress: async () => {
          setBusy('remove')
          try {
            await api(`/promotor/visits/${visit!.id}`, { method: 'DELETE' })
            await reloadDay()
            router.back()
          } catch (e) {
            handleError(e, 'Não foi possível remover')
          } finally {
            setBusy(null)
          }
        },
      },
    ])
  }

  async function upload(asset: Asset, type: PhotoType, extra: UploadExtra) {
    setUploading(type)
    try {
      const loc = await getQuickLocation()
      const form = new FormData()
      form.append('type', type)
      if (extra.taskId) form.append('taskId', extra.taskId)
      if (extra.notes) form.append('notes', extra.notes)
      if (extra.meta) form.append('meta', JSON.stringify(extra.meta))
      if (extra.productIds) form.append('productIds', JSON.stringify(extra.productIds))
      if (loc) {
        form.append('latitude', String(loc.latitude))
        form.append('longitude', String(loc.longitude))
      }
      form.append('takenAt', extra.takenAt ?? new Date().toISOString())
      appendFile(form, asset)
      await api(`/promotor/visits/${visit!.id}/photos`, { form })
      await refreshAll()
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
        handleError(e, 'Foto não enviada')
      } else {
        Alert.alert('Foto não enviada', errorMessage(e), [
          { text: 'Descartar', style: 'destructive' },
          { text: 'Tentar de novo', onPress: () => void upload(asset, type, extra) },
        ])
      }
    } finally {
      setUploading(null)
    }
  }

  async function capture(type: PhotoType, extra: PhotoExtra = {}) {
    const asset = await takePicture()
    if (!asset) return
    await upload(asset, type, { ...extra, takenAt: new Date().toISOString() })
  }

  /** Foto de depois: tira a foto e abre a seleção dos produtos que aparecem nela. */
  async function shootAfter(warning: { minutesAfterBefore: number } | null) {
    const asset = await takePicture()
    if (!asset) return
    setPendingAfter({ asset, takenAt: new Date().toISOString(), warning })
  }

  /** Avisa se a foto de depois vem cedo demais depois da de antes (pode ser foto de antes lançada no depois). */
  function captureAfter() {
    const limit = rules.afterPhotoWarningMinutes
    const lastBefore = beforePhotos.reduce<string | null>((max, p) => (!max || p.takenAt > max ? p.takenAt : max), null)
    const elapsed = lastBefore ? (Date.now() - new Date(lastBefore).getTime()) / 60_000 : Infinity
    if (limit > 0 && elapsed < limit) {
      const minutesAfterBefore = Math.round(Math.max(elapsed, 0) * 10) / 10
      return Alert.alert('Confira a foto', 'Verifique se essa foto não é de antes, está lançando no depois.', [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'É foto de depois', onPress: () => void shootAfter({ minutesAfterBefore }) },
      ])
    }
    void shootAfter(null)
  }

  async function completeTask(task: VisitTask, taskNotes: string) {
    try {
      const updated = await api<Visit>(`/promotor/visits/${visit!.id}/tasks/${task.id}/complete`, { body: { notes: taskNotes.trim() || undefined } })
      setCompletingTask(null)
      setHighlightTasks((prev) => {
        const nextSet = new Set(prev)
        nextSet.delete(task.id)
        return nextSet
      })
      query.setData(updated)
      void reloadDay()
    } catch (e) {
      handleError(e, 'Atividade não concluída')
    }
  }

  /** A contagem de estoque é feita fora do app; aqui o promotor só confirma que fez. */
  function confirmStock() {
    Alert.alert('Contagem de estoque', 'Confirma que fez a contagem de estoque deste cliente?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Confirmar',
        onPress: async () => {
          setBusy('stock')
          try {
            query.setData(await api<Visit>(`/promotor/visits/${visit!.id}/stock-count/confirm`, { body: {} }))
            void reloadDay()
          } catch (e) {
            handleError(e, 'Contagem não confirmada')
          } finally {
            setBusy(null)
          }
        },
      },
    ])
  }

  async function deletePhoto(photo: Photo) {
    try {
      await api(`/promotor/photos/${photo.id}`, { method: 'DELETE' })
      setViewing(null)
      await refreshAll()
    } catch (e) {
      handleError(e, 'Não foi possível apagar')
    }
  }

  function editProducts(photo: Photo) {
    setViewing(null)
    // Espera o visualizador fechar antes de abrir o seletor (dois modais ao mesmo tempo falham no iOS)
    setTimeout(() => setEditingPhoto(photo), 350)
  }

  const inProgress = visit.status === 'EM_ATENDIMENTO'
  openNow.current = () => void checkin('checkin')

  // Passos e passo atual (mesmo cálculo do cartão "Agora" do Meu dia)
  const { steps, current, ...stepInfo } = visitSteps(visit, rules)
  const requiredTasks = stepInfo.requiredTasks
  const firstTask = pendingRequired[0]
  const firstNoProducts = afterPhotos.find((ph) => !ph.products?.length)

  // Botão da barra fixa: sempre o próximo passo
  const barAction: { title: string; onPress: () => void; disabled?: boolean; loading?: boolean } = (() => {
    switch (current) {
      case 'ANTES':
        return { title: uploading === 'ANTES' ? 'Enviando...' : 'Tirar foto de antes', onPress: () => void capture('ANTES'), disabled: !!uploading || !canBefore }
      case 'DEPOIS':
        return firstNoProducts
          ? { title: 'Marcar produtos na foto de depois', onPress: () => setEditingPhoto(firstNoProducts), disabled: !!uploading }
          : { title: uploading === 'DEPOIS' ? 'Enviando...' : 'Tirar foto de depois', onPress: captureAfter, disabled: !!uploading || !canAfter }
      case 'RUPTURA':
        return { title: 'Conferir e confirmar ruptura', onPress: () => setRuptureOpen(true), disabled: !!uploading || !canRupture }
      case 'ESTOQUE':
        return { title: 'Confirmar que fiz a contagem', onPress: confirmStock, loading: busy === 'stock' }
      case 'TAREFA':
        return firstTask && needsPhoto(firstTask)
          ? { title: uploading === 'ATIVIDADE_EXTRA' ? 'Enviando...' : 'Fotografar atividade', onPress: () => void capture('ATIVIDADE_EXTRA', { taskId: firstTask.id }), disabled: !!uploading }
          : { title: 'Concluir atividade', onPress: () => firstTask && setCompletingTask(firstTask) }
      default:
        return { title: 'Fazer check-out', onPress: checkout, loading: busy === 'checkout', disabled: !!uploading }
    }
  })()
  const stepText = stepLine(stepInfo)

  const tasksBlock =
    tasks.length > 0 ? (
      <>
        <SectionTitle>Atividades extras</SectionTitle>
        {pendingRequired.length > 0 && inProgress ? <Muted>As atividades obrigatórias precisam estar concluídas para o check-out.</Muted> : null}
        {tasks.map((t) => {
          const highlighted = highlightTasks.has(t.id) && !t.done
          return (
            <Card key={t.id} style={highlighted ? { borderColor: colors.naoFeito, borderWidth: borders.campo } : undefined}>
              <Row style={{ justifyContent: 'space-between', flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                <Text style={[styles.optionText, { flex: 1 }]}>{t.title}</Text>
                <Badge label={t.done ? 'Feita' : 'Pendente'} tone={t.done ? 'feito' : 'neutro'} />
              </Row>
              <Row>
                {t.required ? <Badge label="Obrigatória" outline /> : null}
                <Badge label={t.requiresPhoto ? 'Exige foto' : 'Sem foto'} tone="neutro" />
                {t.recurrence && recurrenceLabels[t.recurrence] ? <Badge label={recurrenceLabels[t.recurrence]!} tone="neutro" /> : null}
              </Row>
              {t.description ? <Muted>{t.description}</Muted> : null}
              {t.done ? (
                <Muted>
                  Concluída às {formatTime(t.completedAt)}
                  {t.notes ? `: ${t.notes}` : ''}
                </Muted>
              ) : null}
              {inProgress && !lunch ? (
                needsPhoto(t) ? (
                  <Button
                    title={t.done ? 'Fotografar de novo' : 'Fotografar atividade'}
                    variant="secondary"
                    disabled={!!uploading}
                    onPress={() => void capture('ATIVIDADE_EXTRA', { taskId: t.id })}
                  />
                ) : !t.done ? (
                  <Button title="Concluir atividade" variant="secondary" onPress={() => setCompletingTask(t)} />
                ) : null
              ) : null}
            </Card>
          )
        })}
      </>
    ) : null

  const canJustify = day.isToday && !dayEnded && (visit.status === 'PENDENTE' || inProgress)
  const thumbs = (list: Photo[]) =>
    list.length > 0 ? (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {list.map((ph) => (
          <PhotoThumb
            key={ph.id}
            url={ph.url}
            size={sizes.miniatura}
            label={ph.type === 'DEPOIS' ? (ph.products?.length ? `${ph.products.length} produto(s)` : 'Sem produtos') : photoTypeLabels[ph.type]}
            onPress={() => setViewing(ph)}
          />
        ))}
      </View>
    ) : null
  const stateOf = (key: StepKey, done: boolean): 'done' | 'current' | 'todo' => (done ? 'done' : key === current ? 'current' : 'todo')
  const ownButton = (key: StepKey) => !enforced && key !== current
  const stepState = (key: StepKey) => stateOf(key, steps.find((st) => st.key === key)?.done ?? false)
  const numberOf = (key: StepKey) => steps.findIndex((st) => st.key === key) + 1
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${visit.client.latitude},${visit.client.longitude}`
  const addMore = (label: string, onPress: () => void, disabled?: boolean) => <TextAction title={label} onPress={onPress} disabled={disabled || !!uploading} />

  const bar =
    inProgress && !keyboardOpen ? (
      <View style={[localStyles.bar, { paddingBottom: insets.bottom + space.md }]}>
        <Text style={[type.textoForte, styles.number]}>{stepText}</Text>
        <Button title={barAction.title} onPress={barAction.onPress} disabled={barAction.disabled} loading={barAction.loading} />
      </View>
    ) : null

  return (
    <Screen refreshing={query.refreshing} onRefresh={query.refresh} footer={bar}>
      {inProgress ? (
        // O que importa agora: o passo atual e quanto falta, o tempo no cliente, e o cliente numa faixa compacta
        <Card variant="emAtendimento">
          <Text style={[type.textoForte, styles.number, { color: colors.marinho }]}>{stepText}</Text>
          <Text style={[styles.text, styles.number]}>
            {reopened ? 'Reaberto' : 'Em atendimento'} há {formatMinutes(minutesSince(openSince))} (desde {formatTime(openSince)})
          </Text>
          {rules.minVisitMinutes > 0 ? <Muted>Tempo mínimo no cliente: {rules.minVisitMinutes} min</Muted> : null}
          {reopened ? <Muted>Aberturas de hoje: {formatSessions(visit)}. O que já foi feito continua valendo.</Muted> : null}
          <View style={localStyles.clientStrip}>
            <Text style={styles.sectionTitle} numberOfLines={1}>
              {visit.client.name}
            </Text>
            {visit.client.city ? <Muted numberOfLines={1}>{placeOf(visit.client)}</Muted> : null}
            <TextAction title="Abrir no mapa / como chegar" onPress={() => void Linking.openURL(mapUrl)} style={{ alignSelf: 'flex-start' }} />
          </View>
        </Card>
      ) : (
        <Card>
          <Row>
            <Badge label={status.label} tone={status.tone} />
            {originLabels[visit.origin] ? <Badge label={originLabels[visit.origin]!} tone="neutro" /> : null}
            {reopened ? <Badge label="Reaberto" tone="neutro" /> : null}
            {visit.autoClosed ? <Badge label="Encerrado automaticamente" tone="neutro" /> : null}
            {!isDefaultStructure(modules) ? <Badge label={structureLabel(modules)} tone="neutro" /> : null}
            <Muted>#{visit.position} do roteiro</Muted>
          </Row>
          <Text style={styles.sectionTitle}>{visit.client.name}</Text>
          {visit.client.legalName && visit.client.legalName !== visit.client.name ? <Muted>{visit.client.legalName}</Muted> : null}
          {visit.client.city ? <Muted>{placeOf(visit.client)}</Muted> : null}
          <TextAction title="Abrir no mapa / como chegar" onPress={() => void Linking.openURL(mapUrl)} style={{ alignSelf: 'flex-start' }} />
          <Muted>{visit.client.geofenceExempt ? 'Cliente sem cerca eletrônica: a abertura e o check-out valem de qualquer lugar.' : `Cerca eletrônica: ${radius} m`}</Muted>
        </Card>
      )}

      {visit.scheduled && (visit.origin === 'PONTUAL' || visit.scheduled.note) ? (
        <Banner
          tone="info"
          text={
            visit.origin === 'PONTUAL'
              ? `Visita pontual incluída por ${visit.scheduled.createdBy}. Pode ser atendida a qualquer momento do dia.${visit.scheduled.note ? `\nRecado: ${visit.scheduled.note}` : ''}`
              : `Recado de ${visit.scheduled.createdBy}: ${visit.scheduled.note}`
          }
        />
      ) : null}

      {pendingRequests.map((r) => (
        <Banner key={r.id} tone="info" text={`Aguardando supervisor: ${permissionLabels[r.type] ?? r.type}`} />
      ))}
      {visit.geofenceWaived && visit.status !== 'CONCLUIDA' ? <Banner tone="success" text="Supervisor liberou este cliente fora da cerca eletrônica." /> : null}
      {visit.photosWaived ? (
        <Banner tone="success" text={`Supervisor dispensou as fotos deste cliente (fachada${hasPhotoStep ? ', antes, depois e ruptura' : ''}).`} />
      ) : null}
      {visit.routeOrderWaived && visit.status === 'PENDENTE' ? (
        <Banner tone="success" text="Supervisor liberou este cliente da ordem do roteiro: você pode atendê-lo a qualquer momento." />
      ) : null}

      {visit.status === 'PENDENTE' ? (
        dayEnded ? (
          <Banner
            tone="info"
            text={
              day.isToday && day.rules.allowExtraVisits
                ? 'O roteiro de hoje já foi encerrado. Para atender este cliente, toque em "Incluir cliente e reabrir o roteiro" em Meu dia e escolha ele.'
                : 'O roteiro de hoje já foi encerrado.'
            }
          />
        ) : !day.isToday ? (
          <Banner tone="info" text="Esta visita não é de hoje." />
        ) : (
          <>
            {lunch ? (
              <Banner
                tone="warning"
                text={`Você está em almoço desde ${formatTime(day.workDay?.lunchStartedAt)}. Abrir este atendimento (ou justificá-lo) encerra o almoço. A justificativa precisa ser feita na cerca deste cliente ou do próximo do roteiro.`}
              />
            ) : null}
            {blockedByOrder && nextVisit ? (
              <Banner
                tone="info"
                text={`Pela ordem do roteiro, o próximo cliente é ${nextVisit.client.name}. Para atender este antes, peça para antecipá-lo ou para não seguir a ordem.`}
              />
            ) : null}
            {needsFacade ? <Muted>Para abrir o atendimento você precisa estar na loja e tirar a foto da fachada.</Muted> : null}
            <Button title={needsFacade ? 'Abrir atendimento (foto da fachada)' : 'Abrir atendimento'} onPress={() => void checkin('checkin')} loading={busy === 'checkin'} />
            {blockedByOrder ? (
              <>
                <Button title="Pedir para antecipar este cliente" variant="secondary" onPress={() => router.push({ pathname: '/promotor/ordem', params: { first: visit.id } })} />
                <Button title="Pedir para não seguir a ordem" variant="secondary" onPress={() => goRequest('LIVRE_ORDEM_CLIENTE')} />
              </>
            ) : null}
          </>
        )
      ) : null}

      {inProgress ? (
        <>
          <Step
            n={numberOf('FACHADA')}
            title="Fachada"
            state={stepState('FACHADA')}
            detail={facadePhotos.length > 0 ? formatTime(facadePhotos[0]!.takenAt) : 'não exigida'}
            onPressDone={facadePhotos[0] ? () => setViewing(facadePhotos[0]!) : undefined}
          />

          {hasPhotoStep ? (
            <>
              <Step
                n={numberOf('ANTES')}
                title="Foto de antes"
                state={stepState('ANTES')}
                detail={beforePhotos.length > 0 ? `${beforePhotos.length} foto(s) · ${formatTime(beforePhotos[0]!.takenAt)}` : 'Como a gôndola estava ao chegar'}
                onPressDone={beforePhotos[0] ? () => setViewing(beforePhotos[0]!) : undefined}
                doneAction={canBefore ? addMore('+ outra', () => void capture('ANTES')) : undefined}
              >
                {thumbs(beforePhotos)}
                {ownButton('ANTES') ? (
                  <Button title={uploading === 'ANTES' ? 'Enviando...' : 'Tirar foto de antes'} variant="secondary" disabled={!!uploading || !canBefore} onPress={() => void capture('ANTES')} />
                ) : null}
                {!canBefore ? <Muted>Já existem fotos de depois: a foto de antes vem antes delas.</Muted> : null}
              </Step>

              <Step
                n={numberOf('DEPOIS')}
                title="Fotos de depois, marcando os produtos"
                state={stepState('DEPOIS')}
                detail={
                  afterPhotos.length > 0
                    ? `${afterPhotos.length} foto(s), ${markedProducts} produto(s) marcados`
                    : 'Como a gôndola ficou, com os produtos identificados'
                }
                onPressDone={afterPhotos[0] ? () => setViewing(afterPhotos[0]!) : undefined}
                doneAction={addMore('+ outra', captureAfter, !canAfter)}
              >
                {thumbs(afterPhotos)}
                {afterWithoutProducts > 0 ? <Banner tone="warning" text={`${afterWithoutProducts} foto(s) de depois sem produtos marcados. Toque na foto e use "Editar produtos".`} /> : null}
                {ownButton('DEPOIS') ? (
                  <Button title={uploading === 'DEPOIS' ? 'Enviando...' : 'Tirar foto de depois'} variant="secondary" disabled={!!uploading || !canAfter} onPress={captureAfter} />
                ) : null}
                {!canAfter ? <Muted>Tire a foto de antes primeiro.</Muted> : null}
              </Step>

              <Step
                n={numberOf('RUPTURA')}
                title="Ruptura"
                state={stepState('RUPTURA')}
                detail={
                  progress?.ruptureConfirmed
                    ? visit.ruptures?.length
                      ? `confirmada: ${visit.ruptures.map((pr) => pr.name).join(', ')}`
                      : 'confirmada: nenhuma'
                    : 'Produtos que o cliente compra e não aparecem nas fotos de depois'
                }
                onPressDone={() => setRuptureOpen(true)}
              >
                {ownButton('RUPTURA') ? (
                  <Button title="Conferir e confirmar ruptura" variant="secondary" disabled={!!uploading || !canRupture} onPress={() => setRuptureOpen(true)} />
                ) : null}
                {!canRupture ? <Muted>Antes, tire as fotos de depois e marque os produtos em todas elas.</Muted> : null}
              </Step>
            </>
          ) : null}

          {hasStock ? (
            <Step
              n={numberOf('ESTOQUE')}
              title="Contagem de estoque"
              state={stepState('ESTOQUE')}
              detail={progress?.stockConfirmed && visit.stockConfirmedAt ? `confirmada às ${formatTime(visit.stockConfirmedAt)}` : 'Faça a contagem do estoque da loja e confirme aqui'}
            >
              {ownButton('ESTOQUE') ? <Button title="Confirmar que fiz a contagem" variant="secondary" loading={busy === 'stock'} onPress={confirmStock} /> : null}
            </Step>
          ) : null}

          {requiredTasks.length > 0 ? (
            <Step
              n={numberOf('TAREFA')}
              title="Atividades obrigatórias"
              state={stepState('TAREFA')}
              detail={pendingRequired.length > 0 ? `${pendingRequired.length} pendente(s): ${pendingRequired.map((t) => t.title).join('; ')}` : 'feitas'}
            />
          ) : null}

          <Step
            n={numberOf('CHECKOUT')}
            title="Encerrar atendimento"
            state={stepState('CHECKOUT')}
            detail={rules.requireGeofenceOnCheckout && !visit.client.geofenceExempt ? 'O check-out também precisa ser feito na loja.' : undefined}
          >
            <Field label="Observações do atendimento" value={notes} onChangeText={setNotes} multiline placeholder="Opcional" />
            {ownButton('CHECKOUT') ? <Button title="Fazer check-out" variant="secondary" onPress={checkout} loading={busy === 'checkout'} disabled={!!uploading} /> : null}
          </Step>

          {hasActivities ? tasksBlock : null}

          <SectionTitle>Outras fotos</SectionTitle>
          <Muted>Podem ser tiradas a qualquer momento do atendimento.</Muted>
          {thumbs(otherPhotos)}
          <Row style={{ flexWrap: 'nowrap' }}>
            <Button title={uploading === 'VENCIMENTO' ? 'Enviando...' : '+ Vencimento'} small variant="secondary" disabled={!!uploading} onPress={() => setInfoFor('VENCIMENTO')} style={{ flex: 1 }} />
            {hasActivities ? (
              <Button
                title={uploading === 'ATIVIDADE_EXTRA' ? 'Enviando...' : '+ Atividade extra'}
                small
                variant="secondary"
                disabled={!!uploading}
                onPress={() => setInfoFor('ATIVIDADE_EXTRA')}
                style={{ flex: 1 }}
              />
            ) : null}
          </Row>
          {uploading ? (
            <Row>
              <ActivityIndicator color={colors.marinho} />
              <Muted>Enviando foto...</Muted>
            </Row>
          ) : null}
          {enforced && progress && progress.missing.some((m) => PHOTO_STEPS.includes(m)) ? (
            <TextAction title="Não consigo fazer as fotos: pedir dispensa" onPress={() => goRequest('DISPENSA_FOTOS')} />
          ) : null}
        </>
      ) : null}

      {!inProgress && photos.length > 0 ? (
        <>
          <SectionTitle>Fotos</SectionTitle>
          {thumbs(photos)}
        </>
      ) : null}

      {!inProgress && hasActivities ? tasksBlock : null}

      {visit.status === 'CONCLUIDA' ? (
        <Card>
          <Text style={[styles.optionText, styles.number]}>
            {reopened ? 'Atendido em ' : 'Atendido '}
            {formatSessions(visit)} ({formatMinutes(visitMinutes(visit))} no cliente)
          </Text>
          {visit.autoClosed ? (
            <Banner tone="warning" text="Faltou o check-out. O atendimento foi encerrado automaticamente quando você abriu o próximo cliente, no horário da última foto tirada aqui." />
          ) : null}
          {hasStock ? <Muted>{visit.stockConfirmedAt ? `Contagem de estoque confirmada às ${formatTime(visit.stockConfirmedAt)}.` : 'Contagem de estoque não confirmada.'}</Muted> : null}
          {visit.ruptureConfirmedAt ? (
            visit.ruptures?.length ? (
              <Text style={styles.text}>Rupturas confirmadas: {visit.ruptures.map((pr) => pr.name).join(', ')}</Text>
            ) : (
              <Muted>Sem ruptura.</Muted>
            )
          ) : null}
          {visit.notes ? <Muted>{visit.notes}</Muted> : null}
        </Card>
      ) : null}

      {canReopen ? (
        <View style={{ gap: space.sm }}>
          {lunch ? <Banner tone="warning" text={`Você está em almoço desde ${formatTime(day.workDay?.lunchStartedAt)}. Reabrir este cliente encerra o almoço.`} /> : null}
          <Muted>Voltou a este cliente? Reabra e continue de onde parou.{needsFacade ? ' É preciso estar na loja e tirar a foto da fachada.' : ''}</Muted>
          <Button
            title={needsFacade ? 'Reabrir atendimento (foto da fachada)' : 'Reabrir atendimento'}
            variant="secondary"
            onPress={() => void checkin('reopen')}
            loading={busy === 'reopen'}
          />
        </View>
      ) : null}

      {visit.status === 'JUSTIFICADA' && visit.justification ? (
        <Card>
          <Text style={styles.optionText}>Justificado: {visit.justification.reason}</Text>
          <Muted>{visit.justification.text}</Muted>
        </Card>
      ) : null}

      {canJustify ? (
        <View style={{ marginTop: space.md }}>
          <TextAction title="Justificar não atendimento" onPress={() => setJustifyOpen(true)} />
          {visit.status === 'PENDENTE' ? <TextAction title="Pedir troca deste cliente" onPress={() => goRequest('SUBSTITUIR_CLIENTE')} /> : null}
          {visit.status === 'PENDENTE' && visit.origin === 'EXTRA' ? <TextAction title="Remover cliente extra" onPress={removeExtra} disabled={busy === 'remove'} /> : null}
        </View>
      ) : null}

      <PhotoInfoSheet
        type={infoFor}
        tasks={tasks.filter(needsPhoto)}
        onClose={() => setInfoFor(null)}
        onContinue={(extra) => {
          const type = infoFor!
          setInfoFor(null)
          void capture(type, extra)
        }}
      />

      <ProductPicker
        visible={!!pendingAfter}
        visitId={visit.id}
        title="Produtos na foto de depois"
        previewUri={pendingAfter?.asset.uri}
        required={enforced}
        confirmLabel="Enviar foto de depois"
        onConfirm={async (productIds) => {
          const shot = pendingAfter!
          setPendingAfter(null)
          // Promotor confirmou o aviso de foto rápida: fica registrado na foto para o painel
          const meta = shot.warning ? { avisoIntervaloCurto: true, minutosAposAntes: shot.warning.minutesAfterBefore } : undefined
          await upload(shot.asset, 'DEPOIS', { productIds, takenAt: shot.takenAt, meta })
        }}
        onClose={() =>
          Alert.alert('Descartar a foto de depois?', 'A foto só é enviada depois de marcar os produtos.', [
            { text: 'Continuar marcando', style: 'cancel' },
            { text: 'Descartar', style: 'destructive', onPress: () => setPendingAfter(null) },
          ])
        }
      />

      <ProductPicker
        visible={!!editingPhoto}
        visitId={visit.id}
        title="Editar produtos da foto"
        initialSelected={editingPhoto?.products?.map((p) => p.id) ?? []}
        previewUri={editingPhoto ? resolveUrl(editingPhoto.url) : null}
        required={enforced}
        confirmLabel="Salvar produtos"
        onConfirm={async (productIds) => {
          try {
            await api(`/promotor/photos/${editingPhoto!.id}/products`, { method: 'PUT', body: { productIds } })
            setEditingPhoto(null)
            await refreshAll()
          } catch (e) {
            handleError(e, 'Produtos não salvos')
          }
        }}
        onClose={() => setEditingPhoto(null)}
      />

      <RuptureSheet
        visible={ruptureOpen}
        visitId={visit.id}
        onClose={() => setRuptureOpen(false)}
        onConfirmed={(updated) => {
          setRuptureOpen(false)
          query.setData(updated)
          void reloadDay()
        }}
      />

      <CompleteTaskSheet task={completingTask} onClose={() => setCompletingTask(null)} onSubmit={(t, n) => completeTask(t, n)} />

      <JustifySheet
        visible={justifyOpen}
        reasons={day.reasons}
        minLength={rules.justificationMinLength}
        onClose={() => setJustifyOpen(false)}
        onSubmit={async (reasonId, text) => {
          const wasOnLunch = lunch
          try {
            // No almoço a justificativa é a volta do almoço: precisa da posição exata, na cerca deste cliente ou do próximo
            const loc = wasOnLunch ? await getPreciseLocation() : await getQuickLocation()
            await api(`/promotor/visits/${visit.id}/justify`, { body: { reasonId, text, latitude: loc?.latitude, longitude: loc?.longitude } })
            setJustifyOpen(false)
            await refreshAll()
            if (wasOnLunch) Alert.alert('Volta do almoço', `Almoço encerrado às ${formatTime(new Date().toISOString())}.`)
          } catch (e) {
            handleError(e, 'Justificativa não registrada', { noRelease: wasOnLunch })
          }
        }}
      />

      <PhotoViewer url={viewing?.url ?? null} visible={!!viewing} onClose={() => setViewing(null)}>
        {viewing ? (
          <>
            <Text style={styles.sectionTitle}>{photoTypeLabels[viewing.type]}</Text>
            <Muted>Tirada às {formatTime(viewing.takenAt)}</Muted>
            {viewing.meta ? <Muted>{formatMeta(viewing.meta)}</Muted> : null}
            {viewing.notes ? <Text style={styles.text}>{viewing.notes}</Text> : null}
            {viewing.type === 'DEPOIS' ? (
              viewing.products?.length ? (
                <Text style={styles.text}>Produtos marcados: {viewing.products.map((p) => p.name).join(', ')}</Text>
              ) : (
                <Banner tone="warning" text="Nenhum produto marcado nesta foto." />
              )
            ) : null}
            {inProgress && viewing.type === 'DEPOIS' ? <Button title="Editar produtos" variant="secondary" onPress={() => editProducts(viewing)} /> : null}
            {inProgress && viewing.type !== 'FACHADA' ? (
              <Button
                title="Apagar foto"
                variant="exit"
                onPress={() =>
                  Alert.alert('Apagar esta foto?', viewing.type === 'DEPOIS' ? 'A confirmação de ruptura precisará ser feita de novo.' : undefined, [
                    { text: 'Cancelar', style: 'cancel' },
                    { text: 'Apagar', style: 'destructive', onPress: () => void deletePhoto(viewing) },
                  ])
                }
              />
            ) : null}
          </>
        ) : null}
      </PhotoViewer>
    </Screen>
  )
}

/** Conclui uma atividade sem foto, com observação/resposta opcional. */
function CompleteTaskSheet({ task, onClose, onSubmit }: { task: VisitTask | null; onClose: () => void; onSubmit: (task: VisitTask, notes: string) => Promise<void> }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (task) setText('')
  }, [task])
  return (
    <Sheet visible={!!task} title="Concluir atividade" onClose={onClose}>
      {task ? (
        <>
          <Text style={styles.optionText}>{task.title}</Text>
          {task.description ? <Muted>{task.description}</Muted> : null}
          <Field label="Observação / resposta" value={text} onChangeText={setText} multiline placeholder="Opcional" />
          <Button
            title="Concluir atividade"
            loading={busy}
            onPress={async () => {
              setBusy(true)
              try {
                await onSubmit(task, text)
              } finally {
                setBusy(false)
              }
            }}
          />
        </>
      ) : null}
    </Sheet>
  )
}

function JustifySheet({
  visible,
  reasons,
  minLength,
  onClose,
  onSubmit,
}: {
  visible: boolean
  reasons: { id: string; label: string }[]
  minLength: number
  onClose: () => void
  onSubmit: (reasonId: string, text: string) => Promise<void>
}) {
  const [reasonId, setReasonId] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (visible) {
      setReasonId(null)
      setText('')
    }
  }, [visible])
  const ok = !!reasonId && text.trim().length >= minLength
  return (
    <Sheet visible={visible} title="Justificar não atendimento" onClose={onClose}>
      <Text style={styles.label}>Motivo</Text>
      {reasons.map((r) => (
        <Pressable key={r.id} onPress={() => setReasonId(r.id)} style={[styles.option, reasonId === r.id && styles.optionActive]}>
          <Text style={styles.optionText}>{r.label}</Text>
        </Pressable>
      ))}
      <Field label="Explique o que aconteceu" value={text} onChangeText={setText} multiline hint={`${text.trim().length}/${minLength} caracteres no mínimo`} />
      <Button
        title="Registrar justificativa"
        variant="reject"
        disabled={!ok}
        missing={!reasonId ? 'Escolha o motivo' : `Explique com pelo menos ${minLength} caracteres`}
        loading={busy}
        onPress={async () => {
          setBusy(true)
          try {
            await onSubmit(reasonId!, text.trim())
          } finally {
            setBusy(false)
          }
        }}
      />
    </Sheet>
  )
}

const localStyles = StyleSheet.create({
  doneCircle: {
    width: space.xxl,
    height: space.xxl,
    borderRadius: space.xxl / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.feitoSuave,
  },
  clientStrip: { gap: space.xs / 2, paddingTop: space.sm, borderTopWidth: borders.fina, borderTopColor: colors.divisoria },
  // Barra fixa do passo atual
  bar: {
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    backgroundColor: colors.superficie,
    borderTopWidth: borders.fina,
    borderTopColor: colors.divisoria,
    ...elevated,
  },
})

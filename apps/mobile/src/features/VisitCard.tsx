import { Text, View } from 'react-native'
import { Badge, Card, NumberCircle, Row, styles } from '@/components/ui'
import { formatMinutes, formatSessions, isDefaultStructure, originLabels, placeOf, structureLabel, visitMinutes, visitStatusFor } from '@/lib/format'
import { space } from '@/lib/theme'
import type { Visit } from '@/lib/types'

/**
 * Cartão de visita do "Meu dia" do promotor e do dia do promotor visto pelo supervisor.
 * Próximo cliente: borda e número marinho, selo "Próximo". Em atendimento: borda azul, número em azul suave.
 * As atividades vão no subtítulo ("Salvador - BA · 2 atividades"). `compact`: uma linha só, para o cliente que já
 * aparece no cartão "Agora" (marcado "acima").
 */
export function VisitCard({
  visit,
  isNext,
  dayOpen = true,
  compact,
  onPress,
}: {
  visit: Visit
  isNext?: boolean
  /** Dia em andamento: "Não feito" fica cinza (vermelho nos dias encerrados) */
  dayOpen?: boolean
  compact?: boolean
  onPress?: () => void
}) {
  const status = visitStatusFor(visit.status, dayOpen)
  const origin = originLabels[visit.origin]
  const pendingRequests = visit.requests?.filter((r) => r.status === 'PENDENTE').length ?? 0
  const tasksOpen = visit.status === 'CONCLUIDA' ? 0 : (visit.tasks?.filter((t) => !t.done).length ?? 0)
  const reopened = (visit.sessions?.length ?? 0) > 1
  const inProgress = visit.status === 'EM_ATENDIMENTO'
  const circleTone = isNext ? 'marinho' : status.tone
  const subtitle = [visit.client.city ? placeOf(visit.client) : null, tasksOpen > 0 ? `${tasksOpen} ${tasksOpen === 1 ? 'atividade' : 'atividades'}` : null]
    .filter(Boolean)
    .join(' · ')

  if (compact) {
    return (
      <Card onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm }}>
        <NumberCircle n={visit.position} tone={circleTone} />
        <Text style={[styles.optionText, { flex: 1 }]} numberOfLines={1}>
          {visit.client.name}
        </Text>
        <Badge label="acima" tone="neutro" />
      </Card>
    )
  }

  return (
    <Card onPress={onPress} variant={isNext ? 'proximo' : inProgress ? 'emAtendimento' : 'normal'}>
      <View style={{ flexDirection: 'row', gap: space.md }}>
        <NumberCircle n={visit.position} tone={circleTone} />
        <View style={{ flex: 1, gap: space.xs }}>
          <Text style={styles.sectionTitle} numberOfLines={2}>
            {visit.client.name}
          </Text>
          {subtitle ? (
            <Text style={styles.muted} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
          <Row>
            {isNext ? <Badge label="Próximo" marinho /> : <Badge label={status.label} tone={status.tone} />}
            {origin ? <Badge label={origin} tone="neutro" /> : null}
            {!isDefaultStructure(visit.modules) ? <Badge label={structureLabel(visit.modules!)} tone="neutro" /> : null}
            {visit.geofenceWaived ? <Badge label="Cerca liberada" tone="neutro" /> : null}
            {visit.client.geofenceExempt ? <Badge label="Sem cerca" tone="neutro" /> : null}
            {visit.photosWaived ? <Badge label="Fotos dispensadas" tone="neutro" /> : null}
            {visit.routeOrderWaived && visit.status === 'PENDENTE' ? <Badge label="Fora da ordem" tone="neutro" /> : null}
            {reopened ? <Badge label="Reaberto" tone="neutro" /> : null}
            {visit.autoClosed ? <Badge label="Encerrado automaticamente" tone="neutro" /> : null}
            {visit.status === 'CONCLUIDA' && visit.ruptures?.length ? <Badge label={`${visit.ruptures.length} ruptura(s)`} tone="naoFeito" /> : null}
            {pendingRequests > 0 ? <Badge label="Aguardando supervisor" tone="neutro" /> : null}
          </Row>
          {visit.checkinAt ? (
            <Text style={[styles.muted, styles.number]}>
              {formatSessions(visit)} ({formatMinutes(visitMinutes(visit))})
              {visit.photos ? ` · ${visit.photos.length} foto(s)` : ''}
            </Text>
          ) : null}
          {visit.justification ? (
            <Text style={styles.muted} numberOfLines={2}>
              {visit.justification.reason}: {visit.justification.text}
            </Text>
          ) : null}
          {visit.scheduled?.note ? (
            <Text style={styles.muted} numberOfLines={2}>
              Recado de {visit.scheduled.createdBy}: {visit.scheduled.note}
            </Text>
          ) : null}
        </View>
      </View>
    </Card>
  )
}

import { Text, View } from 'react-native'
import { Badge, Card, Row, styles } from '@/components/ui'
import { formatMinutes, formatSessions, isDefaultStructure, originLabels, placeOf, structureLabel, visitMinutes, visitStatusInfo } from '@/lib/format'
import { colors, space } from '@/lib/theme'
import type { Visit } from '@/lib/types'

/** Cartão de visita usado no "Meu dia" do promotor e no dia do promotor visto pelo supervisor. */
export function VisitCard({ visit, isNext, onPress }: { visit: Visit; isNext?: boolean; onPress?: () => void }) {
  const status = visitStatusInfo[visit.status]
  const origin = originLabels[visit.origin]
  const pendingRequests = visit.requests?.filter((r) => r.status === 'PENDENTE').length ?? 0
  const tasksOpen = visit.tasks?.filter((t) => !t.done).length ?? 0
  const reopened = (visit.sessions?.length ?? 0) > 1

  return (
    <Card onPress={onPress} style={[isNext && { borderColor: colors.primary, borderWidth: 2 }, visit.status === 'EM_ATENDIMENTO' && { borderColor: colors.info, borderWidth: 2 }]}>
      <View style={{ flexDirection: 'row', gap: space.md }}>
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: 17,
            backgroundColor: status.bg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontWeight: '800', color: status.color }}>{visit.position}</Text>
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={[styles.sectionTitle, { fontSize: 16 }]} numberOfLines={2}>
            {visit.client.name}
          </Text>
          {visit.client.city ? (
            <Text style={styles.muted} numberOfLines={1}>
              {placeOf(visit.client)}
            </Text>
          ) : null}
          <Row style={{ marginTop: 2 }}>
            <Badge label={status.label} color={status.color} bg={status.bg} />
            {isNext ? <Badge label="Próximo" color="#fff" bg={colors.primary} /> : null}
            {origin ? <Badge label={origin} color={colors.info} bg={colors.infoSoft} /> : null}
            {!isDefaultStructure(visit.modules) ? <Badge label={structureLabel(visit.modules!)} color={colors.primary} bg={colors.primarySoft} /> : null}
            {visit.geofenceWaived ? <Badge label="Cerca liberada" color={colors.warning} bg={colors.warningSoft} /> : null}
            {visit.photosWaived ? <Badge label="Fotos dispensadas" color={colors.warning} bg={colors.warningSoft} /> : null}
            {visit.routeOrderWaived && visit.status === 'PENDENTE' ? <Badge label="Fora da ordem" color={colors.warning} bg={colors.warningSoft} /> : null}
            {reopened ? <Badge label="Reaberto" color={colors.info} bg={colors.infoSoft} /> : null}
            {visit.autoClosed ? <Badge label="Encerrado automaticamente" color={colors.warning} bg={colors.warningSoft} /> : null}
            {visit.status === 'CONCLUIDA' && visit.ruptures?.length ? (
              <Badge label={`${visit.ruptures.length} ruptura(s)`} color={colors.danger} bg={colors.dangerSoft} />
            ) : null}
            {pendingRequests > 0 ? <Badge label="Aguardando supervisor" color={colors.warning} bg={colors.warningSoft} /> : null}
            {tasksOpen > 0 && visit.status !== 'CONCLUIDA' ? <Badge label={`${tasksOpen} atividade(s)`} color={colors.primary} bg={colors.primarySoft} /> : null}
          </Row>
          {visit.checkinAt ? (
            <Text style={styles.muted}>
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

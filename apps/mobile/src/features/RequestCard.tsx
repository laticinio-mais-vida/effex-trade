import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { Badge, Card, Row, styles } from '@/components/ui'
import { formatDateTime, requestStatusInfo } from '@/lib/format'
import { colors, space } from '@/lib/theme'
import type { PermissionRequest } from '@/lib/types'

/** Detalhes legíveis do payload de cada tipo de liberação. */
function PayloadDetails({ request }: { request: PermissionRequest }) {
  const p = request.payload
  if (!p) return null
  if (request.type === 'ALTERAR_ORDEM' && Array.isArray(p.to)) {
    return (
      <View style={{ gap: 2 }}>
        <Text style={styles.label}>Nova ordem proposta</Text>
        {(p.to as string[]).map((name, i) => {
          const moved = Array.isArray(p.from) && p.from[i] !== name
          return (
            <Text key={`${name}-${i}`} style={[styles.text, moved && { fontWeight: '700', color: colors.primary }]}>
              {i + 1}. {name}
            </Text>
          )
        })}
      </View>
    )
  }
  if (request.type === 'SUBSTITUIR_CLIENTE' && p.clientName) {
    return (
      <Text style={styles.text}>
        Trocar <Text style={{ fontWeight: '700' }}>{p.replacedClientName ?? request.visit?.client.name}</Text> por{' '}
        <Text style={{ fontWeight: '700' }}>{p.clientName}</Text>
      </Text>
    )
  }
  return null
}

export function RequestCard({ request, showPromotor, actions }: { request: PermissionRequest; showPromotor?: boolean; actions?: ReactNode }) {
  const status = requestStatusInfo[request.status]
  const direct = request.createdBy.role !== 'PROMOTOR'
  return (
    <Card style={request.status === 'PENDENTE' && { borderColor: colors.warning }}>
      <Row style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
        <Text style={[styles.sectionTitle, { flex: 1, fontSize: 16 }]}>{request.typeLabel}</Text>
        <Badge label={status.label} color={status.color} bg={status.bg} />
      </Row>
      {showPromotor ? <Text style={[styles.text, { fontWeight: '600' }]}>{request.promotor.name}</Text> : null}
      {request.visit ? (
        <Text style={styles.text}>
          Cliente: {request.visit.client.code ? `${request.visit.client.code} · ` : ''}
          {request.visit.client.name} (#{request.visit.position})
        </Text>
      ) : null}
      <PayloadDetails request={request} />
      {request.reason ? <Text style={[styles.text, { fontStyle: 'italic' }]}>"{request.reason}"</Text> : null}
      <Text style={styles.muted}>
        {direct ? `Liberação direta de ${request.createdBy.name}` : 'Pedido'} às {formatDateTime(request.createdAt)}
      </Text>
      {request.decidedAt && !direct ? (
        <View style={{ gap: 2, paddingTop: space.xs }}>
          <Text style={styles.muted}>
            {status.label} por {request.decidedBy?.name ?? 'supervisor'} às {formatDateTime(request.decidedAt)}
          </Text>
          {request.decisionNote ? <Text style={styles.text}>{request.decisionNote}</Text> : null}
        </View>
      ) : null}
      {actions}
    </Card>
  )
}

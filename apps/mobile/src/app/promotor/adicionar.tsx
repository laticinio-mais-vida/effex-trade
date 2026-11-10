import { useRouter } from 'expo-router'
import { Alert } from 'react-native'
import { Muted, Screen } from '@/components/ui'
import { ClientSearch } from '@/features/ClientSearch'
import { dayClosed, useDay } from '@/features/promotor/DayContext'
import { api, ApiError, errorMessage } from '@/lib/api'
import type { Client, Visit } from '@/lib/types'

/** Visita de hoje que impede incluir o cliente de novo (a API recusa: o caminho é abrir ou reabrir a visita). */
function blockingVisit(visits: Visit[], clientId: string) {
  return visits.find((v) => v.client.id === clientId && (v.status === 'PENDENTE' || v.status === 'EM_ATENDIMENTO' || v.status === 'CONCLUIDA'))
}

export default function AdicionarCliente() {
  const router = useRouter()
  const { day, reload } = useDay()
  const visits = day?.visits ?? []

  function goToVisit(visitId: string) {
    router.replace(`/promotor/visita/${visitId}`)
  }

  // Roteiro já encerrado hoje: escolher um cliente reabre o roteiro (o promotor volta às atividades)
  const closed = dayClosed(day)

  async function include(client: Client) {
    try {
      const res = await api<Visit & { reopened?: boolean }>('/promotor/visits', { body: { clientId: client.id } })
      await reload()
      // Reabriu o roteiro: vai direto para o cliente (novo ou o que já estava no dia)
      if (res.reopened) router.replace(`/promotor/visita/${res.id}`)
      else router.back()
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CLIENTE_NO_ROTEIRO' && e.details?.visitId) {
        const visitId: string = e.details.visitId
        Alert.alert('Cliente já está no seu dia', e.message, [
          { text: 'Fechar', style: 'cancel' },
          { text: 'Ir para o cliente', onPress: () => goToVisit(visitId) },
        ])
        void reload()
        return
      }
      Alert.alert('Não foi possível incluir', errorMessage(e))
    }
  }

  function select(client: Client) {
    const existing = blockingVisit(visits, client.id)
    if (closed) {
      Alert.alert(
        'Reabrir o roteiro?',
        `O roteiro de hoje está encerrado. ${
          existing ? `${client.name} já está no seu dia: o roteiro é reaberto e você vai direto para ele.` : `${client.name} entra como cliente extra e o roteiro é reaberto.`
        }\n\nO envio de localização volta a ligar e, no fim, você precisa encerrar o roteiro de novo.`,
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Reabrir e continuar', onPress: () => void include(client) },
        ],
      )
      return
    }
    if (existing) {
      // Cliente já no dia: não repete, leva para a visita (concluída = reabrir e continuar de onde parou)
      goToVisit(existing.id)
      return
    }
    const justified = visits.some((v) => v.client.id === client.id && v.status === 'JUSTIFICADA')
    Alert.alert('Incluir cliente extra?', `${client.name}${justified ? '\n\nEste cliente foi justificado hoje. Será incluída uma nova visita.' : ''}`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Incluir', onPress: () => void include(client) },
    ])
  }

  return (
    <Screen>
      {closed ? (
        <Muted>
          Seu roteiro de hoje está encerrado. Escolher um cliente reabre o roteiro: um cliente novo entra como extra; um cliente que já está no seu dia (atendido ou
          não) volta a poder ser atendido.
        </Muted>
      ) : null}
      <Muted>
        Clientes extras entram no fim da lista e podem ser atendidos a qualquer momento
        {day ? ` (limite de ${day.rules.maxExtraVisitsPerDay} por dia)` : ''}. Para voltar a um cliente já atendido hoje, toque nele e reabra o atendimento.
      </Muted>
      <ClientSearch
        fetcher={(search) => api<Client[]>(`/promotor/clients${search ? `?search=${encodeURIComponent(search)}` : ''}`)}
        onSelect={select}
        note={(c) => {
          const existing = blockingVisit(visits, c.id)
          if (!existing) return visits.some((v) => v.client.id === c.id && v.status === 'JUSTIFICADA') ? 'Justificado hoje: pode incluir de novo' : null
          if (existing.status === 'CONCLUIDA') return 'Atendido hoje: toque para reabrir'
          if (existing.status === 'EM_ATENDIMENTO') return 'Em atendimento agora: toque para abrir'
          return 'No roteiro de hoje: toque para abrir'
        }}
      />
    </Screen>
  )
}

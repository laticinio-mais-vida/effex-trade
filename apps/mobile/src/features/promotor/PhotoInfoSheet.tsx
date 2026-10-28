import { useEffect, useState } from 'react'
import { Pressable, Text } from 'react-native'
import { Button, Field, Muted, Sheet, styles } from '@/components/ui'
import { photoTypeLabels } from '@/lib/format'
import type { PhotoType, VisitTask } from '@/lib/types'

export type PhotoExtra = { taskId?: string; notes?: string; meta?: Record<string, unknown> }

/** DD/MM/AAAA -> AAAA-MM-DD (ou null se inválida). */
function parseBrDate(text: string) {
  const m = text.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return null
  const iso = `${m[3]}-${m[2]}-${m[1]}`
  const d = new Date(`${iso}T12:00:00`)
  return Number.isNaN(d.getTime()) || d.getDate() !== Number(m[1]) ? null : iso
}

function maskDate(text: string) {
  const digits = text.replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
}

/** Informações pedidas antes de abrir a câmera (vencimento, atividade extra). */
export function PhotoInfoSheet({
  type,
  tasks,
  onClose,
  onContinue,
}: {
  type: PhotoType | null
  tasks: VisitTask[]
  onClose: () => void
  onContinue: (extra: PhotoExtra) => void
}) {
  const [product, setProduct] = useState('')
  const [expiry, setExpiry] = useState('')
  const [quantity, setQuantity] = useState('')
  const [notes, setNotes] = useState('')
  const [taskId, setTaskId] = useState<string | null>(null)

  useEffect(() => {
    if (!type) return
    setProduct('')
    setExpiry('')
    setQuantity('')
    setNotes('')
    setTaskId(tasks.find((t) => !t.done)?.id ?? null)
  }, [type, tasks])

  if (!type) return null

  let valid = true
  let extra: PhotoExtra = {}
  if (type === 'VENCIMENTO') {
    const iso = parseBrDate(expiry)
    const qty = Number(quantity)
    valid = product.trim().length >= 2 && !!iso && Number.isInteger(qty) && qty > 0
    extra = { notes: notes.trim() || undefined, meta: { produto: product.trim(), validade: iso, quantidade: qty } }
  } else if (type === 'ATIVIDADE_EXTRA') {
    valid = !!taskId || notes.trim().length >= 5
    extra = { taskId: taskId ?? undefined, notes: notes.trim() || undefined }
  }

  return (
    <Sheet visible title={`Foto: ${photoTypeLabels[type]}`} onClose={onClose}>
      {type === 'VENCIMENTO' ? (
        <Field label="Produto" value={product} onChangeText={setProduct} placeholder="Ex.: Iogurte Morango 170g" />
      ) : null}
      {type === 'VENCIMENTO' ? (
        <>
          <Field label="Validade" value={expiry} onChangeText={(t) => setExpiry(maskDate(t))} placeholder="DD/MM/AAAA" keyboardType="number-pad" error={expiry.length === 10 && !parseBrDate(expiry) ? 'Data inválida' : null} />
          <Field label="Quantidade" value={quantity} onChangeText={(t) => setQuantity(t.replace(/\D/g, ''))} placeholder="Unidades" keyboardType="number-pad" />
        </>
      ) : null}
      {type === 'ATIVIDADE_EXTRA' ? (
        <>
          <Text style={styles.label}>Qual atividade?</Text>
          {tasks.map((t) => (
            <Pressable key={t.id} onPress={() => setTaskId(t.id)} style={[styles.option, taskId === t.id && styles.optionActive]}>
              <Text style={styles.optionText}>
                {t.done ? '✓ ' : ''}
                {t.title}
              </Text>
              {t.description ? <Muted>{t.description}</Muted> : null}
            </Pressable>
          ))}
          <Pressable onPress={() => setTaskId(null)} style={[styles.option, taskId === null && styles.optionActive]}>
            <Text style={styles.optionText}>Outra atividade (descrever)</Text>
          </Pressable>
        </>
      ) : null}
      <Field
        label={type === 'ATIVIDADE_EXTRA' && !taskId ? 'Descrição da atividade' : 'Observação'}
        value={notes}
        onChangeText={setNotes}
        multiline
        placeholder={type === 'ATIVIDADE_EXTRA' && !taskId ? 'O que foi feito? (mínimo 5 caracteres)' : 'Opcional'}
      />
      <Button title="Abrir câmera" disabled={!valid} onPress={() => onContinue(extra)} />
    </Sheet>
  )
}

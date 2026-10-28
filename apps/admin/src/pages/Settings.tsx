import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'
import type { PromotorOverride, SettingMeta, SettingsResponse } from '../types'
import { ErrorBox, Field, Loading, PageHead, Segmented, useLookups } from '../ui'

type Target = 'todos' | 'escolhidos'

const shortWeekday: Record<number, string> = { 0: 'Dom', 1: 'Seg', 2: 'Ter', 3: 'Qua', 4: 'Qui', 5: 'Sex', 6: 'Sáb' }

function fmtValue(value: unknown, meta: SettingMeta) {
  if (typeof value === 'boolean') return value ? 'ligado' : 'desligado'
  if (Array.isArray(value)) {
    if (meta.options?.some((o) => typeof o.value === 'number')) {
      return value.length === 7 ? 'todos os dias' : value.length === 0 ? 'nenhum dia' : [...value].sort().map((d) => shortWeekday[Number(d)]).join(', ')
    }
    return value.map((v) => meta.options?.find((o) => o.value === v)?.label ?? v).join(', ') || 'nenhum'
  }
  return `${String(value)}${meta.unit ? ` ${meta.unit}` : ''}`
}

const same = (a: unknown, b: unknown) =>
  JSON.stringify(Array.isArray(a) ? [...a].sort() : a) === JSON.stringify(Array.isArray(b) ? [...b].sort() : b)

export function SettingsPage() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'
  const lookups = useLookups()
  const query = useQuery({ queryKey: ['settings'], queryFn: () => api<SettingsResponse>('/admin/settings') })
  const [target, setTarget] = useState<Target>('todos')
  const [selected, setSelected] = useState<string[]>([])
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const [saved, setSaved] = useState<string | null>(null)

  const overridesById = useMemo(() => new Map((query.data?.overrides ?? []).map((o) => [o.promotor.id, o])), [query.data])

  // Valores de partida: regra geral, ou as regras efetivas quando um único promotor está escolhido
  const baseline = useMemo<Record<string, unknown>>(() => {
    if (!query.data) return {}
    if (target === 'escolhidos' && selected.length === 1) return { ...query.data.values, ...(overridesById.get(selected[0]!)?.values ?? {}) }
    return query.data.values
  }, [query.data, target, selected, overridesById])

  useEffect(() => setDraft(baseline), [baseline])

  const changed = useMemo(() => Object.fromEntries(Object.entries(draft).filter(([k, v]) => !same(v, baseline[k]))), [draft, baseline])
  const dirty = Object.keys(changed).length > 0
  const canSave = isAdmin && dirty && (target === 'todos' || selected.length > 0)

  const save = useMutation({
    mutationFn: () => api('/admin/settings', { method: 'PUT', body: target === 'todos' ? { values: changed } : { values: changed, promotorIds: selected } }),
    onSuccess: () => {
      setSaved(target === 'todos' ? 'Regra geral salva para todos os promotores sem exceção.' : `Exceção salva para ${selected.length} ${selected.length === 1 ? 'promotor' : 'promotores'}.`)
      qc.invalidateQueries({ queryKey: ['settings'] })
    },
  })
  const clear = useMutation({
    mutationFn: (body: { promotorIds: string[]; keys?: string[] }) => api('/admin/settings/overrides/clear', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  })

  if (query.isLoading) return <Loading />
  if (query.error || !query.data) return <ErrorBox error={query.error} />
  const { meta, defaults, overrides, promotorSellers } = query.data
  const groups = [...new Set(Object.values(meta).map((m) => m.group))]
  const promotores = lookups.data?.promotores ?? []
  const vendedores = lookups.data?.vendedores ?? []

  const toggle = (id: string) => setSelected((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]))
  const selectBySeller = (sellerId: string) => {
    if (!sellerId) return
    const ids = promotores.filter((p) => promotorSellers[p.id]?.includes(sellerId)).map((p) => p.id)
    setSelected((list) => [...new Set([...list, ...ids])])
  }

  return (
    <div style={{ maxWidth: 980 }}>
      <PageHead
        title="Regras"
        description="Regras que delimitam o trabalho do promotor. Valem na hora para todos os aparelhos. Cada mudança pode valer para todos os promotores ou só para os promotores escolhidos (exceção)."
        actions={
          isAdmin && (
            <>
              {saved && !dirty && <span className="muted small">{saved}</span>}
              <button className="btn" disabled={!dirty} onClick={() => setDraft(baseline)}>
                Desfazer
              </button>
              <button className="btn primary" disabled={!canSave || save.isPending} onClick={() => save.mutate()}>
                {target === 'todos' ? 'Salvar para todos' : `Salvar para ${selected.length} ${selected.length === 1 ? 'promotor' : 'promotores'}`}
              </button>
            </>
          )
        }
      />
      {!isAdmin && (
        <div className="alert" style={{ marginBottom: 16 }}>
          Somente administradores podem alterar as regras.
        </div>
      )}
      <ErrorBox error={save.error ?? clear.error} />

      <div className="stack">
        {isAdmin && (
          <section className="panel">
            <div className="panel-head">
              <h2>Para quem vale esta alteração</h2>
              <Segmented<Target>
                value={target}
                onChange={(t) => {
                  setTarget(t)
                  setSaved(null)
                }}
                options={[
                  { value: 'todos', label: 'Todos os promotores' },
                  { value: 'escolhidos', label: 'Promotores escolhidos' },
                ]}
              />
            </div>
            <div className="panel-body stack" style={{ gap: 12 }}>
              {target === 'todos' ? (
                <p className="muted" style={{ margin: 0 }}>
                  Você está editando a regra geral. Promotores com exceção numa regra continuam com a exceção dele até ela ser removida (lista no fim da página).
                </p>
              ) : (
                <>
                  <div className="toolbar" style={{ marginBottom: 0 }}>
                    <Field label="Selecionar os promotores de um vendedor">
                      <select className="input" value="" onChange={(e) => selectBySeller(e.target.value)}>
                        <option value="">Escolha o vendedor</option>
                        {vendedores.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name} ({promotores.filter((p) => promotorSellers[p.id]?.includes(v.id)).length} promotores)
                          </option>
                        ))}
                      </select>
                    </Field>
                    <button className="btn" onClick={() => setSelected(promotores.map((p) => p.id))}>
                      Marcar todos
                    </button>
                    <button className="btn" onClick={() => setSelected([])} disabled={selected.length === 0}>
                      Limpar seleção
                    </button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
                    {promotores.map((p) => (
                      <label key={p.id} className="check" style={{ padding: '6px 8px', border: '1px solid var(--rule)', borderRadius: 4, background: selected.includes(p.id) ? '#fffbea' : undefined }}>
                        <input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggle(p.id)} />
                        {p.name}
                        {overridesById.has(p.id) && <span className="chip warn">com exceção</span>}
                      </label>
                    ))}
                  </div>
                  <p className="muted small" style={{ margin: 0 }}>
                    {selected.length === 0
                      ? 'Marque os promotores que vão receber a alteração.'
                      : selected.length === 1
                        ? 'Os valores abaixo são as regras atuais deste promotor. O que você mudar vira exceção só para ele.'
                        : `Os valores abaixo partem da regra geral. O que você mudar vira exceção para os ${selected.length} promotores marcados; o resto continua como está para cada um.`}
                    {' '}Regras do painel (mapa e nota das fotos) não têm exceção por promotor.
                  </p>
                </>
              )}
            </div>
          </section>
        )}

        {groups.map((group) => (
          <section className="panel" key={group}>
            <div className="panel-head">
              <h2>{group}</h2>
            </div>
            <div>
              {Object.entries(meta)
                .filter(([, m]) => m.group === group)
                .map(([key, m]) => (
                  <RuleRow
                    key={key}
                    settingKey={key}
                    meta={m}
                    value={draft[key]}
                    defaultValue={defaults[key]}
                    changed={key in changed}
                    disabled={!isAdmin || (target === 'escolhidos' && m.scope === 'geral')}
                    exceptions={target === 'todos' ? overrides.filter((o) => key in o.values) : []}
                    onChange={(v) => setDraft({ ...draft, [key]: v })}
                  />
                ))}
            </div>
          </section>
        ))}

        <section className="panel">
          <div className="panel-head">
            <h2>Exceções por promotor</h2>
            <span className="muted small">{overrides.length === 0 ? 'nenhuma' : `${overrides.length} ${overrides.length === 1 ? 'promotor' : 'promotores'}`}</span>
          </div>
          {overrides.length === 0 ? (
            <div className="panel-body muted">Todos os promotores seguem a regra geral.</div>
          ) : (
            <table className="data">
              <tbody>
                {overrides.map((o: PromotorOverride) => (
                  <tr key={o.promotor.id}>
                    <td className="nowrap" style={{ verticalAlign: 'middle' }}>
                      <strong>{o.promotor.name}</strong>
                    </td>
                    <td>
                      <div className="btn-row" style={{ gap: 6 }}>
                        {Object.entries(o.values).map(([key, value]) =>
                          meta[key] ? (
                            <span key={key} className="chip warn" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              {meta[key]!.label}: {fmtValue(value, meta[key]!)}
                              {isAdmin && (
                                <button
                                  className="btn icon small"
                                  style={{ width: 20, minHeight: 20 }}
                                  aria-label={`Remover exceção de ${meta[key]!.label}`}
                                  onClick={() => clear.mutate({ promotorIds: [o.promotor.id], keys: [key] })}
                                >
                                  ✕
                                </button>
                              )}
                            </span>
                          ) : null,
                        )}
                      </div>
                    </td>
                    <td style={{ width: 170, verticalAlign: 'middle' }}>
                      {isAdmin && (
                        <button className="btn small" onClick={() => clear.mutate({ promotorIds: [o.promotor.id] })}>
                          Voltar à regra geral
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  )
}

function RuleRow({
  settingKey,
  meta: m,
  value,
  defaultValue,
  changed,
  disabled,
  exceptions,
  onChange,
}: {
  settingKey: string
  meta: SettingMeta
  value: unknown
  defaultValue: unknown
  changed: boolean
  disabled: boolean
  exceptions: PromotorOverride[]
  onChange: (v: unknown) => void
}) {
  const id = `rule-${settingKey}`
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 280px', gap: 20, padding: '14px 18px', borderBottom: '1px solid var(--rule)', opacity: disabled && m.scope === 'geral' ? 0.55 : 1 }}>
      <div>
        <label htmlFor={id} style={{ fontWeight: 600 }}>
          {m.label}
          {changed && (
            <span className="chip warn" style={{ marginLeft: 8 }}>
              alterado
            </span>
          )}
        </label>
        <p className="muted small" style={{ margin: '4px 0 0' }}>
          {m.help} Padrão: {fmtValue(defaultValue, m)}.
        </p>
        {exceptions.length > 0 && (
          <p className="small" style={{ margin: '4px 0 0', color: 'var(--justified)' }}>
            Exceção: {exceptions.map((o) => `${o.promotor.name} (${fmtValue(o.values[settingKey], m)})`).join(', ')}
          </p>
        )}
      </div>
      <div style={{ alignSelf: 'center' }}>
        {typeof value === 'boolean' && (
          <label className="check">
            <input id={id} type="checkbox" disabled={disabled} checked={value} onChange={(e) => onChange(e.target.checked)} />
            {value ? 'Ligado' : 'Desligado'}
          </label>
        )}
        {typeof value === 'number' && (
          <div className="btn-row" style={{ flexWrap: 'nowrap' }}>
            <input
              id={id}
              className="input num"
              type="number"
              disabled={disabled}
              style={{ width: 120 }}
              value={String(value)}
              onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
            />
            {m.unit && <span className="muted">{m.unit}</span>}
          </div>
        )}
        {Array.isArray(value) && m.options && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px' }} id={id}>
            {m.options.map((o) => {
              const list = value as (string | number)[]
              const on = list.some((v) => String(v) === String(o.value))
              return (
                <label className="check" key={String(o.value)}>
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={on}
                    onChange={(e) => onChange(e.target.checked ? [...list, o.value] : list.filter((v) => String(v) !== String(o.value)))}
                  />
                  {o.label}
                </label>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

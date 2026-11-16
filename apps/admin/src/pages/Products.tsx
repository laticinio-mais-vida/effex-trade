import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { fmtDate, fmtDateTime, parseCsv } from '../format'
import type { ErpSyncStatus, Paged, Product } from '../types'
import { Empty, ErrorBox, Field, Loading, Modal, PageHead, Pager } from '../ui'

const PAGE_SIZE = 50

/** Normaliza o cabeçalho da planilha: minúsculas, sem acento, espaços viram _ ("Razão social" = razao_social). */
function readTable(text: string) {
  const table = parseCsv(text)
  const header = (table[0] ?? []).map((h) =>
    h
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, '_'),
  )
  return { header, rows: table.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()]))) }
}

export function ProductsPage() {
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<Product | 'new' | null>(null)
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [search])

  const query = useQuery({
    queryKey: ['products', debounced, page],
    queryFn: () => api<Paged<Product> & { erpActive: boolean }>('/admin/products', { query: { search: debounced, page, pageSize: PAGE_SIZE } }),
  })
  const sync = useQuery({ queryKey: ['erp-sync'], queryFn: () => api<ErpSyncStatus>('/admin/clients/sync-status') })
  const sales = sync.data?.sales
  // Depois que os produtos vêm do ERP, o cadastro e a importação manuais fecham (como os clientes)
  const manual = query.data ? !query.data.erpActive : false

  return (
    <div>
      <PageHead
        title="Produtos e mix"
        description="O mix é o que cada cliente compra: os produtos das vendas dele nos últimos 2 meses, que chegam do ERP com a sincronização dos clientes. No atendimento, o promotor marca os produtos que aparecem nas fotos de depois; o que é do mix e não aparece, ele confirma como ruptura."
        actions={
          manual ? (
            <>
              <button className="btn" onClick={() => setImporting(true)}>
                Importar produtos
              </button>
              <button className="btn primary" onClick={() => setEditing('new')}>
                Novo produto
              </button>
            </>
          ) : undefined
        }
      />
      {query.data?.erpActive && (
        <p className="small muted" style={{ margin: 'calc(var(--esp-2) * -1) 0 var(--esp-4)' }}>
          {sales ? `Mix das vendas de ${fmtDate(sales.from)} a ${fmtDate(sales.to)}, atualizado em ${fmtDateTime(sales.at)}. ` : ''}
          Código e nome vêm do ERP. Desative o produto que o promotor não deve procurar na gôndola (ex.: vendido só para o balcão): ele sai do mix de todos os clientes.
        </p>
      )}
      <div className="toolbar">
        <Field label="Buscar">
          <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome, código, marca ou categoria" style={{ minWidth: 280 }} />
        </Field>
      </div>
      {query.isLoading && <Loading />}
      <ErrorBox error={query.error} />
      {query.data && query.data.items.length === 0 && (
        <Empty>
          {debounced
            ? 'Nenhum produto encontrado.'
            : 'Nenhum produto cadastrado. Os produtos e o mix chegam com as vendas, quando a sincronização dos clientes com o ERP roda no computador da empresa (sync\\sincronizar-clientes.bat).'}
        </Empty>
      )}
      {query.data && query.data.items.length > 0 && (
        <div className="panel table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Código</th>
                <th>Produto</th>
                <th>Marca</th>
                <th>Categoria</th>
                <th className="r">Clientes que compram</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {query.data.items.map((p) => (
                <tr key={p.id} className="clickable" onClick={() => setEditing(p)}>
                  <td className="num">{p.code}</td>
                  <td>
                    <strong>{p.name}</strong>
                    {p.erpId != null && (
                      <span className="chip" title={`Produto vindo do ERP (código interno ${p.erpId})`} style={{ marginLeft: 'var(--esp-2)' }}>
                        ERP
                      </span>
                    )}
                  </td>
                  <td>{p.brand ?? <span className="muted">—</span>}</td>
                  <td>{p.category ?? <span className="muted">—</span>}</td>
                  <td className="r">{p.mixClients}</td>
                  <td>{p.active ? 'Ativo' : <span className="muted">Inativo</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {query.data && <Pager page={page} pageSize={PAGE_SIZE} total={query.data.total} onPage={setPage} />}
      {editing && <ProductForm product={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {importing && <ImportProducts onClose={() => setImporting(false)} />}
    </div>
  )
}

function ProductForm({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const qc = useQueryClient()
  const fromErp = product?.erpId != null
  const [form, setForm] = useState({
    code: product?.code ?? '',
    name: product?.name ?? '',
    brand: product?.brand ?? '',
    category: product?.category ?? '',
    active: product?.active ?? true,
  })
  const save = useMutation({
    mutationFn: () => {
      const body = { code: form.code, name: form.name, brand: form.brand || null, category: form.category || null, active: form.active }
      return product ? api(`/admin/products/${product.id}`, { method: 'PATCH', body }) : api('/admin/products', { method: 'POST', body })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] })
      onClose()
    },
  })
  return (
    <Modal
      title={product ? product.name : 'Novo produto'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" disabled={save.isPending || !form.code || form.name.length < 2} onClick={() => save.mutate()}>
            {product ? 'Salvar produto' : 'Cadastrar produto'}
          </button>
        </>
      }
    >
      {fromErp && (
        <p className="small muted" style={{ margin: '0 0 var(--esp-3)' }}>
          Código e nome vêm do ERP (código interno {product!.erpId}): altere lá e rode a sincronização. Aqui mudam a marca, a categoria e a situação.
        </p>
      )}
      <div className="form-grid">
        <Field label="Código no ERP">
          <input className="input" value={form.code} disabled={fromErp} onChange={(e) => setForm({ ...form, code: e.target.value })} />
        </Field>
        <Field label="Marca">
          <input className="input" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
        </Field>
        <Field label="Nome do produto" className="full">
          <input className="input" value={form.name} disabled={fromErp} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex.: Iogurte Morango 170g" />
        </Field>
        <Field label="Categoria" className="full">
          <input className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
        </Field>
        <label className="check full">
          <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
          Produto ativo (desativado, ele sai do mix de todos os clientes: não aparece para o promotor nem entra no contraste de ruptura)
        </label>
      </div>
      <ErrorBox error={save.error} />
    </Modal>
  )
}

function ImportProducts({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [problem, setProblem] = useState<string | null>(null)
  const run = useMutation({
    mutationFn: () =>
      api<{ created: number; updated: number }>('/admin/products/import', {
        method: 'POST',
        body: { products: rows.map((r) => ({ code: r.codigo, name: r.nome, brand: r.marca || null, category: r.categoria || null })) },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  })
  const onFile = async (file: File) => {
    run.reset()
    const { header, rows } = readTable(await file.text())
    const missing = ['codigo', 'nome'].filter((c) => !header.includes(c))
    setProblem(missing.length ? `Faltam colunas obrigatórias: ${missing.join(', ')}.` : null)
    setRows(missing.length ? [] : rows.filter((r) => r.codigo && r.nome))
  }
  return (
    <Modal
      title="Importar produtos"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {run.data ? 'Fechar' : 'Cancelar'}
          </button>
          {!run.data && (
            <button className="btn primary" disabled={rows.length === 0 || run.isPending} onClick={() => run.mutate()}>
              Importar {rows.length} produtos
            </button>
          )}
        </>
      }
    >
      <div className="stack">
        <p style={{ margin: 0 }}>Planilha em CSV (ponto e vírgula) com estas colunas. Produtos com código já cadastrado são atualizados.</p>
        <code className="small" style={{ background: 'var(--fundo)', padding: 'var(--esp-3)', borderRadius: 'var(--raio-selo)' }}>codigo;nome;marca;categoria</code>
        <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        {problem && <div className="alert">{problem}</div>}
        {rows.length > 0 && !run.data && <p style={{ margin: 0 }}>{rows.length} produtos lidos.</p>}
        {run.data && (
          <div className="alert ok">
            {run.data.created} produtos cadastrados e {run.data.updated} atualizados.
          </div>
        )}
        <ErrorBox error={run.error} />
      </div>
    </Modal>
  )
}

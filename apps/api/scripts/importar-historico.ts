/**
 * Importa o histórico de visitas do TradePro (planilha "Relatório de Roteiros") para a tabela TimeHistory, que dá as
 * medianas do relatório de tempos. Aceita .csv (vírgula ou ponto e vírgula) e .xlsx. Para .xls antigo, salve como .xlsx ou
 * .csv antes. Reimportar o mesmo período troca as linhas (não duplica). Contas "(TESTE)" ficam de fora.
 *
 * Uso: npm run importar-historico -- <arquivo> [--simular] [--naovinculados lista.csv]
 *   --simular        só confere e mostra o resumo, sem gravar
 *   --naovinculados  grava a lista dos CPF/CNPJ do histórico que não casam com nenhum cliente do cadastro
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { extname } from 'node:path'
import ExcelJS from 'exceljs'
import { prisma } from '../src/db'
import { importTimeHistory, parseHistoryTable, type Cell } from '../src/services/time-history'

const args = process.argv.slice(2)
const flagValue = (name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const dryRun = args.includes('--simular')
const unlinkedOut = flagValue('--naovinculados')
const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--naovinculados')

if (!file) {
  console.error('Uso: npm run importar-historico -- <arquivo.csv|arquivo.xlsx> [--simular] [--naovinculados lista.csv]')
  process.exit(1)
}

/** CSV com aspas, vírgula ou ponto e vírgula (o separador é o que mais aparece na primeira linha com dados). */
function parseCsv(content: string): string[][] {
  const text = content.replace(/^﻿/, '')
  const sample = text.split(/\r?\n/).slice(0, 5).join('\n')
  const delimiter = (sample.match(/;/g)?.length ?? 0) > (sample.match(/,/g)?.length ?? 0) ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === delimiter) (row.push(cell), (cell = ''))
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      cell = ''
      rows.push(row)
      row = []
    } else cell += ch
  }
  if (cell !== '' || row.length) (row.push(cell), rows.push(row))
  return rows
}

async function readTable(path: string): Promise<Cell[][]> {
  const ext = extname(path).toLowerCase()
  if (ext === '.csv' || ext === '.txt') return parseCsv(readFileSync(path, 'utf8'))
  if (ext === '.xlsx') {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(path)
    const sheet = wb.worksheets[0]
    if (!sheet) throw new Error('A planilha não tem nenhuma aba.')
    const rows: Cell[][] = []
    sheet.eachRow({ includeEmpty: true }, (r) => {
      rows.push((r.values as unknown[]).slice(1).map((v): Cell => (v != null && typeof v === 'object' && !(v instanceof Date) ? String((v as { text?: string; result?: unknown }).text ?? (v as { result?: unknown }).result ?? '') : (v as Cell))))
    })
    return rows
  }
  throw new Error(`Formato "${ext}" não suportado: use .csv ou .xlsx (o .xls antigo precisa ser salvo como .xlsx ou .csv).`)
}

async function main() {
  console.log(`Lendo ${file}...`)
  const parsed = parseHistoryTable(await readTable(file!))
  if (parsed.missing.length) throw new Error(`Colunas não encontradas na planilha: ${parsed.missing.join(', ')}.`)
  console.log(`${parsed.rows.length} linhas lidas${parsed.excludedTest ? `, ${parsed.excludedTest} de contas de teste ignoradas` : ''}${parsed.problems.length ? `, ${parsed.problems.length} com problema` : ''}.`)
  for (const p of parsed.problems.slice(0, 10)) console.log(`  linha ${p.line}: ${p.message}`)
  if (parsed.problems.length > 10) console.log(`  ... e mais ${parsed.problems.length - 10}`)
  if (!parsed.rows.length) throw new Error('Nenhuma linha válida para importar.')

  const report = await importTimeHistory(parsed.rows, { dryRun })
  console.log(`\n${dryRun ? 'SIMULAÇÃO (nada foi gravado)' : 'Importado'}: ${report.rows} linhas, de ${report.from} a ${report.to} (${report.days} dias)`)
  if (!dryRun && report.replaced) console.log(`  ${report.replaced} linhas do mesmo período foram trocadas`)
  console.log(`  visitadas: ${report.visited}   sem visita: ${report.withoutVisit}   check-out esquecido (> 12 h): ${report.forgottenCheckouts}`)
  console.log(`\nPromotores (${report.promotors.length}):`)
  for (const p of report.promotors) console.log(`  ${p.userId ? 'ok ' : '-- '} ${p.name} (${p.rows} linhas)${p.userId ? '' : '  sem usuário correspondente no EFFEX'}`)
  console.log(`\nClientes: ${report.clients.total} CPF/CNPJ no histórico, ${report.clients.linked} casam com o cadastro do EFFEX, ${report.clients.unlinked.length} não.`)
  if (report.clients.unlinked.length) {
    console.log('  Preencha o CPF/CNPJ no cadastro dos clientes (Clientes > Baixar planilha > coluna cpf_cnpj > Importar planilha).')
    if (unlinkedOut) {
      const lines = ['cpf_cnpj;nome;cidade;linhas', ...report.clients.unlinked.map((c) => [c.key, c.name, c.city ?? '', c.rows].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';'))]
      writeFileSync(unlinkedOut, `﻿${lines.join('\n')}\n`)
      console.log(`  Lista gravada em ${unlinkedOut}`)
    }
  }
}

main()
  .catch((e) => {
    console.error(`\nErro: ${e instanceof Error ? e.message : e}`)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

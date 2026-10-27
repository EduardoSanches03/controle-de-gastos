/** "Servidor" local do app Android: atende as mesmas rotas de backend/api.py usando o banco no aparelho. */
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { Banco, type Cartao, type Linha } from './banco'
import {
  cicloFatura, dividirValor, faturaAtual, hoje, mesIso, referenciaPorVencimento, somarMeses, vencimentosDespesa,
  type Ciclo,
} from './regras'

const ARQUIVO = 'gastos.db'

let SQL: SqlJsStatic
let banco: Promise<Banco> | null = null
let gravando: Promise<unknown> = Promise.resolve()

function paraBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

function deBase64(b64: string): Uint8Array {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

/** Bytes do banco. O export do sql.js reabre a conexão, então as chaves estrangeiras são religadas. */
function exportar(b: Banco): Uint8Array {
  const bytes = b.db.export()
  b.db.run('PRAGMA foreign_keys = ON')
  return bytes
}

function gravar(b: Banco, arquivo = ARQUIVO) {
  const dados = paraBase64(exportar(b))
  gravando = gravando.then(() => Filesystem.writeFile({ path: arquivo, data: dados, directory: Directory.Data }))
    .catch(e => console.error('[banco] falha ao gravar', e))
  return gravando
}

function abrir(bytes?: Uint8Array): Banco {
  let b: Banco | null = null
  b = new Banco(new SQL.Database(bytes), () => b && gravar(b))
  return b
}

async function iniciar(): Promise<Banco> {
  SQL = await initSqlJs({ locateFile: () => wasmUrl })
  let bytes: Uint8Array | undefined
  try {
    const r = await Filesystem.readFile({ path: ARQUIVO, directory: Directory.Data })
    bytes = deBase64(r.data as string)
  } catch { /* primeiro uso: banco novo */ }
  const b = abrir(bytes)
  b.gerarRecorrencias(...(hoje().split('-').map(Number) as [number, number]))
  await gravar(b)
  return b
}

const obterBanco = () => (banco ??= iniciar())

/** Substitui o banco do aparelho por outro arquivo .db (ex.: backup do PC). O atual é guardado antes. */
export async function importarBanco(bytes: Uint8Array) {
  const atual = await obterBanco()
  const teste = new SQL.Database(bytes)
  try {
    if (!teste.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'despesas'").length)
      throw new Error('Esse arquivo não é um banco do Controle de Gastos.')
  } finally {
    teste.close()
  }
  await gravar(atual, 'gastos_antes_importacao.db')
  const novo = abrir(bytes)
  novo.gerarRecorrencias(...(hoje().split('-').map(Number) as [number, number]))
  await gravar(novo)
  atual.db.close()
  banco = Promise.resolve(novo)
}

async function compartilhar(nome: string, dados: string, titulo: string) {
  const { uri } = await Filesystem.writeFile({ path: nome, data: dados, directory: Directory.Cache })
  try {
    await Share.share({ title: titulo, files: [uri] })
  } catch (e) {
    // fechar a janela de compartilhar não é erro
    if (!/cancel/i.test(String((e as Error)?.message ?? e))) throw e
  }
}

// ----------------------------------------------------------------- validação
class Invalido extends Error {}
const texto = (v: unknown, campo: string, obrigatorio = false) => {
  const s = typeof v === 'string' ? v : v == null ? '' : String(v)
  if (obrigatorio && !s) throw new Invalido(`Preencha o campo ${campo}.`)
  return s
}
const inteiro = (v: unknown, campo: string, min: number, max = Infinity) => {
  const n = Number(v)
  if (!Number.isInteger(n) || n < min || n > max) throw new Invalido(`Valor inválido em ${campo}.`)
  return n
}
const idOuNulo = (v: unknown) => (v == null || v === '' ? null : inteiro(v, 'cartão', 0))
const mesRef = (v: unknown, campo: string) => {
  if (v == null || v === '') return null
  if (typeof v !== 'string' || !/^\d{4}-\d{2}$/.test(v)) throw new Invalido(`Valor inválido em ${campo}.`)
  return v
}
const dataIso = (v: unknown) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Invalido('Data inválida.')
  return v
}

function cartaoIn(c: Linha) {
  return {
    nome: texto(c.nome, 'nome', true), bandeira: texto(c.bandeira, 'bandeira'),
    dia_fechamento: inteiro(c.dia_fechamento, 'fechamento', 1, 31), dia_vencimento: inteiro(c.dia_vencimento, 'vencimento', 1, 31),
    limite_centavos: inteiro(c.limite_centavos ?? 0, 'limite', 0), ativo: c.ativo === false ? 0 : 1,
  }
}

function despesaIn(d: Linha) {
  return {
    descricao: texto(d.descricao, 'descrição', true), categoria: texto(d.categoria, 'categoria'),
    cartao_id: idOuNulo(d.cartao_id), valor_total_centavos: inteiro(d.valor_total_centavos, 'valor', 1),
    num_parcelas: inteiro(d.num_parcelas, 'parcelas', 1, 120), data_compra: dataIso(d.data_compra),
    observacao: texto(d.observacao, 'observação'), mes_referencia: mesRef(d.mes_referencia, 'mês'),
  }
}

function recorrenteIn(r: Linha) {
  const dados = {
    descricao: texto(r.descricao, 'descrição', true), categoria: texto(r.categoria, 'categoria'),
    cartao_id: idOuNulo(r.cartao_id), valor_centavos: inteiro(r.valor_centavos, 'valor', 1),
    dia: inteiro(r.dia, 'dia', 1, 31), inicio: mesRef(r.inicio, 'início')!, fim: mesRef(r.fim, 'fim'),
    observacao: texto(r.observacao, 'observação'),
  }
  if (!dados.inicio) throw new Invalido('Informe o mês inicial.')
  if (dados.fim && dados.fim < dados.inicio) throw new Invalido('O mês final não pode ser antes do mês inicial.')
  return dados
}

// ------------------------------------------------------------------- faturas
function status(aberto: number, itens: number, ciclo: Ciclo, dataHoje: string) {
  if (!itens) return 'vazia'
  if (!aberto) return 'paga'
  if (dataHoje < ciclo.fechamento) return 'aberta'
  if (dataHoje <= ciclo.vencimento) return 'fechada'
  return 'vencida'
}

const soma = (itens: Linha[]) => itens.reduce((s, i) => s + i.valor_centavos, 0)
const aberto = (itens: Linha[]) => itens.reduce((s, i) => s + (i.pago ? 0 : i.valor_centavos), 0)
const naoEncontrado = (o: string) => new Error(`${o} não encontrad${o === 'Cartão' ? 'o' : 'a'}`)

function resumoMes(db: Banco, ano: number, mes: number, cartaoId: number | null) {
  const dataHoje = hoje()
  db.gerarRecorrencias(...somarMeses(ano, mes, 2))
  const vencendo = db.parcelasMes(ano, mes, cartaoId)
  const cartoes = db.cartoes().filter(c => cartaoId === null || (cartaoId && c.id === cartaoId))
  const emConstrucao = []
  for (const c of cartoes) {
    const itens = db.parcelasFatura(c.id, ano, mes)
    if (!itens.length && !c.ativo) continue
    const ciclo = cicloFatura(c, ano, mes)
    emConstrucao.push({
      cartao_id: c.id, cartao: c.nome, referencia: mesIso(ano, mes), ...ciclo,
      status: status(aberto(itens), itens.length, ciclo, dataHoje),
      total_centavos: soma(itens), aberto_centavos: aberto(itens), itens,
    })
  }
  const porId = new Map(cartoes.map(c => [c.id, c]))
  const porCartao = new Map<number, Linha[]>()
  for (const p of vencendo) if (p.cartao_id != null) porCartao.set(p.cartao_id, [...(porCartao.get(p.cartao_id) ?? []), p])
  const aPagar = [...porCartao].map(([cid, itens]) => {
    const venc = itens.map(i => i.vencimento as string).sort().at(-1)!
    return {
      cartao_id: cid, cartao: itens[0].cartao, vencimento: venc,
      referencia: mesIso(...referenciaPorVencimento(venc, porId.get(cid)!)),
      total_centavos: soma(itens), aberto_centavos: aberto(itens), itens,
    }
  }).sort((a, b) => a.cartao.localeCompare(b.cartao))
  const semCartao = vencendo.filter(p => p.cartao_id == null)

  // gasto do mês = fatura em construção + recorrências + lançamentos sem cartão
  const gasto = [...emConstrucao.flatMap(f => f.itens), ...semCartao]
  const categorias = new Map<string, number>()
  for (const p of gasto) categorias.set(p.categoria || 'Sem categoria', (categorias.get(p.categoria || 'Sem categoria') ?? 0) + p.valor_centavos)
  const aPagarItens = [...aPagar.flatMap(f => f.itens), ...semCartao]
  return {
    a_pagar: aPagar,
    em_construcao: emConstrucao,
    recorrencias: semCartao.filter(p => p.recorrente_id),
    lancamentos: semCartao.filter(p => !p.recorrente_id),
    totais: {
      gasto_centavos: soma(gasto),
      em_construcao_centavos: emConstrucao.reduce((s, f) => s + f.total_centavos, 0),
      a_pagar_aberto_centavos: aberto(aPagarItens),
      pago_centavos: soma(aPagarItens) - aberto(aPagarItens),
    },
    categorias: [...categorias].map(([categoria, total_centavos]) => ({ categoria, total_centavos }))
      .sort((a, b) => b.total_centavos - a.total_centavos),
  }
}

function fatura(db: Banco, cartaoId: number, anoQ: number | null, mesQ: number | null) {
  const dataHoje = hoje()
  const cartao = db.cartao(cartaoId)
  if (!cartao) throw naoEncontrado('Cartão')
  const atual = faturaAtual(cartao, dataHoje)
  const [ano, mes] = anoQ && mesQ ? [anoQ, mesQ] : atual
  const maior = mesIso(...atual) > mesIso(ano, mes) ? atual : [ano, mes] as [number, number]
  const ultima = cicloFatura(cartao, ...somarMeses(...maior, 6)).vencimento.split('-').map(Number)
  db.gerarRecorrencias(ultima[0], ultima[1])
  const itens = db.parcelasFatura(cartaoId, ano, mes)
  const totais = new Map(db.totaisFaturas(cartaoId).map(r => [r.mes_vencimento, r]))

  const resumo = (a: number, m: number) => {
    const c = cicloFatura(cartao as Cartao, a, m)
    const t = totais.get(c.vencimento.slice(0, 7)) ?? { total_centavos: 0, aberto_centavos: 0, itens: 0 }
    return {
      referencia: mesIso(a, m), ...c,
      total_centavos: t.total_centavos, aberto_centavos: t.aberto_centavos, itens: t.itens,
      status: status(t.aberto_centavos, t.itens, c, dataHoje),
    }
  }
  return {
    cartao, atual: mesIso(...atual),
    fatura: { ...resumo(ano, mes), lista: itens },
    linha_do_tempo: Array.from({ length: 10 }, (_, i) => resumo(...somarMeses(...atual, i - 3))),
  }
}

function csvMes(db: Banco, ano: number, mes: number) {
  db.gerarRecorrencias(ano, mes)
  const cel = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const linhas = [['Vencimento', 'Descrição', 'Categoria', 'Cartão', 'Parcela', 'Valor', 'Pago']]
  for (const p of db.parcelasMes(ano, mes)) {
    const [a, m, d] = (p.vencimento as string).split('-')
    linhas.push([`${d}/${m}/${a}`, p.descricao, p.categoria || '', p.cartao || 'Sem cartão',
      `${p.numero}/${p.num_parcelas}`, (p.valor_centavos / 100).toFixed(2).replace('.', ','), p.pago ? 'Sim' : 'Não'])
  }
  return '﻿' + linhas.map(l => l.map(cel).join(';')).join('\r\n') + '\r\n'
}

// -------------------------------------------------------------------- rotas
export async function atender(metodo: string, url: string, corpo?: any): Promise<any> {
  const db = await obterBanco()
  const u = new URL(url, 'http://local')
  const q = (k: string) => u.searchParams.get(k)
  const qNum = (k: string) => (q(k) === null ? null : Number(q(k)))
  const seg = u.pathname.replace(/^\/api\//, '').split('/')
  const id = Number(seg[1])
  const rota = `${metodo} ${seg.map(s => (/^\d+$/.test(s) ? ':id' : s)).join('/')}`

  switch (rota) {
    case 'GET cartoes': return db.cartoes(q('somente_ativos') === 'true')
    case 'POST cartoes': db.salvarCartao(cartaoIn(corpo)); return { ok: true }
    case 'PUT cartoes/:id':
      if (!db.cartao(id)) throw naoEncontrado('Cartão')
      db.salvarCartao(cartaoIn(corpo), id); return { ok: true }
    case 'DELETE cartoes/:id': {
      const excluido = db.excluirCartao(id)
      return { excluido, desativado: !excluido }
    }

    case 'GET categorias': return db.categorias()

    case 'GET despesas': return db.despesas((q('busca') ?? '').trim(), qNum('cartao_id'), q('situacao') ?? 'todas')
    case 'GET despesas/:id': {
      const d = db.despesa(id)
      if (!d) throw naoEncontrado('Despesa')
      return d
    }
    case 'POST despesas': return { id: db.salvarDespesa(despesaIn(corpo)) }
    case 'PUT despesas/:id':
      if (!db.despesa(id)) throw naoEncontrado('Despesa')
      db.salvarDespesa(despesaIn(corpo), id); return { ok: true }
    case 'DELETE despesas/:id': db.excluirDespesa(id); return { ok: true }

    case 'GET recorrentes': return db.recorrentes()
    case 'GET recorrentes/:id': {
      const r = db.recorrente(id)
      if (!r) throw naoEncontrado('Recorrente')
      return r
    }
    case 'POST recorrentes': return { id: db.salvarRecorrente(recorrenteIn(corpo)) }
    case 'PUT recorrentes/:id':
      if (!db.recorrente(id)) throw naoEncontrado('Recorrente')
      db.salvarRecorrente(recorrenteIn(corpo), id); return { ok: true }
    case 'POST recorrentes/:id/encerrar': db.encerrarRecorrente(id); return { ok: true }
    case 'DELETE recorrentes/:id': db.excluirRecorrente(id); return { ok: true }

    case 'POST simular': {
      const s = {
        valor_total_centavos: inteiro(corpo.valor_total_centavos, 'valor', 0),
        num_parcelas: inteiro(corpo.num_parcelas, 'parcelas', 1, 120), data_compra: dataIso(corpo.data_compra),
        mes_referencia: mesRef(corpo.mes_referencia, 'mês'),
      }
      const cartao = db.cartao(idOuNulo(corpo.cartao_id))
      const valores = dividirValor(s.valor_total_centavos, s.num_parcelas)
      return vencimentosDespesa(s, cartao).map((v, i) => ({
        numero: i + 1, vencimento: v, valor_centavos: valores[i],
        fatura: cartao ? mesIso(...referenciaPorVencimento(v, cartao)) : null,
      }))
    }

    case 'GET mes': return resumoMes(db, Number(q('ano')), Number(q('mes')), qNum('cartao_id'))
    case 'GET faturas/:id': return fatura(db, id, qNum('ano'), qNum('mes'))
    case 'POST parcelas/pagamento': db.marcarPago(corpo.ids, !!corpo.pago); return { ok: true }

    case 'POST exportar': {
      const ano = Number(q('ano')), mes = Number(q('mes'))
      const nome = `gastos_${mesIso(ano, mes)}.csv`
      await compartilhar(nome, btoa(unescape(encodeURIComponent(csvMes(db, ano, mes)))), 'Exportar CSV')
      return { caminho: nome }
    }
    case 'POST backup': {
      const nome = `backup_gastos_${hoje()}.db`
      await compartilhar(nome, paraBase64(exportar(db)), 'Backup do Controle de Gastos')
      return { caminho: nome }
    }
    case 'POST abrir-pasta': return { ok: true }
  }
  throw new Error(`Rota não encontrada: ${metodo} ${u.pathname}`)
}

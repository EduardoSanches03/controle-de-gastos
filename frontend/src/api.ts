import { Capacitor } from '@capacitor/core'

export interface Cartao {
  id: number
  nome: string
  bandeira: string
  dia_fechamento: number
  dia_vencimento: number
  limite_centavos: number
  ativo: number
  usado_centavos: number
}

export type CartaoIn = Omit<Cartao, 'id' | 'usado_centavos' | 'ativo'> & { ativo: boolean }

export interface Despesa {
  id: number
  descricao: string
  categoria: string | null
  categoria_id: number | null
  cartao_id: number | null
  cartao: string | null
  valor_total_centavos: number
  num_parcelas: number
  data_compra: string
  observacao: string
  parcelas_pagas: number | null
  aberto_centavos: number | null
  ultimo_vencimento: string | null
  recorrente_id: number | null
  competencia: string | null
  mes_referencia: string | null
}

export interface Recorrente {
  id: number
  descricao: string
  categoria: string | null
  cartao_id: number | null
  cartao: string | null
  valor_centavos: number
  dia: number
  inicio: string
  fim: string | null
  observacao: string
  pago_mes_atual: number | null
  meses_pagos: number
}

export interface RecorrenteIn {
  descricao: string
  categoria: string
  cartao_id: number | null
  valor_centavos: number
  dia: number
  inicio: string
  fim: string | null
  observacao: string
}

export interface DespesaIn {
  descricao: string
  categoria: string
  cartao_id: number | null
  valor_total_centavos: number
  num_parcelas: number
  data_compra: string
  observacao: string
  /** 'AAAA-MM' quando lançada pelo mês da 1ª parcela */
  mes_referencia: string | null
}

export interface Parcela {
  id: number
  despesa_id: number
  numero: number
  num_parcelas: number
  valor_centavos: number
  vencimento: string
  pago: number
  descricao: string
  categoria: string | null
  cartao: string | null
  cartao_id: number | null
  recorrente_id: number | null
}

/** fatura que vence no mês */
export interface FaturaAPagar {
  cartao_id: number
  cartao: string
  referencia: string
  vencimento: string
  total_centavos: number
  aberto_centavos: number
  itens: Parcela[]
}

/** fatura de referência do mês, ainda recebendo compras (paga no mês seguinte) */
export interface FaturaEmConstrucao {
  cartao_id: number
  cartao: string
  referencia: string
  inicio: string
  fim: string
  fechamento: string
  vencimento: string
  status: FaturaResumo['status']
  total_centavos: number
  aberto_centavos: number
  itens: ItemFatura[]
}

export interface ResumoMes {
  a_pagar: FaturaAPagar[]
  em_construcao: FaturaEmConstrucao[]
  /** sem cartão */
  recorrencias: Parcela[]
  /** sem cartão e não recorrentes */
  lancamentos: Parcela[]
  totais: {
    gasto_centavos: number
    em_construcao_centavos: number
    a_pagar_aberto_centavos: number
    pago_centavos: number
  }
  categorias: { categoria: string; total_centavos: number }[]
}

export interface ParcelaSimulada {
  numero: number
  vencimento: string
  valor_centavos: number
  /** mês de referência da fatura ('AAAA-MM'), só quando for no cartão */
  fatura: string | null
}

export interface FaturaResumo {
  referencia: string
  inicio: string
  fim: string
  fechamento: string
  vencimento: string
  total_centavos: number
  aberto_centavos: number
  itens: number
  status: 'aberta' | 'fechada' | 'vencida' | 'paga' | 'vazia'
}

export interface ItemFatura {
  id: number
  despesa_id: number
  numero: number
  num_parcelas: number
  valor_centavos: number
  vencimento: string
  pago: number
  descricao: string
  data_compra: string
  mes_referencia: string | null
  categoria: string | null
  recorrente_id: number | null
}

export interface FaturaDetalhe {
  cartao: Cartao
  atual: string
  fatura: FaturaResumo & { lista: ItemFatura[] }
  linha_do_tempo: FaturaResumo[]
}

/** Filtro de cartão: null = todos, 0 = sem cartão, n = id do cartão */
export type FiltroCartao = number | null

/** No app Android não há servidor: as rotas são atendidas por src/local, com o banco no aparelho. */
export const ehNativo = Capacitor.isNativePlatform()

async function req<T>(metodo: string, url: string, corpo?: unknown): Promise<T> {
  if (ehNativo) return (await import('./local/servidor')).atender(metodo, url, corpo)
  const r = await fetch(url, {
    method: metodo,
    headers: corpo ? { 'Content-Type': 'application/json' } : undefined,
    body: corpo ? JSON.stringify(corpo) : undefined,
  })
  if (!r.ok) {
    let msg = `Erro ${r.status}`
    try {
      const j = await r.json()
      msg = typeof j.detail === 'string' ? j.detail : msg
    } catch { /* resposta sem JSON */ }
    throw new Error(msg)
  }
  return r.json()
}

function qs(params: Record<string, string | number | null | undefined>) {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const api = {
  cartoes: (somenteAtivos = false) => req<Cartao[]>('GET', `/api/cartoes${qs({ somente_ativos: somenteAtivos ? 'true' : null })}`),
  criarCartao: (c: CartaoIn) => req('POST', '/api/cartoes', c),
  editarCartao: (id: number, c: CartaoIn) => req('PUT', `/api/cartoes/${id}`, c),
  excluirCartao: (id: number) => req<{ excluido: boolean; desativado: boolean }>('DELETE', `/api/cartoes/${id}`),

  categorias: () => req<string[]>('GET', '/api/categorias'),

  despesas: (busca: string, cartaoId: FiltroCartao, situacao: string) =>
    req<Despesa[]>('GET', `/api/despesas${qs({ busca, cartao_id: cartaoId, situacao })}`),
  despesa: (id: number) => req<Despesa>('GET', `/api/despesas/${id}`),
  criarDespesa: (d: DespesaIn) => req<{ id: number }>('POST', '/api/despesas', d),
  editarDespesa: (id: number, d: DespesaIn) => req('PUT', `/api/despesas/${id}`, d),
  excluirDespesa: (id: number) => req('DELETE', `/api/despesas/${id}`),
  simular: (valor: number, parcelas: number, data: string, cartaoId: number | null, mesReferencia: string | null = null) =>
    req<ParcelaSimulada[]>('POST', '/api/simular', {
      valor_total_centavos: valor, num_parcelas: parcelas, data_compra: data, cartao_id: cartaoId, mes_referencia: mesReferencia,
    }),

  recorrentes: () => req<Recorrente[]>('GET', '/api/recorrentes'),
  criarRecorrente: (r: RecorrenteIn) => req('POST', '/api/recorrentes', r),
  editarRecorrente: (id: number, r: RecorrenteIn) => req('PUT', `/api/recorrentes/${id}`, r),
  encerrarRecorrente: (id: number) => req('POST', `/api/recorrentes/${id}/encerrar`),
  excluirRecorrente: (id: number) => req('DELETE', `/api/recorrentes/${id}`),

  mes: (ano: number, mes: number, cartaoId: FiltroCartao) =>
    req<ResumoMes>('GET', `/api/mes${qs({ ano, mes, cartao_id: cartaoId })}`),
  fatura: (cartaoId: number, ref?: string) => {
    const [ano, mes] = ref ? ref.split('-').map(Number) : [null, null]
    return req<FaturaDetalhe>('GET', `/api/faturas/${cartaoId}${qs({ ano, mes })}`)
  },
  pagar: (ids: number[], pago: boolean) => req('POST', '/api/parcelas/pagamento', { ids, pago }),

  exportar: (ano: number, mes: number) => req<{ caminho: string }>('POST', `/api/exportar${qs({ ano, mes })}`),
  backup: () => req<{ caminho: string }>('POST', '/api/backup'),
  abrirPasta: () => req('POST', '/api/abrir-pasta'),
  /** só no Android: troca o banco do aparelho por um arquivo .db (ex.: backup do PC) */
  importarBanco: async (bytes: Uint8Array) => (await import('./local/servidor')).importarBanco(bytes),
}

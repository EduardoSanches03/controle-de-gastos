import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, CreditCard, Inbox, Plus, Repeat } from 'lucide-react'
import { api, type Cartao, type FaturaDetalhe, type FaturaResumo, type Recorrente } from '../api'
import { Checkbox, Confirmar } from '../components/ui'
import { brl, dataBR, hojeISO, mesAno, nomeFatura } from '../format'

const STATUS: Record<FaturaResumo['status'], string> = {
  aberta: 'Aberta',
  fechada: 'Fechada',
  vencida: 'Vencida',
  paga: 'Paga',
  vazia: 'Sem lançamentos',
}

const somarRef = (ref: string, n: number) => {
  const [a, m] = ref.split('-').map(Number)
  const idx = a * 12 + (m - 1) + n
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`
}

export function Faturas({ versao, alvo, onEditarDespesa, onEditarRecorrente, onNovaRecorrente, onAlterado, onIrCartoes }: {
  versao: number
  alvo: { cartaoId: number; ref?: string } | null
  onEditarDespesa: (id: number) => void
  onEditarRecorrente: (r: Recorrente) => void
  onNovaRecorrente: (cartaoId: number) => void
  onAlterado: () => void
  onIrCartoes: () => void
}) {
  const [cartoes, setCartoes] = useState<Cartao[] | null>(null)
  const [cartaoId, setCartaoId] = useState<number | null>(alvo?.cartaoId ?? null)
  const [ref, setRef] = useState<string | undefined>(alvo?.ref)
  const [dados, setDados] = useState<FaturaDetalhe | null>(null)
  const [confirmar, setConfirmar] = useState<'pagar' | 'desfazer' | null>(null)
  const [recorrentes, setRecorrentes] = useState<Recorrente[]>([])

  // quando outra tela pede para abrir uma fatura específica
  useEffect(() => {
    if (alvo) { setCartaoId(alvo.cartaoId); setRef(alvo.ref) }
  }, [alvo])

  useEffect(() => {
    api.cartoes(true).then(l => {
      setCartoes(l)
      setCartaoId(atual => (atual !== null && l.some(c => c.id === atual)) ? atual : l[0]?.id ?? null)
    })
  }, [versao])

  useEffect(() => { api.recorrentes().then(setRecorrentes) }, [versao])

  useEffect(() => {
    if (cartaoId === null) { setDados(null); return }
    api.fatura(cartaoId, ref).then(setDados)
  }, [cartaoId, ref, versao])

  if (cartoes && cartoes.length === 0) {
    return (
      <div className="page">
        <div className="page-header"><h1>Faturas</h1></div>
        <div className="panel empty">
          <CreditCard size={28} />
          <div>Cadastre um cartão para acompanhar as faturas.</div>
          <button className="btn" style={{ marginTop: 14 }} onClick={onIrCartoes}>Ir para Cartões</button>
        </div>
      </div>
    )
  }

  const f = dados?.fatura
  const refAtual = f?.referencia
  const abertos = f?.lista.filter(i => !i.pago) ?? []
  const mesAtual = hojeISO().slice(0, 7)
  const automaticas = recorrentes.filter(r => r.cartao_id === cartaoId && (!r.fim || r.fim >= mesAtual))
  const maior = Math.max(1, ...(dados?.linha_do_tempo.map(t => t.total_centavos) ?? [1]))

  async function pagar(ids: number[], pago: boolean) {
    await api.pagar(ids, pago)
    onAlterado()
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Faturas</h1>
        <div className="spacer" />
        <div className="segmented">
          {cartoes?.map(c => (
            <button key={c.id} className={c.id === cartaoId ? 'on' : ''}
              onClick={() => { setCartaoId(c.id); setRef(undefined) }}>{c.nome}</button>
          ))}
        </div>
      </div>

      {f && dados && refAtual && (
        <div className="two-col">
          <div className="panel">
            <div className="fatura-head">
              <div className="month-nav">
                <button className="icon-btn" aria-label="Fatura anterior" onClick={() => setRef(somarRef(refAtual, -1))}>
                  <ChevronLeft size={18} />
                </button>
                <div className="fatura-title">
                  <span className="dim">Fatura de</span>
                  <h1>{nomeFatura(refAtual)}</h1>
                </div>
                <button className="icon-btn" aria-label="Próxima fatura" onClick={() => setRef(somarRef(refAtual, 1))}>
                  <ChevronRight size={18} />
                </button>
              </div>
              <span className={`chip ${f.status}`}>{STATUS[f.status]}</span>
              {refAtual !== dados.atual && (
                <button className="btn ghost" onClick={() => setRef(undefined)}>Fatura atual</button>
              )}
              <div className="spacer" />
              {f.status === 'paga'
                ? <button className="btn" onClick={() => setConfirmar('desfazer')}>Desfazer pagamento</button>
                : <button className="btn primary" disabled={!abertos.length} onClick={() => setConfirmar('pagar')}>
                    Pagar fatura
                  </button>}
            </div>

            <div className="fatura-info">
              <div><label>Compras de</label><span className="num">{dataBR(f.inicio).slice(0, 5)} a {dataBR(f.fim).slice(0, 5)}</span></div>
              <div><label>Fecha em</label><span className="num">{dataBR(f.fechamento)}</span></div>
              <div><label>Vence em</label><span className="num">{dataBR(f.vencimento)}</span></div>
              <div><label>Total</label><strong className="num">{brl(f.total_centavos)}</strong></div>
              <div>
                <label>Em aberto</label>
                <strong className={`num${f.aberto_centavos && f.status !== 'aberta' ? ' red' : ''}`}>{brl(f.aberto_centavos)}</strong>
              </div>
            </div>

            {f.lista.length === 0 ? (
              <div className="empty">
                <Inbox size={28} />
                <div>Nenhum lançamento nesta fatura.</div>
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 40 }} />
                      <th>Compra</th>
                      <th>Descrição</th>
                      <th>Categoria</th>
                      <th className="right">Parcela</th>
                      <th className="right">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {f.lista.map(i => (
                      <tr key={i.id} className={i.pago ? 'paid' : ''} onClick={() => onEditarDespesa(i.despesa_id)}>
                        <td><Checkbox marcado={!!i.pago} onChange={v => pagar([i.id], v)} /></td>
                        <td className="num muted">{i.mes_referencia ? mesAno(`${i.mes_referencia}-01`) : dataBR(i.data_compra)}</td>
                        <td className="desc">{i.descricao}</td>
                        <td>{i.categoria ? <span className="tag">{i.categoria}</span> : <span className="dim">—</span>}</td>
                        <td className="right num muted">
                          {i.recorrente_id ? <span className="recur"><Repeat size={12} /> mensal</span>
                            : i.num_parcelas > 1 ? `${i.numero}/${i.num_parcelas}` : 'à vista'}
                        </td>
                        <td className="right num">{brl(i.valor_centavos)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="side-stack">
            <div className="panel">
              <div className="panel-head">
                <h2>Cobranças automáticas</h2>
                <button className="btn ghost" style={{ height: 28, padding: '0 8px' }}
                  onClick={() => cartaoId !== null && onNovaRecorrente(cartaoId)}>
                  <Plus size={14} /> Adicionar
                </button>
              </div>
              {automaticas.length === 0 ? (
                <div className="panel-body dim" style={{ fontSize: 12.5 }}>
                  Assinaturas e cobranças que caem todo mês neste cartão (streaming, academia, seguro...).
                </div>
              ) : (
                <div className="timeline">
                  {automaticas.map(r => (
                    <button key={r.id} className="timeline-row tipo-recorrente" onClick={() => onEditarRecorrente(r)}>
                      <div className="top" style={{ marginBottom: 0 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <i className="tipo-dot recorrente" /> {r.descricao}
                        </span>
                        <span className="num">{brl(r.valor_centavos)}</span>
                      </div>
                      <div className="sub"><span>todo dia {r.dia}</span>{r.inicio > mesAtual && <span>começa depois</span>}</div>
                    </button>
                  ))}
                  <div className="table-foot num" style={{ border: 'none', padding: '8px 12px 4px' }}>
                    <span>Total por mês <b>{brl(automaticas.reduce((s, r) => s + r.valor_centavos, 0))}</b></span>
                  </div>
                </div>
              )}
            </div>
            <div className="panel">
              <div className="panel-head"><h2>Faturas de {dados.cartao.nome}</h2></div>
              <div className="timeline">
                {dados.linha_do_tempo.map(t => (
                  <button key={t.referencia}
                    className={`timeline-row${t.referencia === refAtual ? ' selected' : ''}`}
                    onClick={() => setRef(t.referencia)}>
                    <div className="top">
                      <span>
                        {nomeFatura(t.referencia, false).slice(0, 3)}/{t.referencia.slice(2, 4)}
                        {t.referencia === dados.atual && <span className="dim"> · atual</span>}
                      </span>
                      <span className="num">{t.itens ? brl(t.total_centavos) : '—'}</span>
                    </div>
                    <div className="bar"><i style={{ width: `${t.total_centavos * 100 / maior}%` }} /></div>
                    <div className="sub">
                      <span>vence {dataBR(t.vencimento).slice(0, 5)}</span>
                      <span className={`status-dot ${t.status === 'paga' ? 'pago' : t.status === 'fechada' || t.status === 'vencida' ? 'pendente' : ''}`}>
                        {STATUS[t.status].toLowerCase()}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
            <div className="hint" style={{ padding: '0 4px' }}>
              {dados.cartao.nome} vira no dia {dados.cartao.dia_fechamento} e vence no dia {dados.cartao.dia_vencimento}.
              Compras a partir do dia {dados.cartao.dia_fechamento} entram na fatura do mês seguinte.
            </div>
          </div>
        </div>
      )}

      {confirmar && f && (
        <Confirmar
          titulo={confirmar === 'pagar' ? 'Pagar fatura' : 'Desfazer pagamento'}
          mensagem={confirmar === 'pagar'
            ? `Marcar a fatura de ${nomeFatura(f.referencia).toLowerCase()} (${brl(f.aberto_centavos)}) como paga?`
            : `Voltar todos os itens da fatura de ${nomeFatura(f.referencia).toLowerCase()} para em aberto?`}
          textoConfirmar={confirmar === 'pagar' ? 'Pagar fatura' : 'Desfazer'}
          onConfirmar={() => confirmar === 'pagar'
            ? pagar(abertos.map(i => i.id), true)
            : pagar(f.lista.map(i => i.id), false)}
          onClose={() => setConfirmar(null)}
        />
      )}
    </div>
  )
}

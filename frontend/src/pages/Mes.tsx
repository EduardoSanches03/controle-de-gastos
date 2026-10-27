import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, CreditCard, Download, ExternalLink, Inbox, Plus, Repeat } from 'lucide-react'
import { api, ehNativo, type Cartao, type FaturaAPagar, type FaturaEmConstrucao, type FaturaResumo, type FiltroCartao, type Parcela, type ResumoMes } from '../api'
import { FiltroCartaoSelect } from '../components/CartaoSelect'
import { Checkbox, Confirmar, useToast } from '../components/ui'
import { brl, dataBR, mesAno, MESES, nomeFatura } from '../format'

const STATUS: Record<FaturaResumo['status'], string> = {
  aberta: 'Aberta',
  fechada: 'Fechada',
  vencida: 'Vencida',
  paga: 'Paga',
  vazia: 'Sem compras',
}

const ddmm = (iso: string) => dataBR(iso).slice(0, 5)

export function Mes({ versao, onNovaDespesa, onEditarDespesa, onAlterado, onAbrirFatura }: {
  versao: number
  onAbrirFatura: (cartaoId: number, ref?: string) => void
  onNovaDespesa: () => void
  onEditarDespesa: (id: number) => void
  onAlterado: () => void
}) {
  const hoje = new Date()
  const [ano, setAno] = useState(hoje.getFullYear())
  const [mes, setMes] = useState(hoje.getMonth() + 1)
  const [filtro, setFiltro] = useState<FiltroCartao>(null)
  const [cartoes, setCartoes] = useState<Cartao[]>([])
  const [dados, setDados] = useState<ResumoMes | null>(null)
  const [aberta, setAberta] = useState<number | null>(null)
  const [confirmar, setConfirmar] = useState<{ fatura: FaturaAPagar; pago: boolean } | null>(null)
  const toast = useToast()

  const carregar = useCallback(() => {
    api.mes(ano, mes, filtro).then(setDados)
  }, [ano, mes, filtro])

  useEffect(() => { carregar() }, [carregar, versao])
  useEffect(() => { api.cartoes().then(setCartoes) }, [versao])

  function navegar(n: number) {
    const idx = ano * 12 + (mes - 1) + n
    setAno(Math.floor(idx / 12))
    setMes((idx % 12) + 1)
  }

  async function pagar(ids: number[], pago: boolean) {
    await api.pagar(ids, pago)
    onAlterado()
  }

  async function exportar() {
    try {
      const r = await api.exportar(ano, mes)
      if (!ehNativo) toast(`CSV salvo em ${r.caminho}`)
    } catch (e) {
      toast(`Não foi possível exportar: ${(e as Error).message}`)
    }
  }

  const ehMesAtual = ano === hoje.getFullYear() && mes === hoje.getMonth() + 1
  const nomeMes = MESES[mes - 1].toLowerCase()
  const comCartao = filtro !== 0
  const semCartao = filtro === null || filtro === 0
  // um bloco por cartão juntando a fatura que vence no mês e a que está em construção
  const porCartao = (() => {
    const mapa = new Map<number, { id: number; nome: string; pagar?: FaturaAPagar; construcao?: FaturaEmConstrucao }>()
    for (const f of dados?.em_construcao ?? []) mapa.set(f.cartao_id, { id: f.cartao_id, nome: f.cartao, construcao: f })
    for (const f of dados?.a_pagar ?? []) {
      const atual = mapa.get(f.cartao_id) ?? { id: f.cartao_id, nome: f.cartao }
      mapa.set(f.cartao_id, { ...atual, pagar: f })
    }
    return [...mapa.values()].sort((a, b) => a.nome.localeCompare(b.nome))
  })()
  const t = dados?.totais
  const maiorCategoria = Math.max(1, ...(dados?.categorias.map(c => c.total_centavos) ?? [1]))
  const gastoTotal = t?.gasto_centavos || 1

  return (
    <div className="page">
      <div className="page-header">
        <div className="month-nav">
          <button className="icon-btn" onClick={() => navegar(-1)} aria-label="Mês anterior"><ChevronLeft size={18} /></button>
          <h1>{MESES[mes - 1]} <span className="dim">{ano}</span></h1>
          <button className="icon-btn" onClick={() => navegar(1)} aria-label="Próximo mês"><ChevronRight size={18} /></button>
        </div>
        {!ehMesAtual && (
          <button className="btn ghost" onClick={() => { setAno(hoje.getFullYear()); setMes(hoje.getMonth() + 1) }}>
            Mês atual
          </button>
        )}
        <div className="spacer" />
        <FiltroCartaoSelect cartoes={cartoes} valor={filtro} onChange={setFiltro} />
        <button className="btn" onClick={exportar}><Download size={15} /> Exportar CSV</button>
        <button className="btn primary" onClick={onNovaDespesa}><Plus size={15} /> Nova despesa</button>
      </div>

      <div className="kpis">
        <div className="panel kpi accent" title="Fatura em construção + recorrências + lançamentos sem cartão">
          <label>Gasto no mês</label>
          <strong className="num">{brl(t?.gasto_centavos ?? 0)}</strong>
        </div>
        <div className="panel kpi" title="Compras no cartão deste mês, pagas no mês seguinte">
          <label>Em construção (cartões)</label>
          <strong className="num">{brl(t?.em_construcao_centavos ?? 0)}</strong>
        </div>
        <div className="panel kpi" title="Faturas que vencem neste mês + recorrências + lançamentos ainda não pagos">
          <label>A pagar neste mês</label>
          <strong className={`num${t?.a_pagar_aberto_centavos ? ' red' : ''}`}>{brl(t?.a_pagar_aberto_centavos ?? 0)}</strong>
        </div>
        <div className="panel kpi">
          <label>Pago neste mês</label>
          <strong className="num">{brl(t?.pago_centavos ?? 0)}</strong>
        </div>
      </div>

      <div className="two-col">
        <div className="side-stack">
          {comCartao && dados && porCartao.length === 0 && (
            <div className="panel panel-body dim">Nenhum cartão cadastrado.</div>
          )}
          {comCartao && porCartao.map(({ id, nome, pagar: f, construcao: fc }) => {
            const paga = !!f && f.aberto_centavos === 0
            const expandida = aberta === id
            return (
              <div key={id} className="panel card-panel">
                <div className="card-panel-head">
                  <CreditCard size={16} />
                  <h2>{nome}</h2>
                  <div className="spacer" />
                  <span className="muted num">
                    {f && `a pagar ${brl(f.aberto_centavos)}`}
                    {f && fc && ' · '}
                    {fc && `em construção ${brl(fc.total_centavos)}`}
                  </span>
                </div>

                <div className="card-section-title">Fatura a pagar em {nomeMes}</div>
                {f ? (
                  <div className={`fatura-row${paga ? ' paid' : ''}`}>
                    <div className="fatura-line" onClick={() => setAberta(expandida ? null : id)}>
                      <Checkbox marcado={paga} titulo={paga ? 'Desfazer pagamento' : 'Marcar fatura como paga'}
                        onChange={v => setConfirmar({ fatura: f, pago: v })} />
                      <div className="item-info">
                        <strong>Fatura de {nomeFatura(f.referencia).toLowerCase()}</strong>
                        <span className="muted">vence {dataBR(f.vencimento)} · {f.itens.length} item(ns)</span>
                      </div>
                      <div className="fatura-valor num">
                        <strong>{brl(f.total_centavos)}</strong>
                        {paga ? <span className="ok">paga</span>
                          : f.aberto_centavos < f.total_centavos
                            ? <span className="muted">{brl(f.aberto_centavos)} em aberto</span>
                            : <span className="muted">em aberto</span>}
                      </div>
                      <button className="icon-btn" title="Abrir fatura"
                        onClick={e => { e.stopPropagation(); onAbrirFatura(id, f.referencia) }}>
                        <ExternalLink size={15} />
                      </button>
                      <ChevronDown size={16} className={`chevron${expandida ? ' up' : ''}`} />
                    </div>
                    {expandida && <TabelaParcelas itens={f.itens} onPagar={pagar} onEditar={onEditarDespesa} />}
                  </div>
                ) : <div className="card-section-empty dim">Nenhuma fatura deste cartão vence em {nomeMes}.</div>}

                {fc && <>
                  <div className="card-section-title">
                    Fatura em construção · {nomeFatura(fc.referencia).toLowerCase()}
                    <span className={`chip ${fc.status}`}>{STATUS[fc.status]}</span>
                  </div>
                  <div className="construcao-head">
                    <div className="muted num">
                      compras de {ddmm(fc.inicio)} a {ddmm(fc.fim)} · fecha {ddmm(fc.fechamento)} · vence {dataBR(fc.vencimento)}
                    </div>
                    <div className="right">
                      <strong className="num">{brl(fc.total_centavos)}</strong>
                      <button className="icon-btn" title="Abrir fatura" onClick={() => onAbrirFatura(id, fc.referencia)}>
                        <ExternalLink size={15} />
                      </button>
                    </div>
                  </div>
                  {fc.itens.length === 0 ? (
                    <div className="card-section-empty dim">Nenhuma compra nesta fatura ainda.</div>
                  ) : (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Compra</th>
                            <th>Descrição</th>
                            <th>Categoria</th>
                            <th className="right">Parcela</th>
                            <th className="right">Valor</th>
                          </tr>
                        </thead>
                        <tbody>
                          {fc.itens.map(i => (
                            <tr key={i.id} onClick={() => onEditarDespesa(i.despesa_id)}>
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
                </>}
              </div>
            )
          })}
          {!comCartao && (
            <div className="panel empty">
              <Inbox size={28} />
              <div>Filtro “sem cartão”: veja recorrências e lançamentos ao lado.</div>
            </div>
          )}
        </div>

        <div className="side-stack">
          {semCartao && (
            <div className="panel">
              <div className="panel-head"><h2>Recorrências</h2></div>
              <div className="panel-body">
                {dados?.recorrencias.length
                  ? <ListaCompacta itens={dados.recorrencias} onPagar={pagar} onEditar={onEditarDespesa} />
                  : <div className="dim">Nenhuma recorrência sem cartão em {nomeMes}.</div>}
                {comCartao && <div className="hint" style={{ marginTop: 10 }}>As recorrências no cartão aparecem na fatura.</div>}
              </div>
            </div>
          )}

          {semCartao && (
            <div className="panel">
              <div className="panel-head">
                <h2>Lançamentos do mês <span className="dim">· sem cartão</span></h2>
                <button className="icon-btn" title="Nova despesa" onClick={onNovaDespesa}><Plus size={15} /></button>
              </div>
              <div className="panel-body">
                {dados?.lancamentos.length
                  ? <ListaCompacta itens={dados.lancamentos} onPagar={pagar} onEditar={onEditarDespesa} />
                  : <div className="dim">Nenhum gasto sem cartão em {nomeMes}.</div>}
              </div>
            </div>
          )}

          <div className="panel">
            <div className="panel-head"><h2>Gasto por categoria</h2></div>
            <div className="panel-body">
              {dados?.categorias.length ? (
                <div className="bar-list">
                  {dados.categorias.map((c, i) => (
                    <div key={c.categoria} className="bar-row">
                      <div className="top">
                        <span>{c.categoria}</span>
                        <span className="num">
                          {brl(c.total_centavos)}
                          <span className="dim"> · {Math.round(c.total_centavos * 100 / gastoTotal)}%</span>
                        </span>
                      </div>
                      <div className={`bar${i === 0 ? ' accent' : ''}`}>
                        <i style={{ width: `${c.total_centavos * 100 / maiorCategoria}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : <div className="dim">Sem gastos neste mês.</div>}
            </div>
          </div>
        </div>
      </div>

      {confirmar && (
        <Confirmar
          titulo={confirmar.pago ? 'Pagar fatura' : 'Desfazer pagamento'}
          mensagem={confirmar.pago
            ? `Marcar a fatura de ${nomeFatura(confirmar.fatura.referencia).toLowerCase()} do ${confirmar.fatura.cartao} (${brl(confirmar.fatura.aberto_centavos)}) como paga?`
            : `Desmarcar o pagamento da fatura de ${nomeFatura(confirmar.fatura.referencia).toLowerCase()} do ${confirmar.fatura.cartao}?`}
          textoConfirmar={confirmar.pago ? 'Pagar fatura' : 'Desfazer'}
          onConfirmar={() => pagar(confirmar.fatura.itens.filter(i => !!i.pago !== confirmar.pago).map(i => i.id), confirmar.pago)}
          onClose={() => setConfirmar(null)}
        />
      )}
    </div>
  )
}

function TabelaParcelas({ itens, onPagar, onEditar }: {
  itens: Parcela[]
  onPagar: (ids: number[], pago: boolean) => void
  onEditar: (despesaId: number) => void
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th style={{ width: 40 }} />
            <th>Vencimento</th>
            <th>Descrição</th>
            <th>Categoria</th>
            <th className="right">Parcela</th>
            <th className="right">Valor</th>
          </tr>
        </thead>
        <tbody>
          {itens.map(p => (
            <tr key={p.id} className={p.pago ? 'paid' : ''} onClick={() => onEditar(p.despesa_id)}>
              <td>
                <Checkbox marcado={!!p.pago} titulo={p.pago ? 'Desmarcar pagamento' : 'Marcar como paga'}
                  onChange={v => onPagar([p.id], v)} />
              </td>
              <td className="num">{dataBR(p.vencimento)}</td>
              <td className="desc">{p.descricao}</td>
              <td>{p.categoria ? <span className="tag">{p.categoria}</span> : <span className="dim">—</span>}</td>
              <td className="right num muted">
                {p.recorrente_id
                  ? <span className="recur"><Repeat size={12} /> mensal</span>
                  : p.num_parcelas > 1 ? `${p.numero}/${p.num_parcelas}` : 'à vista'}
              </td>
              <td className="right num">{brl(p.valor_centavos)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ListaCompacta({ itens, onPagar, onEditar }: {
  itens: Parcela[]
  onPagar: (ids: number[], pago: boolean) => void
  onEditar: (despesaId: number) => void
}) {
  return (
    <div className="recorrencias">
      {itens.map(p => (
        <div key={p.id} className={`recorrencia${p.pago ? ' paid' : ''}`} onClick={() => onEditar(p.despesa_id)}>
          <Checkbox marcado={!!p.pago} titulo={p.pago ? 'Desmarcar pagamento' : 'Marcar como paga'}
            onChange={v => onPagar([p.id], v)} />
          <div className="item-info">
            <span>{p.descricao}</span>
            <span className="dim num">
              vence {ddmm(p.vencimento)}
              {p.num_parcelas > 1 && !p.recorrente_id ? ` · ${p.numero}/${p.num_parcelas}` : ''}
              {p.categoria ? ` · ${p.categoria}` : ''}
            </span>
          </div>
          <span className="num">{brl(p.valor_centavos)}</span>
        </div>
      ))}
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, CircleStop, Inbox, Plus, Search, Trash2 } from 'lucide-react'
import { api, type Cartao, type Despesa, type FiltroCartao, type Recorrente } from '../api'
import { FiltroCartaoSelect } from '../components/CartaoSelect'
import { Confirmar } from '../components/ui'
import { brl, dataBR, hojeISO, mesAno } from '../format'

type Tipo = 'avista' | 'parcelada' | 'recorrente'
type Coluna = 'data' | 'descricao' | 'valor' | 'aberto' | 'termina'

const TIPOS: { id: Tipo; nome: string }[] = [
  { id: 'avista', nome: 'À vista' },
  { id: 'parcelada', nome: 'Parceladas' },
  { id: 'recorrente', nome: 'Recorrentes' },
]
const NOME_TIPO: Record<Tipo, string> = { avista: 'À vista', parcelada: 'Parcelada', recorrente: 'Recorrente' }

/** Linha da tabela: compra (à vista/parcelada) ou recorrente, no mesmo formato */
interface Linha {
  chave: string
  tipo: Tipo
  data: string
  /** lançada pelo mês, sem dia definido */
  porMes?: boolean
  descricao: string
  categoria: string | null
  cartao: string | null
  valor: number
  aberto: number
  termina: string
  encerrada: boolean
  despesa?: Despesa
  recorrente?: Recorrente
}

export function Despesas({ versao, onNovaDespesa, onEditarDespesa, onEditarRecorrente, onAlterado }: {
  versao: number
  onNovaDespesa: () => void
  onEditarDespesa: (id: number) => void
  onEditarRecorrente: (r: Recorrente) => void
  onAlterado: () => void
}) {
  const [busca, setBusca] = useState('')
  const [filtroCartao, setFiltroCartao] = useState<FiltroCartao>(null)
  const [tipos, setTipos] = useState<Set<Tipo>>(new Set())
  const [situacao, setSituacao] = useState<'todas' | 'abertas' | 'quitadas'>('todas')
  const [cartoes, setCartoes] = useState<Cartao[]>([])
  const [despesas, setDespesas] = useState<Despesa[]>([])
  const [recorrentes, setRecorrentes] = useState<Recorrente[]>([])
  const [ordem, setOrdem] = useState<{ col: Coluna; desc: boolean }>({ col: 'data', desc: true })
  const [excluir, setExcluir] = useState<Linha | null>(null)
  const [encerrar, setEncerrar] = useState<Recorrente | null>(null)

  useEffect(() => {
    api.cartoes().then(setCartoes)
    api.despesas('', null, 'todas').then(setDespesas)
    api.recorrentes().then(setRecorrentes)
  }, [versao])

  const mesAtual = hojeISO().slice(0, 7)

  const todas = useMemo<Linha[]>(() => [
    ...despesas.map(d => ({
      chave: `d${d.id}`,
      tipo: (d.num_parcelas > 1 ? 'parcelada' : 'avista') as Tipo,
      data: d.data_compra,
      porMes: !!d.mes_referencia,
      descricao: d.descricao,
      categoria: d.categoria,
      cartao: d.cartao,
      valor: d.valor_total_centavos,
      aberto: d.aberto_centavos ?? 0,
      termina: d.ultimo_vencimento ?? d.data_compra,
      encerrada: !d.aberto_centavos,
      despesa: d,
    })),
    ...recorrentes.map(r => {
      const encerrada = !!r.fim && r.fim < mesAtual
      const vigente = !encerrada && r.inicio <= mesAtual
      return {
        chave: `r${r.id}`,
        tipo: 'recorrente' as Tipo,
        data: `${r.inicio}-${String(r.dia).padStart(2, '0')}`,
        descricao: r.descricao,
        categoria: r.categoria,
        cartao: r.cartao,
        valor: r.valor_centavos,
        aberto: vigente && !r.pago_mes_atual ? r.valor_centavos : 0,
        termina: r.fim ? `${r.fim}-01` : '9999-12',
        encerrada,
        recorrente: r,
      }
    }),
  ], [despesas, recorrentes, mesAtual])

  // filtros (menos o de tipo) — usados também para as contagens dos chips
  const filtradas = useMemo(() => {
    const b = busca.trim().toLowerCase()
    const nomeCartao = filtroCartao === null ? undefined
      : filtroCartao === 0 ? null : cartoes.find(c => c.id === filtroCartao)?.nome
    return todas.filter(l =>
      (!b || l.descricao.toLowerCase().includes(b) || (l.categoria ?? '').toLowerCase().includes(b)
        || (l.despesa?.observacao ?? l.recorrente?.observacao ?? '').toLowerCase().includes(b))
      && (nomeCartao === undefined || l.cartao === nomeCartao)
      && (situacao === 'todas' || (situacao === 'abertas' ? !l.encerrada : l.encerrada)))
  }, [todas, busca, filtroCartao, situacao, cartoes])

  const visiveis = useMemo(() => {
    const l = filtradas.filter(x => tipos.size === 0 || tipos.has(x.tipo))
    l.sort((a, b) => {
      const va = a[ordem.col], vb = b[ordem.col]
      const r = typeof va === 'string' ? va.localeCompare(String(vb), 'pt-BR') : (va as number) - (vb as number)
      return ordem.desc ? -r : r
    })
    return l
  }, [filtradas, tipos, ordem])

  const contagem = (t: Tipo) => filtradas.filter(l => l.tipo === t).length
  const alternarTipo = (t: Tipo) => setTipos(atual => {
    const novo = new Set(atual)
    if (novo.has(t)) novo.delete(t)
    else novo.add(t)
    return novo
  })

  const compras = visiveis.filter(l => l.tipo !== 'recorrente')
  const fixas = visiveis.filter(l => l.tipo === 'recorrente' && !l.encerrada)
  const aPagarParcelas = compras.reduce((s, l) => s + l.aberto, 0)
  const fixoMensal = fixas.reduce((s, l) => s + l.valor, 0)

  function Th({ col, children, direita }: { col: Coluna; children: string; direita?: boolean }) {
    const ativa = ordem.col === col
    return (
      <th className={direita ? 'right' : ''} style={{ cursor: 'pointer' }}
        onClick={() => setOrdem({ col, desc: ativa ? !ordem.desc : col !== 'descricao' })}>
        {children}
        {ativa && (ordem.desc ? <ArrowDown size={11} style={{ marginLeft: 4 }} /> : <ArrowUp size={11} style={{ marginLeft: 4 }} />)}
      </th>
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Despesas</h1>
        <div className="spacer" />
        <button className="btn primary" onClick={onNovaDespesa}><Plus size={15} /> Nova despesa</button>
      </div>

      <div className="kpis" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="panel kpi accent">
          <label>Ainda a pagar em compras</label>
          <strong className="num">{brl(aPagarParcelas)}</strong>
        </div>
        <div className="panel kpi">
          <label>Recorrentes por mês</label>
          <strong className="num">{brl(fixoMensal)}</strong>
        </div>
        <div className="panel kpi">
          <label>Lançamentos na lista</label>
          <strong className="num">{visiveis.length}</strong>
        </div>
      </div>

      <div className="page-header">
        <div className="search">
          <Search size={15} />
          <input className="input" placeholder="Buscar por descrição, categoria ou observação"
            value={busca} onChange={e => setBusca(e.target.value)} />
        </div>
        <FiltroCartaoSelect cartoes={cartoes} valor={filtroCartao} onChange={setFiltroCartao} />
        <div className="segmented">
          {([['todas', 'Todas'], ['abertas', 'Em andamento'], ['quitadas', 'Quitadas/encerradas']] as const).map(([id, nome]) => (
            <button key={id} className={situacao === id ? 'on' : ''} onClick={() => setSituacao(id)}>{nome}</button>
          ))}
        </div>
      </div>

      <div className="filtro-tipos">
        {TIPOS.map(t => (
          <button key={t.id} className={`filtro-tipo${tipos.has(t.id) ? ' on' : ''}`} onClick={() => alternarTipo(t.id)}>
            <i className={`tipo-dot ${t.id}`} /> {t.nome} <span className="qtd num">{contagem(t.id)}</span>
          </button>
        ))}
        {tipos.size > 0 && <button className="btn ghost" onClick={() => setTipos(new Set())}>Limpar</button>}
      </div>

      <div className="panel">
        {visiveis.length === 0 ? (
          <div className="empty">
            <Inbox size={28} />
            <div>{todas.length ? 'Nada encontrado com esses filtros.' : 'Nenhuma despesa cadastrada ainda.'}</div>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <Th col="data">Data</Th>
                  <Th col="descricao">Descrição</Th>
                  <th>Categoria</th>
                  <th>Cartão</th>
                  <th className="right">Andamento</th>
                  <Th col="valor" direita>Valor</Th>
                  <Th col="aberto" direita>Em aberto</Th>
                  <Th col="termina">Termina</Th>
                  <th style={{ width: 76 }} />
                </tr>
              </thead>
              <tbody>
                {visiveis.map(l => {
                  const d = l.despesa, r = l.recorrente
                  return (
                    <tr key={l.chave} className={`tipo-${l.tipo}${l.encerrada ? ' paid' : ''}`}
                      onClick={() => d ? onEditarDespesa(d.id) : r && onEditarRecorrente(r)}>
                      <td className="num">{r ? <span className="muted">desde {mesAno(`${r.inicio}-01`)}</span> : l.porMes ? mesAno(l.data) : dataBR(l.data)}</td>
                      <td className="desc">
                        <span className="desc-tipo">
                          {l.descricao}
                          <span className={`tipo-tag tipo-${l.tipo}`}>{NOME_TIPO[l.tipo]}</span>
                        </span>
                      </td>
                      <td>{l.categoria ? <span className="tag">{l.categoria}</span> : <span className="dim">—</span>}</td>
                      <td className="muted">{l.cartao ?? 'Sem cartão'}</td>
                      <td className="right num muted">
                        {r ? (l.encerrada ? 'encerrada' : r.inicio > mesAtual ? 'ainda não começou'
                          : r.pago_mes_atual ? 'mês pago' : `dia ${r.dia} · pendente`)
                          : d && d.num_parcelas > 1 ? `${d.parcelas_pagas ?? 0}/${d.num_parcelas} pagas`
                          : d?.parcelas_pagas ? 'paga' : 'a pagar'}
                      </td>
                      <td className="right num">
                        {r ? <>{brl(l.valor)}<span className="dim">/mês</span></>
                          : d && d.num_parcelas > 1
                            ? <>{brl(l.valor)} <span className="dim">· {d.num_parcelas}×</span></>
                            : brl(l.valor)}
                      </td>
                      <td className={`right num${l.aberto ? '' : ' dim'}`}>
                        {l.aberto ? brl(l.aberto) : r ? '—' : 'quitada'}
                      </td>
                      <td className="num muted">{r && !r.fim ? 'sem fim' : mesAno(l.termina)}</td>
                      <td className="right" onClick={e => e.stopPropagation()}>
                        {r && !l.encerrada && (
                          <button className="icon-btn" title="Encerrar (para de lançar nos próximos meses)"
                            onClick={() => setEncerrar(r)}><CircleStop size={14} /></button>
                        )}
                        <button className="icon-btn danger" title="Excluir" onClick={() => setExcluir(l)}>
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {encerrar && (
        <Confirmar
          titulo="Encerrar recorrente"
          mensagem={<>
            <b style={{ color: 'var(--text)' }}>{encerrar.descricao}</b> deixa de ser lançada a partir do próximo mês.
            O histórico e o lançamento deste mês continuam.
          </>}
          textoConfirmar="Encerrar"
          onConfirmar={async () => { await api.encerrarRecorrente(encerrar.id); onAlterado() }}
          onClose={() => setEncerrar(null)}
        />
      )}
      {excluir && (
        <Confirmar
          titulo={excluir.recorrente ? 'Excluir recorrente' : 'Excluir despesa'}
          mensagem={excluir.recorrente
            ? <>Excluir <b style={{ color: 'var(--text)' }}>{excluir.descricao}</b> e todos os lançamentos dela, inclusive
              os meses já pagos? Se ela só acabou, prefira <b style={{ color: 'var(--text)' }}>Encerrar</b> para manter o histórico.</>
            : <>Excluir <b style={{ color: 'var(--text)' }}>{excluir.descricao}</b> e todas as suas {excluir.despesa?.num_parcelas} parcela(s)?
              Essa ação não pode ser desfeita.</>}
          textoConfirmar={excluir.recorrente ? 'Excluir tudo' : 'Excluir'}
          onConfirmar={async () => {
            if (excluir.recorrente) await api.excluirRecorrente(excluir.recorrente.id)
            else if (excluir.despesa) await api.excluirDespesa(excluir.despesa.id)
            onAlterado()
          }}
          onClose={() => setExcluir(null)}
        />
      )}
    </div>
  )
}

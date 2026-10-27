import { useEffect, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { api, type Cartao, type Recorrente } from '../api'
import { CartaoModal } from '../components/CartaoModal'
import { Confirmar, useToast } from '../components/ui'
import { brl, hojeISO } from '../format'

export function Cartoes({ versao, onAlterado }: { versao: number; onAlterado: () => void }) {
  const [cartoes, setCartoes] = useState<Cartao[]>([])
  const [editando, setEditando] = useState<Cartao | 'novo' | null>(null)
  const [excluir, setExcluir] = useState<Cartao | null>(null)
  const [recorrentes, setRecorrentes] = useState<Recorrente[]>([])
  const toast = useToast()

  useEffect(() => {
    api.cartoes().then(setCartoes)
    api.recorrentes().then(setRecorrentes)
  }, [versao])
  const mesAtual = hojeISO().slice(0, 7)

  return (
    <div className="page">
      <div className="page-header">
        <h1>Cartões</h1>
        <span className="dim">O limite usado considera todas as parcelas ainda não pagas.</span>
        <div className="spacer" />
        <button className="btn primary" onClick={() => setEditando('novo')}><Plus size={15} /> Novo cartão</button>
      </div>

      <div className="cards-grid">
        {cartoes.map(c => {
          const pct = c.limite_centavos ? Math.min(100, c.usado_centavos * 100 / c.limite_centavos) : 0
          const disponivel = c.limite_centavos - c.usado_centavos
          const auto = recorrentes.filter(r => r.cartao_id === c.id && (!r.fim || r.fim >= mesAtual))
          return (
            <div key={c.id} className={`panel credit-card${c.ativo ? '' : ' inactive'}`}>
              <div className="head">
                <div>
                  <h3>{c.nome}</h3>
                  <div className="dim" style={{ fontSize: 12 }}>{c.bandeira || 'Sem bandeira'}{!c.ativo && ' · inativo'}</div>
                </div>
                <div>
                  <button className="icon-btn" title="Editar" onClick={() => setEditando(c)}><Pencil size={14} /></button>
                  <button className="icon-btn danger" title="Excluir" onClick={() => setExcluir(c)}><Trash2 size={14} /></button>
                </div>
              </div>
              <div className="meta">
                <span>Vira dia <b>{c.dia_fechamento}</b></span>
                <span>Vence dia <b>{c.dia_vencimento}</b></span>
              </div>
              {auto.length > 0 && (
                <div className="meta" title={auto.map(r => `${r.descricao}: ${brl(r.valor_centavos)}`).join('\n')}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <i className="tipo-dot recorrente" />
                    {auto.length} cobrança{auto.length > 1 ? 's' : ''} automática{auto.length > 1 ? 's' : ''} ·
                    <b className="num">{brl(auto.reduce((s, r) => s + r.valor_centavos, 0))}/mês</b>
                  </span>
                </div>
              )}
              <div>
                {c.limite_centavos ? (
                  <>
                    <div className={`bar${pct >= 80 ? ' accent' : ''}`}><i style={{ width: `${pct}%` }} /></div>
                    <div className="limit-values num">
                      <span className="muted">Usado <b style={{ color: 'var(--text)', fontWeight: 500 }}>{brl(c.usado_centavos)}</b></span>
                      <span className={disponivel < c.limite_centavos * 0.2 ? 'red' : 'muted'}>
                        {disponivel < 0 ? `Excedido ${brl(-disponivel)}` : `Disponível ${brl(disponivel)}`}
                      </span>
                    </div>
                    <div className="dim num" style={{ fontSize: 12, marginTop: 4 }}>Limite {brl(c.limite_centavos)} · {Math.round(pct)}% usado</div>
                  </>
                ) : (
                  <div className="muted num">Em aberto {brl(c.usado_centavos)} <span className="dim">· sem limite cadastrado</span></div>
                )}
              </div>
            </div>
          )
        })}
        <button className="new-card" onClick={() => setEditando('novo')}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Plus size={16} /> Adicionar cartão</span>
        </button>
      </div>

      {editando && (
        <CartaoModal
          cartao={editando === 'novo' ? undefined : editando}
          onClose={() => setEditando(null)}
          onSalvo={onAlterado}
        />
      )}
      {excluir && (
        <Confirmar
          titulo="Excluir cartão"
          mensagem={`Excluir o cartão ${excluir.nome}? Se ele tiver despesas lançadas, será apenas desativado.`}
          textoConfirmar="Excluir"
          onConfirmar={async () => {
            const r = await api.excluirCartao(excluir.id)
            if (r.desativado) toast(`${excluir.nome} tem despesas lançadas, então foi desativado em vez de excluído.`)
            onAlterado()
          }}
          onClose={() => setExcluir(null)}
        />
      )}
    </div>
  )
}

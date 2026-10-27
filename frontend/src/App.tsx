import { useCallback, useEffect, useRef, useState } from 'react'
import { CalendarDays, CreditCard, DatabaseBackup, FolderOpen, Receipt, Upload, WalletCards } from 'lucide-react'
import { api, ehNativo, type Recorrente } from './api'
import { DespesaModal } from './components/DespesaModal'
import { RecorrenteModal } from './components/RecorrenteModal'
import { Confirmar, useToast, type Rascunho } from './components/ui'
import { Cartoes } from './pages/Cartoes'
import { Despesas } from './pages/Despesas'
import { Faturas } from './pages/Faturas'
import { Mes } from './pages/Mes'

type Pagina = 'mes' | 'faturas' | 'despesas' | 'cartoes'

const MENU: { id: Pagina; nome: string; icone: typeof CalendarDays }[] = [
  { id: 'mes', nome: 'Visão do mês', icone: CalendarDays },
  { id: 'faturas', nome: 'Faturas', icone: WalletCards },
  { id: 'despesas', nome: 'Despesas', icone: Receipt },
  { id: 'cartoes', nome: 'Cartões', icone: CreditCard },
]

/** Formulário aberto: compra (nova ou edição) ou recorrente (nova ou edição) */
type Formulario =
  | { tipo: 'compra'; id?: number; inicial?: Rascunho }
  | { tipo: 'recorrente'; recorrente?: Recorrente; inicial?: Rascunho }

function paginaDoEndereco(): Pagina {
  const h = location.hash.slice(1)
  return MENU.some(m => m.id === h) ? (h as Pagina) : 'mes'
}

export default function App() {
  const [pagina, setPaginaState] = useState<Pagina>(paginaDoEndereco)
  // incrementa sempre que algo muda, para as páginas recarregarem
  const [versao, setVersao] = useState(0)
  const [alvoFatura, setAlvoFatura] = useState<{ cartaoId: number; ref?: string } | null>(null)
  const [form, setForm] = useState<Formulario | null>(null)
  const toast = useToast()
  const seletorBanco = useRef<HTMLInputElement>(null)
  const [importar, setImportar] = useState<File | null>(null)

  function setPagina(p: Pagina) {
    setPaginaState(p)
    history.replaceState(null, '', `#${p}`)
  }

  const alterado = useCallback(() => setVersao(v => v + 1), [])
  const nova = useCallback(() => setForm({ tipo: 'compra' }), [])
  const editar = useCallback((id: number) => setForm({ tipo: 'compra', id }), [])
  const editarRecorrente = useCallback((r: Recorrente) => setForm({ tipo: 'recorrente', recorrente: r }), [])
  const novaRecorrente = useCallback((cartaoId?: number) =>
    setForm({ tipo: 'recorrente', inicial: { cartaoId: cartaoId ?? null } }), [])

  useEffect(() => {
    const mudou = () => setPaginaState(paginaDoEndereco())
    window.addEventListener('hashchange', mudou)
    return () => window.removeEventListener('hashchange', mudou)
  }, [])

  // Ctrl+N abre nova despesa
  useEffect(() => {
    const atalho = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'n') { e.preventDefault(); nova() }
    }
    window.addEventListener('keydown', atalho)
    return () => window.removeEventListener('keydown', atalho)
  }, [nova])

  async function backup() {
    try {
      const r = await api.backup()
      if (!ehNativo) toast(`Backup salvo em ${r.caminho}`)
    } catch (e) {
      toast(`Não foi possível fazer o backup: ${(e as Error).message}`)
    }
  }

  async function importarBanco(arquivo: File) {
    try {
      await api.importarBanco(new Uint8Array(await arquivo.arrayBuffer()))
      alterado()
      toast('Banco importado.')
    } catch (e) {
      toast(`Não foi possível importar: ${(e as Error).message}`)
    }
  }

  const props = { versao, onNovaDespesa: nova, onEditarDespesa: editar, onAlterado: alterado }
  const abrirFatura = (cartaoId: number, ref?: string) => {
    setAlvoFatura({ cartaoId, ref })
    setPagina('faturas')
  }
  const fechar = () => setForm(null)

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand"><img src="/icon.svg" alt="" /> <span>Controle de Gastos</span></div>
        {MENU.map(({ id, nome, icone: Icone }) => (
          <button key={id} className={`nav-item${pagina === id ? ' active' : ''}`} onClick={() => setPagina(id)}>
            <Icone size={16} /> {nome}
          </button>
        ))}
        <div className="sidebar-footer">
          <button className="nav-item" title="Fazer backup" onClick={backup}><DatabaseBackup size={15} /> <span className="nav-label">Fazer backup</span></button>
          {ehNativo ? <>
            <button className="nav-item" title="Importar banco" onClick={() => seletorBanco.current?.click()}><Upload size={15} /> <span className="nav-label">Importar banco</span></button>
            <input ref={seletorBanco} type="file" hidden onChange={e => {
              setImportar(e.target.files?.[0] ?? null)
              e.target.value = ''
            }} />
          </> : <button className="nav-item" onClick={() => api.abrirPasta()}><FolderOpen size={15} /> Abrir pasta de arquivos</button>}
        </div>
      </aside>

      <main className="main">
        {pagina === 'mes' && <Mes {...props} onAbrirFatura={abrirFatura} />}
        {pagina === 'faturas' && (
          <Faturas versao={versao} alvo={alvoFatura} onEditarDespesa={editar} onAlterado={alterado}
            onEditarRecorrente={editarRecorrente} onNovaRecorrente={novaRecorrente}
            onIrCartoes={() => setPagina('cartoes')} />
        )}
        {pagina === 'despesas' && <Despesas {...props} onEditarRecorrente={editarRecorrente} />}
        {pagina === 'cartoes' && <Cartoes versao={versao} onAlterado={alterado} />}
      </main>

      {form?.tipo === 'compra' && (
        <DespesaModal key="compra" despesaId={form.id} inicial={form.inicial} onClose={fechar} onSalvo={alterado}
          onVirarRecorrente={inicial => setForm({ tipo: 'recorrente', inicial })} />
      )}
      {form?.tipo === 'recorrente' && (
        <RecorrenteModal key="recorrente" recorrente={form.recorrente} inicial={form.inicial} onClose={fechar}
          onSalvo={alterado} onVirarCompra={inicial => setForm({ tipo: 'compra', inicial })} />
      )}
      {importar && (
        <Confirmar titulo="Importar banco" textoConfirmar="Importar"
          mensagem={<>Os dados deste aparelho serão substituídos pelos de <b>{importar.name}</b>. Uma cópia do banco atual fica guardada no app.</>}
          onConfirmar={() => importarBanco(importar)} onClose={() => setImportar(null)} />
      )}
    </div>
  )
}

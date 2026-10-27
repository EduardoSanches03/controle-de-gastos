/** Camada de dados no aparelho: SQLite (sql.js) com as mesmas tabelas e regras de backend/database.py. */
import type { Database as SqlDb, SqlValue } from 'sql.js'
import {
  CATEGORIAS_PADRAO, calcularVencimentos, cicloFatura, dataSegura, dividirValor, hoje, iso, mesIso,
  somarMeses, vencimentosDespesa, vencimentosPorMes, type CartaoRegra,
} from './regras'

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS cartoes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    nome            TEXT    NOT NULL,
    bandeira        TEXT    NOT NULL DEFAULT '',
    dia_fechamento  INTEGER NOT NULL,
    dia_vencimento  INTEGER NOT NULL,
    limite_centavos INTEGER NOT NULL DEFAULT 0,
    ativo           INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS categorias (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL UNIQUE COLLATE NOCASE
);
CREATE TABLE IF NOT EXISTS despesas (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    descricao          TEXT    NOT NULL,
    categoria_id       INTEGER REFERENCES categorias(id),
    cartao_id          INTEGER REFERENCES cartoes(id),
    valor_total_centavos INTEGER NOT NULL,
    num_parcelas       INTEGER NOT NULL DEFAULT 1,
    data_compra        TEXT    NOT NULL,
    observacao         TEXT    NOT NULL DEFAULT '',
    criado_em          TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE TABLE IF NOT EXISTS parcelas (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    despesa_id      INTEGER NOT NULL REFERENCES despesas(id) ON DELETE CASCADE,
    numero          INTEGER NOT NULL,
    valor_centavos  INTEGER NOT NULL,
    vencimento      TEXT    NOT NULL,
    pago            INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS recorrentes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    descricao       TEXT    NOT NULL,
    categoria_id    INTEGER REFERENCES categorias(id),
    cartao_id       INTEGER REFERENCES cartoes(id),
    valor_centavos  INTEGER NOT NULL,
    dia             INTEGER NOT NULL,
    inicio          TEXT    NOT NULL,
    fim             TEXT,
    observacao      TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_parcelas_venc ON parcelas(vencimento);
CREATE INDEX IF NOT EXISTS idx_parcelas_desp ON parcelas(despesa_id);
`

export type Linha = Record<string, any>
export type Cartao = CartaoRegra & Linha & { id: number; nome: string; ativo: number }

export interface DespesaDados {
  descricao: string
  categoria: string
  cartao_id: number | null
  valor_total_centavos: number
  num_parcelas: number
  data_compra: string
  observacao: string
  mes_referencia?: string | null
}

export interface RecorrenteDados {
  descricao: string
  categoria: string
  cartao_id: number | null
  valor_centavos: number
  dia: number
  inicio: string
  fim: string | null
  observacao: string
}

export class Banco {
  constructor(readonly db: SqlDb, private aoAlterar: () => void) {
    this.db.run('PRAGMA foreign_keys = ON')
    this.db.exec(SCHEMA)
    this.migrar()
    if (!this.get('SELECT 1 FROM categorias LIMIT 1'))
      for (const c of CATEGORIAS_PADRAO) this.run('INSERT INTO categorias(nome) VALUES (?)', [c])
  }

  // ------------------------------------------------------------ utilitários
  all(sql: string, params: SqlValue[] = []): Linha[] {
    const st = this.db.prepare(sql)
    try {
      st.bind(params)
      const out: Linha[] = []
      while (st.step()) out.push(st.getAsObject())
      return out
    } finally {
      st.free()
    }
  }

  get(sql: string, params: SqlValue[] = []): Linha | undefined {
    return this.all(sql, params)[0]
  }

  /** Executa e devolve o id da linha inserida. */
  run(sql: string, params: SqlValue[] = []): number {
    this.db.run(sql, params)
    return this.db.exec('SELECT last_insert_rowid()')[0].values[0][0] as number
  }

  /** Agrupa várias alterações numa transação e salva o arquivo no fim. */
  transacao<T>(fn: () => T): T {
    this.db.run('BEGIN')
    try {
      const r = fn()
      this.db.run('COMMIT')
      this.aoAlterar()
      return r
    } catch (e) {
      this.db.run('ROLLBACK')
      throw e
    }
  }

  private migrar() {
    const colunas = new Set(this.all('PRAGMA table_info(despesas)').map(r => r.name))
    if (!colunas.has('recorrente_id')) {
      this.db.run('ALTER TABLE despesas ADD COLUMN recorrente_id INTEGER REFERENCES recorrentes(id)')
      this.db.run('ALTER TABLE despesas ADD COLUMN competencia TEXT')
    }
    if (!colunas.has('mes_referencia')) this.db.run('ALTER TABLE despesas ADD COLUMN mes_referencia TEXT')
    if ((this.get('PRAGMA user_version')!.user_version as number) < 1) {
      // v1: no lançamento por mês com cartão, o mês passou a ser o da fatura
      for (const d of this.all('SELECT * FROM despesas WHERE mes_referencia IS NOT NULL AND cartao_id IS NOT NULL')) {
        const vencs = vencimentosPorMes(d.mes_referencia, d.num_parcelas, this.cartao(d.cartao_id)!)
        vencs.forEach((v, i) =>
          this.db.run('UPDATE parcelas SET vencimento = ? WHERE despesa_id = ? AND numero = ?', [v, d.id, i + 1]))
      }
      this.db.run('PRAGMA user_version = 1')
    }
    this.db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_despesas_recorrencia
                 ON despesas(recorrente_id, competencia) WHERE recorrente_id IS NOT NULL`)
  }

  // ---------------------------------------------------------------- cartões
  cartoes(somenteAtivos = false): Cartao[] {
    let sql = `
      SELECT c.*,
             COALESCE((SELECT SUM(p.valor_centavos) FROM parcelas p
                       JOIN despesas d ON d.id = p.despesa_id
                       WHERE d.cartao_id = c.id AND p.pago = 0
                         AND NOT (d.recorrente_id IS NOT NULL AND d.data_compra > ?)), 0) AS usado_centavos
      FROM cartoes c`
    if (somenteAtivos) sql += ' WHERE c.ativo = 1'
    return this.all(sql + ' ORDER BY c.ativo DESC, c.nome', [hoje()]) as Cartao[]
  }

  cartao(id: number | null | undefined): Cartao | null {
    if (id == null) return null
    return (this.get('SELECT * FROM cartoes WHERE id = ?', [id]) as Cartao) ?? null
  }

  salvarCartao(dados: Linha, id?: number) {
    const campos = ['nome', 'bandeira', 'dia_fechamento', 'dia_vencimento', 'limite_centavos', 'ativo']
    const valores = campos.map(c => dados[c])
    this.transacao(() => {
      if (id) this.run(`UPDATE cartoes SET ${campos.map(c => c + ' = ?').join(', ')} WHERE id = ?`, [...valores, id])
      else this.run(`INSERT INTO cartoes(${campos.join(', ')}) VALUES (${campos.map(() => '?').join(', ')})`, valores)
    })
  }

  /** Exclui o cartão. Se ele tiver despesas, apenas desativa e retorna false. */
  excluirCartao(id: number): boolean {
    const emUso = this.get(`SELECT 1 FROM despesas WHERE cartao_id = ?
                            UNION SELECT 1 FROM recorrentes WHERE cartao_id = ? LIMIT 1`, [id, id])
    this.transacao(() => {
      if (emUso) this.run('UPDATE cartoes SET ativo = 0 WHERE id = ?', [id])
      else this.run('DELETE FROM cartoes WHERE id = ?', [id])
    })
    return !emUso
  }

  // ------------------------------------------------------------- categorias
  categorias(): string[] {
    return this.all('SELECT nome FROM categorias ORDER BY nome').map(r => r.nome)
  }

  private categoriaId(nome: string): number | null {
    nome = nome.trim()
    if (!nome) return null
    const row = this.get('SELECT id FROM categorias WHERE nome = ?', [nome])
    return row ? row.id : this.run('INSERT INTO categorias(nome) VALUES (?)', [nome])
  }

  // --------------------------------------------------------------- despesas
  despesa(id: number) {
    return this.get(`SELECT d.*, cat.nome AS categoria FROM despesas d
                     LEFT JOIN categorias cat ON cat.id = d.categoria_id WHERE d.id = ?`, [id])
  }

  /** Regenera as parcelas mantendo o status de pagas. */
  salvarDespesa(dados: DespesaDados, id?: number): number {
    return this.transacao(() => {
      const catId = this.categoriaId(dados.categoria)
      const linha: SqlValue[] = [dados.descricao, catId, dados.cartao_id, dados.valor_total_centavos,
        dados.num_parcelas, dados.data_compra, dados.observacao, dados.mes_referencia || null]
      let pagas = new Set<number>()
      if (id) {
        pagas = new Set(this.all('SELECT numero FROM parcelas WHERE despesa_id = ? AND pago = 1', [id]).map(r => r.numero))
        this.run(`UPDATE despesas SET descricao=?, categoria_id=?, cartao_id=?, valor_total_centavos=?,
                  num_parcelas=?, data_compra=?, observacao=?, mes_referencia=? WHERE id=?`, [...linha, id])
        this.run('DELETE FROM parcelas WHERE despesa_id = ?', [id])
      } else {
        id = this.run(`INSERT INTO despesas(descricao, categoria_id, cartao_id, valor_total_centavos,
                       num_parcelas, data_compra, observacao, mes_referencia) VALUES (?,?,?,?,?,?,?,?)`, linha)
      }
      const n = dados.num_parcelas
      const vencs = vencimentosDespesa(dados, this.cartao(dados.cartao_id))
      const valores = dividirValor(dados.valor_total_centavos, n)
      for (let i = 0; i < n; i++)
        this.run('INSERT INTO parcelas(despesa_id, numero, valor_centavos, vencimento, pago) VALUES (?,?,?,?,?)',
          [id, i + 1, valores[i], vencs[i], pagas.has(i + 1) ? 1 : 0])
      return id
    })
  }

  excluirDespesa(id: number) {
    this.transacao(() => this.run('DELETE FROM despesas WHERE id = ?', [id]))
  }

  despesas(busca = '', cartaoId: number | null = null, situacao = 'todas') {
    let sql = `
      SELECT d.*, cat.nome AS categoria, c.nome AS cartao,
             SUM(p.pago) AS parcelas_pagas,
             SUM(CASE WHEN p.pago = 0 THEN p.valor_centavos ELSE 0 END) AS aberto_centavos,
             MAX(p.vencimento) AS ultimo_vencimento
      FROM despesas d
      LEFT JOIN categorias cat ON cat.id = d.categoria_id
      LEFT JOIN cartoes c ON c.id = d.cartao_id
      LEFT JOIN parcelas p ON p.despesa_id = d.id
      WHERE d.recorrente_id IS NULL`
    const params: SqlValue[] = []
    if (busca) {
      sql += ' AND (d.descricao LIKE ? OR cat.nome LIKE ? OR d.observacao LIKE ?)'
      params.push(`%${busca}%`, `%${busca}%`, `%${busca}%`)
    }
    if (cartaoId === 0) sql += ' AND d.cartao_id IS NULL'
    else if (cartaoId) { sql += ' AND d.cartao_id = ?'; params.push(cartaoId) }
    sql += ' GROUP BY d.id'
    if (situacao === 'abertas') sql += ' HAVING aberto_centavos > 0'
    else if (situacao === 'quitadas') sql += ' HAVING aberto_centavos = 0'
    return this.all(sql + ' ORDER BY d.data_compra DESC, d.id DESC', params)
  }

  // ------------------------------------------------------------- recorrentes
  recorrentes() {
    const mesAtual = hoje().slice(0, 7)
    return this.all(`
      SELECT r.*, cat.nome AS categoria, c.nome AS cartao,
             (SELECT p.pago FROM despesas d JOIN parcelas p ON p.despesa_id = d.id
               WHERE d.recorrente_id = r.id AND d.competencia = ?) AS pago_mes_atual,
             (SELECT COUNT(*) FROM despesas d JOIN parcelas p ON p.despesa_id = d.id
               WHERE d.recorrente_id = r.id AND p.pago = 1) AS meses_pagos
      FROM recorrentes r
      LEFT JOIN categorias cat ON cat.id = r.categoria_id
      LEFT JOIN cartoes c ON c.id = r.cartao_id
      ORDER BY (r.fim IS NOT NULL AND r.fim < ?), r.dia, r.descricao`, [mesAtual, mesAtual])
  }

  recorrente(id: number) {
    return this.get(`SELECT r.*, cat.nome AS categoria FROM recorrentes r
                     LEFT JOIN categorias cat ON cat.id = r.categoria_id WHERE r.id = ?`, [id])
  }

  /** Ao editar, refaz os lançamentos não pagos a partir do mês atual. */
  salvarRecorrente(dados: RecorrenteDados, id?: number): number {
    const mesAtual = hoje().slice(0, 7)
    let ate = mesAtual
    id = this.transacao(() => {
      const catId = this.categoriaId(dados.categoria)
      const linha: SqlValue[] = [dados.descricao, catId, dados.cartao_id, dados.valor_centavos, dados.dia,
        dados.inicio, dados.fim, dados.observacao]
      if (id) {
        const ultimo = this.get('SELECT MAX(competencia) AS m FROM despesas WHERE recorrente_id = ?', [id])?.m
        if (ultimo && ultimo > ate) ate = ultimo
        this.run(`UPDATE recorrentes SET descricao=?, categoria_id=?, cartao_id=?, valor_centavos=?,
                  dia=?, inicio=?, fim=?, observacao=? WHERE id=?`, [...linha, id])
        this.run(`DELETE FROM despesas WHERE recorrente_id = ? AND (
                    competencia < ?
                    OR (? IS NOT NULL AND competencia > ?)
                    OR (competencia >= ? AND id IN (SELECT despesa_id FROM parcelas WHERE pago = 0)))`,
          [id, dados.inicio, dados.fim, dados.fim, mesAtual])
        return id
      }
      return this.run(`INSERT INTO recorrentes(descricao, categoria_id, cartao_id, valor_centavos, dia, inicio,
                       fim, observacao) VALUES (?,?,?,?,?,?,?,?)`, linha)
    })
    const [a, m] = ate.split('-').map(Number)
    this.gerarRecorrencias(a, m)
    return id
  }

  /** Para de gerar a partir do próximo mês; o histórico é mantido. */
  encerrarRecorrente(id: number) {
    const mesAtual = hoje().slice(0, 7)
    this.transacao(() => {
      this.run('UPDATE recorrentes SET fim = ? WHERE id = ?', [mesAtual, id])
      this.run('DELETE FROM despesas WHERE recorrente_id = ? AND competencia > ?', [id, mesAtual])
    })
  }

  /** Remove a recorrente e todos os lançamentos dela (inclusive os já pagos). */
  excluirRecorrente(id: number) {
    this.transacao(() => {
      this.run('DELETE FROM despesas WHERE recorrente_id = ?', [id])
      this.run('DELETE FROM recorrentes WHERE id = ?', [id])
    })
  }

  /** Cria os lançamentos mensais que faltarem até o mês informado (nunca antes do mês atual). */
  gerarRecorrencias(ateAno: number, ateMes: number) {
    const mesAtual = hoje().slice(0, 7)
    const ate = mesIso(ateAno, ateMes) < mesAtual ? mesAtual : mesIso(ateAno, ateMes)
    let criou = false
    this.db.run('BEGIN')
    try {
      for (const r of this.all('SELECT * FROM recorrentes')) {
        const limite = r.fim && r.fim < ate ? r.fim : ate
        const existentes = new Set(this.all('SELECT competencia FROM despesas WHERE recorrente_id = ?', [r.id]).map(x => x.competencia))
        const cartao = this.cartao(r.cartao_id)
        let [ano, mes] = (r.inicio as string).split('-').map(Number)
        while (mesIso(ano, mes) <= limite) {
          const comp = mesIso(ano, mes)
          if (!existentes.has(comp)) {
            const data = dataSegura(ano, mes, r.dia)
            const did = this.run(`INSERT INTO despesas(descricao, categoria_id, cartao_id, valor_total_centavos,
                                  num_parcelas, data_compra, observacao, recorrente_id, competencia)
                                  VALUES (?,?,?,?,1,?,?,?,?)`,
              [r.descricao, r.categoria_id, r.cartao_id, r.valor_centavos, data, r.observacao, r.id, comp])
            const venc = calcularVencimentos(data, 1, cartao)[0]
            this.run('INSERT INTO parcelas(despesa_id, numero, valor_centavos, vencimento) VALUES (?,1,?,?)',
              [did, r.valor_centavos, venc])
            criou = true
          }
          [ano, mes] = somarMeses(ano, mes, 1)
        }
      }
      this.db.run('COMMIT')
    } catch (e) {
      this.db.run('ROLLBACK')
      throw e
    }
    if (criou) this.aoAlterar()
  }

  // --------------------------------------------------------------- parcelas
  /** Parcelas que vencem no mês (o que é pago nele). */
  parcelasMes(ano: number, mes: number, cartaoId: number | null = null) {
    const params: SqlValue[] = [iso(ano, mes, 1), iso(...somarMeses(ano, mes, 1), 1)]
    let sql = `
      SELECT p.*, d.descricao, d.num_parcelas, d.data_compra, d.mes_referencia, d.cartao_id, d.id AS despesa_id,
             d.recorrente_id, cat.nome AS categoria, c.nome AS cartao
      FROM parcelas p
      JOIN despesas d ON d.id = p.despesa_id
      LEFT JOIN categorias cat ON cat.id = d.categoria_id
      LEFT JOIN cartoes c ON c.id = d.cartao_id
      WHERE p.vencimento >= ? AND p.vencimento < ?`
    if (cartaoId === 0) sql += ' AND d.cartao_id IS NULL'
    else if (cartaoId) { sql += ' AND d.cartao_id = ?'; params.push(cartaoId) }
    return this.all(sql + ' ORDER BY p.vencimento, c.nome, d.descricao', params)
  }

  /** Itens da fatura (referência ano/mês) do cartão: tudo que vence no mês de pagamento dela. */
  parcelasFatura(cartaoId: number, ano: number, mes: number) {
    const [va, vm] = cicloFatura(this.cartao(cartaoId)!, ano, mes).vencimento.split('-').map(Number)
    return this.all(`
      SELECT p.*, d.descricao, d.num_parcelas, d.data_compra, d.mes_referencia, d.recorrente_id, d.id AS despesa_id,
             cat.nome AS categoria
      FROM parcelas p
      JOIN despesas d ON d.id = p.despesa_id
      LEFT JOIN categorias cat ON cat.id = d.categoria_id
      WHERE d.cartao_id = ? AND p.vencimento >= ? AND p.vencimento < ?
      ORDER BY d.data_compra, d.descricao`, [cartaoId, iso(va, vm, 1), iso(...somarMeses(va, vm, 1), 1)])
  }

  /** Total e em aberto de cada fatura do cartão, agrupado pelo mês de vencimento. */
  totaisFaturas(cartaoId: number) {
    return this.all(`
      SELECT substr(p.vencimento, 1, 7) AS mes_vencimento,
             SUM(p.valor_centavos) AS total_centavos,
             SUM(CASE WHEN p.pago = 0 THEN p.valor_centavos ELSE 0 END) AS aberto_centavos,
             COUNT(*) AS itens
      FROM parcelas p JOIN despesas d ON d.id = p.despesa_id
      WHERE d.cartao_id = ?
      GROUP BY mes_vencimento`, [cartaoId])
  }

  marcarPago(ids: number[], pago: boolean) {
    this.transacao(() => {
      for (const id of ids) this.run('UPDATE parcelas SET pago = ? WHERE id = ?', [pago ? 1 : 0, id])
    })
  }
}

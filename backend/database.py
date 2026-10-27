"""Camada de dados: SQLite + regras de parcelamento."""
import calendar
import os
import sqlite3
from datetime import date, timedelta
from pathlib import Path

CATEGORIAS_PADRAO = [
    "Alimentação", "Mercado", "Transporte", "Combustível", "Moradia", "Saúde",
    "Educação", "Lazer", "Vestuário", "Assinaturas", "Eletrônicos", "Viagem",
    "Presentes", "Outros",
]

SCHEMA = """
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
    inicio          TEXT    NOT NULL,  -- 'AAAA-MM'
    fim             TEXT,              -- 'AAAA-MM' ou NULL (sem fim)
    observacao      TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_parcelas_venc ON parcelas(vencimento);
CREATE INDEX IF NOT EXISTS idx_parcelas_desp ON parcelas(despesa_id);
"""


def pasta_dados() -> Path:
    base = os.environ.get("APPDATA") or str(Path.home())
    pasta = Path(base) / "ControleDeGastos"
    pasta.mkdir(parents=True, exist_ok=True)
    return pasta


def somar_meses(ano: int, mes: int, n: int) -> tuple[int, int]:
    idx = ano * 12 + (mes - 1) + n
    return idx // 12, idx % 12 + 1


def data_segura(ano: int, mes: int, dia: int) -> date:
    """Cria a data limitando o dia ao último dia do mês (ex.: 31/02 -> 28/02)."""
    return date(ano, mes, min(dia, calendar.monthrange(ano, mes)[1]))


def dividir_valor(total_centavos: int, n: int) -> list[int]:
    """Divide o total em n parcelas; a diferença de centavos vai na 1ª."""
    base = total_centavos // n
    valores = [base] * n
    valores[0] += total_centavos - base * n
    return valores


def calcular_vencimentos(data_compra: date, n: int, cartao=None) -> list[date]:
    """Datas de vencimento de cada parcela.

    Com cartão: compras feitas a partir do dia de fechamento entram na fatura
    seguinte; se o vencimento for antes/igual ao fechamento, a fatura vence no
    mês seguinte ao fechamento. Sem cartão: parcela mensal a partir da compra.
    """
    if cartao is None:
        return [data_segura(*somar_meses(data_compra.year, data_compra.month, i), data_compra.day)
                for i in range(n)]
    fech, venc = cartao["dia_fechamento"], cartao["dia_vencimento"]
    ano, mes = data_compra.year, data_compra.month
    if data_compra.day >= fech:
        ano, mes = somar_meses(ano, mes, 1)
    if venc <= fech:
        ano, mes = somar_meses(ano, mes, 1)
    return [data_segura(*somar_meses(ano, mes, i), venc) for i in range(n)]


def vencimentos_por_mes(mes_ref: str, n: int, cartao=None) -> list[date]:
    """Datas de vencimento quando o usuário informa o mês da 1ª parcela ('AAAA-MM')
    em vez do dia da compra. Com cartão, o mês é o da fatura (ex.: '2026-10' cai na
    fatura de outubro e as seguintes nas faturas seguintes). Sem cartão, vence dia 1
    de cada mês a partir do informado."""
    ano, mes = map(int, mes_ref.split("-"))
    if cartao is None:
        return [date(*somar_meses(ano, mes, i), 1) for i in range(n)]
    return [ciclo_fatura(cartao, *somar_meses(ano, mes, i))["vencimento"] for i in range(n)]


def vencimentos_despesa(dados, cartao=None) -> list[date]:
    if dados.get("mes_referencia"):
        return vencimentos_por_mes(dados["mes_referencia"], dados["num_parcelas"], cartao)
    return calcular_vencimentos(dados["data_compra"], dados["num_parcelas"], cartao)


# ------------------------------------------------------------------ faturas
# Uma fatura é identificada pelo mês em que o ciclo de compras COMEÇA.
# Ex.: fecha dia 3, vence dia 5 -> "fatura de outubro" = compras de 03/10 a 02/11,
# fecha em 03/11 e vence em 05/11.

def _meses_ate_vencimento(cartao) -> int:
    return 1 if cartao["dia_vencimento"] > cartao["dia_fechamento"] else 2


def ciclo_fatura(cartao, ano: int, mes: int) -> dict:
    fech, venc = cartao["dia_fechamento"], cartao["dia_vencimento"]
    inicio = data_segura(ano, mes, fech)
    fechamento = data_segura(*somar_meses(ano, mes, 1), fech)
    vencimento = data_segura(*somar_meses(ano, mes, _meses_ate_vencimento(cartao)), venc)
    return {"inicio": inicio, "fim": fechamento - timedelta(days=1), "fechamento": fechamento, "vencimento": vencimento}


def referencia_por_vencimento(vencimento: date, cartao) -> tuple[int, int]:
    """Mês de referência da fatura (início do ciclo) a partir da data de vencimento."""
    return somar_meses(vencimento.year, vencimento.month, -_meses_ate_vencimento(cartao))


def fatura_atual(cartao, hoje: date | None = None) -> tuple[int, int]:
    """Fatura em que uma compra feita hoje entraria."""
    hoje = hoje or date.today()
    if hoje.day >= cartao["dia_fechamento"]:
        return hoje.year, hoje.month
    return somar_meses(hoje.year, hoje.month, -1)


class Database:
    def __init__(self, caminho: Path | None = None):
        self.caminho = caminho or pasta_dados() / "gastos.db"
        self.con = sqlite3.connect(self.caminho, check_same_thread=False)
        self.con.row_factory = sqlite3.Row
        self.con.execute("PRAGMA foreign_keys = ON")
        self.con.executescript(SCHEMA)
        self._migrar()
        if not self.con.execute("SELECT 1 FROM categorias LIMIT 1").fetchone():
            self.con.executemany("INSERT INTO categorias(nome) VALUES (?)",
                                 [(c,) for c in CATEGORIAS_PADRAO])
        self.con.commit()

    def _migrar(self):
        colunas = {r["name"] for r in self.con.execute("PRAGMA table_info(despesas)")}
        if "recorrente_id" not in colunas:
            # cada mês de uma recorrente vira uma despesa à vista ligada a ela
            self.con.execute("ALTER TABLE despesas ADD COLUMN recorrente_id INTEGER REFERENCES recorrentes(id)")
            self.con.execute("ALTER TABLE despesas ADD COLUMN competencia TEXT")
        if "mes_referencia" not in colunas:
            # 'AAAA-MM' quando a despesa foi lançada pelo mês (não pelo dia da compra)
            self.con.execute("ALTER TABLE despesas ADD COLUMN mes_referencia TEXT")
        if self.con.execute("PRAGMA user_version").fetchone()[0] < 1:
            # v1: no lançamento por mês com cartão, o mês passou a ser o da fatura
            # (antes era o do vencimento); recalcula essas parcelas mantendo as pagas
            for d in self.con.execute("""SELECT * FROM despesas
                                         WHERE mes_referencia IS NOT NULL AND cartao_id IS NOT NULL""").fetchall():
                vencs = vencimentos_por_mes(d["mes_referencia"], d["num_parcelas"], self.cartao(d["cartao_id"]))
                self.con.executemany("UPDATE parcelas SET vencimento = ? WHERE despesa_id = ? AND numero = ?",
                                     [(v.isoformat(), d["id"], i + 1) for i, v in enumerate(vencs)])
            self.con.execute("PRAGMA user_version = 1")
        self.con.execute("""CREATE UNIQUE INDEX IF NOT EXISTS idx_despesas_recorrencia
                            ON despesas(recorrente_id, competencia) WHERE recorrente_id IS NOT NULL""")

    # ---------------------------------------------------------------- cartões
    def cartoes(self, somente_ativos=False):
        sql = """
            SELECT c.*,
                   COALESCE((SELECT SUM(p.valor_centavos) FROM parcelas p
                             JOIN despesas d ON d.id = p.despesa_id
                             WHERE d.cartao_id = c.id AND p.pago = 0
                               AND NOT (d.recorrente_id IS NOT NULL
                                        AND d.data_compra > date('now', 'localtime'))), 0) AS usado_centavos
            FROM cartoes c
        """
        if somente_ativos:
            sql += " WHERE c.ativo = 1"
        return self.con.execute(sql + " ORDER BY c.ativo DESC, c.nome").fetchall()

    def cartao(self, cartao_id):
        if cartao_id is None:
            return None
        return self.con.execute("SELECT * FROM cartoes WHERE id = ?", (cartao_id,)).fetchone()

    def salvar_cartao(self, dados: dict, cartao_id=None):
        campos = ("nome", "bandeira", "dia_fechamento", "dia_vencimento", "limite_centavos", "ativo")
        valores = [dados[c] for c in campos]
        if cartao_id:
            self.con.execute(f"UPDATE cartoes SET {', '.join(c + ' = ?' for c in campos)} WHERE id = ?",
                             valores + [cartao_id])
        else:
            self.con.execute(f"INSERT INTO cartoes({', '.join(campos)}) VALUES ({', '.join('?' * len(campos))})",
                             valores)
        self.con.commit()

    def excluir_cartao(self, cartao_id) -> bool:
        """Exclui o cartão. Se ele tiver despesas, apenas desativa e retorna False."""
        em_uso = self.con.execute("""SELECT 1 FROM despesas WHERE cartao_id = ?
                                     UNION SELECT 1 FROM recorrentes WHERE cartao_id = ? LIMIT 1""",
                                  (cartao_id, cartao_id)).fetchone()
        if em_uso:
            self.con.execute("UPDATE cartoes SET ativo = 0 WHERE id = ?", (cartao_id,))
            self.con.commit()
            return False
        self.con.execute("DELETE FROM cartoes WHERE id = ?", (cartao_id,))
        self.con.commit()
        return True

    # ------------------------------------------------------------- categorias
    def categorias(self) -> list[str]:
        return [r["nome"] for r in self.con.execute("SELECT nome FROM categorias ORDER BY nome")]

    def _categoria_id(self, nome: str):
        nome = nome.strip()
        if not nome:
            return None
        row = self.con.execute("SELECT id FROM categorias WHERE nome = ?", (nome,)).fetchone()
        if row:
            return row["id"]
        return self.con.execute("INSERT INTO categorias(nome) VALUES (?)", (nome,)).lastrowid

    # --------------------------------------------------------------- despesas
    def despesa(self, despesa_id):
        return self.con.execute("""
            SELECT d.*, cat.nome AS categoria FROM despesas d
            LEFT JOIN categorias cat ON cat.id = d.categoria_id WHERE d.id = ?
        """, (despesa_id,)).fetchone()

    def salvar_despesa(self, dados: dict, despesa_id=None):
        """dados: descricao, categoria, cartao_id, valor_total_centavos, num_parcelas,
        data_compra (date), observacao, mes_referencia ('AAAA-MM' ou None). Regenera as parcelas mantendo o status de pagas."""
        cat_id = self._categoria_id(dados["categoria"])
        linha = (dados["descricao"], cat_id, dados["cartao_id"], dados["valor_total_centavos"],
                 dados["num_parcelas"], dados["data_compra"].isoformat(), dados["observacao"],
                 dados.get("mes_referencia") or None)
        pagas = set()
        if despesa_id:
            pagas = {r["numero"] for r in self.con.execute(
                "SELECT numero FROM parcelas WHERE despesa_id = ? AND pago = 1", (despesa_id,))}
            self.con.execute("""UPDATE despesas SET descricao=?, categoria_id=?, cartao_id=?,
                                valor_total_centavos=?, num_parcelas=?, data_compra=?, observacao=?,
                                mes_referencia=? WHERE id=?""", linha + (despesa_id,))
            self.con.execute("DELETE FROM parcelas WHERE despesa_id = ?", (despesa_id,))
        else:
            despesa_id = self.con.execute("""INSERT INTO despesas(descricao, categoria_id, cartao_id,
                                valor_total_centavos, num_parcelas, data_compra, observacao, mes_referencia)
                                VALUES (?,?,?,?,?,?,?,?)""", linha).lastrowid
        n = dados["num_parcelas"]
        vencs = vencimentos_despesa(dados, self.cartao(dados["cartao_id"]))
        valores = dividir_valor(dados["valor_total_centavos"], n)
        self.con.executemany(
            "INSERT INTO parcelas(despesa_id, numero, valor_centavos, vencimento, pago) VALUES (?,?,?,?,?)",
            [(despesa_id, i + 1, valores[i], vencs[i].isoformat(), int(i + 1 in pagas)) for i in range(n)])
        self.con.commit()
        return despesa_id

    def excluir_despesa(self, despesa_id):
        self.con.execute("DELETE FROM despesas WHERE id = ?", (despesa_id,))
        self.con.commit()

    def despesas(self, busca="", cartao_id=None, situacao="todas"):
        sql = """
            SELECT d.*, cat.nome AS categoria, c.nome AS cartao,
                   SUM(p.pago) AS parcelas_pagas,
                   SUM(CASE WHEN p.pago = 0 THEN p.valor_centavos ELSE 0 END) AS aberto_centavos,
                   MAX(p.vencimento) AS ultimo_vencimento
            FROM despesas d
            LEFT JOIN categorias cat ON cat.id = d.categoria_id
            LEFT JOIN cartoes c ON c.id = d.cartao_id
            LEFT JOIN parcelas p ON p.despesa_id = d.id
            WHERE d.recorrente_id IS NULL
        """
        params = []
        if busca:
            sql += " AND (d.descricao LIKE ? OR cat.nome LIKE ? OR d.observacao LIKE ?)"
            params += [f"%{busca}%"] * 3
        if cartao_id == 0:
            sql += " AND d.cartao_id IS NULL"
        elif cartao_id:
            sql += " AND d.cartao_id = ?"
            params.append(cartao_id)
        sql += " GROUP BY d.id"
        if situacao == "abertas":
            sql += " HAVING aberto_centavos > 0"
        elif situacao == "quitadas":
            sql += " HAVING aberto_centavos = 0"
        return self.con.execute(sql + " ORDER BY d.data_compra DESC, d.id DESC", params).fetchall()

    # ------------------------------------------------------------- recorrentes
    def recorrentes(self):
        mes_atual = date.today().strftime("%Y-%m")
        return self.con.execute("""
            SELECT r.*, cat.nome AS categoria, c.nome AS cartao,
                   (SELECT p.pago FROM despesas d JOIN parcelas p ON p.despesa_id = d.id
                     WHERE d.recorrente_id = r.id AND d.competencia = ?) AS pago_mes_atual,
                   (SELECT COUNT(*) FROM despesas d JOIN parcelas p ON p.despesa_id = d.id
                     WHERE d.recorrente_id = r.id AND p.pago = 1) AS meses_pagos
            FROM recorrentes r
            LEFT JOIN categorias cat ON cat.id = r.categoria_id
            LEFT JOIN cartoes c ON c.id = r.cartao_id
            ORDER BY (r.fim IS NOT NULL AND r.fim < ?), r.dia, r.descricao
        """, (mes_atual, mes_atual)).fetchall()

    def recorrente(self, recorrente_id):
        return self.con.execute("""
            SELECT r.*, cat.nome AS categoria FROM recorrentes r
            LEFT JOIN categorias cat ON cat.id = r.categoria_id WHERE r.id = ?
        """, (recorrente_id,)).fetchone()

    def salvar_recorrente(self, dados: dict, recorrente_id=None):
        """dados: descricao, categoria, cartao_id, valor_centavos, dia, inicio ('AAAA-MM'),
        fim ('AAAA-MM' ou None), observacao. Ao editar, refaz os lançamentos não pagos
        a partir do mês atual (meses passados e pagos ficam como estão)."""
        cat_id = self._categoria_id(dados["categoria"])
        linha = (dados["descricao"], cat_id, dados["cartao_id"], dados["valor_centavos"], dados["dia"],
                 dados["inicio"], dados["fim"], dados["observacao"])
        mes_atual = date.today().strftime("%Y-%m")
        ate = mes_atual
        if recorrente_id:
            ultimo = self.con.execute("SELECT MAX(competencia) FROM despesas WHERE recorrente_id = ?",
                                      (recorrente_id,)).fetchone()[0]
            ate = max(ate, ultimo or ate)
            self.con.execute("""UPDATE recorrentes SET descricao=?, categoria_id=?, cartao_id=?, valor_centavos=?,
                                dia=?, inicio=?, fim=?, observacao=? WHERE id=?""", linha + (recorrente_id,))
            # remove o que ficou fora do período e os meses em aberto a partir de agora (serão recriados)
            self.con.execute("""DELETE FROM despesas WHERE recorrente_id = ? AND (
                                  competencia < ?
                                  OR (? IS NOT NULL AND competencia > ?)
                                  OR (competencia >= ? AND id IN (SELECT despesa_id FROM parcelas WHERE pago = 0)))""",
                             (recorrente_id, dados["inicio"], dados["fim"], dados["fim"], mes_atual))
        else:
            recorrente_id = self.con.execute("""INSERT INTO recorrentes(descricao, categoria_id, cartao_id,
                                valor_centavos, dia, inicio, fim, observacao) VALUES (?,?,?,?,?,?,?,?)""",
                                             linha).lastrowid
        self.con.commit()
        self.gerar_recorrencias(*map(int, ate.split("-")))
        return recorrente_id

    def encerrar_recorrente(self, recorrente_id):
        """Para de gerar a partir do próximo mês; o histórico é mantido."""
        mes_atual = date.today().strftime("%Y-%m")
        self.con.execute("UPDATE recorrentes SET fim = ? WHERE id = ?", (mes_atual, recorrente_id))
        self.con.execute("DELETE FROM despesas WHERE recorrente_id = ? AND competencia > ?",
                         (recorrente_id, mes_atual))
        self.con.commit()

    def excluir_recorrente(self, recorrente_id):
        """Remove a recorrente e todos os lançamentos dela (inclusive os já pagos)."""
        self.con.execute("DELETE FROM despesas WHERE recorrente_id = ?", (recorrente_id,))
        self.con.execute("DELETE FROM recorrentes WHERE id = ?", (recorrente_id,))
        self.con.commit()

    def gerar_recorrencias(self, ate_ano: int, ate_mes: int):
        """Cria os lançamentos mensais que faltarem, do início de cada recorrente até o mês
        informado (nunca antes do mês atual)."""
        hoje = date.today()
        if (ate_ano, ate_mes) < (hoje.year, hoje.month):
            ate_ano, ate_mes = hoje.year, hoje.month
        ate = f"{ate_ano:04d}-{ate_mes:02d}"
        for r in self.con.execute("SELECT * FROM recorrentes").fetchall():
            limite = min(ate, r["fim"]) if r["fim"] else ate
            existentes = {row[0] for row in self.con.execute(
                "SELECT competencia FROM despesas WHERE recorrente_id = ?", (r["id"],))}
            cartao = self.cartao(r["cartao_id"])
            ano, mes = map(int, r["inicio"].split("-"))
            while f"{ano:04d}-{mes:02d}" <= limite:
                comp = f"{ano:04d}-{mes:02d}"
                if comp not in existentes:
                    data = data_segura(ano, mes, r["dia"])
                    did = self.con.execute("""INSERT INTO despesas(descricao, categoria_id, cartao_id,
                                valor_total_centavos, num_parcelas, data_compra, observacao, recorrente_id, competencia)
                                VALUES (?,?,?,?,1,?,?,?,?)""",
                                           (r["descricao"], r["categoria_id"], r["cartao_id"], r["valor_centavos"],
                                            data.isoformat(), r["observacao"], r["id"], comp)).lastrowid
                    venc = calcular_vencimentos(data, 1, cartao)[0]
                    self.con.execute(
                        "INSERT INTO parcelas(despesa_id, numero, valor_centavos, vencimento) VALUES (?,1,?,?)",
                        (did, r["valor_centavos"], venc.isoformat()))
                ano, mes = somar_meses(ano, mes, 1)
        self.con.commit()

    # --------------------------------------------------------------- parcelas
    def parcelas_mes(self, ano: int, mes: int, cartao_id=None):
        """Parcelas que vencem no mês (o que é pago nele)."""
        inicio = date(ano, mes, 1).isoformat()
        fim = date(*somar_meses(ano, mes, 1), 1).isoformat()
        sql = """
            SELECT p.*, d.descricao, d.num_parcelas, d.data_compra, d.mes_referencia, d.cartao_id, d.id AS despesa_id,
                   d.recorrente_id,
                   cat.nome AS categoria, c.nome AS cartao
            FROM parcelas p
            JOIN despesas d ON d.id = p.despesa_id
            LEFT JOIN categorias cat ON cat.id = d.categoria_id
            LEFT JOIN cartoes c ON c.id = d.cartao_id
            WHERE p.vencimento >= ? AND p.vencimento < ?
        """
        params = [inicio, fim]
        if cartao_id == 0:
            sql += " AND d.cartao_id IS NULL"
        elif cartao_id:
            sql += " AND d.cartao_id = ?"
            params.append(cartao_id)
        return self.con.execute(sql + " ORDER BY p.vencimento, c.nome, d.descricao", params).fetchall()

    def parcelas_fatura(self, cartao_id: int, ano: int, mes: int):
        """Itens da fatura (referência ano/mês) do cartão: tudo que vence no mês de pagamento dela."""
        venc = ciclo_fatura(self.cartao(cartao_id), ano, mes)["vencimento"]
        inicio = date(venc.year, venc.month, 1).isoformat()
        fim = date(*somar_meses(venc.year, venc.month, 1), 1).isoformat()
        return self.con.execute("""
            SELECT p.*, d.descricao, d.num_parcelas, d.data_compra, d.mes_referencia, d.recorrente_id, d.id AS despesa_id,
                   cat.nome AS categoria
            FROM parcelas p
            JOIN despesas d ON d.id = p.despesa_id
            LEFT JOIN categorias cat ON cat.id = d.categoria_id
            WHERE d.cartao_id = ? AND p.vencimento >= ? AND p.vencimento < ?
            ORDER BY d.data_compra, d.descricao
        """, (cartao_id, inicio, fim)).fetchall()

    def totais_faturas(self, cartao_id: int):
        """Total e em aberto de cada fatura do cartão, agrupado pelo mês de vencimento."""
        return self.con.execute("""
            SELECT substr(p.vencimento, 1, 7) AS mes_vencimento,
                   SUM(p.valor_centavos) AS total_centavos,
                   SUM(CASE WHEN p.pago = 0 THEN p.valor_centavos ELSE 0 END) AS aberto_centavos,
                   COUNT(*) AS itens
            FROM parcelas p JOIN despesas d ON d.id = p.despesa_id
            WHERE d.cartao_id = ?
            GROUP BY mes_vencimento
        """, (cartao_id,)).fetchall()

    def marcar_pago(self, parcela_ids, pago: bool):
        self.con.executemany("UPDATE parcelas SET pago = ? WHERE id = ?",
                             [(int(pago), pid) for pid in parcela_ids])
        self.con.commit()

    def backup(self, destino: Path):
        with sqlite3.connect(destino) as dst:
            self.con.backup(dst)

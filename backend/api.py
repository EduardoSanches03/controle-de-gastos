"""API REST do Controle de Gastos (FastAPI)."""
import csv
import os
import sys
import threading
from collections import defaultdict
from datetime import date
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .database import (Database, ciclo_fatura, dividir_valor, fatura_atual,
                       referencia_por_vencimento, somar_meses, vencimentos_despesa)

# CONTROLE_GASTOS_DB permite usar outro arquivo de banco (útil para testes)
db = Database(Path(os.environ["CONTROLE_GASTOS_DB"]) if os.environ.get("CONTROLE_GASTOS_DB") else None)
lock = threading.Lock()
db.gerar_recorrencias(date.today().year, date.today().month)
app = FastAPI(title="Controle de Gastos")

RAIZ = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent.parent))
FRONT = RAIZ / "frontend" / "dist"


def pasta_exportacao() -> Path:
    pasta = Path.home() / "Documents" / "Controle de Gastos"
    pasta.mkdir(parents=True, exist_ok=True)
    return pasta


# ----------------------------------------------------------------- modelos
class CartaoIn(BaseModel):
    nome: str = Field(min_length=1)
    bandeira: str = ""
    dia_fechamento: int = Field(ge=1, le=31)
    dia_vencimento: int = Field(ge=1, le=31)
    limite_centavos: int = Field(ge=0, default=0)
    ativo: bool = True


class DespesaIn(BaseModel):
    descricao: str = Field(min_length=1)
    categoria: str = ""
    cartao_id: int | None = None
    valor_total_centavos: int = Field(gt=0)
    num_parcelas: int = Field(ge=1, le=120)
    data_compra: date
    observacao: str = ""
    # 'AAAA-MM': lançada pelo mês da 1ª parcela em vez do dia da compra
    mes_referencia: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}$")


class RecorrenteIn(BaseModel):
    descricao: str = Field(min_length=1)
    categoria: str = ""
    cartao_id: int | None = None
    valor_centavos: int = Field(gt=0)
    dia: int = Field(ge=1, le=31)
    inicio: str = Field(pattern=r"^\d{4}-\d{2}$")
    fim: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}$")
    observacao: str = ""


class SimulacaoIn(BaseModel):
    valor_total_centavos: int = Field(ge=0)
    num_parcelas: int = Field(ge=1, le=120)
    data_compra: date
    cartao_id: int | None = None
    mes_referencia: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}$")


class PagamentoIn(BaseModel):
    ids: list[int]
    pago: bool


def linhas(rows):
    return [dict(r) for r in rows]


# ----------------------------------------------------------------- cartões
@app.get("/api/cartoes")
def listar_cartoes(somente_ativos: bool = False):
    with lock:
        return linhas(db.cartoes(somente_ativos))


@app.post("/api/cartoes")
def criar_cartao(c: CartaoIn):
    with lock:
        db.salvar_cartao(c.model_dump() | {"ativo": int(c.ativo)})
    return {"ok": True}


@app.put("/api/cartoes/{cartao_id}")
def editar_cartao(cartao_id: int, c: CartaoIn):
    with lock:
        if not db.cartao(cartao_id):
            raise HTTPException(404, "Cartão não encontrado")
        db.salvar_cartao(c.model_dump() | {"ativo": int(c.ativo)}, cartao_id)
    return {"ok": True}


@app.delete("/api/cartoes/{cartao_id}")
def excluir_cartao(cartao_id: int):
    with lock:
        excluido = db.excluir_cartao(cartao_id)
    return {"excluido": excluido, "desativado": not excluido}


# -------------------------------------------------------------- categorias
@app.get("/api/categorias")
def listar_categorias():
    with lock:
        return db.categorias()


# ---------------------------------------------------------------- despesas
@app.get("/api/despesas")
def listar_despesas(busca: str = "", cartao_id: int | None = None, situacao: str = "todas"):
    with lock:
        return linhas(db.despesas(busca.strip(), cartao_id, situacao))


@app.get("/api/despesas/{despesa_id}")
def obter_despesa(despesa_id: int):
    with lock:
        d = db.despesa(despesa_id)
    if not d:
        raise HTTPException(404, "Despesa não encontrada")
    return dict(d)


@app.post("/api/despesas")
def criar_despesa(d: DespesaIn):
    with lock:
        return {"id": db.salvar_despesa(d.model_dump())}


@app.put("/api/despesas/{despesa_id}")
def editar_despesa(despesa_id: int, d: DespesaIn):
    with lock:
        if not db.despesa(despesa_id):
            raise HTTPException(404, "Despesa não encontrada")
        db.salvar_despesa(d.model_dump(), despesa_id)
    return {"ok": True}


@app.delete("/api/despesas/{despesa_id}")
def excluir_despesa(despesa_id: int):
    with lock:
        db.excluir_despesa(despesa_id)
    return {"ok": True}


# ------------------------------------------------------------- recorrentes
@app.get("/api/recorrentes")
def listar_recorrentes():
    with lock:
        return linhas(db.recorrentes())


@app.get("/api/recorrentes/{recorrente_id}")
def obter_recorrente(recorrente_id: int):
    with lock:
        r = db.recorrente(recorrente_id)
    if not r:
        raise HTTPException(404, "Recorrente não encontrada")
    return dict(r)


def _validar_periodo(r: RecorrenteIn):
    if r.fim and r.fim < r.inicio:
        raise HTTPException(422, "O mês final não pode ser antes do mês inicial.")


@app.post("/api/recorrentes")
def criar_recorrente(r: RecorrenteIn):
    _validar_periodo(r)
    with lock:
        return {"id": db.salvar_recorrente(r.model_dump())}


@app.put("/api/recorrentes/{recorrente_id}")
def editar_recorrente(recorrente_id: int, r: RecorrenteIn):
    _validar_periodo(r)
    with lock:
        if not db.recorrente(recorrente_id):
            raise HTTPException(404, "Recorrente não encontrada")
        db.salvar_recorrente(r.model_dump(), recorrente_id)
    return {"ok": True}


@app.post("/api/recorrentes/{recorrente_id}/encerrar")
def encerrar_recorrente(recorrente_id: int):
    with lock:
        db.encerrar_recorrente(recorrente_id)
    return {"ok": True}


@app.delete("/api/recorrentes/{recorrente_id}")
def excluir_recorrente(recorrente_id: int):
    with lock:
        db.excluir_recorrente(recorrente_id)
    return {"ok": True}


@app.post("/api/simular")
def simular(s: SimulacaoIn):
    with lock:
        cartao = db.cartao(s.cartao_id)
    vencs = vencimentos_despesa(s.model_dump(), cartao)
    valores = dividir_valor(s.valor_total_centavos, s.num_parcelas)
    return [{"numero": i + 1, "vencimento": v.isoformat(), "valor_centavos": valores[i],
             "fatura": "%04d-%02d" % referencia_por_vencimento(v, cartao) if cartao else None}
            for i, v in enumerate(vencs)]


# ---------------------------------------------------------------- mês
@app.get("/api/mes")
def resumo_mes(ano: int, mes: int, cartao_id: int | None = None):
    """Visão do mês: faturas que vencem nele (a pagar), fatura de referência do mês
    (em construção, paga no mês seguinte), recorrências e lançamentos sem cartão."""
    hoje = date.today()
    soma = lambda itens: sum(i["valor_centavos"] for i in itens)
    aberto = lambda itens: sum(i["valor_centavos"] for i in itens if not i["pago"])
    with lock:
        # recorrentes no cartão podem cair na fatura de até dois meses à frente
        db.gerar_recorrencias(*somar_meses(ano, mes, 2))
        vencendo = linhas(db.parcelas_mes(ano, mes, cartao_id))
        cartoes = [c for c in db.cartoes()
                   if cartao_id is None or (cartao_id and c["id"] == cartao_id)]
        em_construcao = []
        for c in cartoes:
            itens = linhas(db.parcelas_fatura(c["id"], ano, mes))
            if not itens and not c["ativo"]:
                continue
            ciclo = ciclo_fatura(c, ano, mes)
            em_construcao.append({
                "cartao_id": c["id"], "cartao": c["nome"], "referencia": f"{ano:04d}-{mes:02d}",
                **{k: v.isoformat() for k, v in ciclo.items()},
                "status": _status(soma(itens), aberto(itens), len(itens), ciclo, hoje),
                "total_centavos": soma(itens), "aberto_centavos": aberto(itens), "itens": itens,
            })
        nomes = {c["id"]: c for c in cartoes}

    por_cartao = defaultdict(list)
    for p in vencendo:
        if p["cartao_id"] is not None:
            por_cartao[p["cartao_id"]].append(p)
    a_pagar = []
    for cid, itens in por_cartao.items():
        venc = max(i["vencimento"] for i in itens)
        a_pagar.append({
            "cartao_id": cid, "cartao": itens[0]["cartao"], "vencimento": venc,
            "referencia": "%04d-%02d" % referencia_por_vencimento(date.fromisoformat(venc), nomes[cid]),
            "total_centavos": soma(itens), "aberto_centavos": aberto(itens), "itens": itens,
        })
    a_pagar.sort(key=lambda f: f["cartao"])
    sem_cartao = [p for p in vencendo if p["cartao_id"] is None]
    recorrencias = [p for p in sem_cartao if p["recorrente_id"]]
    lancamentos = [p for p in sem_cartao if not p["recorrente_id"]]

    # gasto do mês = fatura em construção + recorrências + lançamentos sem cartão
    gasto = [i for f in em_construcao for i in f["itens"]] + sem_cartao
    categorias = defaultdict(int)
    for p in gasto:
        categorias[p["categoria"] or "Sem categoria"] += p["valor_centavos"]
    a_pagar_itens = [i for f in a_pagar for i in f["itens"]] + sem_cartao
    return {
        "a_pagar": a_pagar,
        "em_construcao": em_construcao,
        "recorrencias": recorrencias,
        "lancamentos": lancamentos,
        "totais": {
            "gasto_centavos": soma(gasto),
            "em_construcao_centavos": sum(f["total_centavos"] for f in em_construcao),
            "a_pagar_aberto_centavos": aberto(a_pagar_itens),
            "pago_centavos": soma(a_pagar_itens) - aberto(a_pagar_itens),
        },
        "categorias": sorted(({"categoria": k, "total_centavos": v} for k, v in categorias.items()),
                             key=lambda c: -c["total_centavos"]),
    }


# ---------------------------------------------------------------- faturas
def _status(total, aberto, itens, ciclo, hoje):
    if not itens:
        return "vazia"
    if not aberto:
        return "paga"
    if hoje < ciclo["fechamento"]:
        return "aberta"
    if hoje <= ciclo["vencimento"]:
        return "fechada"
    return "vencida"


@app.get("/api/faturas/{cartao_id}")
def fatura(cartao_id: int, ano: int | None = None, mes: int | None = None):
    """Detalhe de uma fatura (referência = mês em que o ciclo começa) + linha do tempo das faturas."""
    hoje = date.today()
    with lock:
        cartao = db.cartao(cartao_id)
        if not cartao:
            raise HTTPException(404, "Cartão não encontrado")
        atual = fatura_atual(cartao, hoje)
        ano, mes = (ano, mes) if ano and mes else atual
        # garante as recorrentes geradas até a última fatura exibida
        ultima = ciclo_fatura(cartao, *somar_meses(*max(atual, (ano, mes)), 6))["vencimento"]
        db.gerar_recorrencias(ultima.year, ultima.month)
        itens = linhas(db.parcelas_fatura(cartao_id, ano, mes))
        totais = {r["mes_vencimento"]: dict(r) for r in db.totais_faturas(cartao_id)}

    def resumo(a, m):
        c = ciclo_fatura(cartao, a, m)
        t = totais.get(c["vencimento"].strftime("%Y-%m"), {"total_centavos": 0, "aberto_centavos": 0, "itens": 0})
        return {
            "referencia": f"{a:04d}-{m:02d}",
            "inicio": c["inicio"].isoformat(), "fim": c["fim"].isoformat(),
            "fechamento": c["fechamento"].isoformat(), "vencimento": c["vencimento"].isoformat(),
            "total_centavos": t["total_centavos"], "aberto_centavos": t["aberto_centavos"], "itens": t["itens"],
            "status": _status(t["total_centavos"], t["aberto_centavos"], t["itens"], c, hoje),
        }

    return {
        "cartao": dict(cartao),
        "atual": "%04d-%02d" % atual,
        "fatura": resumo(ano, mes) | {"lista": itens},
        "linha_do_tempo": [resumo(*somar_meses(*atual, n)) for n in range(-3, 7)],
    }


@app.post("/api/parcelas/pagamento")
def marcar_pagamento(p: PagamentoIn):
    with lock:
        db.marcar_pago(p.ids, p.pago)
    return {"ok": True}


# ---------------------------------------------------------- arquivos
@app.post("/api/exportar")
def exportar_mes(ano: int, mes: int):
    with lock:
        db.gerar_recorrencias(ano, mes)
        parcelas = db.parcelas_mes(ano, mes)
    caminho = pasta_exportacao() / f"gastos_{ano}-{mes:02d}.csv"
    with open(caminho, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(["Vencimento", "Descrição", "Categoria", "Cartão", "Parcela", "Valor", "Pago"])
        for p in parcelas:
            a, m, d = p["vencimento"].split("-")
            w.writerow([f"{d}/{m}/{a}", p["descricao"], p["categoria"] or "", p["cartao"] or "Sem cartão",
                        f"{p['numero']}/{p['num_parcelas']}",
                        f"{p['valor_centavos'] / 100:.2f}".replace(".", ","),
                        "Sim" if p["pago"] else "Não"])
    return {"caminho": str(caminho)}


@app.post("/api/backup")
def backup():
    caminho = pasta_exportacao() / f"backup_gastos_{date.today():%Y-%m-%d}.db"
    with lock:
        db.backup(caminho)
    return {"caminho": str(caminho)}


@app.post("/api/abrir-pasta")
def abrir_pasta():
    os.startfile(pasta_exportacao())
    return {"ok": True}


@app.get("/api/info")
def info():
    return {"banco": str(db.caminho), "exportacao": str(pasta_exportacao())}


# ------------------------------------------------------ frontend estático
if FRONT.exists():
    app.mount("/assets", StaticFiles(directory=FRONT / "assets"), name="assets")

    @app.get("/{caminho:path}")
    def spa(caminho: str):
        arquivo = (FRONT / caminho).resolve()
        if caminho and arquivo.is_file() and arquivo.is_relative_to(FRONT.resolve()):
            return FileResponse(arquivo)
        return FileResponse(FRONT / "index.html")

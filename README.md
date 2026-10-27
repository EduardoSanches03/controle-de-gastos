# Controle de Gastos

App desktop para controlar despesas parceladas por cartão.

- **Backend:** Python + FastAPI + SQLite (`backend/`)
- **Frontend:** React + TypeScript + Vite (`frontend/`)
- **Janela:** pywebview (Edge WebView2), em `app.py`

## Download
**[⬇ Baixar a última versão](https://github.com/EduardoSanches03/controle-de-gastos/releases/latest)**

- `ControleDeGastos-windows.zip`: extraia e rode `ControleDeGastos.exe` (ou use `instalar.ps1` para instalar com atalhos).
- `ControleDeGastos.apk`: app Android.

## Instalar / atualizar o programa no PC
```powershell
powershell -ExecutionPolicy Bypass -File instalar.ps1
```
O script faz o build do React, gera o `.exe`, instala em `%LOCALAPPDATA%\Programs\ControleDeGastos` e cria os atalhos.
Rode de novo sempre que alterar o código. Os dados não são apagados.

## Desenvolvimento
```powershell
powershell -ExecutionPolicy Bypass -File dev.ps1
```
Sobe o backend (porta 8765, com auto-reload) e o Vite (porta 5173, com hot reload). Abra http://localhost:5173.

Para abrir a janela do app com o frontend já buildado: `.venv\Scripts\python app.py`

## Dados
- **Banco:** `%APPDATA%\ControleDeGastos\gastos.db`. A variável `CONTROLE_GASTOS_DB` troca o arquivo (útil para testes).
- **Backups e CSVs exportados:** `Documentos\Controle de Gastos`.

## Regras de parcelamento
- Compras feitas **a partir do dia de fechamento** do cartão entram na fatura seguinte.
- Se o dia de vencimento for menor ou igual ao de fechamento, a fatura vence no mês seguinte ao fechamento.
- Sem cartão (Pix/dinheiro/débito): parcelas mensais a partir da data da compra.
- Diferença de centavos na divisão vai para a 1ª parcela.
- Alterar o fechamento/vencimento de um cartão não recalcula despesas antigas. Para recalcular uma despesa, abra e salve ela de novo.

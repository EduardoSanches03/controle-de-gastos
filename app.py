"""Abre o Controle de Gastos numa janela própria (backend FastAPI + frontend React)."""
import socket
import sys
import threading
import time
import webbrowser

import uvicorn

from backend.api import app


def porta_livre() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def aguardar(porta: int, tentativas=100):
    for _ in range(tentativas):
        try:
            with socket.create_connection(("127.0.0.1", porta), timeout=0.2):
                return
        except OSError:
            time.sleep(0.05)


def main():
    porta = porta_livre()
    servidor = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=porta, log_level="warning",
                                             log_config=None))
    threading.Thread(target=servidor.run, daemon=True).start()
    aguardar(porta)
    url = f"http://127.0.0.1:{porta}"

    if "--navegador" in sys.argv:
        webbrowser.open(url)
        threading.Event().wait()
        return
    try:
        import webview
    except ImportError:
        webbrowser.open(url)
        threading.Event().wait()
        return
    webview.create_window("Controle de Gastos", url, width=1320, height=820, min_size=(1000, 640),
                          background_color="#0f1012")
    webview.start()
    servidor.should_exit = True


if __name__ == "__main__":
    main()

"""Servidor local para testar o front (pasta public/) no navegador ou no celular.

Uso:  python3 scripts/dev_server.py [porta]
Abra http://localhost:5173 — ou, no celular na mesma rede Wi-Fi, http://IP-DO-MAC:5173.

Os dados vêm do projeto Firebase configurado em public/firebase-config.js.
Para o login funcionar a partir do localhost, "localhost" precisa estar em
Authentication > Configurações > Domínios autorizados (já vem por padrão).
"""
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PUBLIC = Path(__file__).resolve().parent.parent / "public"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", 5173))


# Mesmas rotas do vercel.json: a raiz é a landing page; as telas do app abrem app.html
ROTAS_APP = {"/login", "/sign-up", "/home", "/nova", "/pagar", "/historico", "/financas",
             "/financas/fixos", "/financas/cartoes", "/financas/previsao", "/financas/grupos", "/financas/renda-e-cartoes",
             "/ajustes-do-grupo", "/meus-grupos", "/minha-conta"}
ROTAS_PAGINA = {"/politica-de-privacidade": "/politica-de-privacidade.html"}


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".webmanifest": "application/manifest+json"}

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(PUBLIC), **kw)

    def translate_path(self, path):
        caminho = path.split("?", 1)[0].split("#", 1)[0]
        if caminho in ROTAS_APP:
            path = "/app.html"
        elif caminho in ROTAS_PAGINA:
            path = ROTAS_PAGINA[caminho]
        return super().translate_path(path)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    print(f"Rachaê em http://localhost:{PORT}")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()

"""Servidor de desenvolvimento com API FALSA (dados de exemplo).

Serve a pasta public/ e responde às mesmas ações do Api.gs em /mock-api,
para testar o layout no navegador/celular sem mexer na planilha real.

Uso:  python3 scripts/dev_server.py [porta]
Depois abra http://localhost:5173 (ou, no celular na mesma rede Wi-Fi,
http://IP-DO-MAC:5173). Login: qualquer email da lista abaixo, código 123456.
Cadastro: convite CASA2026, código 123456.
"""
import json
import sys
from datetime import date
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PUBLIC = Path(__file__).resolve().parent.parent / "public"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5173

NAMES = ["Aline", "Eduardo", "Bia"]
EMAILS = {"aline@exemplo.com": "Aline", "eduardo@exemplo.com": "Eduardo", "bia@exemplo.com": "Bia"}
GRUPOS = [
    {"nome": "Casa", "tipo": "Compartilhado", "membros": NAMES},
    {"nome": "Viagem", "tipo": "Compartilhado", "membros": ["Aline", "Eduardo"]},
]
CONFIG = {
    "names": NAMES,
    "categorias": ["Aluguel", "Mercado/Supermercado", "Lazer", "Transporte", "Streaming",
                   "Contas de Consumo", "Saúde", "Pet", "Viagem", "Alimentação", "Outros"],
    "metodos": ["Igual", "Porcentagem", "Valor customizado"],
    "segmentos": ["Mensais", "À Vista"],
    "emailsConfigured": True,
}
CONVITE = "CASA2026"  # código de convite da API falsa
PENDENTES = {}
SESSIONS = {}
DESPESAS = [
    {"row": 3, "data": "02/09/2026", "descricao": "Aluguel setembro", "categoria": "Aluguel", "segmento": "Mensais",
     "grupo": "Casa", "valor": 2400, "pagoPor": "Aline", "metodo": "Igual"},
    {"row": 4, "data": "10/09/2026", "descricao": "Mercado do mês", "categoria": "Mercado/Supermercado",
     "segmento": "À Vista", "grupo": "Casa", "valor": 612.4, "pagoPor": "Eduardo", "metodo": "Igual"},
]


def dashboard(nome, grupo):
    grupo = grupo or "Casa"
    ano = date.today().year
    evol = [{"mes": f"{ano - 1}-{m:02d}", "valor": 2800 + m * 90} for m in range(1, 13)]
    evol += [{"mes": f"{ano}-{m:02d}", "valor": 3000 + (m % 4) * 250} for m in range(1, date.today().month + 1)]
    cats = [{"categoria": "Aluguel", "valor": 2400}, {"categoria": "Mercado/Supermercado", "valor": 612.4},
            {"categoria": "Contas de Consumo", "valor": 380}, {"categoria": "Streaming", "valor": 89.9},
            {"categoria": "Lazer", "valor": 150}]
    saldos = [
        {"nome": "Aline", "totalPagoAv": 2400, "totalDevidoAv": 1004, "saldoAv": 1396, "saldoParc": -120, "saldoGeral": 1276, "situacao": "A RECEBER"},
        {"nome": "Eduardo", "totalPagoAv": 612.4, "totalDevidoAv": 1004, "saldoAv": -391.6, "saldoParc": 60, "saldoGeral": -331.6, "situacao": "A PAGAR"},
        {"nome": "Bia", "totalPagoAv": 0, "totalDevidoAv": 1004, "saldoAv": -1004, "saldoParc": 60, "saldoGeral": -944.4, "situacao": "A PAGAR"},
    ]
    membros = next((g["membros"] for g in GRUPOS if g["nome"] == grupo), NAMES)
    saldos = [s for s in saldos if s["nome"] in membros]
    return {
        "grupoAtual": grupo,
        "grupos": [{"nome": g["nome"], "tipo": g["tipo"]} for g in GRUPOS],
        "pessoal": next((s for s in saldos if s["nome"] == nome), None),
        "saldosPorPessoa": saldos,
        "gastosPorCategoria": cats,
        "evolucaoMensal": evol,
        "catPorMes": {f"{ano}-{date.today().month:02d}": cats},
        "reembolsosPorPessoa": [{"nome": "Aline", "valor": 480}, {"nome": "Eduardo", "valor": 120}, {"nome": "Bia", "valor": 0}],
        "comprasEmAberto": [{"id": "CP-001", "descricao": "Sofá novo", "saldoDevedor": 360}],
        "totalAvulsas": 3012.4,
    }


def handle(req):
    action = req.get("action")
    sess = SESSIONS.get(req.get("token"))
    public = {"config", "iniciarLogin", "confirmarCodigo", "loginPorNome", "iniciarCadastro", "confirmarCadastro"}
    if action not in public and not sess:
        return {"ok": False, "error": "Sessão expirada. Entre novamente.", "code": "AUTH"}
    if action == "config":
        return {"ok": True, "data": {**CONFIG, "cadastroAberto": True, "vagas": 5 - len(NAMES)}}
    if action == "iniciarCadastro":
        email = req.get("email", "").strip().lower()
        if req.get("convite", "").strip().upper() != CONVITE:
            return {"ok": False, "error": "Código de convite inválido."}
        if email in EMAILS:
            return {"ok": False, "error": 'Esse email já está cadastrado. Use "Já tenho cadastro" para entrar.'}
        if req.get("nome", "").lower() in [n.lower() for n in NAMES]:
            return {"ok": False, "error": "Já existe alguém com esse nome."}
        if len(NAMES) >= 5:
            return {"ok": False, "error": "A casa já tem 5 pessoas cadastradas."}
        PENDENTES[email] = req["nome"].strip()
        return {"ok": True, "data": {"ok": True}}
    if action == "confirmarCadastro":
        email = req.get("email", "").strip().lower()
        if email not in PENDENTES:
            return {"ok": False, "error": "Código expirado ou não solicitado."}
        if req.get("codigo") != "123456":
            return {"ok": False, "error": "Código incorreto. Confira e tente novamente."}
        nome = PENDENTES.pop(email)
        NAMES.append(nome)
        EMAILS[email] = nome
        token = f"tok-{len(SESSIONS) + 1}"
        SESSIONS[token] = nome
        return {"ok": True, "data": {"nome": nome, "token": token}}
    if action == "iniciarLogin":
        if req.get("email", "").strip().lower() not in EMAILS:
            return {"ok": False, "error": "Esse email não está cadastrado."}
        return {"ok": True, "data": {"ok": True}}
    if action == "confirmarCodigo":
        if req.get("codigo") != "123456":
            return {"ok": False, "error": "Código incorreto. Confira e tente novamente."}
        nome = EMAILS[req["email"].strip().lower()]
        token = f"tok-{len(SESSIONS) + 1}"
        SESSIONS[token] = nome
        return {"ok": True, "data": {"nome": nome, "token": token}}
    if action == "sessao":
        return {"ok": True, "data": {"nome": sess}}
    if action == "logout":
        SESSIONS.pop(req.get("token"), None)
        return {"ok": True, "data": {"ok": True}}
    if action == "grupos":
        return {"ok": True, "data": GRUPOS}
    if action == "dashboard":
        return {"ok": True, "data": dashboard(sess, req.get("grupo"))}
    if action == "comprasParaPagamento":
        return {"ok": True, "data": dashboard(sess, req.get("grupo"))["comprasEmAberto"]}
    if action == "historico":
        return {"ok": True, "data": {"despesas": DESPESAS[::-1], "compras": [
            {"id": "CP-001", "data": "05/08/2026", "descricao": "Sofá novo", "categoria": "Outros", "grupo": "Casa",
             "valorTotal": 1800, "comprador": "Aline", "nParcelas": 10, "saldoTotal": 1080}],
            "pagamentos": [{"data": "05/09/2026", "compraId": "CP-001", "descricao": "Sofá novo", "pessoa": "Bia", "valor": 60}]}}
    if action in ("addDespesa", "addCompraParcelada", "addPagamento"):
        p = req.get("payload", {})
        print("  payload:", json.dumps(p, ensure_ascii=False))
        if action == "addDespesa":
            row = 3 + len(DESPESAS)
            DESPESAS.append({"row": row, "data": p["data"], "descricao": p["descricao"], "categoria": p["categoria"],
                             "segmento": p["segmento"], "grupo": p["grupo"], "valor": p["valorTotal"],
                             "pagoPor": p["pagoPor"], "metodo": p["metodo"]})
            return {"ok": True, "data": {"ok": True, "row": row}}
        return {"ok": True, "data": {"ok": True, "row": 10, "id": "CP-002"}}
    return {"ok": False, "error": "Ação desconhecida: " + str(action)}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(PUBLIC), **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.path.split("?")[0] == "/config.js":
            body = b"window.RACHAE_API_URL = location.origin + '/mock-api';\n"
            self.send_response(200)
            self.send_header("Content-Type", "text/javascript; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def do_POST(self):
        if self.path != "/mock-api":
            self.send_error(404)
            return
        raw = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        req = json.loads(raw or b"{}")
        print("API", req.get("action"))
        body = json.dumps(handle(req), ensure_ascii=False).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    print(f"Rachaê (API falsa) em http://localhost:{PORT} — código de login: 123456")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()

# Rachaê — app mobile (PWA)

Front-end do Rachaê que roda no navegador do celular (Safari no iPhone, Chrome no Android)
e pode ser **instalado na tela inicial** como um app: tela cheia, ícone próprio, sem a barra
do Google. A planilha `Divisao_Contas_Casa` continua sendo a fonte da verdade — o Apps Script
vira só uma API.

```
celular (PWA)  ──POST JSON──▶  Apps Script (Api.gs + Code.gs)  ──▶  Google Sheets
```

## Estrutura

| Pasta | O que é |
|---|---|
| `apps-script/Code.gs` | Backend original (sem mudanças), cópia para versionar |
| `apps-script/Api.gs` | **Novo**: `doPost` com sessão por token, reaproveita as funções do Code.gs |
| `public/` | O site estático (HTML/CSS/JS puro, sem build) — é isso que vai para a hospedagem |
| `public/config.js` | Onde vai a URL do App da Web (`.../exec`) |
| `public/sw.js` | Service worker (abre instantâneo e funciona offline para a "casca") |
| `scripts/dev_server.py` | Servidor local com **API falsa** para testar sem tocar na planilha |
| `scripts/gerar_icones.py` | Gera os ícones PNG |

## 1. Testar localmente (API falsa)

```bash
python3 scripts/dev_server.py
```

Abra http://localhost:5173. Login: `aline@exemplo.com` e código `123456`.
Para testar no celular, na mesma rede Wi-Fi: `http://IP-DO-SEU-MAC:5173`
(o service worker e a instalação só funcionam de verdade em HTTPS — veja o passo 4).

## 2. Publicar a API no Apps Script

1. Abra a planilha → **Extensões > Apps Script**.
2. Clique em **+ > Script**, dê o nome **Api** e cole o conteúdo de `apps-script/Api.gs`.
   O `Code.gs` e o `Index` que já estão lá continuam iguais.
3. **Implantar > Gerenciar implantações** → lápis → Versão: **Nova versão** → Implantar.
   - Executar como: **Eu**
   - Quem pode acessar: **Qualquer pessoa** (obrigatório: a opção "qualquer pessoa com Conta do
     Google" exige cookies do Google e o navegador bloqueia a chamada vinda de outro site).
4. Copie a URL do App da Web (termina em `/exec`). A URL antiga continua abrindo a interface
   antiga, então as duas convivem enquanto vocês testam.

> A segurança não depende de a URL ser secreta: toda leitura/gravação exige o token de sessão
> gerado depois do código por email. Para derrubar todas as sessões (ex.: celular perdido), rode
> a função `encerrarTodasAsSessoes` no editor.

## 3. Configurar o front

Em `public/config.js`:

```js
window.RACHAE_API_URL = 'https://script.google.com/macros/s/SEU_ID/exec';
```

## 4. Hospedar (HTTPS grátis)

Qualquer hospedagem estática serve; aponte para a pasta `public/`.

- **GitHub Pages**: suba o repositório e publique a pasta `public/` (Settings > Pages, ou uma
  Action que publica `public/`).
- **Vercel / Netlify / Cloudflare Pages**: importe o repositório, sem comando de build,
  diretório de saída `public`.

Ao publicar uma versão nova do front, aumente `CACHE_VERSION` em `public/sw.js`.

## 5. Instalar no celular

- **iPhone (Safari)**: abra o link → botão **Compartilhar** → **Adicionar à Tela de Início**.
  O app instalado tem armazenamento separado do Safari, então é preciso entrar com o código
  uma vez pelo ícone.
- **Android (Chrome)**: o próprio app mostra o botão **Instalar app** (ou menu ⋮ > Instalar app).

## O que mudou em relação à interface do Apps Script

- Roda fora do iframe do Google: tela cheia, instalável, respeita notch e barra inferior do iPhone.
- Campos com fonte ≥16px (o Safari não dá mais zoom ao tocar), teclado numérico com vírgula
  para valores (`1.234,56` funciona), preenchimento automático do código do email.
- Abre instantâneo com os últimos dados salvos e atualiza em segundo plano; aviso quando está sem internet.
- Sessão por token no servidor: a pessoa de cada lançamento vem do login, não do aparelho.
- Travas contra envio duplicado e contra dois lançamentos simultâneos caírem na mesma linha.
- Validação da divisão antes de enviar (porcentagens somam 100%, valores somam o total).
- Tags continuam só locais (por aparelho), como antes.

# Rachaê — divisão de contas de casa (PWA + Firebase)

App que roda no navegador do celular (Safari no iPhone, Chrome no Android) e pode ser
**instalado na tela inicial**. Os dados ficam no **Firebase (plano Spark, gratuito)**:
login por email e senha no Firebase Authentication e dados no Cloud Firestore, protegidos
pelas regras em [`firestore.rules`](firestore.rules). O site é estático e fica na Vercel.

```
celular (PWA, Vercel) ──SDK──▶ Firebase Auth (email + senha)
                       └─────▶ Cloud Firestore (dados em tempo real + cache offline)
                                  ▲ regras de segurança = firestore.rules
```

No plano Spark não existe Cloud Functions, então:
- os **saldos são calculados no aparelho** ([`public/js/calc.js`](public/js/calc.js)), a partir dos lançamentos;
- **toda a segurança fica nas regras do Firestore**: só quem é da casa lê os dados, cada um só
  registra pagamento em nome próprio, só dá para entrar na casa com convite válido etc.

## Estrutura

| Caminho | O que é |
|---|---|
| `public/` | O site (HTML/CSS/JS puro, sem build) — é o que a Vercel publica |
| `public/firebase-config.js` | Configuração do app web do Firebase (passo 4) |
| `public/js/api.js` | Login, casa, convites e leitura/gravação no Firestore |
| `public/js/calc.js` | Cálculo de saldos, parcelas e gráficos (antes eram fórmulas da planilha) |
| `firestore.rules` | Regras de segurança — **publique sempre que mudar** (passo 3) |
| `legado/` | Versão antiga com Google Sheets + Apps Script (só referência) |

## Configurar o Firebase (uma vez só)

### 1. Criar o projeto
1. Entre em [console.firebase.google.com](https://console.firebase.google.com) com sua conta Google.
2. **Criar um projeto** → nome `rachae` → pode desligar o Google Analytics (não é usado).
3. O projeto já nasce no plano **Spark** (gratuito). Não precisa cadastrar cartão.

### 2. Ligar o login por email e senha
1. Menu **Criação > Authentication** → **Vamos começar**.
2. Aba **Método de login** → **E-mail/senha** → ative só a primeira chave (**E-mail/senha**) → Salvar.
   A opção "Link do e-mail (login sem senha)" fica **desligada**: no plano Spark ela só permite
   5 emails por dia no projeto todo.
3. Aba **Configurações > Domínios autorizados** → **Adicionar domínio** → `apprachae.vercel.app`
   (o `localhost` já vem na lista).
4. Opcional: **Modelos** (templates) → **Redefinição de senha** → idioma português.

### 3. Criar o banco e publicar as regras
1. Menu **Criação > Firestore Database** → **Criar banco de dados**.
2. Edição **Standard**, local **`southamerica-east1` (São Paulo)** — não dá para mudar depois.
3. Comece no **modo de produção** (bloqueia tudo até as regras serem publicadas).
4. Aba **Regras** → apague o conteúdo e cole **todo** o arquivo [`firestore.rules`](firestore.rules) → **Publicar**.

### 4. Registrar o app web e copiar a configuração
1. **Configurações do projeto** (engrenagem) → **Seus apps** → ícone **`</>`** (Web).
2. Apelido `rachae-web`, **sem** marcar Firebase Hosting → Registrar app.
3. Copie o objeto `firebaseConfig` que aparece e cole os valores em
   [`public/firebase-config.js`](public/firebase-config.js). Esses valores não são segredo:
   quem protege os dados são as regras do passo 3.

### 5. Publicar
Faça commit e push; a Vercel publica sozinha em ~30 s.

### 6. Criar a casa e convidar os moradores
1. Abra o app → **Criar conta** (nome, email, senha).
2. Em "Falta entrar numa casa", abra **Sou eu quem vai criar a casa** → dê um nome → **Criar casa**.
3. Na tela **Casa** (ícone de pessoa no topo) → **Compartilhar link de convite**.
4. Quem abrir o link cria a conta e já entra na casa. Para parar de aceitar gente nova: **Fechar convites**.

O código de convite fica guardado **só no aparelho de quem criou a casa** (o Firestore não
deixa listar convites, de propósito). Se trocar de aparelho, é só tocar em **Gerar código
de convite** de novo.

## Proteção extra (recomendado)
- **Restringir a chave da API ao seu site:** no [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
  (mesmo projeto) → chave "Browser key" → **Restrições de aplicativo: Referenciadores HTTP** →
  adicione `https://apprachae.vercel.app/*` e `http://localhost:5173/*`.
- **Alerta de uso:** o plano Spark não cobra nada; se passar da cota diária (50 mil leituras,
  20 mil gravações), o Firestore só recusa até o dia seguinte.

## Testar localmente
```bash
python3 scripts/dev_server.py
```
Abra http://localhost:5173 (usa o projeto Firebase configurado). Os cálculos de saldo podem
ser conferidos sem Firebase, direto no Node, importando `public/js/calc.js`.

## Instalar no celular
- **iPhone (Safari)**: abra o link → **Compartilhar** → **Adicionar à Tela de Início**. O app
  instalado não compartilha o login com o Safari, então entre de novo uma vez pelo ícone.
- **Android (Chrome)**: o app mostra o botão **Instalar app** (ou menu ⋮ > Instalar app).

## O que mudou em relação à planilha
- **Sem limite de linhas** (a planilha lotava com 120 despesas).
- **Tempo real:** quando alguém lança uma despesa, o saldo dos outros atualiza sozinho.
- **Funciona offline:** dá para abrir e consultar sem internet; o que for lançado sincroniza depois.
- **Login com senha**, "esqueci a senha" e entrada na casa **por convite**; o dono pode remover pessoas.
- **Apagar lançamentos:** cada pessoa apaga o que lançou (o dono da casa apaga qualquer um).
- **Grupos** (ex.: "Viagem") criados pelo próprio app, na tela Casa.
- Sem limite de 5 moradores.

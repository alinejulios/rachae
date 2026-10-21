# Rachaê — briefing para o Claude Design

Este documento orienta a criação do **design system do Rachaê**. Tudo aqui foi
extraído do app que está em produção (`public/css/app.css`, `public/index.html`,
`public/manifest.webmanifest`, `public/icons/icon.svg`). O objetivo é
**organizar e refinar o que já existe**, não reinventar a identidade.

---

## 1. Produto

- **O que é:** app para dividir contas em grupo (a casa, uma viagem, o casal…)
  e acompanhar as finanças pessoais.
- **Plataforma:** PWA mobile-first, instalável na tela inicial, só na vertical
  (retrato). Roda no Safari (iPhone) e no Chrome (Android).
- **Idioma:** português do Brasil.
- **Público:** pessoas comuns, sem conhecimento financeiro técnico, usando o app
  no dia a dia, com uma mão, muitas vezes com pressa.
- **Tecnologia:** HTML/CSS/JS puro, sem framework e sem build. O design system
  deve virar **variáveis CSS e classes simples**. Nada de React, Tailwind ou
  bibliotecas de componentes.
- **Largura:** o conteúdo vai até **560px** (centralizado em telas maiores).
  Desenhe para **390×844** (iPhone) e confira em **360px** e **320px**.

### Conceitos do domínio
| Termo na interface | O que é |
|---|---|
| Grupo | Pessoas que dividem contas; entra-se por link/código de convite |
| Conjunto de despesas | Subdivisão do grupo (ex.: "Contas fixas", "Viagem"), com parte ou todas as pessoas |
| Despesa | Gasto lançado e dividido entre participantes (igual ou por valor) |
| Pagamento / Acerto | Quem deve quanto a quem; pode pagar via **Pix** (QR code) |
| Parcelas | Despesas parceladas, com status: em dia, atrasada, do mês, futura |
| Finanças | Área privada (só a pessoa vê): renda, benefícios (VR/VA/VT), cartões com fatura, contas fixas, limites por categoria |

---

## 2. Estrutura de telas

- **Login / cadastro:** coluna centralizada, marca no topo (64px), título
  "Rachaê", campos centralizados, código de convite em caixa alta e espaçado,
  banner para instalar o app.
- **Topo fixo (sticky):** selo da marca (32px, degradê) + nome do grupo com
  seta para trocar de grupo + nome do conjunto embaixo (12px). Botões de ícone
  à direita.
- **Barra de abas inferior fixa** (62px + área segura), 5 abas com ícone + rótulo:
  **Início · Nova · Pagar · Histórico · Finanças**. A aba ativa fica em `brand-blue`;
  as outras, em `text-muted`.
- **Telas secundárias** (abertas pelo topo): Grupos, Casa (configurações), Conta.

### Telas para desenhar
1. Login / cadastro / entrar com convite
2. Início — saldo em destaque (hero), quem deve a quem, resumo do período
3. Nova despesa — formulário (valor, descrição, data, quem pagou, participantes, divisão, tags, parcelas)
4. Pagar — lista de acertos com painel Pix + QR code
5. Histórico — lista filtrável de lançamentos
6. Finanças — totais do mês, gráfico de colunas por mês, donut por categoria, ranking, cartões/faturas, limites
7. Grupos / Casa / Conta — listas de configuração, convite, zona de perigo

---

## 3. Marca

- **Ícone:** raio branco sobre quadrado arredondado com degradê (arquivo `public/icons/icon.svg`).
- **Degradê da marca:** `linear-gradient(135deg, #00D2FF 0%, #2563EB 50%, #5C82FF 100%)`
- **Brilho da marca:** `0 8px 22px -8px rgba(0,210,255,0.45)`. É a **única sombra** do
  app e só aparece na marca. O resto da interface é plano, separado por bordas finas.
- **Cor do tema (manifest):** `#2563EB` · **fundo:** `#f4f7fc`
- **Personalidade:** leve, direta, confiável, nada de "banco sisudo". O nome
  brinca com "rachar a conta"; o raio sugere rapidez.

---

## 4. Tokens de cor (já existem — manter os nomes)

O app tem **modo claro e escuro**, que seguem o sistema (`prefers-color-scheme`).
Toda cor precisa existir nos dois.

### Superfícies e texto
| Token | Claro | Escuro | Uso |
|---|---|---|---|
| `--surface-1` | `#ffffff` | `#171b23` | Cards, topo, barra de abas |
| `--surface-2` | `#f4f7fc` | `#0f1218` | Fundo da página, tiles internos |
| `--card-border` | `rgba(20,40,80,.10)` | `rgba(255,255,255,.10)` | Bordas de cards e campos |
| `--input-bg` | `#ffffff` | `#1e2330` | Fundo de campos |
| `--text-primary` | `#111827` | `#f5f7fb` | Texto principal |
| `--text-secondary` | `#5b6779` | `#b7c0d1` | Rótulos, subtítulos |
| `--text-muted` | `#8b95a5` | `#838da0` | Dicas, estados vazios |
| `--gridline` | `#e6ebf4` | `#262c38` | Divisores de lista, trilhos de barra |
| `--baseline` | `#ccd4e2` | `#3a4152` | Linha de base de gráficos, totais |

### Marca
| Token | Claro | Escuro |
|---|---|---|
| `--brand-blue` | `#2563eb` | `#5c82ff` |
| `--brand-blue-dark` | `#1d4ed8` | `#7c9cff` |
| `--brand-blue-tint` | `#e8efff` | `#1c2a4f` |
| `--brand-aqua` | `#00b8e6` | `#00d2ff` |
| `--brand-aqua-dark` | `#0089b0` | `#33dbff` |
| `--brand-aqua-tint` | `#e0f8ff` | `#0f3240` |

### Status
| Token | Claro | Escuro | Significado |
|---|---|---|---|
| `--good` | `#10b981` | `#10b981` | Positivo, quitado |
| `--good-text` | `#047857` | `#34d399` | Texto positivo (contraste) |
| `--good-tint` | `#e3f8ef` | `#10332a` | Fundo positivo |
| `--critical` | `#dc2626` | `#ef4444` | Dívida, erro, atraso, excluir |
| `--critical-tint` | `#fdeaea` | `#3a1c1e` | Fundo crítico |
| `--warning` | `#b45309` | `#f59e0b` | Alerta, sem internet |

### Categorias (gráficos e cartões)
| Token | Claro | Escuro |
|---|---|---|
| `--cat-1` | `#2a78d6` | `#3987e5` |
| `--cat-2` | `#eb6834` | `#d95926` |
| `--cat-3` | `#1baf7a` | `#199e70` |
| `--cat-4` | `#eda100` | `#c98500` |
| `--cat-5` | `#e87ba4` | `#d55181` |
| `--cat-6` | `#008300` | `#008300` |
| `--cat-7` | `#4a3aa7` | `#9085e9` |
| `--cat-8` | `#e34948` | `#e66767` |
| `--cat-other` | `#9aa3b2` | `#6b7484` |
| `--fonte-9…12` (cartões extras) | `#0ea5c6` `#5b6474` `#8a5a2b` `#a855f7` | `#22c3e6` `#a7b0bf` `#c08a55` `#c084fc` |

**Regras de cor**
- Vermelho/verde **sempre acompanhados de texto ou ícone**, nunca só a cor.
- Texto sobre tint usa a versão `-dark` / `-text` da cor (contraste AA).
- Sem degradês fora da marca. Sem sombras fora da marca.

---

## 5. Tipografia

| Papel | Fonte | Pesos |
|---|---|---|
| Display (títulos, valores, botões) | **Plus Jakarta Sans** | 600, 700, 800 |
| Corpo (texto, rótulos, listas) | **Inter** (fallback: system-ui) | 400–800 |

### Escala em uso hoje (a ser organizada em tokens)
| Uso | Tamanho / peso | Fonte |
|---|---|---|
| Título do login | 30 / 800, tracking -0.02em | Display |
| Valor em destaque (hero) | `clamp(26px, 9.5vw, 38px)` / 700 | Display |
| Número de resumo | 24 / 700 | Display |
| Título de página | 22 / 700 | Display |
| Valor do Pix | 22 / 700 | Display |
| Botão principal | 17 / 600 | Display |
| Título de card (h3) | 15 / 600, cor secundária | Display |
| Item de lista | 14,5–15 / 700 | Inter |
| Rótulo de campo | 13 / 700, cor secundária | Inter |
| Texto secundário | 12,5 | Inter |
| Pill / badge | 11 / 800 | Inter |
| Rótulo da barra de abas | `clamp(9.5px, 3vw, 11px)` / 700 | Inter |

**Regras**
- Todo número de dinheiro usa `font-variant-numeric: tabular-nums`.
- Campos de texto com **16px no mínimo** (abaixo disso o iOS dá zoom ao focar).
- Valores monetários em formato brasileiro: `R$ 1.234,56`.

---

## 6. Forma, espaço, movimento

**Arredondamento**
| Elemento | Raio |
|---|---|
| Card | 18 (16 abaixo de 360px) |
| Botão, caixa, painel | 14 |
| Campo, segmented, lista interna | 12 |
| Botão de ícone, select pequeno | 10 |
| Pill, chip, badge | 999 |
| Marcador de cor (legenda) | 3–4 |

**Espaçamento** (hoje solto; propor escala em tokens)
- Valores usados: 3, 4, 6, 8, 10, 12, 14, 16, 20, 24.
- Card: padding 16, distância entre cards 14.
- Margem lateral da tela: 16 (12 abaixo de 360px).

**Áreas de toque mínimas**
- Botão principal 50 · campo e botão secundário 46 · aba 54 · chip/segmented 38 · botão de ícone 38.

**Movimento**
- Toque em botão: `scale(.97–.98)` em 80ms.
- Toast: entra de baixo com fade, 250ms.
- Respeitar `prefers-reduced-motion` (desliga tudo).

**Ícones**
- Traço (stroke), viewBox 24, `stroke-width: 2`, pontas e junções arredondadas,
  `currentColor`. Tamanho 21–23px. Estilo compatível com Lucide/Feather.

**Áreas seguras**
- Respeitar notch e barra inferior do iPhone (`env(safe-area-inset-*)`).

---

## 7. Componentes existentes

### Ações
- **Botão principal** — largura total, 50px, fundo `brand-blue`, texto branco, Display 17/600. Pressionado: `brand-blue-dark`. Desabilitado: opacidade .55.
- **Botão secundário** — largura total, 46px, fundo `brand-blue-tint`, texto `brand-blue-dark`.
- **Botão perigo** — fundo `critical-tint`, texto `critical`.
- **Link** — texto `brand-blue` sublinhado, 14/700.
- **Botão de ícone** — 38×38, sem fundo; pressionado: `surface-2`.
- **Excluir discreto** — texto `text-muted` sublinhado, 12,5/700.

### Formulário
- **Campo / select** — 46px, raio 12, borda `card-border`, foco com contorno 2px `brand-blue`.
- **Campo de dinheiro** — prefixo "R$" dentro do campo.
- **Rótulo** — 13/700, `text-secondary`, acima do campo.
- **Dica** — 13, `text-muted`; variações `ok` (verde), `warn` (âmbar), `error` (vermelho).
- **Participante** — checkbox em formato de card (48px); marcado: borda `brand-blue` + fundo tint.
- **Tags** — pills coloridas removíveis + campo pontilhado para adicionar.
- **Segmented** — trilho com borda, opção ativa com fundo tint.
- **Mini-seg / chip toggle** — pills selecionáveis (`aria-pressed`), ativo com ✓.

### Exibição
- **Card** — `surface-1`, borda 1px, raio 18, padding 16. Título h3 pequeno e cinza.
- **Hero** — rótulo + valor grande centralizado + pill de status (positivo/negativo/neutro).
- **Stat tile** — bloco `surface-2` com rótulo 12 e valor 16/800, em grade de 2.
- **Linha de lista** — nome à esquerda, valor/ação à direita, divisor `gridline`.
- **Item de histórico** — título + valor na linha 1, detalhes 12,5 cinza na linha 2.
- **Badge / pill / tag de status** — 11/800, raio 999. Status de parcela: `ok` (verde), `atraso` (vermelho), `mes` (azul), `fut` (cinza).
- **Ranking** — linha com barra de "calor" azul translúcida ao fundo proporcional ao valor.

### Gráficos
- **Barra horizontal** — nome, trilho `gridline` 10px, preenchimento colorido, valor.
- **Donut** — 132px, anel com total no centro, legenda ao lado.
- **Colunas por mês** — empilhadas por categoria; mês selecionado com fundo tint; meses futuros a 45% de opacidade; valores estimados com hachura diagonal.
- **Legenda** — quadradinho de cor 10px + nome.

### Feedback
- **Toast** — fundo invertido (`text-primary`), raio 14; versão de erro em `critical`.
- **Barra offline** — faixa `warning`: "Sem internet — os dados podem estar desatualizados".
- **Spinner**, **estado vazio** (texto centralizado `text-muted`), **banner de instalação** (fundo tint com ícone).

### Específicos
- **Painel Pix** — QR code (fundo branco, raio 10) + nome, valor em destaque, botão copiar.
- **Caixa de convite** — código grande, Display, letras espaçadas, selecionável.
- **Seletor de grupo** — select com fundo tint no topo.
- **Lista de parcelas**, **dica de fatura** (qual fatura a compra vai cair), **zona de perigo** (card com borda vermelha).

---

## 8. Voz e texto

- Português brasileiro, informal e claro, tratando por "você".
- Frases curtas, verbos de ação nos botões ("Salvar despesa", "Pagar com Pix", "Copiar código").
- Sem jargão financeiro: "quem deve a quem", "sua parte", "fatura de novembro".
- Erros dizem o que aconteceu e o que fazer.

---

## 9. O que o design system deve entregar

1. **Tokens em 3 camadas** (primitivo → semântico → componente), como variáveis CSS,
   **mantendo os nomes semânticos atuais** (`--surface-1`, `--brand-blue`, `--good`…)
   para não quebrar o app. Acrescentar tokens que faltam: espaçamento, raio,
   tamanhos de fonte, alturas de toque, duração de animação.
2. **Escala tipográfica** nomeada (ex.: `display-xl`, `title`, `body`, `label`, `caption`).
3. **Consolidação de componentes parecidos:**
   - `badge` / `pill` / `tag-st` / `tag-pill` → um componente "Pill" com variantes.
   - `chip` / `chip.toggle` / `mini-seg` / `segmented` → um sistema de seleção.
   - `list-row` / `hist-item` / `grupo-linha` / `parc` → uma "Linha de lista" com slots.
4. **Página de referência** com cada componente nos estados: normal, pressionado,
   foco, desabilitado, erro — em **claro e escuro**.
5. **Telas de exemplo** (seção 2) aplicando o sistema.

## 10. Restrições (não negociáveis)

- **Mobile primeiro**, 320–560px, uma mão, polegar na parte de baixo.
- **Acessibilidade WCAG 2.2 AA**: contraste, foco visível, áreas de toque ≥ 38px (ideal 44px), sem depender só de cor.
- **Claro e escuro** obrigatórios, seguindo o sistema.
- **Sem sombras pesadas, sem glassmorphism, sem ilustrações decorativas** que pesem no carregamento.
- **Implementável em CSS puro**: nada que exija framework ou build.
- **Não mudar comportamento nem dados**: é uma camada visual. Nomes de classes e
  variáveis atuais podem ganhar apelidos novos, mas os antigos continuam funcionando
  até serem migrados.

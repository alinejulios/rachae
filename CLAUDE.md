# Rachaê — regras do projeto

## REGRA DE SEGURANÇA Nº 1: nenhum dado de usuário pode ser apagado

O app está em produção, usado por beta testers. **Nenhuma informação que os
usuários inseriram pode ser perdida — nunca.** Isso vale para TODA alteração,
por menor que seja. Features novas podem ser acrescentadas; dados existentes
nunca são removidos, sobrescritos ou tornados inacessíveis.

Na prática, antes de qualquer mudança:

- **Firestore é aditivo.** Pode criar campos, documentos e coleções novas.
  Não pode renomear nem remover coleções/campos existentes (`households`,
  `membros`, `grupos`, `despesas`, `compras`, `pagamentos`, `pessoais`,
  `users`, `convites`…). Campo novo sempre com valor padrão no código para
  documentos antigos que não o têm.
- **Código continua lendo o formato antigo.** Se o formato de um dado mudar,
  o app precisa entender os dois (antigo e novo). Nada de migração que
  reescreve ou apaga documentos em massa.
- **Sem scripts/migrações destrutivas.** Nada de `deleteDoc`, `batch.delete`,
  `set` sem `merge` sobre documento existente, ou limpeza de dados "órfãos"
  sem autorização explícita do dono do projeto, caso a caso.
- **`firestore.rules` não pode trancar dados antigos.** Ao endurecer uma
  validação, conferir que documentos já gravados continuam legíveis e
  editáveis (ex.: campo novo obrigatório quebra o `update` de docs antigos).
- **Dados locais também contam.** Chaves de `localStorage`/IndexedDB e o cache
  do service worker (`public/sw.js`) não podem ser trocados de um jeito que
  descarte o que o usuário tem salvo.
- **Exclusões feitas pelo próprio usuário na interface** (ex.: apagar uma
  despesa que ele criou) continuam funcionando como hoje — a regra é sobre o
  *desenvolvimento* não apagar dados, não sobre tirar funcionalidades.
- Na dúvida se uma mudança pode perder dado: **parar e perguntar antes**.

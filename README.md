# MVP Agro · Cotação de Insumos

Tela para o usuário cadastrar uma **cotação de insumos do agronegócio** e, ao
enviar, disparar um **webhook** que contata os fornecedores. Usa o padrão de
cores do design system **Starbridge** (modo claro e escuro) e a logo da Starbridge.

**Projeto único**: frontend (React) e backend (Express) no mesmo `package.json`,
mesmo `node_modules`, mesmo `tsconfig.json` e mesma porta.

- **Frontend:** React + TypeScript
- **Backend:** Node.js + Express + TypeScript
- **Build/dev:** Vite (embutido no Express em dev) · `tsx` roda o servidor

```
.
├── index.html            # entrada do Vite
├── package.json          # único (back + front)
├── tsconfig.json         # único
├── vite.config.ts
├── .env                  # único (back + VITE_*)
├── Dockerfile
├── public/               # logo da Starbridge
└── src/
    ├── server/           # Express + TS (valida e dispara o webhook)
    └── client/           # React + TS (formulário)
```

O frontend chama `/api/cotacoes` no mesmo servidor; o backend valida (Zod) e
repassa ao webhook em `WEBHOOK_URL` (assim a URL fica fora do navegador).

## Payload enviado ao webhook

```json
{
  "nome": "João Silva",
  "email": "joao@gmail.com",
  "cidade": "Crateús",
  "estado": "CE",
  "produtos": [
    { "material": "Ureia 45% N", "quantidade": 10, "unidade": "t", "marca": "Yara" },
    { "material": "Glifosato 480 SL", "quantidade": 200, "unidade": "L" },
    { "material": "Semente de soja", "quantidade": 50, "unidade": "saca" }
  ]
}
```

Todos os campos são obrigatórios, **exceto `marca`** (quando vazio, é omitido do payload).

## Pré-requisitos

- Node.js 18+ (testado com Node 22)

## Instalação (uma vez)

```bash
npm install
```

Instala tudo (back + front) num único `node_modules`.

> **Rede com proxy/antivírus que intercepta TLS?** Se o `npm install` falhar com
> `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, rode confiando na loja de certificados do
> sistema (que já tem a CA corporativa) — sem desabilitar a verificação:
>
> ```bash
> NODE_OPTIONS=--use-system-ca npm install
> ```

## Desenvolvimento — uma porta, hot-reload

```bash
npm run dev
```

Abra **http://localhost:4000**. Frontend e backend sobem juntos no mesmo servidor;
qualquer alteração aparece na hora (Vite embutido). `Ctrl+C` encerra.

> Opcional: copie `.env.example` para `.env` para trocar o `WEBHOOK_URL`. Sem
> isso, ele já usa a URL padrão do n8n.

## Produção — processo único

```bash
npm run build   # gera dist/ (frontend)
npm start       # http://localhost:4000 (UI + API juntos)
```

## Docker — imagem única

```bash
docker build -t mvp-agro .
docker run -p 4000:4000 mvp-agro
# UI + API em http://localhost:4000

# Trocar o webhook sem rebuildar:
docker run -p 4000:4000 -e WEBHOOK_URL="https://seu-webhook" mvp-agro
```

## Variáveis de ambiente (`.env` na raiz)

| Variável             | Padrão                        | Descrição                                                    |
| -------------------- | ----------------------------- | ------------------------------------------------------------ |
| `PORT`               | `4000`                        | Porta do servidor (UI + API).                                |
| `WEBHOOK_URL`        | _(URL do n8n já preenchida)_  | **Webhook que recebe a cotação.** Configurável.              |
| `WEBHOOK_TIMEOUT_MS` | `15000`                       | Tempo máximo de espera pela resposta do webhook.             |
| `CORS_ORIGIN`        | `http://localhost:4000`       | Só relevante se o frontend for servido em outra origem.      |
| `DATABASE_URL`       | _(vazio)_                     | Conexão Postgres, usada pelas migrations e pela autenticação. |
| `VITE_API_URL`       | _(vazio)_                     | Base da API. Vazio = mesma origem (`/api`). Vite só expõe `VITE_*`. |
| `JWT_SECRET`         | _(obrigatório)_               | **Segredo HMAC que assina os access tokens.** >= 32 chars aleatórios. |
| `AUTH_*` / `ARGON_*` | _(padrões sensatos)_          | TTLs, lockout, cookies e custos do argon2. Veja `.env.example`. |

> Sem um `JWT_SECRET` forte (>= 32 caracteres) o servidor **não sobe** (fail-closed).

## Scripts

| Comando             | O que faz                                                       |
| ------------------- | -------------------------------------------------------------- |
| `npm install`       | Instala tudo (um único `node_modules`).                        |
| `npm run dev`       | Sobe UI + API na porta 4000 com hot-reload.                    |
| `npm run build`     | Compila o frontend em `dist/`.                                 |
| `npm start`         | Sobe UI + API na 4000 a partir do build (produção).           |
| `npm run typecheck` | Checagem de tipos (front + back).                              |
| `npm run migrate`   | Aplica as migrations pendentes no Postgres.                    |
| `npm run migrate:down` | Reverte a última migration aplicada.                       |
| `npm run migrate:status` | Lista migrations aplicadas/pendentes.                    |
| `npm run create-user`  | Cria um usuário com senha hasheada (argon2). Veja abaixo.    |

## Migrations

SQL puro versionado em `migrations/`, aplicado por um runner simples (Postgres).

```bash
# defina DATABASE_URL no .env, depois:
npm run migrate          # aplica as pendentes
npm run migrate:status   # vê o estado
npm run migrate:down     # reverte a última
```

Cada arquivo segue o padrão `NNNN_descricao.sql` com duas seções:

```sql
-- migrate:up
CREATE TABLE ...;

-- migrate:down
DROP TABLE ...;
```

O controle do que já foi aplicado fica na tabela `schema_migrations`. As
migrations usam `IF NOT EXISTS`, então rodar contra um banco que já tem as
tabelas é seguro (idempotente).

## API

`POST /api/cotacoes` — recebe o payload acima, valida (Zod) e repassa ao webhook.

- `200` → `{ "message": "Cotação enviada aos fornecedores com sucesso!" }`
- `400` → dados inválidos (`{ message, errors }`)
- `502 / 504` → falha/timeout ao contatar o webhook

`GET /api/health` — healthcheck (`{ "status": "ok" }`).

## Autenticação (login seguro)

Login com **JWT + argon2id**, sessão com **refresh token rotativo** e opção de
**"lembrar de mim"**. Todo o app (UI + APIs de dados) fica atrás do login;
públicos só `/api/health` e as rotas `/api/auth/*`.

**Primeiro acesso — crie um usuário:**

```bash
# defina DATABASE_URL e JWT_SECRET no .env, rode as migrations e depois:
npm run migrate
CREATE_USER_PASSWORD='SuaSenhaForte123' npm run create-user -- \
  --name "Seu Nome" --email voce@empresa.com --role admin
```

> A senha pode vir de `CREATE_USER_PASSWORD` (fora do histórico do shell), de
> `--password`, ou ser **gerada** automaticamente (exibida uma vez) se omitida.
> Roles disponíveis na tabela: `admin`, `manager`, `user`, `viewer`.

**Requisitos de senha** (validados no cadastro e na criação via CLI):

| Requisito                | Regra                                              |
| ------------------------ | -------------------------------------------------- |
| Comprimento              | **mínimo 8** e **máximo 128** caracteres           |
| Letra minúscula          | ao menos **1** (`a`–`z`)                           |
| Letra maiúscula          | ao menos **1** (`A`–`Z`)                           |
| Número                   | ao menos **1** (`0`–`9`)                           |

- Caractere especial **não é obrigatório** (é permitido).
- O teto de 128 caracteres evita abuso do hashing (DoS no argon2 com inputs gigantes).
- Exemplos válidos: `Nel01102003`, `Senha123`, `Starbridge2026`.
  Inválidos: `senha123` (sem maiúscula), `SENHA123` (sem minúscula),
  `Senha` (curta e sem número).
- A política fica em [`src/server/auth/schema.ts`](src/server/auth/schema.ts)
  (`passwordSchema`) — ajuste lá se precisar mudar as regras.

**Endpoints (`/api/auth`):**

| Rota            | Método | Descrição                                              |
| --------------- | ------ | ------------------------------------------------------ |
| `/login`        | POST   | `{ email, password, rememberMe? }` → cookies de sessão |
| `/refresh`      | POST   | Rotaciona o refresh token e renova o access token      |
| `/logout`       | POST   | Revoga a sessão e limpa os cookies                     |
| `/me`           | GET    | Usuário autenticado atual                              |
| `/register`     | POST   | Cadastro (desligado por padrão; `AUTH_ALLOW_REGISTRATION`) |

**Medidas de segurança:**

- **argon2id** (OWASP) para hash de senha; re-hash automático quando os custos sobem.
- **Access token** JWT curto (15 min) + **refresh token rotativo** com
  **detecção de reuso**: reapresentar um token já rotacionado revoga a família
  inteira (resposta a roubo de token).
- Tokens em **cookies httpOnly + SameSite=Strict + Secure** (HTTPS) — imunes a
  XSS e a CSRF. Refresh token escopado em `path=/api/auth`.
- **Rate limit** por IP + **bloqueio de conta** após N tentativas (lockout).
- Mensagens genéricas e verify de tempo constante (**sem enumeração de contas**).
- Apenas o **SHA-256** do refresh token é guardado no banco (nunca o valor cru).
- `JWT_SECRET` fraco/ausente impede o servidor de subir (**fail-closed**).

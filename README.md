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
| `DATABASE_URL`       | _(vazio)_                     | Conexão Postgres, usada pelas migrations.                    |
| `VITE_API_URL`       | _(vazio)_                     | Base da API. Vazio = mesma origem (`/api`). Vite só expõe `VITE_*`. |

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

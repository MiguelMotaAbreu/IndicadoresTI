# PulseTI

Plataforma interna de análise dos indicadores de TI da UPA, construída com Next.js, React e SQLite.

## Requisitos

- Node.js 24.15 ou superior
- npm

## Desenvolvimento local

```bash
npm install
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000).

## Persistência local

Os layouts e as métricas personalizadas são persistidos em SQLite. Por padrão, a aplicação cria o arquivo `data/pulseti.sqlite` automaticamente.

Para usar outro caminho, defina `PULSETI_DATABASE_PATH` antes de iniciar o servidor:

```powershell
$env:PULSETI_DATABASE_PATH = "C:\dados\pulseti.sqlite"
npm run dev
```

O caminho deve apontar para uma área persistente e com permissão de escrita para o processo do Node.js.

### Migrações do banco

As migrações são executadas automaticamente na primeira abertura do banco e registradas em `schema_migrations`, com versão e checksum. A aplicação interrompe a inicialização se encontrar uma versão desconhecida ou uma migração já aplicada que tenha sido alterada.

A versão atual cria:

- `dashboard_drafts`: layouts e métricas personalizadas por usuário e painel.
- `users`: estrutura para administradores e analistas, incluindo hash de senha, troca obrigatória e desativação de conta.

A tabela de usuários é apenas a base da próxima fatia. Nenhuma conta ou senha padrão é criada automaticamente e a tela de login ainda não utiliza essa tabela.

## Verificações

```bash
npm test
npm run lint
npm run build
```

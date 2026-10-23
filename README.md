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

A tela de login ainda não utiliza essa tabela. A primeira conta é criada uma única vez pelo comando de bootstrap abaixo; nenhuma conta ou senha padrão é incluída no código.

### Primeiro administrador

No PowerShell, informe email e nome por variáveis de ambiente e execute:

```powershell
$env:PULSETI_BOOTSTRAP_ADMIN_EMAIL="administrador@upa.local"
$env:PULSETI_BOOTSTRAP_ADMIN_NAME="Administrador local"
npm run bootstrap:admin
Remove-Item Env:PULSETI_BOOTSTRAP_ADMIN_EMAIL, Env:PULSETI_BOOTSTRAP_ADMIN_NAME
```

O comando gera uma senha temporária criptograficamente aleatória, mostra-a uma única vez e marca a troca como obrigatória. Para definir a senha temporária manualmente, use `PULSETI_BOOTSTRAP_ADMIN_PASSWORD`; ela deve ter entre 12 e 128 caracteres e deve ser removida do ambiente após a execução.

O bootstrap falha de forma segura se já existir qualquer usuário. A senha é armazenada somente como um hash `scrypt` com salt individual; o valor original não é gravado no banco nem nos logs da aplicação.

## Verificações

```bash
npm test
npm run lint
npm run build
```

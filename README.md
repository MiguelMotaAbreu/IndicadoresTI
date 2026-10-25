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
- `user_sessions`: sessões opacas com expiração por inatividade e limite absoluto.
- `audit_events`: registro append-only dos eventos de autenticação e gestão de usuários.

A autenticação de credenciais e o ciclo de sessões estão conectados à interface. O dashboard e suas APIs exigem uma sessão válida, e a primeira conta é criada uma única vez pelo comando de bootstrap abaixo; nenhuma conta ou senha padrão é incluída no código.

Cada sessão expira após 30 minutos sem atividade ou, no máximo, oito horas após sua criação. O banco guarda somente o hash SHA-256 do token de sessão; o token original existe apenas em um cookie `HttpOnly`, `SameSite=Strict` e `Secure` em produção.

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

No primeiro login, a conta é direcionada obrigatoriamente para `/trocar-senha`. A senha definitiva deve ter entre 12 e 128 caracteres e não pode repetir a senha temporária. Concluída a troca, todas as sessões anteriores são revogadas e uma nova sessão é criada.

### Gestão de usuários

Administradores podem abrir **Administração > Usuários** para listar contas, criar Administradores ou Analistas e desativar ou reativar acessos. A senha temporária é gerada no servidor e exibida uma única vez após a criação; somente o hash é persistido. A conta criada precisa definir uma nova senha no primeiro acesso.

Desativar uma conta preserva sua identidade para referências históricas e revoga imediatamente todas as sessões abertas. A própria conta administrativa em uso não pode ser desativada, evitando o bloqueio acidental do único acesso em operação. A reativação mantém a senha que o usuário já havia definido.

### Auditoria de segurança

Administradores podem consultar em **Administração > Auditoria** os 200 eventos mais recentes de login, logout, troca de senha e criação, desativação ou reativação de usuários. A tela permite pesquisar e filtrar por categoria e resultado.

Os eventos guardam um retrato do ator, alvo, resultado, data e resumo da ação. Senhas, hashes e tokens de sessão nunca fazem parte do registro. Alterações de usuários e seus eventos são confirmados na mesma transação SQLite.

## Verificações

```bash
npm test
npm run lint
npm run build
```

O fluxo completo de autenticação também possui um teste de navegador. Com o servidor iniciado sobre um banco isolado e um administrador temporário ainda não utilizado, informe as credenciais de QA e execute:

```powershell
$env:QA_BASE_URL="http://localhost:3000"
$env:QA_EMAIL="admin.qa@upa.local"
$env:QA_TEMPORARY_PASSWORD="Senha temporaria QA 123"
$env:QA_NEW_PASSWORD="Senha definitiva QA 456"
npm run qa:auth
```

O teste confirma bloqueio anônimo das APIs, erro genérico para credenciais inválidas, troca obrigatória, proteções do cookie, acesso autenticado, logout e seus respectivos eventos de auditoria. Use sempre um banco descartável: o roteiro troca definitivamente a senha da conta informada.

Com um administrador de QA já usando senha definitiva, execute também o fluxo de gestão de usuários:

```powershell
$env:QA_BASE_URL="http://localhost:3000"
$env:QA_EMAIL="admin.qa@upa.local"
$env:QA_PASSWORD="Senha definitiva QA 456"
npm run qa:users
```

Esse roteiro cria um Analista exclusivo, confirma a troca obrigatória de senha, bloqueia o acesso administrativo, desativa a conta, verifica a revogação da sessão e reativa o acesso. Use um banco descartável, pois o usuário de QA permanece cadastrado após o teste.

Para validar a auditoria em um ambiente isolado e descartável:

```powershell
npm run qa:audit
```

O roteiro cria um banco SQLite temporário, prepara uma conta Administrador, escolhe uma porta livre, inicia a aplicação e remove o processo e os dados ao terminar. Ele verifica bloqueio anônimo e de Analistas, registro dos eventos, ausência de credenciais nas respostas e filtros da interface.

Opcionalmente, é possível apontar o roteiro para uma aplicação que já esteja em execução:

```powershell
$env:QA_BASE_URL="http://localhost:3000"
$env:QA_EMAIL="admin.qa@upa.local"
$env:QA_PASSWORD="Senha definitiva QA 456"
npm run qa:audit
```

Nesse modo externo, o servidor precisa estar acessível e o banco deve ser descartável, pois uma conta de teste e eventos permanentes serão criados. Se `QA_BASE_URL` não estiver definida, o modo isolado é usado automaticamente.

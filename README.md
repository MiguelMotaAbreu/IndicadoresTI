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

O Tailwind examina somente o diretório `app`, onde ficam os componentes e estilos. Essa delimitação evita que o compilador de desenvolvimento tente observar arquivos transitórios do SQLite em `data` enquanto eles estão bloqueados pelo banco no Windows.

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
- `sync_runs`: histórico e estado das execuções de sincronização.
- `analytical_snapshots`: metadados das cargas analíticas publicadas e substituídas.
- `notion_property_mappings`: associação validada entre o esquema do Notion e o contrato analítico interno.

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

Administradores podem consultar em **Administração > Auditoria** os 200 eventos mais recentes de login, logout, troca de senha, gestão de usuários e testes da integração com o Notion. A tela permite pesquisar e filtrar por categoria e resultado.

Os eventos guardam um retrato do ator, alvo, resultado, data e resumo da ação. Senhas, hashes e tokens de sessão nunca fazem parte do registro. Alterações de usuários e seus eventos são confirmados na mesma transação SQLite.

### Saúde da instalação

Em **Administração > Saúde do sistema**, o Administrador executa um diagnóstico local e sem efeitos colaterais. A tela verifica a integridade e a versão do SQLite, a presença da configuração do Notion, a completude dos mapeamentos obrigatórios, o último snapshot publicado, o estado dos jobs de sincronização e o tempo ativo do processo.

O estado geral adota a condição mais grave encontrada: saudável, atenção ou crítico. Tokens, IDs das bases, caminhos locais e conteúdo de chamados não fazem parte da resposta. A verificação não realiza chamadas externas; a conectividade real com o Notion continua sendo validada pelo botão **Testar conexão** na tela de Sincronização.

### Fundação da sincronização

Administradores podem consultar em **Administração > Sincronização** o estado real da configuração, a última carga íntegra e o histórico de execuções. A simulação visual anterior foi removida: enquanto o conector não estiver disponível, a aplicação informa claramente a pendência e não apresenta uma sincronização fictícia como concluída.

O ciclo persistente de uma carga possui os estados `running`, `succeeded` e `failed`. Somente uma execução pode permanecer ativa, e a publicação de um novo snapshot acontece em uma única transação: metadados e registros canônicos de chamados e eventos são gravados juntos, e a carga anterior só é substituída quando toda a operação termina. As contagens são derivadas dos registros efetivamente persistidos; falhas preservam o último snapshot publicado.

As credenciais e IDs são lidos apenas no servidor pelas variáveis abaixo; a API administrativa expõe somente se cada requisito está configurado, nunca os valores:

```powershell
$env:PULSETI_NOTION_TOKEN="token-da-integracao"
$env:PULSETI_NOTION_TICKETS_DATABASE_ID="id-da-base-de-chamados"
$env:PULSETI_NOTION_HISTORY_DATABASE_ID="id-da-base-de-historico"
```

Com as três variáveis configuradas, o botão **Testar conexão** faz consultas somente leitura usando a versão `2026-03-11` da API do Notion. O diagnóstico verifica o acesso às duas bases, resolve a fonte de dados de cada base e apresenta apenas nome, quantidade e tipos das propriedades. Tokens, IDs internos e mensagens brutas do serviço não são devolvidos ao navegador nem registrados na auditoria.

Uma base com nenhuma ou múltiplas fontes de dados é recusada de forma explícita, pois escolher silenciosamente uma fonte poderia associar indicadores ao esquema errado. Com configuração e mapeamentos obrigatórios completos, **Sincronizar agora** registra uma execução e responde imediatamente; a leitura, validação e publicação continuam em segundo plano. A interface acompanha o estado até a conclusão, e somente registros normalizados e mapeados entram no snapshot, sem descrições livres ou anexos.

O trabalho em segundo plano usa `after()` do Next.js e possui limite de cinco minutos por execução. Em hospedagem própria, o processo deve receber desligamento gracioso por `SIGINT` ou `SIGTERM` e aguardar as tarefas pendentes antes de encerrar; uma janela de drenagem entre 10 e 30 segundos evita interromper uma carga durante deploys ou reinicializações.

Se uma execução permanecer em `running` por pelo menos 15 minutos, a Administração passa a classificá-la como possivelmente interrompida e oferece **Encerrar execução**. A ação não tenta importar novamente: ela marca somente o job como `failed`, registra a recuperação na auditoria na mesma transação e preserva integralmente o último snapshot publicado. Uma nova sincronização continua dependendo de uma ação explícita do Administrador, evitando duas leituras concorrentes do Notion.

### Mapeamento das propriedades

Em **Administração > Mapeamentos**, o Administrador pode consultar o esquema atual das duas fontes e associar suas propriedades aos 21 campos conhecidos pela camada analítica. Oito campos estruturais são obrigatórios; os opcionais aumentam a cobertura de indicadores de tempo, SLA, agendamento, responsáveis e privacidade.

A interface sugere associações pelos nomes encontrados nos anexos, mas nada é persistido automaticamente. Ao salvar, o servidor consulta novamente o Notion, resolve os nomes escolhidos para IDs estáveis de propriedades, valida tipos e duplicidades e grava o conjunto inteiro em uma transação SQLite junto com seu evento de auditoria. IDs de propriedades ficam somente no servidor; a API e a interface retornam apenas nomes e tipos.

Propriedades de fórmula são aceitas somente nos campos em que a base atual pode depender delas. O mapeamento confirma a compatibilidade estrutural e a pré-validação inspeciona o resultado de cada registro: datas, números, booleanos e textos incompatíveis com o campo analítico são contabilizados como inválidos. Resultados `unsupported` ou `incomplete` de fórmulas e rollups nunca são tratados como valores utilizáveis.

Cada registro de chamado será identificado internamente pelo `page.id` que acompanha toda página retornada pela API do Notion. O código visível é apenas uma referência opcional e sua ausência não descartará o chamado. A propriedade de título pode ser mapeada como solicitante, mas nunca será usada como chave. O motivo permanece como classificação analítica; descrições livres não são sincronizadas nem combinadas para formar identidade ou categoria no v1.

### Pré-validação das bases

Depois que a configuração e os oito campos obrigatórios estiverem completos, **Administração > Sincronização > Pré-validar bases** percorre chamados e histórico com paginação de 100 registros. As duas consultas somente leitura são iniciadas em paralelo, solicitam apenas as propriedades mapeadas, não gravam valores operacionais e não substituem o snapshot publicado.

Quando o formulário do Notion separa a abertura em `Data - Abertura` e `Hora - Abertura`, o segundo campo pode ser associado ao campo opcional **Hora de abertura** em **Administração > Mapeamentos**. A ingestão aceita textos como `8:05`, `08h30` e `21:14:09`, combina ambos em `America/Sao_Paulo` e publica uma data/hora canônica. Uma hora malformada é contabilizada como inválida sem copiar seu texto para o snapshot. Se a hora estiver ausente, a data continua válida para análises diárias, mas o registro não participa de indicadores por faixa horária.

O resultado informa páginas lidas, registros elegíveis por `page.id`, duplicidades técnicas, alertas e cobertura válida dos campos em cada fonte. Antes das análises, cada página é convertida em um registro canônico somente em memória, contendo apenas os campos explicitamente mapeados e já tipados. Descrições livres, anexos e demais propriedades fora do mapeamento não são copiados para essa camada.

Ausências e valores inválidos aparecem separadamente; a cobertura considera somente valores que puderam ser normalizados para o tipo analítico esperado. Também cruza a relação do evento com os `page.id` dos chamados lidos: vínculos ausentes, apontando para chamados inexistentes ou contendo mais de um destino são separados e nunca tratados como seguros. A consistência cronológica verifica início ou conclusão anteriores à abertura, conclusão anterior ao início, fim de etapa anterior ao começo e movimentação anterior à abertura do chamado relacionado. Comparações que dependem de um campo ausente, inválido ou de uma relação ambígua são ignoradas, sem inventar uma inconsistência. O chamado não é descartado por estar sem código visível ou por possuir outro campo analítico vazio. Consultas truncadas pelo limite de 10.000 resultados do Notion são recusadas em vez de apresentadas como completas.

### Modelo analítico da visão geral

O endpoint autenticado `GET /api/analytics/overview` lê exclusivamente o snapshot atualmente publicado e produz o primeiro modelo de leitura real dos painéis. A resposta contém total de chamados, média por dia corrido, cumprimento e cobertura do SLA registrado, pendências atuais, evolução de aberturas e conclusões, além das distribuições por status, prioridade e motivo.

Datas são agrupadas em `America/Sao_Paulo`; períodos de até 366 dias retornam pontos diários, enquanto intervalos maiores são consolidados por mês e limitados a 600 pontos. Ausências não viram zero silenciosamente: médias e SLA sem amostra retornam valor nulo, acompanhados da quantidade válida e da cobertura. Relações do Notion que contenham apenas IDs não são usadas como rótulos de gráficos. Quando ainda não existe snapshot, a API responde com sucesso e `data: null`, permitindo que a interface apresente um estado vazio sem fingir dados reais.

O painel **Visão geral** consome esse modelo diretamente. Seus quatro cartões, evolução temporal e distribuições por status, prioridade e motivo deixam de usar os números demonstrativos assim que a tela é aberta. Sem snapshot, cada widget mostra um estado vazio explícito; falhas de leitura também não reaproveitam mocks. O catálogo deixou de afirmar uma contagem fixa. As prévias de métricas personalizadas permanecem bloqueadas nesse painel até que também executem sobre o snapshot real.

O endpoint autenticado `GET /api/analytics/demand` reutiliza o mesmo contrato de filtros e o mesmo snapshot publicado para produzir a leitura temática de demanda. Ele calcula total do recorte, média por dia corrido, variação contra um período anterior de mesma duração para recortes de 30 ou 90 dias, quantidade e cobertura de motivos, série temporal, mapa de calor em faixas de três horas e Pareto acumulado. O período completo não inventa uma comparação: a variação retorna valor nulo até que um intervalo comparável seja escolhido.

O painel **Demanda e perfil** consome essa leitura real em seus quatro cartões e quatro gráficos. Ranking e Pareto permitem cruzamento por motivo; o mapa de calor permanece somente informativo enquanto dia e faixa horária não fizerem parte do contrato de filtros do servidor. Estados de carregamento, ausência de snapshot, recorte vazio e falha são explícitos, e exportação e métricas personalizadas continuam bloqueadas nesse painel até receberem contratos próprios sobre o snapshot.

O endpoint autenticado `GET /api/analytics/pending` aplica o mesmo contrato de filtros antes de classificar a fila atual pelos status Não Iniciado, Aguardando Informação e Fornecedor. A resposta calcula total e cobertura dos status, idade mediana, faixas de idade, quantidade com fornecedor, ausência de responsável, os cinco chamados mais antigos e a composição dinâmica de setor por prioridade. A idade usa a publicação do snapshot como referência, em vez do relógio do navegador, para que o mesmo snapshot continue reproduzível. A interface de **Pendências** não recorre a mocks quando a carga está ausente, vazia ou indisponível; detalhamento e exportação permanecem bloqueados até receberem contratos específicos da fila.

Os filtros convencionais da **Visão geral** executam novamente a leitura no servidor por período de abertura, setor, prioridade e status. Setores, prioridades e status disponíveis são derivados do snapshot completo, sem opções fixas no navegador. “Últimos 30 dias” e “Últimos 90 dias” terminam na abertura válida mais recente da base, de modo que o mesmo snapshot sempre produza o mesmo recorte. O retorno informa o total da base, a quantidade selecionada e o intervalo aplicado; parâmetros desconhecidos, repetidos ou excessivamente longos são recusados com `400`.

Status, prioridade e motivo também oferecem cross-filter simples. Clicar em uma fatia, legenda ou barra envia a dimensão selecionada ao mesmo endpoint analítico e recalcula o painel inteiro. Somente uma seleção cruzada permanece ativa por vez; ela aparece em um chip destacado, pode ser removida pelo próprio chip e é substituída quando outro elemento é escolhido. Ao abrir e aplicar o painel convencional, a seleção cruzada é limpa para evitar duas origens visuais conflitantes para o mesmo recorte.

O detalhamento e `GET /api/analytics/overview/export` usam exatamente o mesmo recorte. A exportação CSV inclui no máximo 10.000 registros, nunca envia `page.id` ou email e mascara solicitantes para Analistas. Células iniciadas por caracteres de fórmula são neutralizadas antes da geração do arquivo. Cada exportação concluída ou recusada é registrada na auditoria, sem copiar filtros nem conteúdo operacional para o evento.

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

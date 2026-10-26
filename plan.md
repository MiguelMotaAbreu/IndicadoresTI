# Síntese da entrevista e planejamento

## Produto e usuários

Plataforma interna de análise dos indicadores de TI da UPA, sem qualquer função operacional sobre chamados.

- Dois perfis: administrador e analista.
- Até 10 usuários e cinco acessos simultâneos.
- Acesso somente pela rede local, via desktop.
- Administrador gerencia usuários, sincronização, mapeamentos, exclusões e painéis oficiais.
- Analista explora os dados e cria painéis privados ou cópias pessoais.
- Sem páginas públicas, cadastro aberto, monetização, SEO ou suporte mobile.

## Escopo funcional do v1

- Todos os 47 indicadores listados.
- Organização em painéis temáticos: visão geral, demanda, pendências, tempos/SLA, movimentações e qualidade dos dados.
- Entrada pelo catálogo de painéis.
- Laboratório de métricas baseado nos campos disponíveis nas bases, permitindo combinar agregações, constantes e operações aritméticas sem escrever código.
- O construtor começa pelos dados disponíveis, e não por uma lista fechada de indicadores. Exemplos válidos: `Contagem(chamados) ÷ 30` e `Contagem(chamados) × Contagem(movimentações) ÷ 30`.
- Métricas oficiais continuam disponíveis como modelos explicados, mas não limitam a criação de métricas pessoais.
- Painéis oficiais com fluxo de rascunho e publicação.
- Layout em grade, com drag-and-drop real, troca livre de ordem e posição e redimensionamento pelas quatro laterais e quatro cantos, sem sobreposição.
- Cada painel tem uma composição inicial própria, adequada ao tipo de análise, em vez de reutilizar o mesmo arranjo de cartões e gráficos.
- Cross-filter simples ou múltiplo entre gráficos do painel atual.
- Detalhamento dos chamados que compõem uma seleção.
- Filtros mantidos somente durante a sessão.
- Exportação de gráficos/painéis em imagem ou PDF e dados em CSV.
- Período inicial definido individualmente por painel.

## Composição inicial dos painéis

Todos os 47 indicadores permanecem disponíveis, mas a primeira visualização de cada painel é curada para responder às perguntas mais importantes daquele tema:

- **Visão geral:** cartões de total, média, SLA e pendências; evolução temporal ampla; composição por status; categorias e prioridades.
- **Demanda e perfil:** volume e variação; linha de evolução; mapa de calor por dia e horário; ranking de motivos; Pareto acumulado. A ênfase é descobrir quando e por que a demanda acontece.
- **Pendências:** tamanho e idade da fila; distribuição por faixas de idade; lista dos chamados mais antigos; composição por setor e prioridade. A ênfase é risco de envelhecimento, não evolução geral da demanda.
- **Tempos e SLA:** mediana e P90; histograma de primeiro atendimento; cumprimento por prioridade; comparação entre grupos; cobertura da avaliação. Percentis não aparecem sem amostra mínima válida.
- **Movimentações:** volume de eventos; barras por tipo; linha do tempo recente; composição do tempo por etapa; cobertura do histórico. A limitação de 37 chamados com histórico fica visível no próprio painel.
- **Qualidade dos dados:** barras de cobertura por requisito; escore de confiabilidade da carga; inconsistências por regra; explicação das validações aplicadas.

O usuário pode reorganizar essa composição, restaurar o arranjo inicial do painel e adicionar métricas calculadas ao rascunho.

## Dados e regras analíticas

- Notion permanece como fonte oficial.
- Integração somente leitura com as bases de chamados e histórico.
- Sincronização manual, executada como job em segundo plano.
- Antes da primeira publicação, uma pré-validação somente leitura percorre chamados e histórico, confirma a paginação integral, separa valores ausentes de valores incompatíveis com o tipo analítico, calcula a cobertura válida dos campos mapeados e mede vínculos ausentes, órfãos ou ambíguos entre eventos e chamados sem persistir valores operacionais.
- Nova carga só é publicada após ser integralmente concluída e validada.
- Em caso de falha, permanece visível a última carga íntegra.
- Registros removidos do Notion são preservados localmente como inativos e excluídos dos indicadores por padrão.
- Correções de dados são feitas somente no Notion.
- Cada chamado usa o `page.id` fornecido pela API do Notion como chave técnica estável, inclusive quando o código visível estiver vazio.
- O código visível do chamado é uma referência opcional; sua ausência não exclui o registro dos indicadores.
- O título da base pode representar o solicitante. Solicitante, código visível e identidade técnica são conceitos independentes.
- Chamado de teste e futuras exclusões são controlados pelo `page.id`, com motivo e auditoria.
- Categorias derivadas dos motivos usam mapa administrável.
- O motivo do chamado é a classificação analítica. A descrição não é usada para identificar nem categorizar registros no v1, pois não será sincronizada por conter texto livre potencialmente sensível.
- SLA utiliza a classificação produzida pelo Notion.
- Demanda diária considera dias corridos, inclusive dias com zero chamados.
- Tempos exibem duração corrida e minutos de expediente quando disponíveis.
- O período usa a data própria da métrica: abertura, conclusão ou evento.
- Chamados com múltiplos responsáveis formam um grupo compartilhado, sem duplicação.
- Datas inválidas são excluídas dos cálculos e contabilizadas na cobertura.
- “Concluído” é definido pelo status atual; divergências com a data de conclusão são inconsistências.
- Etapas abertas podem mostrar duração provisória até o momento atual, mas ficam fora de distribuições finais.
- Meses parciais são identificados e não comparados automaticamente com períodos de duração diferente.
- Percentis e boxplots: ocultos para `N < 5`, alertados para `N entre 5 e 19`, normais a partir de 20.
- Cada indicador terá sua própria regra de cobertura, usando 80% como limiar inicial padrão.

### Definição e execução de métricas calculadas

- Fórmulas são armazenadas como uma árvore de expressão tipada (AST), nunca como JavaScript, SQL ou texto executável.
- Nós permitidos no v1: campo, agregação, constante e operadores de soma, subtração, multiplicação e divisão.
- Agregações são validadas pelo tipo do campo: contagem/contagem distinta para categorias; média, mediana, percentil, mínimo, máximo e soma apenas para números ou durações compatíveis; agrupamento temporal apenas para datas.
- Dimensão, métrica e filtro são conceitos separados. Escolher um campo para segmentação não o transforma automaticamente em operando da fórmula.
- A interface valida imediatamente campos ausentes, tipos incompatíveis, nomes inválidos, divisores vazios ou iguais a zero e visualizações incompatíveis com a dimensão.
- O backend repete todas as validações e é a única camada autorizada a executar a métrica. A validação do navegador serve apenas para feedback rápido.
- Cruzamentos entre Chamados e Histórico usam o ID estável do chamado e exibem a cobertura da interseção. Uma fórmula entre essas bases não pode sugerir cobertura de 100%.
- Nulos não viram zero silenciosamente. Cada métrica define se deve ignorar, contar separadamente ou invalidar registros ausentes.
- Divisão por zero produz estado “não calculável”, com motivo visível, e nunca `Infinity`, `NaN` ou valor substituído.
- Cada definição registra nome, descrição, fórmula, tipos inferidos, dimensão, filtros, visualização, regra de cobertura, autor, versão e datas de criação/alteração.
- Alterações em fórmulas publicadas criam nova versão; resultados exportados preservam a versão usada.
- Limites de complexidade no v1: até 10 nós por expressão, duas bases relacionadas, um nível de agrupamento e período obrigatório para cálculos sobre histórico.
- Prévia e publicação usam o mesmo avaliador do servidor para evitar diferenças entre o que o construtor mostra e o que o painel calcula.
- Resultados personalizados respeitam as mesmas regras de privacidade, mascaramento, cobertura, amostra mínima e auditoria dos indicadores oficiais.

Os anexos contêm 518 chamados entre 7 de julho e 20 de outubro de 2026 e 72 movimentações vinculadas a 37 chamados. A cobertura limitada do histórico será sempre mostrada junto dos respectivos indicadores.

## Segurança e privacidade

- Login local por email e senha, sem cadastro público.
- Administrador cria contas com senha temporária e troca obrigatória no primeiro acesso.
- Sessões expiram após 30 minutos de inatividade ou oito horas totais.
- Contas são desativadas, não apagadas.
- Painéis de usuários desativados podem ser reatribuídos pelo administrador.
- Descrições e anexos não são sincronizados.
- Analistas veem solicitantes e emails mascarados.
- Somente administradores podem revelar identificação individual, mediante ação auditada.
- CSVs contêm agregados e registros mascarados.
- Auditoria cobre usuários, sincronizações, mapeamentos, publicações, exportações e revelações de identidade.

## Arquitetura e implantação já decididas

- Base existente: Next.js 16.4.2, React 19.3, TypeScript e Tailwind CSS 4.
- Aplicação full-stack hospedada numa estação Windows já utilizada.
- Docker Compose e WSL2 já validados.
- SQLite persistente para usuários, configurações e cópia analítica.
- Acesso somente pela LAN através de IP fixo.
- HTTPS com certificado emitido por CA interna/local.
- Somente ambiente persistente de produção.
- Logs estruturados locais, histórico de jobs e tela administrativa de saúde.
- Componentes exclusivamente open source.
- Pacote manual para exportar e restaurar painéis, mapeamentos e configurações.

## Qualidade e aceite

- Interface clara, desktop-first, neutra e analítica.
- Chrome e Edge atuais, resolução mínima de 1366×768.
- Primeira carga de painel em até três segundos.
- Filtros e cross-filter em até dois segundos.
- Arrastar, soltar e redimensionar deve responder sem atraso perceptível e preservar o layout somente após salvar.
- O construtor deve impedir a inclusão enquanto houver erro de tipo, divisão inválida ou incompatibilidade de visualização.
- Exportações em até quinze segundos.
- Validação manual contra uma planilha de referência produzida com uma cópia integral anonimizada.
- Aceite funcional final realizado pelo responsável pelo projeto.

## ASSUMPTIONS

- Idioma da aplicação: português do Brasil.
- Datas e cálculos usam o fuso `America/Sao_Paulo`.
- A aplicação atende somente esta UPA e funciona como instalação de tenant único.
- IDs de página do Notion serão as chaves estáveis para chamados e relacionamentos; códigos visíveis ausentes não reduzem a cobertura dos indicadores.
- Não haverá envio de email, uploads de anexos, pagamentos, IA ou integrações externas além do Notion.
- PDF e imagens registrarão filtros aplicados, data da geração e data da última sincronização.
- O pacote manual de recuperação não incluirá senhas, sessões ou histórico completo de auditoria.
- A direção visual definitiva será refinada quando forem fornecidas referências.

## OPEN RISKS / unknowns

- A inclusão dos 47 indicadores e do construtor no mesmo v1 representa um escopo grande, mesmo sem prazo rígido.
- Métricas livres aumentam muito a superfície de testes. O avaliador precisará de testes unitários para tipagem, nulos, divisão por zero, cobertura, filtros e cruzamento entre bases.
- Fórmulas matematicamente válidas ainda podem ser semanticamente enganosas. Métricas oficiais devem ser identificadas, e métricas pessoais precisam mostrar fórmula, autor e cobertura.
- Sem limites de complexidade e tempo de execução, métricas personalizadas podem degradar a estação Windows compartilhada.
- Testes exclusivamente manuais deixam risco elevado de regressões silenciosas em métricas e filtros.
- Sem backup automático, falha do disco pode eliminar contas, auditoria e configurações que não estejam no último pacote manual.
- Não existe ambiente de homologação permanente.
- A estação compartilhada é ponto único de falha e suas especificações de hardware ainda não foram avaliadas.
- Renovação do certificado da CA e distribuição da confiança aos computadores clientes ainda precisam ser operacionalizadas.
- Acesso, token e IDs reais das bases do Notion ainda serão fornecidos.
- Alterações futuras no esquema ou na API do Notion podem interromper sincronizações.
- O processo técnico de anonimização da cópia integral ainda precisa ser definido e validado.
- A amostra do histórico é muito pequena para vários indicadores e possui somente 29 etapas encerradas.
- A atualização exclusivamente manual pode deixar painéis desatualizados.
- Referências visuais e identidade final ainda estão pendentes.
- Relatórios executivos externos são apenas uma preocupação de evolução futura; requisitos de distribuição, proteção e destinatários ainda não foram definidos.

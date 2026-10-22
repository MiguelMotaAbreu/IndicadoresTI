export type DashboardKey =
  | "overview"
  | "demand"
  | "pending"
  | "sla"
  | "movement"
  | "quality";

export type IndicatorDefinition = {
  name: string;
  dashboard: DashboardKey;
  visualization: string;
  description: string;
};

export const dashboardThemes = [
  {
    key: "overview" as DashboardKey,
    title: "Visão geral",
    shortTitle: "Visão geral",
    description: "Leitura rápida da operação de TI e seus principais sinais.",
    count: 8,
    accent: "green",
  },
  {
    key: "demand" as DashboardKey,
    title: "Demanda e perfil",
    shortTitle: "Demanda",
    description: "Volume, sazonalidade, motivos, setores e solicitantes.",
    count: 10,
    accent: "blue",
  },
  {
    key: "pending" as DashboardKey,
    title: "Pendências",
    shortTitle: "Pendências",
    description: "Fila atual, idade, composição e chamados sem responsável.",
    count: 7,
    accent: "amber",
  },
  {
    key: "sla" as DashboardKey,
    title: "Tempos e SLA",
    shortTitle: "Tempos e SLA",
    description: "Distribuições de tempo, percentis, cobertura e cumprimento.",
    count: 10,
    accent: "violet",
  },
  {
    key: "movement" as DashboardKey,
    title: "Movimentações",
    shortTitle: "Movimentações",
    description: "Eventos, retomadas, esperas e composição das etapas.",
    count: 8,
    accent: "cyan",
  },
  {
    key: "quality" as DashboardKey,
    title: "Qualidade dos dados",
    shortTitle: "Qualidade",
    description: "Cobertura, consistência e confiabilidade da base analítica.",
    count: 4,
    accent: "rose",
  },
];

export const indicators: IndicatorDefinition[] = [
  { name: "Total de chamados", dashboard: "overview", visualization: "Cartão numérico", description: "Quantidade registrada no total e por período." },
  { name: "Evolução da demanda", dashboard: "demand", visualization: "Linha temporal", description: "Aberturas por dia, semana e mês." },
  { name: "Variação da demanda entre períodos", dashboard: "demand", visualization: "Colunas divergentes", description: "Aumento ou redução percentual entre períodos equivalentes." },
  { name: "Média de chamados por dia", dashboard: "overview", visualization: "Cartão e linha", description: "Média considerando todos os dias do período." },
  { name: "Demanda por dia da semana e horário", dashboard: "demand", visualization: "Mapa de calor", description: "Distribuição por dia da semana e hora." },
  { name: "Chamados por motivo", dashboard: "demand", visualization: "Barras horizontais", description: "Quantidade e participação percentual por motivo." },
  { name: "Pareto dos motivos", dashboard: "demand", visualization: "Pareto", description: "Ranking dos motivos e percentual acumulado." },
  { name: "Chamados por categoria", dashboard: "demand", visualization: "Barras horizontais", description: "Participação de impressoras, computadores, SoulMV e rede." },
  { name: "Chamados por setor", dashboard: "demand", visualization: "Barras horizontais", description: "Quantidade, participação e ranking dos setores." },
  { name: "Problemas por setor", dashboard: "demand", visualization: "Mapa de calor", description: "Cruzamento entre setor, motivo e categoria." },
  { name: "Repetição de problemas por setor", dashboard: "demand", visualization: "Mapa de calor", description: "Frequência semanal do mesmo motivo por setor." },
  { name: "Chamados por solicitante", dashboard: "demand", visualization: "Barras horizontais", description: "Frequência por solicitante mascarado." },
  { name: "Distribuição por prioridade", dashboard: "overview", visualization: "Barras horizontais", description: "Quantidade e percentual por prioridade." },
  { name: "Participação das prioridades mais altas", dashboard: "overview", visualization: "Colunas empilhadas", description: "Percentual de críticos, muito altos e altos." },
  { name: "Distribuição por status", dashboard: "overview", visualization: "Barras horizontais", description: "Retrato atual dos chamados por situação." },
  { name: "Pendências atuais", dashboard: "pending", visualization: "Cartão e barras", description: "Chamados não iniciados, aguardando ou com fornecedor." },
  { name: "Idade das pendências", dashboard: "pending", visualization: "Barras por faixa", description: "Tempo desde a abertura dos chamados pendentes." },
  { name: "Composição das pendências", dashboard: "pending", visualization: "Barras empilhadas", description: "Pendências por setor, motivo, prioridade e responsável." },
  { name: "Proporção de chamados concluídos", dashboard: "overview", visualization: "Barra empilhada", description: "Concluídos sobre o total selecionado." },
  { name: "Conclusões por período", dashboard: "overview", visualization: "Colunas temporais", description: "Quantidade concluída por dia, semana ou mês." },
  { name: "Arquivamentos", dashboard: "pending", visualization: "Barras e linha", description: "Quantidade e percentual por setor, motivo e período." },
  { name: "Atendimentos classificados como fora de expediente", dashboard: "overview", visualization: "Cartão e colunas", description: "Quantidade e percentual classificados fora de expediente." },
  { name: "Distribuição por responsável", dashboard: "pending", visualization: "Barras horizontais", description: "Quantidade atribuída a cada profissional ou grupo." },
  { name: "Conclusões por responsável", dashboard: "pending", visualization: "Barras horizontais", description: "Concluídos atribuídos a cada profissional ou grupo." },
  { name: "Chamados sem responsável", dashboard: "pending", visualization: "Cartão e barras", description: "Quantidade e percentual sem atribuição." },
  { name: "Tempo até o primeiro atendimento", dashboard: "sla", visualization: "Histograma", description: "Média, mediana, P90 e faixas entre abertura e início." },
  { name: "Tempo total até a conclusão", dashboard: "sla", visualization: "Histograma", description: "Média, mediana e P90 entre abertura e conclusão." },
  { name: "Tempo entre início e conclusão", dashboard: "sla", visualization: "Histograma", description: "Distribuição do intervalo entre início e conclusão." },
  { name: "Tempos por setor, motivo, prioridade e responsável", dashboard: "sla", visualization: "Boxplot", description: "Comparação da distribuição de tempos entre grupos." },
  { name: "Distribuição das situações de SLA", dashboard: "sla", visualization: "Barras horizontais", description: "Quantidade e percentual por classificação exportada." },
  { name: "Cumprimento do SLA registrado", dashboard: "sla", visualization: "Barra empilhada", description: "Dentro do prazo sobre chamados avaliados." },
  { name: "Descumprimento do SLA registrado", dashboard: "sla", visualization: "Barras horizontais", description: "Excedidos por grupo com quantidade avaliada." },
  { name: "Cobertura da avaliação de SLA", dashboard: "sla", visualization: "Barra empilhada", description: "Percentual efetivamente classificado." },
  { name: "Chamados com agendamento", dashboard: "sla", visualization: "Cartão e barras", description: "Quantidade e percentual com horário planejado." },
  { name: "Pontualidade dos agendados", dashboard: "sla", visualization: "Barras divergentes", description: "Antecipação e atraso em relação ao horário planejado." },
  { name: "Movimentações dos chamados", dashboard: "movement", visualization: "Barras e linha do tempo", description: "Quantidade de eventos por tipo." },
  { name: "Retomadas de atendimento", dashboard: "movement", visualization: "Colunas", description: "Eventos de retomada e chamados distintos." },
  { name: "Encaminhamentos ao fornecedor", dashboard: "movement", visualization: "Colunas", description: "Eventos e chamados encaminhados." },
  { name: "Ocorrências de espera por informação", dashboard: "movement", visualization: "Barras", description: "Chamados que passaram pela etapa de espera." },
  { name: "Tempo em andamento", dashboard: "movement", visualization: "Barras horizontais", description: "Intervalos acumulados na etapa em andamento." },
  { name: "Tempo aguardando informação", dashboard: "movement", visualization: "Barras horizontais", description: "Intervalos acumulados aguardando informação." },
  { name: "Tempo com fornecedor", dashboard: "movement", visualization: "Barras horizontais", description: "Intervalos acumulados com fornecedor." },
  { name: "Composição do tempo de atendimento", dashboard: "movement", visualization: "Barras empilhadas", description: "Participação de cada etapa no tempo total." },
  { name: "Registros de movimentação por profissional", dashboard: "movement", visualization: "Barras empilhadas", description: "Eventos registrados por profissional e tipo." },
  { name: "Cobertura dos registros de tempo", dashboard: "quality", visualization: "Barras de cobertura", description: "Presença de início, conclusão e ambos." },
  { name: "Cobertura do histórico", dashboard: "quality", visualization: "Barra empilhada", description: "Chamados com e sem movimentações vinculadas." },
  { name: "Consistência dos registros", dashboard: "quality", visualization: "Barras e tabela", description: "Horários invertidos, divergências e etapas incompletas." },
];

export const demandSeries = [
  { label: "07 Jul", chamados: 16, concluidos: 9 },
  { label: "21 Jul", chamados: 42, concluidos: 35 },
  { label: "04 Ago", chamados: 55, concluidos: 48 },
  { label: "18 Ago", chamados: 48, concluidos: 44 },
  { label: "01 Set", chamados: 71, concluidos: 59 },
  { label: "15 Set", chamados: 64, concluidos: 58 },
  { label: "29 Set", chamados: 82, concluidos: 69 },
  { label: "13 Out", chamados: 74, concluidos: 61 },
  { label: "20 Out", chamados: 66, concluidos: 60 },
];

export const reasonData = [
  { name: "Impressora", value: 171, share: 33 },
  { name: "Computador", value: 112, share: 22 },
  { name: "SoulMV", value: 57, share: 11 },
  { name: "Rede", value: 46, share: 9 },
  { name: "Outros", value: 132, share: 25 },
];

export const statusData = [
  { name: "Concluído", value: 443, color: "#16704a" },
  { name: "Arquivado", value: 68, color: "#87a99a" },
  { name: "Aguardando", value: 3, color: "#e5a746" },
  { name: "Fornecedor", value: 1, color: "#6d6fb4" },
  { name: "Não iniciado", value: 1, color: "#d67171" },
];

export const priorityData = [
  { name: "Crítico", value: 50, color: "#a92f3c" },
  { name: "Muito alta", value: 83, color: "#df6049" },
  { name: "Alta", value: 88, color: "#e6a943" },
  { name: "Média", value: 189, color: "#2f8a61" },
  { name: "Baixa", value: 67, color: "#83a895" },
  { name: "Planejado", value: 33, color: "#6689b4" },
  { name: "Não definido", value: 8, color: "#b9bcb8" },
];

export const heatmap = [
  [1, 2, 3, 3, 2, 1, 0, 1],
  [2, 4, 7, 6, 5, 4, 2, 2],
  [1, 5, 8, 9, 6, 5, 3, 1],
  [2, 6, 9, 8, 8, 4, 2, 2],
  [2, 4, 8, 7, 5, 3, 2, 1],
  [1, 2, 3, 4, 3, 2, 1, 1],
  [0, 1, 2, 2, 1, 1, 0, 0],
];

export type DataField = {
  id: string;
  label: string;
  source: "Chamados" | "Histórico";
  type: "número" | "categoria" | "data" | "duração" | "booleano";
  description: string;
};

export const dataFields: DataField[] = [
  { id: "ticket-count", label: "Quantidade de chamados", source: "Chamados", type: "número", description: "Uma unidade por chamado válido." },
  { id: "opened-at", label: "Data de abertura", source: "Chamados", type: "data", description: "Data e hora em que o chamado foi registrado." },
  { id: "started-at", label: "Data de início", source: "Chamados", type: "data", description: "Primeiro início de atendimento registrado." },
  { id: "closed-at", label: "Data de conclusão", source: "Chamados", type: "data", description: "Data e hora de conclusão preenchida." },
  { id: "first-response", label: "Tempo até o primeiro atendimento", source: "Chamados", type: "duração", description: "Diferença entre abertura e início." },
  { id: "resolution-time", label: "Tempo total até a conclusão", source: "Chamados", type: "duração", description: "Diferença entre abertura e conclusão." },
  { id: "priority", label: "Prioridade", source: "Chamados", type: "categoria", description: "Criticidade registrada no Notion." },
  { id: "status", label: "Status", source: "Chamados", type: "categoria", description: "Situação atual do chamado." },
  { id: "sector", label: "Setor solicitante", source: "Chamados", type: "categoria", description: "Setor de origem da solicitação." },
  { id: "reason", label: "Motivo", source: "Chamados", type: "categoria", description: "Motivo informado no chamado." },
  { id: "category", label: "Categoria mapeada", source: "Chamados", type: "categoria", description: "Categoria derivada do motivo." },
  { id: "assignee", label: "Responsável", source: "Chamados", type: "categoria", description: "Profissional ou grupo atribuído." },
  { id: "sla-result", label: "Situação de SLA", source: "Chamados", type: "categoria", description: "Classificação de SLA recebida do Notion." },
  { id: "scheduled", label: "Possui agendamento", source: "Chamados", type: "booleano", description: "Indica data e hora planejadas." },
  { id: "event-count", label: "Quantidade de movimentações", source: "Histórico", type: "número", description: "Uma unidade por evento válido." },
  { id: "event-date", label: "Data da movimentação", source: "Histórico", type: "data", description: "Data e hora do evento." },
  { id: "event-type", label: "Tipo da movimentação", source: "Histórico", type: "categoria", description: "Início, conclusão, espera, retomada ou fornecedor." },
  { id: "stage-duration", label: "Tempo na etapa", source: "Histórico", type: "duração", description: "Duração calculada entre eventos coerentes." },
  { id: "registered-by", label: "Registrado por", source: "Histórico", type: "categoria", description: "Profissional que registrou a movimentação." },
];

export const pendingAgeData = [
  { name: "Até 1 dia", value: 1 },
  { name: "1–3 dias", value: 2 },
  { name: "4–7 dias", value: 1 },
  { name: "8–15 dias", value: 0 },
  { name: "Mais de 15", value: 1 },
];

export const pendingCompositionData = [
  { name: "Recepção", critica: 0, alta: 1, media: 1 },
  { name: "Farmácia", critica: 1, alta: 0, media: 0 },
  { name: "Administrativo", critica: 0, alta: 1, media: 0 },
  { name: "Consultório 03", critica: 0, alta: 0, media: 1 },
];

export const oldestPending = [
  { id: "#0499", reason: "Rede · Internet", sector: "Administrativo", age: "18d 4h" },
  { id: "#0506", reason: "SoulMV · Suporte", sector: "Farmácia", age: "6d 9h" },
  { id: "#0514", reason: "Impressora · Toner", sector: "Recepção", age: "2d 7h" },
];

export const responseHistogram = [
  { name: "0–15 min", value: 96 },
  { name: "15–30", value: 58 },
  { name: "30–60", value: 42 },
  { name: "1–4 h", value: 21 },
  { name: "4–8 h", value: 6 },
  { name: "> 8 h", value: 3 },
];

export const slaByPriority = [
  { name: "Crítico", dentro: 37, fora: 8 },
  { name: "Muito alta", dentro: 61, fora: 7 },
  { name: "Alta", dentro: 72, fora: 6 },
  { name: "Média", dentro: 41, fora: 4 },
];

export const timeComparisonData = [
  { name: "Crítico", mediana: 18, p90: 94 },
  { name: "Muito alta", mediana: 31, p90: 122 },
  { name: "Alta", mediana: 44, p90: 188 },
  { name: "Média", mediana: 72, p90: 260 },
];

export const movementTypeData = [
  { name: "Inícios", value: 24 },
  { name: "Conclusões", value: 21 },
  { name: "Esperas", value: 11 },
  { name: "Retomadas", value: 6 },
  { name: "Fornecedor", value: 5 },
  { name: "Arquivamentos", value: 5 },
];

export const stageCompositionData = [
  { name: "#0518", andamento: 105, informacao: 18, fornecedor: 0 },
  { name: "#0512", andamento: 82, informacao: 44, fornecedor: 0 },
  { name: "#0506", andamento: 46, informacao: 170, fornecedor: 0 },
  { name: "#0499", andamento: 38, informacao: 0, fornecedor: 260 },
];

export const movementTimeline = [
  { time: "14:32", event: "Conclusão registrada", ticket: "#0518", author: "Miguel M." },
  { time: "13:48", event: "Atendimento retomado", ticket: "#0506", author: "Ana P." },
  { time: "11:20", event: "Encaminhado ao fornecedor", ticket: "#0499", author: "Miguel M." },
  { time: "09:06", event: "Aguardando informação", ticket: "#0514", author: "Bruno S." },
];

export const coverageData = [
  { name: "Data de início", value: 54.1 },
  { name: "Data de conclusão", value: 51.0 },
  { name: "Início + conclusão", value: 50.4 },
  { name: "Histórico vinculado", value: 7.1 },
  { name: "SLA avaliado", value: 43.6 },
];

export const inconsistencyData = [
  { name: "Etapa sem encerramento", value: 5 },
  { name: "Conclusão sem início", value: 3 },
  { name: "Horário invertido", value: 2 },
  { name: "Status divergente", value: 2 },
];

export const ticketRows = [
  { id: "#0518", requester: "M••••• M•••", sector: "Recepção", reason: "Impressora - Suporte", priority: "Alta", status: "Concluído" },
  { id: "#0512", requester: "C••••• F•••••", sector: "Consultório 03", reason: "Computador - Suporte", priority: "Média", status: "Concluído" },
  { id: "#0506", requester: "T•••• S••••", sector: "Farmácia", reason: "SoulMV - Suporte", priority: "Muito alta", status: "Aguardando Info" },
  { id: "#0499", requester: "J•••••• O••••••", sector: "Administrativo", reason: "Rede - Internet", priority: "Crítico", status: "Fornecedor" },
  { id: "#0487", requester: "F•••• N•••••", sector: "Sala de Medicação", reason: "Impressora - Inoperante", priority: "Alta", status: "Concluído" },
];

export const auditEvents = [
  { title: "Sincronização concluída", detail: "518 chamados e 72 eventos validados", time: "Hoje, 14:32", tone: "success" },
  { title: "Painel publicado", detail: "Visão geral · versão 8", time: "Ontem, 17:18", tone: "neutral" },
  { title: "Mapeamento atualizado", detail: "Motivo “Pasta Compartilhada” → Infraestrutura", time: "19 out, 10:04", tone: "neutral" },
];

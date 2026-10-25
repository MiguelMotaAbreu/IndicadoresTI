import type { NotionSourceKey, NotionSourceSchema } from "./notion-client";

export type NotionMappingFieldKey =
  | "ticket.externalCode"
  | "ticket.openedAt"
  | "ticket.startedAt"
  | "ticket.completedAt"
  | "ticket.plannedAt"
  | "ticket.requester"
  | "ticket.requesterEmail"
  | "ticket.reason"
  | "ticket.priority"
  | "ticket.assignees"
  | "ticket.sector"
  | "ticket.slaStatus"
  | "ticket.status"
  | "ticket.outsideHours"
  | "history.eventType"
  | "history.ticketRelation"
  | "history.occurredAt"
  | "history.stageStartedAt"
  | "history.stageEndedAt"
  | "history.businessMinutes"
  | "history.recordedBy";

export type NotionMappingField = {
  key: NotionMappingFieldKey;
  source: NotionSourceKey;
  label: string;
  description: string;
  required: boolean;
  acceptedTypes: readonly string[];
  aliases: readonly string[];
};

export const notionMappingFields: readonly NotionMappingField[] = [
  { key: "ticket.externalCode", source: "tickets", label: "Código visível do chamado", description: "Referência curta opcional; registros sem código continuam identificados pelo page.id do Notion.", required: false, acceptedTypes: ["unique_id", "rich_text", "title", "formula"], aliases: ["Chamados T.I UPA ZONA LESTE", "Chamado", "Código", "ID"] },
  { key: "ticket.openedAt", source: "tickets", label: "Data e hora de abertura", description: "Base temporal da demanda; fórmulas serão validadas registro a registro na importação.", required: true, acceptedTypes: ["date", "created_time", "formula"], aliases: ["Data - Abertura", "Abertura", "Data de abertura"] },
  { key: "ticket.startedAt", source: "tickets", label: "Início do atendimento", description: "Permite calcular o tempo até o primeiro atendimento.", required: false, acceptedTypes: ["date", "formula"], aliases: ["Data - Em Atendimento", "Início do atendimento"] },
  { key: "ticket.completedAt", source: "tickets", label: "Conclusão", description: "Permite calcular conclusões e tempo total.", required: false, acceptedTypes: ["date", "formula"], aliases: ["Data - Concluído", "Conclusão", "Data de conclusão"] },
  { key: "ticket.plannedAt", source: "tickets", label: "Atendimento planejado", description: "Usado nos indicadores de agendamento e pontualidade.", required: false, acceptedTypes: ["date", "formula"], aliases: ["Data - Atendimento Planejado", "Atendimento planejado"] },
  { key: "ticket.requester", source: "tickets", label: "Solicitante", description: "Pode ser a propriedade title; será mascarado para Analistas e nunca será usado como chave.", required: false, acceptedTypes: ["people", "rich_text", "title"], aliases: ["Solicitante"] },
  { key: "ticket.requesterEmail", source: "tickets", label: "Email do solicitante", description: "Identificação sensível usada somente com as regras de privacidade.", required: false, acceptedTypes: ["email", "rich_text", "formula"], aliases: ["Email", "E-mail"] },
  { key: "ticket.reason", source: "tickets", label: "Motivo do chamado", description: "Dimensão usada em rankings, Pareto e categorias derivadas.", required: true, acceptedTypes: ["select", "multi_select", "relation", "rich_text", "formula"], aliases: ["Motivo do Chamado", "Motivo"] },
  { key: "ticket.priority", source: "tickets", label: "Prioridade", description: "Classificação de criticidade registrada.", required: true, acceptedTypes: ["select", "status", "formula"], aliases: ["Prioridade"] },
  { key: "ticket.assignees", source: "tickets", label: "Responsável", description: "Pessoas atribuídas; múltiplos responsáveis formarão um grupo compartilhado.", required: false, acceptedTypes: ["people"], aliases: ["Responsável", "Responsáveis"] },
  { key: "ticket.sector", source: "tickets", label: "Setor solicitante", description: "Dimensão organizacional para demanda e pendências.", required: true, acceptedTypes: ["select", "multi_select", "relation", "rich_text", "formula"], aliases: ["Setor", "Setor solicitante"] },
  { key: "ticket.slaStatus", source: "tickets", label: "Situação do SLA", description: "Classificação de SLA produzida pelo Notion.", required: false, acceptedTypes: ["select", "status", "formula"], aliases: ["Situação do SLA", "SLA"] },
  { key: "ticket.status", source: "tickets", label: "Status atual", description: "Define conclusão, pendência e composição da fila atual.", required: true, acceptedTypes: ["status", "select", "formula"], aliases: ["Status", "Situação"] },
  { key: "ticket.outsideHours", source: "tickets", label: "Fora de expediente", description: "Classificação registrada para atendimentos fora do expediente.", required: false, acceptedTypes: ["checkbox", "formula", "select", "status"], aliases: ["Atendido fora de expediente", "Fora de expediente"] },
  { key: "history.eventType", source: "history", label: "Tipo do evento", description: "Início, conclusão, espera, fornecedor, retomada ou arquivamento.", required: true, acceptedTypes: ["title", "select", "status"], aliases: ["Evento", "Tipo de evento"] },
  { key: "history.ticketRelation", source: "history", label: "Chamado relacionado", description: "Relação estável entre a movimentação e o chamado.", required: true, acceptedTypes: ["relation"], aliases: ["Chamado", "Chamado relacionado"] },
  { key: "history.occurredAt", source: "history", label: "Data e hora do evento", description: "Ordena a linha do tempo e delimita cada etapa.", required: true, acceptedTypes: ["date", "created_time", "formula"], aliases: ["Data e hora", "Data do evento"] },
  { key: "history.stageStartedAt", source: "history", label: "Início da etapa", description: "Início explícito de um intervalo do histórico.", required: false, acceptedTypes: ["date", "formula"], aliases: ["Etapa iniciada", "Início da etapa"] },
  { key: "history.stageEndedAt", source: "history", label: "Fim da etapa", description: "Fim explícito de um intervalo do histórico.", required: false, acceptedTypes: ["date", "formula"], aliases: ["Fim da etapa"] },
  { key: "history.businessMinutes", source: "history", label: "Minutos em expediente", description: "Duração útil calculada pelo Notion quando disponível.", required: false, acceptedTypes: ["number", "formula", "rollup"], aliases: ["Minutos em expediente"] },
  { key: "history.recordedBy", source: "history", label: "Registrado por", description: "Profissional que registrou a movimentação.", required: false, acceptedTypes: ["people", "created_by"], aliases: ["Registrado por"] },
] as const;

export type ValidatedNotionMapping = {
  fieldKey: NotionMappingFieldKey;
  source: NotionSourceKey;
  propertyId: string;
  propertyName: string;
  propertyType: string;
};

export type NotionMappingIssue = {
  code: "invalid_payload" | "unknown_field" | "required_field" | "property_not_found" | "incompatible_type" | "duplicate_property";
  fieldKey: string | null;
  message: string;
};

export class NotionMappingError extends Error {
  readonly issues: NotionMappingIssue[];

  constructor(issues: NotionMappingIssue[]) {
    super("O mapeamento contém campos ausentes ou incompatíveis.");
    this.name = "NotionMappingError";
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateNotionMapping(
  input: unknown,
  schemas: readonly NotionSourceSchema[],
): ValidatedNotionMapping[] {
  if (!isRecord(input)) {
    throw new NotionMappingError([{ code: "invalid_payload", fieldKey: null, message: "Informe um objeto de mapeamentos." }]);
  }

  const definitions = new Map(notionMappingFields.map((field) => [field.key, field]));
  const issues: NotionMappingIssue[] = [];
  const selected = new Set<string>();
  const validated: ValidatedNotionMapping[] = [];

  for (const key of Object.keys(input)) {
    if (!definitions.has(key as NotionMappingFieldKey)) {
      issues.push({ code: "unknown_field", fieldKey: key, message: `O campo interno “${key}” não é reconhecido.` });
    }
  }

  for (const field of notionMappingFields) {
    const rawName = input[field.key];
    const propertyName = typeof rawName === "string" ? rawName.trim() : "";
    if (!propertyName) {
      if (field.required) {
        issues.push({ code: "required_field", fieldKey: field.key, message: `Selecione uma propriedade para “${field.label}”.` });
      }
      continue;
    }

    const schema = schemas.find((candidate) => candidate.key === field.source);
    const property = schema?.properties.find((candidate) => candidate.name === propertyName);
    if (!property) {
      issues.push({ code: "property_not_found", fieldKey: field.key, message: `A propriedade selecionada para “${field.label}” não existe mais na fonte.` });
      continue;
    }
    if (!field.acceptedTypes.includes(property.type)) {
      issues.push({ code: "incompatible_type", fieldKey: field.key, message: `“${field.label}” não aceita propriedades do tipo ${property.type}.` });
      continue;
    }

    const selectionKey = `${field.source}:${property.id}`;
    if (selected.has(selectionKey)) {
      issues.push({ code: "duplicate_property", fieldKey: field.key, message: `A propriedade “${property.name}” já foi usada em outro campo interno.` });
      continue;
    }
    selected.add(selectionKey);
    validated.push({
      fieldKey: field.key,
      source: field.source,
      propertyId: property.id,
      propertyName: property.name,
      propertyType: property.type,
    });
  }

  if (issues.length > 0) throw new NotionMappingError(issues);
  return validated;
}

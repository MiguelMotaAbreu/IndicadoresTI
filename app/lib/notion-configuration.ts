import "server-only";

import type { NotionConnectionConfiguration } from "./notion-client";

type Environment = Record<string, string | undefined>;

export type NotionConfigurationStatus = {
  ready: boolean;
  configuredSources: number;
  totalSources: number;
  missing: string[];
};

export function inspectNotionConfiguration(environment: Environment = process.env): NotionConfigurationStatus {
  const hasToken = Boolean(environment.PULSETI_NOTION_TOKEN?.trim());
  const sources = [
    { value: environment.PULSETI_NOTION_TICKETS_DATABASE_ID, label: "base de chamados" },
    { value: environment.PULSETI_NOTION_HISTORY_DATABASE_ID, label: "base de histórico" },
  ];
  const configuredSources = sources.filter((source) => Boolean(source.value?.trim())).length;
  const missing = [
    ...(!hasToken ? ["token da integração"] : []),
    ...sources.filter((source) => !source.value?.trim()).map((source) => source.label),
  ];

  return {
    ready: hasToken && configuredSources === sources.length,
    configuredSources,
    totalSources: sources.length,
    missing,
  };
}

export function loadNotionConfiguration(
  environment: Environment = process.env,
): NotionConnectionConfiguration | null {
  const token = environment.PULSETI_NOTION_TOKEN?.trim() ?? "";
  const ticketsDatabaseId = environment.PULSETI_NOTION_TICKETS_DATABASE_ID?.trim() ?? "";
  const historyDatabaseId = environment.PULSETI_NOTION_HISTORY_DATABASE_ID?.trim() ?? "";

  if (!token || !ticketsDatabaseId || !historyDatabaseId) return null;
  return { token, ticketsDatabaseId, historyDatabaseId };
}

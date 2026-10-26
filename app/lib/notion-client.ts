export const NOTION_API_VERSION = "2026-03-11";

export type NotionSourceKey = "tickets" | "history";

export type NotionConnectionConfiguration = {
  token: string;
  ticketsDatabaseId: string;
  historyDatabaseId: string;
};

export type NotionPropertyDiagnostic = {
  name: string;
  type: string;
};

export type NotionPropertySchema = NotionPropertyDiagnostic & {
  id: string;
};

export type NotionSourceSchema = {
  key: NotionSourceKey;
  label: string;
  name: string;
  dataSourceId: string;
  properties: NotionPropertySchema[];
};

export type NotionSourceDiagnostic = {
  key: NotionSourceKey;
  label: string;
  name: string;
  propertyCount: number;
  properties: NotionPropertyDiagnostic[];
};

export type NotionConnectionDiagnostic = {
  checkedAt: string;
  apiVersion: typeof NOTION_API_VERSION;
  sources: NotionSourceDiagnostic[];
};

export type NotionPageRecord = {
  id: string;
  properties: Record<string, unknown>;
};

export type NotionQueryResult = {
  pages: NotionPageRecord[];
  requestCount: number;
};

export type NotionClientErrorCode =
  | "configuration_missing"
  | "unauthorized"
  | "forbidden"
  | "source_not_found"
  | "rate_limited"
  | "multiple_data_sources"
  | "query_limit_reached"
  | "invalid_response"
  | "unavailable";

const SAFE_ERROR_MESSAGES: Record<NotionClientErrorCode, string> = {
  configuration_missing: "A integração com o Notion ainda não está completamente configurada.",
  unauthorized: "O Notion rejeitou a credencial configurada.",
  forbidden: "A integração não possui acesso a uma das bases configuradas.",
  source_not_found: "Uma das bases configuradas não foi encontrada ou não foi compartilhada com a integração.",
  rate_limited: "O Notion limitou temporariamente as consultas. Tente novamente em alguns instantes.",
  multiple_data_sources: "Uma base configurada possui mais de uma fonte de dados. Informe uma fonte específica antes de sincronizar.",
  query_limit_reached: "A consulta atingiu o limite de 10.000 registros do Notion e não pode ser considerada completa.",
  invalid_response: "O Notion respondeu em um formato que a aplicação não reconhece.",
  unavailable: "Não foi possível contatar o Notion neste momento.",
};

export class NotionClientError extends Error {
  readonly code: NotionClientErrorCode;

  constructor(code: NotionClientErrorCode) {
    super(SAFE_ERROR_MESSAGES[code]);
    this.name = "NotionClientError";
    this.code = code;
  }
}

type FetchImplementation = typeof fetch;

type NotionClientOptions = {
  fetchImplementation?: FetchImplementation;
  timeoutMs?: number;
  baseUrl?: string;
  now?: () => Date;
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeRequired(value: string): string {
  return value.trim();
}

function errorForStatus(status: number): NotionClientError {
  if (status === 401) return new NotionClientError("unauthorized");
  if (status === 403) return new NotionClientError("forbidden");
  if (status === 404) return new NotionClientError("source_not_found");
  if (status === 429) return new NotionClientError("rate_limited");
  if (status >= 500) return new NotionClientError("unavailable");
  return new NotionClientError("invalid_response");
}

function readDatabase(value: unknown): { name: string; dataSourceId: string } {
  if (!isRecord(value) || value.object !== "database" || !Array.isArray(value.data_sources)) {
    throw new NotionClientError("invalid_response");
  }
  if (value.data_sources.length > 1) throw new NotionClientError("multiple_data_sources");
  const dataSource = value.data_sources[0];
  if (!isRecord(dataSource) || typeof dataSource.id !== "string" || !dataSource.id.trim()) {
    throw new NotionClientError("invalid_response");
  }
  return {
    name: typeof dataSource.name === "string" && dataSource.name.trim() ? dataSource.name.trim() : "Fonte sem nome",
    dataSourceId: dataSource.id,
  };
}

function readDataSource(value: unknown): NotionPropertySchema[] {
  if (!isRecord(value) || value.object !== "data_source" || !isRecord(value.properties)) {
    throw new NotionClientError("invalid_response");
  }

  return Object.entries(value.properties)
    .map(([fallbackName, property]) => {
      if (
        !isRecord(property)
        || typeof property.id !== "string"
        || !property.id.trim()
        || typeof property.type !== "string"
        || !property.type.trim()
      ) {
        throw new NotionClientError("invalid_response");
      }
      return {
        id: property.id.trim(),
        name: typeof property.name === "string" && property.name.trim() ? property.name.trim() : fallbackName,
        type: property.type.trim(),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
}

type NotionQueryPage = {
  pages: NotionPageRecord[];
  hasMore: boolean;
  nextCursor: string | null;
};

function readQueryPage(value: unknown): NotionQueryPage {
  if (
    !isRecord(value)
    || value.object !== "list"
    || !Array.isArray(value.results)
    || typeof value.has_more !== "boolean"
    || !(value.next_cursor === null || typeof value.next_cursor === "string")
  ) {
    throw new NotionClientError("invalid_response");
  }

  if (
    isRecord(value.request_status)
    && value.request_status.type === "incomplete"
    && value.request_status.incomplete_reason === "query_result_limit_reached"
  ) {
    throw new NotionClientError("query_limit_reached");
  }

  const pages = value.results.map((result) => {
    if (
      !isRecord(result)
      || result.object !== "page"
      || typeof result.id !== "string"
      || !result.id.trim()
      || !isRecord(result.properties)
    ) {
      throw new NotionClientError("invalid_response");
    }
    return { id: result.id.trim(), properties: result.properties };
  });

  const nextCursor = typeof value.next_cursor === "string" && value.next_cursor.trim()
    ? value.next_cursor.trim()
    : null;
  if (value.has_more && !nextCursor) throw new NotionClientError("invalid_response");

  return { pages, hasMore: value.has_more, nextCursor };
}

export class NotionReadClient {
  private readonly configuration: NotionConnectionConfiguration;
  private readonly fetchImplementation: FetchImplementation;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;
  private readonly now: () => Date;

  constructor(configuration: NotionConnectionConfiguration, options: NotionClientOptions = {}) {
    this.configuration = {
      token: normalizeRequired(configuration.token),
      ticketsDatabaseId: normalizeRequired(configuration.ticketsDatabaseId),
      historyDatabaseId: normalizeRequired(configuration.historyDatabaseId),
    };
    if (!this.configuration.token || !this.configuration.ticketsDatabaseId || !this.configuration.historyDatabaseId) {
      throw new NotionClientError("configuration_missing");
    }
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.baseUrl = (options.baseUrl ?? "https://api.notion.com/v1").replace(/\/$/, "");
    this.now = options.now ?? (() => new Date());
  }

  private async request(path: string, body?: Record<string, unknown>): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImplementation(`${this.baseUrl}${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.configuration.token}`,
          "Notion-Version": NOTION_API_VERSION,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        cache: "no-store",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error instanceof NotionClientError) throw error;
      throw new NotionClientError("unavailable");
    }

    if (!response.ok) throw errorForStatus(response.status);
    try {
      return await response.json();
    } catch {
      throw new NotionClientError("invalid_response");
    }
  }

  private async inspectSource(
    key: NotionSourceKey,
    label: string,
    databaseId: string,
  ): Promise<NotionSourceSchema> {
    const database = readDatabase(await this.request(`/databases/${encodeURIComponent(databaseId)}`));
    const properties = readDataSource(await this.request(`/data_sources/${encodeURIComponent(database.dataSourceId)}`));
    return {
      key,
      label,
      name: database.name,
      dataSourceId: database.dataSourceId,
      properties,
    };
  }

  async loadSchema(): Promise<NotionSourceSchema[]> {
    return Promise.all([
      this.inspectSource("tickets", "Base de chamados", this.configuration.ticketsDatabaseId),
      this.inspectSource("history", "Base de histórico", this.configuration.historyDatabaseId),
    ]);
  }

  async testConnection(): Promise<NotionConnectionDiagnostic> {
    const schemas = await this.loadSchema();
    const sources = schemas.map((source) => ({
      key: source.key,
      label: source.label,
      name: source.name,
      propertyCount: source.properties.length,
      properties: source.properties.map(({ name, type }) => ({ name, type })),
    }));
    return {
      checkedAt: this.now().toISOString(),
      apiVersion: NOTION_API_VERSION,
      sources,
    };
  }

  async queryDataSource(
    dataSourceId: string,
    propertyIds: readonly string[],
  ): Promise<NotionQueryResult> {
    const normalizedDataSourceId = dataSourceId.trim();
    const normalizedPropertyIds = [...new Set(propertyIds.map((id) => id.trim()).filter(Boolean))];
    if (!normalizedDataSourceId || normalizedPropertyIds.length === 0) {
      throw new NotionClientError("invalid_response");
    }
    if (normalizedPropertyIds.some((id) => /[&#?\s]/.test(id))) {
      throw new NotionClientError("invalid_response");
    }

    const filterQuery = normalizedPropertyIds
      .map((id) => `filter_properties[]=${id}`)
      .join("&");
    const path = `/data_sources/${encodeURIComponent(normalizedDataSourceId)}/query?${filterQuery}`;
    const pages: NotionPageRecord[] = [];
    const seenCursors = new Set<string>();
    let nextCursor: string | null = null;
    let requestCount = 0;

    do {
      const response = readQueryPage(await this.request(path, {
        page_size: 100,
        result_type: "page",
        is_archived: false,
        ...(nextCursor ? { start_cursor: nextCursor } : {}),
      }));
      requestCount += 1;
      pages.push(...response.pages);
      if (!response.hasMore) break;
      if (!response.nextCursor || seenCursors.has(response.nextCursor)) {
        throw new NotionClientError("invalid_response");
      }
      seenCursors.add(response.nextCursor);
      nextCursor = response.nextCursor;
    } while (pages.length <= 10_000);

    if (pages.length > 10_000) throw new NotionClientError("query_limit_reached");
    return { pages, requestCount };
  }
}

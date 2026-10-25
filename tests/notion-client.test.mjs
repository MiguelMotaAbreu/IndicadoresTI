import test from "node:test";
import assert from "node:assert/strict";

import {
  NOTION_API_VERSION,
  NotionClientError,
  NotionReadClient,
} from "../app/lib/notion-client.ts";

const configuration = {
  token: "fake-notion-token-for-tests",
  ticketsDatabaseId: "tickets-database",
  historyDatabaseId: "history-database",
};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("valida as duas bases e retorna somente o diagnóstico sanitizado", async () => {
  const requests = [];
  const fetchImplementation = async (url, init) => {
    requests.push({ url: String(url), init });
    if (String(url).endsWith("/databases/tickets-database")) {
      return jsonResponse({ object: "database", data_sources: [{ id: "tickets-source", name: "Chamados TI" }] });
    }
    if (String(url).endsWith("/databases/history-database")) {
      return jsonResponse({ object: "database", data_sources: [{ id: "history-source", name: "Histórico TI" }] });
    }
    if (String(url).endsWith("/data_sources/tickets-source")) {
      return jsonResponse({
        object: "data_source",
        properties: {
          title: { id: "title-property", name: "Chamado", type: "title" },
          opened: { id: "opened-property", name: "Abertura", type: "date" },
        },
      });
    }
    if (String(url).endsWith("/data_sources/history-source")) {
      return jsonResponse({
        object: "data_source",
        properties: { event: { id: "event-property", name: "Movimentação", type: "select" } },
      });
    }
    return jsonResponse({}, 404);
  };

  const diagnostic = await new NotionReadClient(configuration, {
    fetchImplementation,
    now: () => new Date("2026-10-25T15:00:00.000Z"),
  }).testConnection();

  assert.equal(diagnostic.apiVersion, NOTION_API_VERSION);
  assert.equal(diagnostic.checkedAt, "2026-10-25T15:00:00.000Z");
  assert.deepEqual(diagnostic.sources, [
    {
      key: "tickets",
      label: "Base de chamados",
      name: "Chamados TI",
      propertyCount: 2,
      properties: [
        { name: "Abertura", type: "date" },
        { name: "Chamado", type: "title" },
      ],
    },
    {
      key: "history",
      label: "Base de histórico",
      name: "Histórico TI",
      propertyCount: 1,
      properties: [{ name: "Movimentação", type: "select" }],
    },
  ]);
  assert.equal(requests.length, 4);
  for (const request of requests) {
    assert.equal(request.init.method, "GET");
    assert.equal(request.init.headers.Authorization, `Bearer ${configuration.token}`);
    assert.equal(request.init.headers["Notion-Version"], NOTION_API_VERSION);
    assert.equal(request.init.cache, "no-store");
  }
  assert.equal(JSON.stringify(diagnostic).includes(configuration.token), false);
  assert.equal(JSON.stringify(diagnostic).includes("tickets-database"), false);
  assert.equal(JSON.stringify(diagnostic).includes("tickets-source"), false);
  assert.equal(JSON.stringify(diagnostic).includes("title-property"), false);
});

test("traduz rejeição de credencial sem repassar a resposta remota", async () => {
  const client = new NotionReadClient(configuration, {
    fetchImplementation: async () => jsonResponse({ message: "raw upstream secret detail" }, 401),
  });

  await assert.rejects(
    () => client.testConnection(),
    (error) => {
      assert.equal(error instanceof NotionClientError, true);
      assert.equal(error.code, "unauthorized");
      assert.equal(error.message, "O Notion rejeitou a credencial configurada.");
      assert.equal(error.message.includes("raw upstream"), false);
      assert.equal(error.message.includes(configuration.token), false);
      return true;
    },
  );
});

test("recusa bases com múltiplas fontes para evitar mapear o esquema errado", async () => {
  const client = new NotionReadClient(configuration, {
    fetchImplementation: async (url) => {
      if (String(url).includes("/databases/")) {
        return jsonResponse({
          object: "database",
          data_sources: [
            { id: "source-one", name: "Fonte um" },
            { id: "source-two", name: "Fonte dois" },
          ],
        });
      }
      return jsonResponse({}, 404);
    },
  });

  await assert.rejects(
    () => client.testConnection(),
    (error) => error instanceof NotionClientError && error.code === "multiple_data_sources",
  );
});

test("classifica falhas de rede como indisponibilidade segura", async () => {
  const client = new NotionReadClient(configuration, {
    fetchImplementation: async () => { throw new Error("getaddrinfo ENOTFOUND com detalhes internos"); },
  });

  await assert.rejects(
    () => client.testConnection(),
    (error) => {
      assert.equal(error instanceof NotionClientError, true);
      assert.equal(error.code, "unavailable");
      assert.equal(error.message.includes("ENOTFOUND"), false);
      return true;
    },
  );
});

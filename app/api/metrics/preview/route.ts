import { dataFields } from "@/app/mock-data";
import {
  isMetricDefinitionDraft,
  previewMetricDefinition,
  validateMetricDefinition,
} from "@/app/lib/metrics";

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { ok: false, errors: [{ code: "json_inválido", message: "O corpo da requisição deve ser um JSON válido.", path: "request" }] },
      { status: 400 },
    );
  }

  if (!isMetricDefinitionDraft(payload)) {
    return Response.json(
      { ok: false, errors: [{ code: "definição_inválida", message: "A definição da métrica está incompleta ou malformada.", path: "request" }] },
      { status: 400 },
    );
  }

  const validation = validateMetricDefinition(payload, dataFields);
  if (!validation.valid) {
    return Response.json({ ok: false, errors: validation.errors, warnings: validation.warnings }, { status: 422 });
  }

  try {
    return Response.json({ ok: true, preview: previewMetricDefinition(payload, dataFields) });
  } catch {
    return Response.json(
      { ok: false, errors: [{ code: "não_calculável", message: "O resultado não pôde ser calculado com segurança.", path: "expression" }] },
      { status: 422 },
    );
  }
}

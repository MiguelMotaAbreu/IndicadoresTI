export type MetricSource = "Chamados" | "Histórico";
export type MetricFieldType = "número" | "categoria" | "data" | "duração" | "booleano";
export type MetricValueType = "número" | "duração";
export type AggregationOperation =
  | "contagem"
  | "contagem_distinta"
  | "soma"
  | "média"
  | "mediana"
  | "percentil"
  | "mínimo"
  | "máximo";
export type BinaryOperation = "somar" | "subtrair" | "multiplicar" | "dividir";
export type MetricVisualization =
  | "Cartão numérico"
  | "Barras horizontais"
  | "Colunas"
  | "Linha temporal"
  | "Barra 100% empilhada";

export type MetricField = {
  id: string;
  label: string;
  source: MetricSource;
  type: MetricFieldType;
};

export type FieldNode = { kind: "campo"; fieldId: string };
export type AggregationNode = {
  kind: "agregação";
  operation: AggregationOperation;
  input: FieldNode;
  percentile?: number;
};
export type ConstantNode = { kind: "constante"; value: number };
export type BinaryNode = {
  kind: "operação";
  operation: BinaryOperation;
  left: MetricExpression;
  right: MetricExpression;
};
export type MetricExpression = AggregationNode | ConstantNode | BinaryNode;

export type MetricDefinitionDraft = {
  name: string;
  description: string;
  expression: MetricExpression;
  dimensionFieldId: string | null;
  visualization: MetricVisualization;
  coverageThreshold: number;
  nullPolicy: "ignorar" | "separar" | "invalidar";
};

export type MetricValidationIssue = {
  code: string;
  message: string;
  path: string;
};

export type MetricValidationResult = {
  valid: boolean;
  inferredType: MetricValueType | null;
  nodeCount: number;
  sources: MetricSource[];
  errors: MetricValidationIssue[];
  warnings: MetricValidationIssue[];
};

export type MetricPreview = {
  rawValue: number;
  formattedValue: string;
  coverage: number;
  sampleSize: number;
  formula: string;
  inferredType: MetricValueType;
  warnings: MetricValidationIssue[];
};

export type MetricBuilderParts = {
  fieldAId: string;
  fieldBId: string;
  aggregationA: AggregationOperation;
  aggregationB: AggregationOperation;
  operator: BinaryOperation;
  divisor: number;
};

export function decomposeMetricBuilderExpression(expression: MetricExpression): MetricBuilderParts | null {
  const root = expression as Partial<BinaryNode>;
  if (root.kind !== "operação" || root.operation !== "dividir" || !root.left || !root.right) return null;
  if (root.right.kind !== "constante" || !Number.isFinite(root.right.value)) return null;
  if (root.left.kind !== "operação" || !root.left.left || !root.left.right) return null;
  if (root.left.left.kind !== "agregação" || root.left.right.kind !== "agregação") return null;
  if (!root.left.left.input?.fieldId || !root.left.right.input?.fieldId) return null;

  return {
    fieldAId: root.left.left.input.fieldId,
    fieldBId: root.left.right.input.fieldId,
    aggregationA: root.left.left.operation,
    aggregationB: root.left.right.operation,
    operator: root.left.operation,
    divisor: root.right.value,
  };
}

const numericAggregations = new Set<AggregationOperation>([
  "soma",
  "média",
  "mediana",
  "percentil",
  "mínimo",
  "máximo",
]);
const allowedAggregations = new Set<AggregationOperation>([
  "contagem",
  "contagem_distinta",
  ...numericAggregations,
]);
const allowedOperations = new Set<BinaryOperation>(["somar", "subtrair", "multiplicar", "dividir"]);
const allowedVisualizations = new Set<MetricVisualization>([
  "Cartão numérico",
  "Barras horizontais",
  "Colunas",
  "Linha temporal",
  "Barra 100% empilhada",
]);

function issue(code: string, message: string, path: string): MetricValidationIssue {
  return { code, message, path };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isMetricDefinitionDraft(value: unknown): value is MetricDefinitionDraft {
  if (!isRecord(value) || !isRecord(value.expression)) return false;
  return (
    typeof value.name === "string" &&
    typeof value.description === "string" &&
    (typeof value.dimensionFieldId === "string" || value.dimensionFieldId === null) &&
    typeof value.visualization === "string" &&
    typeof value.coverageThreshold === "number" &&
    ["ignorar", "separar", "invalidar"].includes(String(value.nullPolicy))
  );
}

export function validateMetricDefinition(
  definition: MetricDefinitionDraft,
  fields: MetricField[],
): MetricValidationResult {
  const fieldMap = new Map(fields.map((field) => [field.id, field]));
  const errors: MetricValidationIssue[] = [];
  const warnings: MetricValidationIssue[] = [];
  const sources = new Set<MetricSource>();
  let nodeCount = 0;

  if (definition.name.trim().length < 3) {
    errors.push(issue("nome_curto", "Dê um nome com pelo menos 3 caracteres.", "name"));
  }
  if (definition.name.trim().length > 80) {
    errors.push(issue("nome_longo", "Use no máximo 80 caracteres no nome.", "name"));
  }
  if (!Number.isFinite(definition.coverageThreshold) || definition.coverageThreshold < 0 || definition.coverageThreshold > 100) {
    errors.push(issue("cobertura_inválida", "A cobertura mínima deve ficar entre 0% e 100%.", "coverageThreshold"));
  }
  if (!allowedVisualizations.has(definition.visualization)) {
    errors.push(issue("visualização_inválida", "A visualização selecionada não é permitida.", "visualization"));
  }

  function visit(expression: MetricExpression, path: string): MetricValueType | null {
    nodeCount += 1;
    if (nodeCount > 10) return null;

    if (!isRecord(expression) || typeof expression.kind !== "string") {
      errors.push(issue("nó_inválido", "A expressão contém um nó inválido.", path));
      return null;
    }

    if (expression.kind === "constante") {
      if (!Number.isFinite(expression.value)) {
        errors.push(issue("constante_inválida", "A constante precisa ser um número finito.", `${path}.value`));
      }
      return "número";
    }

    if (expression.kind === "agregação") {
      nodeCount += 1;
      const field = fieldMap.get(expression.input?.fieldId);
      if (!field) {
        errors.push(issue("campo_ausente", "Um campo usado na fórmula não está disponível.", `${path}.input`));
        return null;
      }
      sources.add(field.source);

      if (!allowedAggregations.has(expression.operation)) {
        errors.push(issue("agregação_inválida", "A fórmula usa uma agregação não permitida.", `${path}.operation`));
        return null;
      }

      if (numericAggregations.has(expression.operation) && !["número", "duração"].includes(field.type)) {
        errors.push(issue("agregação_incompatível", `${field.label} não aceita a agregação selecionada.`, path));
        return null;
      }
      if (expression.operation === "percentil" && (!Number.isFinite(expression.percentile) || Number(expression.percentile) <= 0 || Number(expression.percentile) >= 100)) {
        errors.push(issue("percentil_inválido", "O percentil deve ser maior que 0 e menor que 100.", `${path}.percentile`));
      }
      if (["contagem", "contagem_distinta"].includes(expression.operation)) return "número";
      return field.type === "duração" ? "duração" : "número";
    }

    if (expression.kind === "operação") {
      if (!allowedOperations.has(expression.operation)) {
        errors.push(issue("operação_inválida", "A fórmula usa um operador não permitido.", `${path}.operation`));
        return null;
      }
      const leftType = visit(expression.left, `${path}.left`);
      const rightType = visit(expression.right, `${path}.right`);
      if (!leftType || !rightType) return null;

      if (["somar", "subtrair"].includes(expression.operation) && leftType !== rightType) {
        errors.push(issue("tipos_incompatíveis", "Soma e subtração exigem operandos do mesmo tipo.", path));
        return null;
      }
      if (expression.operation === "multiplicar" && leftType === "duração" && rightType === "duração") {
        errors.push(issue("durações_incompatíveis", "Não é possível multiplicar uma duração por outra duração.", path));
        return null;
      }
      if (expression.operation === "dividir" && expression.right.kind === "constante" && expression.right.value === 0) {
        errors.push(issue("divisão_por_zero", "O divisor não pode ser zero.", `${path}.right`));
      }
      if (expression.operation === "dividir" && leftType === "número" && rightType === "duração") {
        errors.push(issue("divisão_incompatível", "Um número não pode ser dividido por uma duração neste v1.", path));
        return null;
      }
      return leftType === "duração" ? "duração" : "número";
    }

    errors.push(issue("tipo_de_nó_desconhecido", "A expressão usa um tipo de nó não permitido.", path));
    return null;
  }

  const inferredType = visit(definition.expression, "expression");
  if (nodeCount > 10) {
    errors.push(issue("expressão_complexa", "A fórmula pode ter no máximo 10 nós.", "expression"));
  }
  if (sources.size > 2) {
    errors.push(issue("fontes_excedidas", "A fórmula pode combinar no máximo duas bases.", "expression"));
  }

  const dimension = definition.dimensionFieldId ? fieldMap.get(definition.dimensionFieldId) : null;
  if (definition.dimensionFieldId && !dimension) {
    errors.push(issue("dimensão_ausente", "A dimensão selecionada não está disponível.", "dimensionFieldId"));
  }
  if (definition.visualization === "Linha temporal" && dimension?.type !== "data") {
    errors.push(issue("linha_sem_data", "Linha temporal exige uma dimensão de data.", "visualization"));
  }
  if (["Barras horizontais", "Colunas", "Barra 100% empilhada"].includes(definition.visualization) && !dimension) {
    errors.push(issue("gráfico_sem_dimensão", "Esta visualização exige uma dimensão para segmentar os dados.", "dimensionFieldId"));
  }
  if (definition.visualization === "Cartão numérico" && dimension) {
    errors.push(issue("cartão_com_dimensão", "Cartão numérico deve mostrar um único valor, sem segmentação.", "dimensionFieldId"));
  }
  if (definition.visualization === "Barra 100% empilhada" && dimension && !["categoria", "booleano"].includes(dimension.type)) {
    errors.push(issue("empilhado_incompatível", "Barra 100% empilhada exige categoria ou campo booleano.", "visualization"));
  }

  if (sources.size > 1) {
    warnings.push(issue("cobertura_cruzada", "O cruzamento usa somente chamados com histórico vinculado e não representa 100% da base.", "expression"));
  }

  return {
    valid: errors.length === 0,
    inferredType,
    nodeCount,
    sources: Array.from(sources),
    errors,
    warnings,
  };
}

const aggregationLabels: Record<AggregationOperation, string> = {
  contagem: "Contagem",
  contagem_distinta: "Contagem distinta",
  soma: "Soma",
  média: "Média",
  mediana: "Mediana",
  percentil: "Percentil",
  mínimo: "Mínimo",
  máximo: "Máximo",
};

const operationLabels: Record<BinaryOperation, string> = {
  somar: "+",
  subtrair: "−",
  multiplicar: "×",
  dividir: "÷",
};

export function formatMetricExpression(expression: MetricExpression, fields: MetricField[]): string {
  const fieldMap = new Map(fields.map((field) => [field.id, field]));

  function format(node: MetricExpression): string {
    if (node.kind === "constante") return node.value.toLocaleString("pt-BR");
    if (node.kind === "agregação") {
      const field = fieldMap.get(node.input.fieldId);
      const suffix = node.operation === "percentil" ? ` ${node.percentile ?? "?"}` : "";
      return `${aggregationLabels[node.operation]}${suffix}(${field?.label ?? "campo ausente"})`;
    }
    return `(${format(node.left)} ${operationLabels[node.operation]} ${format(node.right)})`;
  }

  return format(expression);
}

const mockValues: Record<string, Partial<Record<AggregationOperation, number>>> = {
  "ticket-count": { contagem: 518, soma: 518, média: 4.9 },
  "event-count": { contagem: 72, soma: 72, média: 1.95 },
  "first-response": { média: 78, mediana: 38, percentil: 188, mínimo: 2, máximo: 920 },
  "resolution-time": { média: 744, mediana: 286, percentil: 1880, mínimo: 8, máximo: 6840 },
  priority: { contagem: 518, contagem_distinta: 7 },
  status: { contagem: 518, contagem_distinta: 5 },
  sector: { contagem: 518, contagem_distinta: 31 },
  reason: { contagem: 518, contagem_distinta: 44 },
  category: { contagem: 518, contagem_distinta: 5 },
  assignee: { contagem: 518, contagem_distinta: 9 },
  "event-type": { contagem: 72, contagem_distinta: 6 },
  "stage-duration": { média: 164, mediana: 91, percentil: 480, mínimo: 3, máximo: 1440 },
};

function evaluateExpression(expression: MetricExpression): number {
  if (expression.kind === "constante") return expression.value;
  if (expression.kind === "agregação") {
    const value = mockValues[expression.input.fieldId]?.[expression.operation];
    if (typeof value === "number") return value;
    if (expression.operation === "contagem") return expression.input.fieldId.startsWith("event") ? 72 : 518;
    if (expression.operation === "contagem_distinta") return 1;
    return 0;
  }
  const left = evaluateExpression(expression.left);
  const right = evaluateExpression(expression.right);
  if (expression.operation === "somar") return left + right;
  if (expression.operation === "subtrair") return left - right;
  if (expression.operation === "multiplicar") return left * right;
  if (right === 0) throw new Error("divisão_por_zero");
  return left / right;
}

export function previewMetricDefinition(
  definition: MetricDefinitionDraft,
  fields: MetricField[],
): MetricPreview {
  const validation = validateMetricDefinition(definition, fields);
  if (!validation.valid || !validation.inferredType) {
    throw new Error("A métrica não pode ser executada enquanto houver erros de validação.");
  }
  const rawValue = evaluateExpression(definition.expression);
  if (!Number.isFinite(rawValue)) throw new Error("O resultado não é calculável.");
  const combinedSources = validation.sources.length > 1;
  const coverage = combinedSources ? 7.1 : 100;
  const sampleSize = combinedSources ? 37 : validation.sources[0] === "Histórico" ? 72 : 518;
  const formattedValue = validation.inferredType === "duração"
    ? `${rawValue.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} min`
    : rawValue.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

  const warnings = [...validation.warnings];
  if (coverage < definition.coverageThreshold) {
    warnings.push(issue("cobertura_abaixo_do_limiar", `A cobertura de ${coverage.toLocaleString("pt-BR")}% está abaixo do limiar definido.`, "coverageThreshold"));
  }

  return {
    rawValue,
    formattedValue,
    coverage,
    sampleSize,
    formula: formatMetricExpression(definition.expression, fields),
    inferredType: validation.inferredType,
    warnings,
  };
}

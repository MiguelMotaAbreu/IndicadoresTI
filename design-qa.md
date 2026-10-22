# Design QA — PulseTI

## Verdade visual

- `ui-ref/dashboard-ui-ref.JPG` — referência principal de composição, densidade e paleta, 736 × 552 px.
- `ui-ref/login-ui-ref.JPG` — referência complementar para a entrada, 736 × 552 px.
- A revisão preserva a linguagem visual aprovada e usa as capturas fornecidas pelo usuário como evidência adicional do problema de repetição entre painéis.

## Evidências da implementação

- Preview de produção: `http://127.0.0.1:3004`.
- Viewport: 1366 × 768 CSS px; device scale factor 1.
- Estado principal: sessão autenticada, painel sem overlays.
- Capturas gerais:
  - `qa-artifacts/dashboard-1366x768.png`
  - `qa-artifacts/compare-dashboard-final.png`
- Composições temáticas:
  - `qa-artifacts/dashboard-demand-1366x768.png`
  - `qa-artifacts/dashboard-pending-1366x768.png`
  - `qa-artifacts/dashboard-sla-1366x768.png`
  - `qa-artifacts/dashboard-movement-1366x768.png`
  - `qa-artifacts/dashboard-quality-1366x768.png`
- Estados focados:
  - `qa-artifacts/layout-edit-1366x768.png`
  - `qa-artifacts/builder-1366x768.png`
  - `qa-artifacts/details-1366x768.png`

## Comparação de visão completa

- A estrutura de sidebar, topbar, filtros e cartões mantém proporções, bordas, elevação e densidade coerentes com a referência.
- Os painéis deixaram de compartilhar a mesma composição: demanda usa série temporal, mapa de calor e Pareto; pendências usa faixas de idade, ranking e barras empilhadas; SLA usa histograma, comparação e cobertura; movimentações usa eventos, timeline e composição de etapas; qualidade usa cobertura, escore e inconsistências.
- O viewport desktop mínimo permanece 1366 × 768 conforme o escopo do produto. Mobile continua explicitamente fora do v1.

## Comparações focadas

- **Edição:** cartões exibem contorno de edição e pega de arraste; o grid possui oito direções de redimensionamento. Um drag automatizado alterou a posição real do cartão.
- **Construtor:** os dados disponíveis substituem a lista fechada de indicadores. Dado 1, operador, Dado 2 e constante permanecem visíveis na mesma área, com fórmula legível, cobertura combinada e prévia.
- **Erro:** divisor igual a zero apresenta mensagem específica e mantém “Adicionar ao rascunho” desabilitado.
- **Privacidade:** o drawer continua mascarando solicitantes e não expõe descrição ou anexos.

## Superfícies de fidelidade

- **Tipografia:** Geist mantém hierarquia e densidade próximas da referência; rótulos pequenos permanecem legíveis sem colidir.
- **Espaçamento:** grid, cabeçalhos, legendas e eixos não apresentam sobreposição após o término da transição de 180 ms.
- **Cores:** fundo neutro, superfícies brancas e verde profundo continuam como tokens principais; âmbar, vermelho, violeta e ciano aparecem apenas como cores semânticas.
- **Imagem:** o raster original do login permanece nítido, bem recortado e sem halos. Não foram criados novos ativos raster nesta revisão.
- **Ícones:** uma única família Phosphor é usada para ações, navegação, alertas e pegas de arraste.
- **Conteúdo:** textos explicam amostra, cobertura, unidade e limitação da base diretamente junto ao gráfico.

## Acessibilidade e comportamento

- Controles principais possuem nomes acessíveis e foco visível.
- Estados não dependem apenas de cor; valores, rótulos e mensagens acompanham os tons semânticos.
- Gráficos permanecem sem animação própria; a transição curta do grid não bloqueia interação.
- A validação do construtor usa `role="alert"`, `aria-invalid` e desabilita a ação inválida.

## Histórico de correções

- [P1 — corrigido] Todos os painéis reutilizavam os mesmos quatro gráficos. Foram criadas cinco composições temáticas adicionais e layouts iniciais independentes.
- [P1 — corrigido] O construtor oferecia apenas uma lista de métricas prontas. Foi substituído por seleção de campos, operandos, operação, constante, dimensão e visualização.
- [P2 — corrigido] O grid só redimensionava pelo canto sudeste e compactava verticalmente. Agora usa posicionamento livre e oito direções de resize.
- [P2 — corrigido] Arrastar um KPI em modo de edição também abria o drawer. A ação de detalhamento foi desativada enquanto o layout está sendo editado.
- [P2 — corrigido] Capturas feitas durante a transição do grid sugeriam overflow. O QA passou a aguardar a estabilização da animação; o `scrollWidth` final coincide com a largura do container.
- [P2 — corrigido] O toast podia cobrir a ação primária do construtor. Foi movido para uma região central livre e perdeu captura de eventos do ponteiro.

## Verificações

- `npm run lint`: passou.
- `npx tsc --noEmit`: passou.
- `npm run build`: passou.
- Playwright/Edge: 9 de 9 cenários passaram.
- Console e page errors: nenhum.
- Não há achados P0, P1 ou P2 pendentes.

## Follow-up de polimento

- A persistência dos layouts e a execução das fórmulas ainda pertencem ao backend.
- A fórmula visual é um protótipo funcional de definição; o avaliador tipado do servidor está especificado no `plan.md` e não deve usar `eval`, JavaScript ou SQL fornecido pelo usuário.

final result: passed

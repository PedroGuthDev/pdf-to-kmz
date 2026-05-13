# Phase 1: PDF Parser Engine - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-12
**Phase:** 01-PDF Parser Engine
**Areas discussed:** Escopo de dados por poste, Tratamento de falhas de parsing, Associação distância↔postes, Saída e validação do parser

---

## Escopo de Dados por Poste

### Q1: Que dados o parser deve extrair por poste?

| Option | Description | Selected |
|--------|-------------|----------|
| Mínimo para KMZ | Só IDs, distâncias e posições x,y | |
| Tudo que conseguir | IDs, tipos, distâncias, posições, nomes de rua, códigos | |
| Você decide | Deixa o planner/researcher decidir | |

**User's choice:** Free-text — "somente os postes que estão marcados com o círculo vermelho, indicando sua numeração: 01, 02, 03"
**Notes:** User revealed that relevant posts are NOT the 5-digit utility IDs from research, but sequentially numbered posts (01, 02, 03) marked with red circles. This fundamentally changed the parsing approach.

### Q2: Os círculos vermelhos são gráficos vetoriais ou texto?

| Option | Description | Selected |
|--------|-------------|----------|
| Gráficos vetoriais | Círculo desenhado como shape, número como texto separado | |
| Texto/caractere | Círculo é caractere especial | |
| Não tenho certeza | Precisaria analisar o PDF | ✓ |

**User's choice:** Not sure, but knows the layers — circle is on `Numero_Poste` layer, number is on `TEXTO` layer.
**Notes:** User revealed the PDF has layer structure (OCGs). This was a critical discovery not in any prior research.

### Q3: Quais outras camadas existem no PDF?

| Option | Description | Selected |
|--------|-------------|----------|
| Sei as camadas | Posso listar | ✓ |
| Não sei ao certo | Precisaria verificar | |
| Só sei dessas duas | Numero_Poste e TEXTO | |

**User's choice:** Listed additional layers: `Distância_Poste` (distances), `Cabo Projetado` (cable polyline for KMZ)
**Notes:** Four relevant layers identified total.

### Q4: O que está na camada Cabo Projetado?

| Option | Description | Selected |
|--------|-------------|----------|
| Linha desenhada | Polyline/path gráfico do trajeto do cabo | ✓ |
| Labels de texto | Textos descrevendo tipo de cabo | |
| Ambos | Linha desenhada + labels | |

**User's choice:** Polyline desenhada do trajeto do cabo
**Notes:** Parser needs to extract graphic operators, not just text. Uses `getOperatorList()`.

### Q5: A polyline passa pelos postes?

| Option | Description | Selected |
|--------|-------------|----------|
| Sim, passa pelos postes | Postes sobre o trajeto | ✓ |
| Não necessariamente | Postes ao lado do trajeto | |
| Não tenho certeza | Precisaria verificar | |

**User's choice:** "Sim, a polyline passa ao lado do poste, não necessariamente encosta, mas fica próximo"
**Notes:** Proximity-based association between posts and cable polyline.

---

## Tratamento de Falhas de Parsing

### Q1: Comportamento em caso de problema de parsing?

| Option | Description | Selected |
|--------|-------------|----------|
| Pular e avisar | Ignora + warnings | ✓ |
| Parar com erro | Stop on error | |
| Pular silenciosamente | Ignora sem avisar | |

**User's choice:** Pular e avisar

### Q2: Se camadas esperadas não existirem?

| Option | Description | Selected |
|--------|-------------|----------|
| Erro fatal | Para com mensagem | |
| Fallback para texto | Tenta sem filtro de camadas | |
| Listar camadas disponíveis | Pede mapeamento manual | ✓ |

**User's choice:** Listar camadas e pedir mapeamento manual

### Q3: Quais páginas processar?

| Option | Description | Selected |
|--------|-------------|----------|
| Só páginas 2-4 | Hardcoded | |
| Todas as páginas | Procura em todas | ✓ |
| Usuário seleciona | Preview + seleção | |

**User's choice:** Todas as páginas — "existem projetos imensos e projetos de 1 página, varia bastante"

### Q4: Encoding de caracteres especiais?

| Option | Description | Selected |
|--------|-------------|----------|
| Ignorar nomes de rua | Só números e geometria | ✓ |
| Extrair nomes de rua | Precisa de encoding funcional | |

**User's choice:** Ignorar nomes de rua

---

## Associação Distância↔Postes

### Q1: Como associar distâncias aos pares de postes?

| Option | Description | Selected |
|--------|-------------|----------|
| Proximidade espacial | Nearest-neighbor | |
| Seguir a polyline | Sequência pela polyline | |
| Pela numeração sequencial | Ordem numérica define pares | |

**User's choice:** Free-text — "Combinar numeração sequencial + polyline"

### Q2: Como funciona a numeração em ramificações?

| Option | Description | Selected |
|--------|-------------|----------|
| Numeração contínua | Sem reset | ✓ |
| Numeração separada por ramo | Reset ou prefixo | |
| Não há ramificações | Sempre linear | |
| Varia por projeto | Sem padrão fixo | |

**User's choice:** Numeração contínua — "cabo segue para a direita do poste 6-11, depois para a esquerda da ramificação do poste 12 em diante"

### Q3: Como identificar o ponto de bifurcação?

| Option | Description | Selected |
|--------|-------------|----------|
| Pela polyline | Divisão geométrica | ✓ |
| Por proximidade espacial | Posição x,y | |
| Indicador visual | Símbolo/marcação | |
| Combinação | Polyline + proximidade | |

**User's choice:** Pela polyline — divisão geométrica

### Q4: Postes repetem entre páginas?

| Option | Description | Selected |
|--------|-------------|----------|
| Sim, repetem | Deduplicar por número | ✓ |
| Não, cada um aparece uma vez | Sem sobreposição | |
| Não tenho certeza | Verificar | |

**User's choice:** "Em alguns casos aparecem repetido, precisaria ter deduplicação"

---

## Saída e Validação do Parser

### Q1: Nível de feedback após parsing?

| Option | Description | Selected |
|--------|-------------|----------|
| Resumo simples | Contagens básicas | ✓ |
| Preview detalhado | Tabela + mini-mapa | |
| Resumo + warnings | Contagem + lista de avisos | |

**User's choice:** Resumo simples

### Q2: Fluxo contínuo ou confirmar antes?

| Option | Description | Selected |
|--------|-------------|----------|
| Fluxo contínuo | Sem gate de confirmação | ✓ |
| Confirmar antes | Botão "Confirmar dados" | |

**User's choice:** Fluxo contínuo

### Q3: Estrutura de dados de saída?

| Option | Description | Selected |
|--------|-------------|----------|
| Mínimo | numero + posição + distância | |
| Com topologia | + grafo de conexões | |
| Com polyline | + geometria da polyline do cabo | ✓ |

**User's choice:** Com polyline — estrutura rica para linhas curvas no KMZ

### Q4: Normalização de coordenadas PDF?

| Option | Description | Selected |
|--------|-------------|----------|
| Posições cruas | x,y como pdf.js retorna | |
| Normalizar por página | Coordenadas relativas 0-1 | |
| Você decide | Planner decide | ✓ |

**User's choice:** Você decide

---

## Agent's Discretion

- D-18: Coordinate normalization strategy (raw PDF points vs. relative 0-1 per page)

## Deferred Ideas

None — discussion stayed within phase scope

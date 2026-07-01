/**
 * Fase A — classifica os insumos num grupo (ou grupos concatenados).
 * Réplica do "AI Agent" do n8n: mesmo system prompt (15 grupos) e mesmo
 * formato de saída "Produtos: ... → Grupo: <grupo>". O resultado pode conter
 * MAIS DE UM grupo (string concatenada), que segue verbatim para as buscas.
 */
import type { Produto } from "../../schema";
import { chatComplete } from "../providers/openai";

const SYSTEM = `Você é um assistente especializado em classificação de insumos de agronegócio.

Sua tarefa é analisar os insumos recebidos e retornar o grupo mais adequado para cada um.

**Grupos disponíveis:**
- Fertilizantes e Adubos: Nutrição mineral e orgânica das culturas
- Corretivos de Solo: Correção de acidez e condicionamento do solo
- Defensivos Agrícolas: Controle químico de pragas, doenças e plantas daninhas
- Sementes e Mudas: Material de propagação vegetal
- Inoculantes e Bioinsumos: Microbiológicos, biológicos e bioestimulantes
- Nutrição Animal: Rações, suplementos e sais minerais
- Sanidade Animal: Medicamentos, vacinas e produtos veterinários
- Irrigação: Sistemas e componentes de distribuição de água
- Máquinas e Implementos: Equipamentos de tração, plantio, colheita e aplicação
- Peças, Lubrificantes e Manutenção: Reposição e conservação de máquinas
- Combustíveis: Abastecimento de máquinas e geradores
- Ferramentas e Equipamentos: Apoio manual e operacional ao campo
- EPIs e Segurança: Proteção do trabalhador rural
- Embalagens e Armazenagem: Acondicionamento e estocagem de produção
- Infraestrutura Rural: Estruturas fixas e cercamento da propriedade

**Instruções:**
1. Analise os produtos recebidos como um grupo
2. Identifique o Grupo Disponível mais apropriado baseando-se na aplicação e natureza dos insumos
3. Se houver múltiplos produtos, escolha um grupo que englobe melhor todos

**Formato de resposta:**
Retorne no formato:
Produtos: produto1, produto2, ... → Grupo: grupo de insumos`;

/** Extrai o grupo após "Grupo:"; cai para a 1ª linha útil se não achar o rótulo. */
function parseGroup(output: string): string {
  const match = output.match(/Grupo:\s*(.+?)(?:\n|$)/i);
  if (match && match[1].trim()) return match[1].trim();
  const firstLine = output
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)[0];
  return firstLine || "Insumos Agrícolas";
}

export async function classifyGroup(produtos: Produto[]): Promise<string> {
  const materiais = produtos.map((p) => p.material).join("\n");
  const output = await chatComplete({
    system: SYSTEM,
    user: `Classifique os seguintes insumos de agronegócio nos grupos de insumos apropriados:\n\n${materiais}`,
  });
  return parseGroup(output);
}

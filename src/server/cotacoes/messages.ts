/**
 * Template da mensagem de cotação enviada ao fornecedor via WhatsApp.
 * Réplica fiel do nó "Mensagem para os fornecedores" do n8n. Os campos
 * `enderecoEntrega`, `cnpj` e `nomeObra` são OPCIONAIS: a frase se adapta
 * quando ausentes (hoje o formulário não os coleta). `marca` faz o papel de
 * "referência" do produto.
 */
import type { Cotacao } from "../schema";

export interface SupplierMessageInput {
  nome: string;
  cidade: string;
  produtos: Cotacao["produtos"];
  enderecoEntrega?: string;
  cnpj?: string;
  nomeObra?: string;
}

export function buildSupplierMessage(input: SupplierMessageInput): string {
  const { nome, cidade, produtos, enderecoEntrega, cnpj, nomeObra } = input;

  let t = `Olá, tudo bem?\n\nMeu nome é ${nome}, representante da Agente Comprador. `;
  t += `Estamos interessados na compra dos seguintes insumos para nossa fazenda`;
  t += nomeObra ? `, ${nomeObra},` : `,`;
  t += ` com entrega na cidade de ${cidade}`;
  if (enderecoEntrega) t += `, endereço ${enderecoEntrega}`;
  if (cnpj) t += ` e CNPJ ${cnpj}`;
  t += `:\n\n`;

  for (const p of produtos) {
    t += `- ${p.quantidade} ${p.unidade} de ${p.material}${p.marca ? ` - ${p.marca}` : ""};\n`;
  }

  t += "\nSolicito, por gentileza, o orçamento detalhado incluindo:\n\n";
  t += "- Preço unitário e total para cada item;\n";
  t += "- Prazo de entrega previsto;\n";
  t += "- Condições e formas de pagamento disponíveis;\n";
  t += "- Indicação se os preços incluem impostos;\n";
  t += "- Indicação se os preços incluem frete;\n";
  t += "- Validade da proposta comercial.\n\n";
  t +=
    "Caso necessitem de informações adicionais para a elaboração do orçamento, fico à disposição para esclarecimentos.\n\n";
  t += "Agradeço antecipadamente e aguardo seu retorno.";

  return t;
}

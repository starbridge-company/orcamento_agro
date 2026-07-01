/**
 * Fases D/F — e-mails ao comprador (réplica dos nós Gmail do n8n):
 *  - notifyNoSuppliers: quando nada é encontrado no raio máximo.
 *  - notifySuccess: lista os fornecedores contatados + link do painel.
 */
import { config } from "../../config";
import { sendMail } from "../providers/mailer";
import type { SupplierCandidate } from "./types";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function notifyNoSuppliers(email: string): Promise<void> {
  await sendMail({
    to: email,
    subject: "Retorno do Agente Comprador",
    text: `Infelizmente não encontramos nenhum fornecedor dos insumos solicitados num raio ${config.cotacao.searchMaxRadiusKm}km.`,
  });
}

export async function notifySuccess(params: {
  email: string;
  quoteId: string;
  dominio: string;
  suppliers: SupplierCandidate[];
}): Promise<void> {
  const { email, quoteId, dominio, suppliers } = params;
  const painelUrl = `${dominio}/cotacoes/${quoteId}`;

  const fornecedoresHtml = suppliers
    .map(
      (s, i) => `
      <div style="background:#f9f9f9;border-left:4px solid #4CAF50;padding:10px;margin:10px 0;">
        <div style="font-weight:bold;color:#4CAF50;">${i + 1}. ${escapeHtml(s.name)}</div>
        <div>📍 ${escapeHtml(s.city)}, ${escapeHtml(s.state)}</div>
        <div>📞 ${escapeHtml(s.phone)}</div>
      </div>`,
    )
    .join("");

  const html = `<!DOCTYPE html>
<html>
<body style="font-family:Arial,sans-serif;line-height:1.6;color:#333;">
  <div style="background:#4CAF50;color:#fff;padding:20px;text-align:center;">
    <h2>🎉 Sua cotação foi enviada com sucesso!</h2>
  </div>
  <div style="padding:20px;">
    <p>Olá!</p>
    <p>Sua solicitação de orçamento foi enviada para os seguintes fornecedores:</p>
    ${fornecedoresHtml}
    <div style="font-size:18px;font-weight:bold;color:#4CAF50;margin:20px 0;">
      📊 Total: ${suppliers.length} fornecedores
    </div>
    <p>Acompanhe o status das cotações através do painel:</p>
    <a href="${painelUrl}" style="display:inline-block;background:#4CAF50;color:#fff;padding:10px 20px;text-decoration:none;border-radius:5px;">
      📋 Acessar Painel de Acompanhamento
    </a>
  </div>
  <div style="background:#f1f1f1;padding:15px;text-align:center;margin-top:20px;">
    <p>Atenciosamente,<br><strong>Agente Comprador</strong></p>
    <p style="font-size:12px;color:#666;">Starbridge</p>
  </div>
</body>
</html>`;

  const textLines = suppliers.map(
    (s, i) => `${i + 1}. ${s.name}\n   📍 ${s.city}, ${s.state}\n   📞 ${s.phone}`,
  );
  const text = `Olá!

Sua cotação foi enviada com sucesso! 🎉

Enviamos para os seguintes fornecedores:

${textLines.join("\n\n")}

📊 Total: ${suppliers.length} fornecedores

📋 Acompanhe pelo painel:
${painelUrl}

Atenciosamente,
Agente Comprador
Starbridge`;

  await sendMail({
    to: email,
    subject: "Orçamentos enviados com sucesso!",
    html,
    text,
  });
}

/**
 * Provider de e-mail via SMTP (nodemailer). Substitui o nó Gmail do n8n.
 * Credenciais no .env (config.cotacao.smtp). O transporter é criado sob
 * demanda e reutilizado.
 */
import nodemailer, { type Transporter } from "nodemailer";
import { config } from "../../config";

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  const { host, port, secure, user, pass } = config.cotacao.smtp;
  if (!host) throw new Error("SMTP_HOST não configurado.");
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host,
      port,
      secure, // true => 465 (TLS implícito); false => 587 (STARTTLS)
      auth: user ? { user, pass } : undefined,
    });
  }
  return transporter;
}

export interface MailInput {
  to: string;
  subject: string;
  html?: string;
  text?: string;
}

export async function sendMail(mail: MailInput): Promise<void> {
  const { from, fromName, user } = config.cotacao.smtp;
  const fromAddr = from || user;
  await getTransporter().sendMail({
    from: fromName ? `"${fromName}" <${fromAddr}>` : fromAddr,
    to: mail.to,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
  });
}

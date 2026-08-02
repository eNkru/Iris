import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { getEnv, logger } from "@iris/utils";

let transporter: Transporter | null = null;

/**
 * Lazily created nodemailer transporter. SMTP transport is required for
 * magic-link login emails; the same transport will back the future email
 * alert channel (R12).
 */
export function getSmtpTransporter(): Transporter {
  if (!transporter) {
    const env = getEnv();
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth:
        env.SMTP_USER !== ""
          ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
          : undefined,
    });
  }
  return transporter;
}

export interface SendMagicLinkParams {
  email: string;
  url: string;
}

export async function sendMagicLinkEmail(params: SendMagicLinkParams): Promise<void> {
  const env = getEnv();

  await getSmtpTransporter().sendMail({
    from: env.SMTP_FROM,
    to: params.email,
    subject: "Sign in to Iris",
    text: `Sign in to Iris using this link: ${params.url}`,
    html: `<p>Sign in to Iris using this link:</p><p><a href="${params.url}">${params.url}</a></p>`,
  });

  logger.info("Magic link email sent", { email: params.email });
}

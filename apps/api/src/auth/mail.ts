import type { Prisma } from "@agentcommons/db";
import nodemailer from "nodemailer";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { z } from "zod";

export const emailTransportSchema = z.enum(["none", "smtp", "ses"]);

export interface AuthMail {
  send(input: {
    to: string;
    kind: "verification" | "reset" | "welcome";
    url: string;
    id?: string;
  }): Promise<void>;
}
export function authMail(environment: NodeJS.ProcessEnv): AuthMail | undefined {
  const mode = emailTransportSchema.parse(
    environment.EMAIL_TRANSPORT || "none",
  );
  if (mode === "none") return undefined;
  const from = z.email().parse(environment.EMAIL_FROM);
  const transport =
    mode === "smtp"
      ? nodemailer.createTransport(
          z
            .url()
            .refine((value) =>
              ["smtp:", "smtps:"].includes(new URL(value).protocol),
            )
            .parse(environment.SMTP_URL),
        )
      : nodemailer.createTransport({
          SES: {
            sesClient: new SESv2Client({
              region: z
                .string()
                .min(1)
                .parse(environment.AWS_REGION || "us-west-2"),
            }),
            SendEmailCommand,
          },
        });
  return {
    async send(input) {
      const messages = {
        verification: {
          subject: "Verify your AgentCommons email",
          text: `Verify your email to finish signing up:\n\n${input.url}\n\nIf you did not sign up, you can ignore this email.`,
        },
        reset: {
          subject: "Reset your AgentCommons password",
          text: `Choose a new password:\n\n${input.url}\n\nThis link expires in one hour. If you did not request it, you can ignore this email.`,
        },
        welcome: {
          subject: "Your AgentCommons organization is ready",
          text: `Your organization is ready. Sign in to create an API key and install the capture hook:\n\n${input.url}\n\nCaptured sessions will appear in your dashboard.`,
        },
      };
      await transport.sendMail({
        from,
        to: z.email().parse(input.to),
        ...messages[input.kind],
        ...(input.id
          ? { messageId: `<${input.id}@${new URL(input.url).hostname}>` }
          : {}),
      });
    },
  };
}

export interface WelcomeJobs {
  enqueueWelcome(tx: Prisma.TransactionClient, userId: string): Promise<void>;
}

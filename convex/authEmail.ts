import { Email } from "@convex-dev/auth/providers/Email";

const VERIFICATION_CODE_DIGITS = 8;
const VERIFICATION_CODE_SPACE = 10 ** VERIFICATION_CODE_DIGITS;
const VERIFICATION_CODE_MAX_AGE_SECONDS = 15 * 60;

type MailEnvironment = {
  AUTH_RESEND_KEY?: string;
  AUTH_EMAIL_FROM?: string;
};

export function normalizeAuthEmail(value: unknown): string {
  if (typeof value !== "string") throw new Error("invalid_email");
  if (value.length > 512) throw new Error("invalid_email");
  const email = value.normalize("NFKC").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("invalid_email");
  }
  return email;
}

export async function generateEmailVerificationToken(): Promise<string> {
  const values = new Uint32Array(1);
  const unbiasedCeiling = 0x1_0000_0000 - (0x1_0000_0000 % VERIFICATION_CODE_SPACE);
  do {
    crypto.getRandomValues(values);
  } while (values[0] >= unbiasedCeiling);
  return String(values[0] % VERIFICATION_CODE_SPACE).padStart(VERIFICATION_CODE_DIGITS, "0");
}

export async function sendNodeRoomVerificationEmail(
  input: { identifier: string; token: string },
  environment: MailEnvironment = process.env,
  send: typeof fetch = fetch,
): Promise<void> {
  const apiKey = environment.AUTH_RESEND_KEY?.trim();
  const from = environment.AUTH_EMAIL_FROM?.trim();
  if (!apiKey || !from) throw new Error("email_delivery_not_configured");

  const response = await send("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: normalizeAuthEmail(input.identifier),
      subject: "Your NodeRoom verification code",
      text: `Your NodeRoom verification code is ${input.token}. It expires in 15 minutes. If you did not request this code, you can ignore this email.`,
      html: `<div style="font-family:system-ui,sans-serif;color:#26211d;line-height:1.5"><h1 style="font-size:22px">Verify your NodeRoom account</h1><p>Enter this code to finish signing in:</p><p style="font-family:ui-monospace,monospace;font-size:28px;font-weight:700;letter-spacing:4px">${input.token}</p><p>This code expires in 15 minutes. If you did not request it, you can ignore this email.</p></div>`,
    }),
  });
  if (!response.ok) throw new Error("email_delivery_failed");
}

export const nodeRoomEmailVerification = Email({
  id: "noderoom-email-verification",
  maxAge: VERIFICATION_CODE_MAX_AGE_SECONDS,
  generateVerificationToken: generateEmailVerificationToken,
  sendVerificationRequest: async ({ identifier, token }) => {
    await sendNodeRoomVerificationEmail({ identifier, token });
  },
});

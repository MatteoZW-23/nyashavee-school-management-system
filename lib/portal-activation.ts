import { createHash, randomBytes } from "node:crypto";
import { isProviderDeliverableEmail, MESSAGE_PROVIDER_TIMEOUT_MS } from "./messaging.ts";

const ACTIVATION_PREFIX = "portal-activation:";

export type ActivationTarget = {
  userId: string;
  membershipId: string;
  profileType?: "parent";
  profileId?: string;
};

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function hashActivationToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createActivationToken() {
  return randomBytes(32).toString("base64url");
}

export function activationIdentifier(target: ActivationTarget) {
  // The database keeps only the token hash. This metadata is not a secret and
  // lets the one-time activation endpoint bind the invitation to one profile.
  return ACTIVATION_PREFIX + JSON.stringify(target);
}

export function parseActivationIdentifier(identifier: string): ActivationTarget | null {
  if (!identifier.startsWith(ACTIVATION_PREFIX)) return null;
  try {
    const parsed = JSON.parse(identifier.slice(ACTIVATION_PREFIX.length)) as ActivationTarget;
    if (!parsed.userId || !parsed.membershipId) return null;
    if ((parsed.profileType && !parsed.profileId) || (!parsed.profileType && parsed.profileId)) return null;
    if (parsed.profileType && parsed.profileType !== "parent") return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function sendPortalActivationEmail(email: string, displayName: string, schoolName: string, link: string, introduction?: string) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM?.trim();
  if (!apiKey || !from || !isProviderDeliverableEmail(email)) return false;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [email],
      subject: `Set up your ${schoolName} portal account`,
      text: `Hello ${displayName},\n\n${introduction ? `${introduction}\n\n` : ""}Use this private link to set your portal password. It expires in 24 hours and can be used once:\n\n${link}\n\nIf you were not expecting this invitation, contact ${schoolName}.`,
    }),
    signal: AbortSignal.timeout(MESSAGE_PROVIDER_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`resend_${response.status}`);
  return true;
}

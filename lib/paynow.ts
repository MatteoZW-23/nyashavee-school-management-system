import { createHash } from "node:crypto";

const INITIATE_URL = "https://www.paynow.co.zw/interface/initiatetransaction";
const GATEWAY_TIMEOUT_MS = 15000;

export function isPaynowConfigured() {
  return Boolean(process.env.PAYNOW_INTEGRATION_ID?.trim() && process.env.PAYNOW_INTEGRATION_KEY?.trim());
}

// Paynow signs messages as SHA512(concatenated field values + integration key),
// uppercase hex. The field order is the order the fields were sent/received.
export function paynowHash(values: string[]) {
  const key = process.env.PAYNOW_INTEGRATION_KEY?.trim() ?? "";
  return createHash("sha512").update([...values, key].join("")).digest("hex").toUpperCase();
}

function parsePaynowResponse(text: string) {
  const params = new URLSearchParams(text);
  const out: Record<string, string> = {};
  for (const [key, value] of params) out[key.toLowerCase()] = value;
  return out;
}

export type PaynowInit = { redirectUrl: string; pollUrl: string; reference: string };

// Start a web checkout: returns the Paynow page the parent is redirected to and
// the poll URL the school can query for the final result.
export async function initiatePayment(input: { reference: string; amount: number; currency: string; email: string; returnUrl: string; resultUrl: string; info: string }): Promise<PaynowInit> {
  const id = process.env.PAYNOW_INTEGRATION_ID!.trim();
  const amount = input.amount.toFixed(2);
  const fields: Array<[string, string]> = [
    ["id", id],
    ["reference", input.reference],
    ["amount", amount],
    ["additionalinfo", input.info],
    ["returnurl", input.returnUrl],
    ["resulturl", input.resultUrl],
    ["authemail", input.email],
    ["status", "Message"],
  ];
  const hash = paynowHash(fields.map(([, value]) => value));
  fields.push(["hash", hash]);

  const response = await fetch(INITIATE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
    signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
  });
  const result = parsePaynowResponse(await response.text());
  if (!response.ok || result.status?.toLowerCase() !== "ok" || !result.browserurl || !result.pollurl) {
    throw new Error(result.error ? `paynow_init: ${result.error}` : `paynow_init_${response.status}`);
  }
  return { redirectUrl: result.browserurl, pollUrl: result.pollurl, reference: input.reference };
}

export type PaynowStatus = { status: string; paynowReference: string; amount: string; reference: string };

// Poll the transaction status. The hash covers every field in the response in
// the order Paynow sent it — verify before trusting the status.
export async function checkPaymentStatus(pollUrl: string): Promise<PaynowStatus> {
  const response = await fetch(pollUrl, { method: "POST", signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS) });
  const result = parsePaynowResponse(await response.text());
  const { hash, ...rest } = result;
  const expected = paynowHash(Object.values(rest));
  if (!hash || expected !== hash.toUpperCase()) throw new Error("paynow_hash_mismatch");
  return { status: result.status ?? "Unknown", paynowReference: result.paynowreference ?? "", amount: result.amount ?? "0", reference: result.reference ?? "" };
}

// Verify a result webhook payload (form fields in received order).
export function verifyResultPayload(fields: Array<[string, string]>): boolean {
  const pairs = fields.map(([key, value]) => [key.toLowerCase(), value] as [string, string]);
  const hashEntry = pairs.find(([key]) => key === "hash");
  if (!hashEntry) return false;
  const values = pairs.filter(([key]) => key !== "hash").map(([, value]) => value);
  return paynowHash(values) === hashEntry[1].toUpperCase();
}

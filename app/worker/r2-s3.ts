/** Minimal AWS SigV4 for R2 S3-compatible PUT/HEAD. */

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256(data: string | ArrayBuffer): Promise<ArrayBuffer> {
  const bytes = typeof data === "string" ? encoder.encode(data) : data;
  return crypto.subtle.digest("SHA-256", bytes);
}

async function hmacSha256(key: BufferSource, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data));
}

async function signingKey(secret: string, date: string, region: string, service: string): Promise<ArrayBuffer> {
  const kDate = await hmacSha256(encoder.encode(`AWS4${secret}`), date);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  return hmacSha256(kService, "aws4_request");
}

export type R2Dest = {
  accountId: string;
  bucketName: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export async function putObjectToR2S3(
  dest: R2Dest,
  key: string,
  body: ArrayBuffer,
  contentType?: string,
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const region = "auto";
  const service = "s3";
  const host = `${dest.accountId}.r2.cloudflarestorage.com`;
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  const url = `https://${host}/${dest.bucketName}/${encodedKey}`;
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = toHex(await sha256(body));

  const headers: Record<string, string> = {
    host,
    "content-type": contentType ?? "application/octet-stream",
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };

  const signedHeaderNames = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((k) => `${k}:${headers[k]}\n`)
    .join("");

  const canonicalRequest = [
    "PUT",
    `/${dest.bucketName}/${encodedKey}`,
    "",
    canonicalHeaders,
    signedHeaderNames,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    toHex(await sha256(canonicalRequest)),
  ].join("\n");

  const derivedKey = await signingKey(dest.secretAccessKey, dateStamp, region, service);
  const signature = toHex(await hmacSha256(derivedKey, stringToSign));

  const authorization = `AWS4-HMAC-SHA256 Credential=${dest.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaderNames}, Signature=${signature}`;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: authorization,
      "Content-Type": headers["content-type"],
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, status: res.status, message: text.slice(0, 200) || res.statusText };
  }
  return { ok: true };
}

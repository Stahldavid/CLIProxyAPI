import { createHash, timingSafeEqual } from "node:crypto";

const digest = (value) => createHash("sha256").update(value).digest();

/** Local-only authentication; remote access must terminate TLS before this server. */
export function createConsoleAuth({
  password = null,
  required = false,
  managementToken = null,
} = {}) {
  if (password === null && !required) return () => true;
  if (
    typeof password !== "string" ||
    password.length < 16 ||
    password.length > 1024 ||
    /[\x00-\x1f\x7f]/.test(password)
  ) {
    throw new TypeError(
      "Connected console requires a separate GATEWAY_CONSOLE_PASSWORD of 16–1024 characters.",
    );
  }
  if (
    managementToken &&
    timingSafeEqual(digest(password), digest(managementToken))
  ) {
    throw new TypeError(
      "Console and management credentials must be different.",
    );
  }
  const expected = digest(`gateway:${password}`);
  return (req) => {
    const header = req.headers.authorization;
    if (
      typeof header !== "string" ||
      header.length > 2048 ||
      !/^Basic [A-Za-z0-9+/]+={0,2}$/.test(header)
    )
      return false;
    const encoded = header.slice(6);
    const decoded = Buffer.from(encoded, "base64");
    if (decoded.toString("base64") !== encoded) return false;
    return timingSafeEqual(expected, digest(decoded));
  };
}

/** Reject browser cross-site access even when a browser caches Basic credentials. */
export function isSameOriginRequest(req) {
  const site = req.headers["sec-fetch-site"];
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = req.headers.origin;
  if (origin && origin !== `http://${req.headers.host}`) return false;
  return true;
}

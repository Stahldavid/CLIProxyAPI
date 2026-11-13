/** Offline display projection. This module never fetches or persists source records. */
const MAX_RECORDS = 10000;
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const count = (value) =>
  Number.isSafeInteger(value) && value >= 0 ? value : null;
const label = (value) => {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (
    !text ||
    text.length > 100 ||
    /[\x00-\x1f<>]|(?:bearer\s|sk-|ghp_|github_pat_|eyJ)/i.test(text)
  )
    return null;
  return text;
};
const time = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T/.test(value) &&
  Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null;
function clientFor(record) {
  const explicit = label(record.client_label);
  if (explicit) return [explicit, "declared"];
  const agent =
    typeof record.user_agent === "string"
      ? record.user_agent.slice(0, 1024)
      : "";
  if (/claude[- /]?code|claude-cli/i.test(agent))
    return ["Claude Code", "user-agent heuristic"];
  if (/codex/i.test(agent)) return ["Codex CLI", "user-agent heuristic"];
  if (/opencode/i.test(agent)) return ["OpenCode", "user-agent heuristic"];
  return ["Unknown client", "unavailable"];
}

export function normalizeRecords(snapshot) {
  const source = Array.isArray(snapshot)
    ? snapshot
    : object(snapshot)
      ? snapshot.records
      : null;
  if (!Array.isArray(source))
    throw new TypeError("Expected an array or an object with a records array.");
  if (source.length > MAX_RECORDS)
    throw new RangeError(`Snapshots are limited to ${MAX_RECORDS} records.`);
  if (source.some((record) => !object(record)))
    throw new TypeError("Every record must be an object.");
  return source.map((record, index) => {
    const [client, clientEvidence] = clientFor(record);
    const tokens = object(record.tokens) ? record.tokens : {};
    const auth = label(record.auth_type);
    return {
      id: `event-${index + 1}`,
      timestamp: time(record.timestamp),
      client,
      clientEvidence,
      requestedModel: label(record.alias) || label(record.model),
      forwardedModel: label(record.model),
      responseModel: label(record.response_model),
      provider: label(record.provider) || "Unknown provider",
      executor: label(record.executor_type) || "Unknown executor",
      account: label(record.account_label) || "Unidentified account",
      authMethod: auth || "Unknown",
      subscription: null,
      tokens: {
        input: count(tokens.input_tokens),
        output: count(tokens.output_tokens),
        cached: count(tokens.cached_tokens),
        total: count(tokens.total_tokens),
      },
      latencyMs:
        typeof record.latency_ms === "number" &&
        Number.isFinite(record.latency_ms) &&
        record.latency_ms >= 0
          ? record.latency_ms
          : null,
      status:
        record.failed === true
          ? "failed"
          : record.failed === false
            ? "success"
            : "unknown",
      cost: null,
    };
  });
}

function groups(records, field) {
  const result = new Map();
  for (const record of records) {
    const name = record[field] || "Unknown";
    const group = result.get(name) || {
      name,
      requests: 0,
      tokensKnown: 0,
      totalTokens: 0,
    };
    group.requests++;
    if (record.tokens.total !== null) {
      group.tokensKnown++;
      group.totalTokens += record.tokens.total;
    }
    result.set(name, group);
  }
  return [...result.values()]
    .map((group) => ({
      ...group,
      totalTokens:
        group.tokensKnown && Number.isSafeInteger(group.totalTokens)
          ? group.totalTokens
          : null,
    }))
    .sort((a, b) => b.requests - a.requests || a.name.localeCompare(b.name));
}

export function summarize(records) {
  const success = records.filter(
    (record) => record.status === "success",
  ).length;
  const failed = records.filter((record) => record.status === "failed").length;
  const latencies = records
    .map((record) => record.latencyMs)
    .filter((value) => value !== null)
    .sort((a, b) => a - b);
  const known = records.filter((record) => record.tokens.total !== null);
  const tokenSum = known.reduce((sum, record) => sum + record.tokens.total, 0);
  return {
    total: records.length,
    success,
    failed,
    unknown: records.length - success - failed,
    successRate: success + failed ? (success / (success + failed)) * 100 : null,
    p95LatencyMs: latencies.length
      ? latencies[Math.ceil(latencies.length * 0.95) - 1]
      : null,
    latencyKnown: latencies.length,
    tokensKnown: known.length,
    totalTokens:
      known.length && Number.isSafeInteger(tokenSum) ? tokenSum : null,
    providers: groups(records, "provider"),
    models: groups(records, "forwardedModel"),
    clients: groups(records, "client"),
    cost: null,
  };
}

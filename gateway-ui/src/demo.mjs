// Synthetic records, never provider telemetry or billing evidence.
export const demo = {
  records: Array.from({ length: 48 }, (_, i) => ({
    id: `demo-${i + 1}`,
    timestamp: new Date(Date.UTC(2026, 10, 13, 8, i * 3)).toISOString(),
    client_label: i % 4 ? "Claude Code" : "OpenCode",
    provider: i % 5 ? "codex" : "openai",
    alias: i % 4 ? "sonnet" : "coding",
    model: i % 5 ? "example-codex-model" : "example-api-model",
    response_model: i % 3 ? "example-codex-model" : null,
    account_label:
      i % 5 ? "Conta demonstrativa OAuth" : "Conta demonstrativa API",
    auth_type: i % 5 ? "oauth" : "api_key",
    tokens: {
      input_tokens: 300 + i * 19,
      output_tokens: 70 + i * 7,
      total_tokens: 370 + i * 26,
    },
    latency_ms: 400 + ((i * 83) % 1900),
    failed: i % 13 === 0,
  })),
};

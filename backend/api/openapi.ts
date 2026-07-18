const capabilityAuth = [{ capabilityToken: [] as string[] }];

export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "MidnightZK Off-Ramp SDK API",
    version: "0.2.0",
    description:
      "Non-custodial ADA → fiat off-ramps with Midnight ZK payee privacy + Cardano PlutusV3 escrow.\n\n" +
      "## Lifecycle state machine\n" +
      "`CREATED → LOCK_SUBMITTED → LOCK_CONFIRMED → MIDNIGHT_INTENT_PROVED → PAYMENT_SUBMITTED → " +
      "SETTLEMENT_CONFIRMED → MIDNIGHT_SETTLEMENT_PROVED → RELEASE_AUTHORIZED → RELEASED`\n\n" +
      "Terminals: `RELEASED`, `PAYMENT_FAILED`, `REFUNDED` (refund also recovers escrow from `PAYMENT_FAILED` " +
      "after the deadline). Every mutation validates the source state (409 on a skip) and is idempotent — " +
      "replaying a completed step returns the stored result with `idempotent: true`.\n\n" +
      "## Authentication\n" +
      "`POST /api/offramp/initiate` returns a per-intent `capabilityToken` exactly once; only its SHA-256 hash " +
      "is persisted. All mutation routes and `GET /api/intents/{id}` require it via the `X-Capability-Token` " +
      "header (or `Authorization: Bearer`). The initiate response also returns `payeeSalt` / `amountSalt` " +
      "exactly once — the server never persists or re-returns cleartext payee handles or salts; stored intents " +
      "contain only commitments, hashes, receipts, and chain references.\n\n" +
      "## Settlement\n" +
      "`confirm-settlement` never accepts a caller-supplied status: the server obtains the provider status " +
      "through the rail adapter (`getStatus`, or `verifyWebhook` on caller-relayed provider webhook bytes) and " +
      "only then has the Settlement Oracle sign an attestation.\n\n" +
      "## Release / refund\n" +
      "Both spend only the stored lock UTxO reference; destinations are bound by the on-chain datum " +
      "(`operatorPkh` / `senderPkh`). Caller-supplied `lockTxHash` / `payoutAddress` overrides are rejected, " +
      "and refund enforces the escrow deadline server-side.",
  },
  servers: [{ url: "/", description: "This server" }],
  tags: [
    { name: "System", description: "Health, OpenAPI" },
    { name: "OffRamp", description: "Off-ramp intent lifecycle" },
    { name: "Cardano", description: "Lock / release / refund on Cardano" },
    { name: "Testing", description: "Internal testing suite + report (disabled outside test mode)" },
  ],
  components: {
    securitySchemes: {
      capabilityToken: {
        type: "apiKey",
        in: "header",
        name: "X-Capability-Token",
        description: "Per-intent capability token returned once by /api/offramp/initiate.",
      },
      testToken: {
        type: "apiKey",
        in: "header",
        name: "X-Test-Token",
        description: "Optional shared secret for test endpoints (OFFRAMP_TEST_TOKEN).",
      },
    },
  },
  paths: {
    "/health": {
      get: {
        tags: ["System"],
        summary: "Health check",
        responses: { "200": { description: "ok" } },
      },
    },
    "/api/adapters": {
      get: {
        tags: ["OffRamp"],
        summary: "List available rail adapters",
        responses: { "200": { description: "ok" } },
      },
    },
    "/api/offramp/initiate": {
      post: {
        tags: ["OffRamp"],
        summary: "Initiate an off-ramp intent (state: CREATED)",
        description:
          "Builds commitments + rail quote; no on-chain tx. Returns `capabilityToken`, `payeeSalt`, and " +
          "`amountSalt` exactly once — none of them are persisted, and cleartext `payeeHandle` is never stored.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              example: { adapter: "cashapp", payeeHandle: "$alice", amountAda: 2, fiatAmount: "1.50", fiatCurrency: "USD" },
            },
          },
        },
        responses: { "200": { description: "intent created; one-time secrets in response" }, "400": { description: "invalid parameters" } },
      },
    },
    "/api/offramp/lock": {
      post: {
        tags: ["Cardano"],
        summary: "Submit Cardano LOCK tx (CREATED → LOCK_SUBMITTED)",
        description: "Pays the configured escrow into the validator with inline EscrowDatum. Idempotent.",
        security: capabilityAuth,
        requestBody: { required: true, content: { "application/json": { example: { intentId: "<hex>" } } } },
        responses: {
          "200": { description: "tx submitted (or stored result replayed)" },
          "401": { description: "missing/invalid capability token" },
          "409": { description: "invalid source state" },
        },
      },
    },
    "/api/offramp/confirm-lock": {
      post: {
        tags: ["Cardano"],
        summary: "Confirm the lock UTxO on-chain (LOCK_SUBMITTED → LOCK_CONFIRMED)",
        security: capabilityAuth,
        requestBody: { required: true, content: { "application/json": { example: { intentId: "<hex>" } } } },
        responses: {
          "200": { description: "lock confirmed" },
          "401": { description: "missing/invalid capability token" },
          "409": { description: "not yet visible on-chain or invalid source state" },
        },
      },
    },
    "/api/offramp/prove": {
      post: {
        tags: ["OffRamp"],
        summary: "Generate Midnight ZK proof (LOCK_CONFIRMED → MIDNIGHT_INTENT_PROVED)",
        description: "The client re-supplies the payee handle + salts (held client-side); the server never persists them.",
        security: capabilityAuth,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              example: { intentId: "<hex>", payeeHandle: "$alice", payeeSalt: "<hex>", amountSalt: "<hex>" },
            },
          },
        },
        responses: {
          "200": { description: "proof generated (or stored proof replayed)" },
          "401": { description: "missing/invalid capability token" },
          "409": { description: "invalid source state" },
        },
      },
    },
    "/api/offramp/submit-payment": {
      post: {
        tags: ["OffRamp"],
        summary: "Submit fiat payment via rail adapter (MIDNIGHT_INTENT_PROVED → PAYMENT_SUBMITTED)",
        security: capabilityAuth,
        requestBody: {
          required: true,
          content: { "application/json": { example: { intentId: "<hex>", payeeHandle: "$alice" } } },
        },
        responses: {
          "200": { description: "payment submitted (or stored result replayed)" },
          "401": { description: "missing/invalid capability token" },
          "409": { description: "invalid source state" },
          "502": { description: "adapter rejected the submission (state → PAYMENT_FAILED)" },
        },
      },
    },
    "/api/offramp/confirm-settlement": {
      post: {
        tags: ["OffRamp"],
        summary: "Confirm settlement via adapter status + Settlement Oracle (PAYMENT_SUBMITTED → … → MIDNIGHT_SETTLEMENT_PROVED)",
        description:
          "Caller-supplied `status` is rejected. The server queries the rail adapter's authenticated status " +
          "endpoint (or verifies relayed provider webhook bytes via the adapter) and only attests terminal " +
          "provider states. A FAILED provider status transitions to PAYMENT_FAILED.",
        security: capabilityAuth,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              examples: {
                poll: { value: { intentId: "<hex>" } },
                webhook: { value: { intentId: "<hex>", webhook: { rawBody: "<provider bytes>", headers: { "x-provider-signature": "<sig>" } } } },
              },
            },
          },
        },
        responses: {
          "200": { description: "attestation (+ Midnight settlement receipt when SETTLED)" },
          "400": { description: "caller-asserted status or invalid webhook" },
          "401": { description: "missing/invalid capability token" },
          "409": { description: "provider status not terminal, or invalid source state" },
        },
      },
    },
    "/api/offramp/release": {
      post: {
        tags: ["Cardano"],
        summary: "Authorize + submit Cardano RELEASE tx (MIDNIGHT_SETTLEMENT_PROVED → RELEASE_AUTHORIZED → RELEASED)",
        description:
          "Uses only the stored lock UTxO reference and the datum-bound operator destination. The release " +
          "authorization is built from the stored oracle attestation + Midnight settlement receipt and signed " +
          "server-side by the oracle key. `lockTxHash` / `payoutAddress` / `oracleSignature` overrides are rejected.",
        security: capabilityAuth,
        requestBody: { required: true, content: { "application/json": { example: { intentId: "<hex>" } } } },
        responses: {
          "200": { description: "tx submitted (or stored result replayed)" },
          "400": { description: "override field supplied" },
          "401": { description: "missing/invalid capability token" },
          "409": { description: "settlement evidence missing, deadline passed, or invalid source state" },
        },
      },
    },
    "/api/offramp/refund": {
      post: {
        tags: ["Cardano"],
        summary: "Submit Cardano REFUND tx after the deadline (→ REFUNDED)",
        description:
          "Uses only the stored lock UTxO reference and the datum-bound sender destination. The escrow deadline " +
          "is enforced server-side (and again on-chain). Override fields are rejected.",
        security: capabilityAuth,
        requestBody: { required: true, content: { "application/json": { example: { intentId: "<hex>" } } } },
        responses: {
          "200": { description: "tx submitted (or stored result replayed)" },
          "400": { description: "override field supplied" },
          "401": { description: "missing/invalid capability token" },
          "409": { description: "deadline not reached or invalid source state" },
        },
      },
    },
    "/api/intents": {
      get: {
        tags: ["OffRamp"],
        summary: "List intent summaries (id, state, adapter, timestamps only)",
        responses: { "200": { description: "ok" } },
      },
    },
    "/api/intents/{id}": {
      get: {
        tags: ["OffRamp"],
        summary: "Get a single intent (requires the intent's capability token)",
        security: capabilityAuth,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "ok" },
          "401": { description: "missing/invalid capability token" },
          "404": { description: "not found" },
        },
      },
    },
    "/api/testing-report": {
      get: {
        tags: ["Testing"],
        summary: "Get latest internal testing report",
        description: "403 unless OFFRAMP_ENABLE_TEST_ENDPOINTS=1; requires X-Test-Token when OFFRAMP_TEST_TOKEN is set.",
        security: [{ testToken: [] as string[] }],
        responses: { "200": { description: "ok" }, "403": { description: "test endpoints disabled" } },
      },
    },
    "/api/test/run-suite": {
      post: {
        tags: ["Testing"],
        summary: "Run the internal testing suite (simulated off-ramps)",
        description: "403 unless OFFRAMP_ENABLE_TEST_ENDPOINTS=1; requires X-Test-Token when OFFRAMP_TEST_TOKEN is set.",
        security: [{ testToken: [] as string[] }],
        requestBody: { required: false, content: { "application/json": { example: { runsPerRail: 10 } } } },
        responses: { "200": { description: "report" }, "403": { description: "test endpoints disabled" } },
      },
    },
  },
};

export const swaggerHtml = (specUrl = "/api/openapi.json") => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>MidnightZK Off-Ramp SDK API</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>body{margin:0}#ui{height:100vh}</style>
</head>
<body>
  <div id="ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = () => SwaggerUIBundle({ url: ${JSON.stringify(specUrl)}, dom_id: "#ui", deepLinking: true });
  </script>
</body>
</html>`;

export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "MidnightZK Off-Ramp SDK API",
    version: "0.1.0",
    description:
      "Non-custodial ADA → fiat off-ramps with Midnight ZK payee privacy + Cardano PlutusV3 escrow.\n\n## Pipeline\n1. **Initiate** — create commitments + rail quote, no on-chain state yet\n2. **Lock ADA** — pay min-ADA into the escrow validator with inline EscrowDatum\n3. **Generate ZK Proof** — prove knowledge of payee + amount witnesses without revealing them\n4. **Submit Payment** — route through Cash App / Wise / Revolut sandbox adapter\n5. **Confirm Settlement** — Settlement Oracle signs canonical attestation from rail webhook\n6. **Release** — operator spends escrow UTxO (a future revision will additionally verify proof + attestation on-chain)\n\nAlternative path: **Refund** spends escrow back to the sender after the deadline if the rail did not settle.",
  },
  servers: [{ url: "/", description: "This server" }],
  tags: [
    { name: "System", description: "Health, OpenAPI" },
    { name: "OffRamp", description: "Off-ramp intent lifecycle" },
    { name: "Cardano", description: "Lock / release / refund on Cardano" },
    { name: "Testing", description: "Internal testing suite + report" },
  ],
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
        summary: "Initiate an off-ramp intent (no on-chain tx)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              example: { adapter: "cashapp", payeeHandle: "$alice", amountAda: 2, fiatAmount: "1.50", fiatCurrency: "USD" },
            },
          },
        },
        responses: { "200": { description: "intent created" } },
      },
    },
    "/api/offramp/lock": {
      post: {
        tags: ["Cardano"],
        summary: "Submit Cardano LOCK tx",
        description: "Pays the configured min-ADA into the escrow validator with inline EscrowDatum. Returns the Cardano txHash + script address.",
        requestBody: { required: true, content: { "application/json": { example: { intentId: "<hex>" } } } },
        responses: { "200": { description: "tx submitted" } },
      },
    },
    "/api/offramp/prove": {
      post: {
        tags: ["OffRamp"],
        summary: "Generate Midnight ZK proof",
        requestBody: { required: true, content: { "application/json": { example: { intentId: "<hex>" } } } },
        responses: { "200": { description: "proof generated" } },
      },
    },
    "/api/offramp/submit-payment": {
      post: {
        tags: ["OffRamp"],
        summary: "Submit fiat payment via rail adapter",
        requestBody: { required: true, content: { "application/json": { example: { intentId: "<hex>" } } } },
        responses: { "200": { description: "payment submitted" } },
      },
    },
    "/api/offramp/confirm-settlement": {
      post: {
        tags: ["OffRamp"],
        summary: "Confirm settlement via Settlement Oracle",
        requestBody: { required: true, content: { "application/json": { example: { intentId: "<hex>" } } } },
        responses: { "200": { description: "settlement confirmed" } },
      },
    },
    "/api/offramp/release": {
      post: {
        tags: ["Cardano"],
        summary: "Submit Cardano RELEASE tx",
        requestBody: { required: true, content: { "application/json": { example: { intentId: "<hex>", lockTxHash: "<hex>", lockOutputIndex: 0 } } } },
        responses: { "200": { description: "tx submitted" } },
      },
    },
    "/api/offramp/refund": {
      post: {
        tags: ["Cardano"],
        summary: "Submit Cardano REFUND tx (after deadline)",
        requestBody: { required: true, content: { "application/json": { example: { intentId: "<hex>", lockTxHash: "<hex>", lockOutputIndex: 0 } } } },
        responses: { "200": { description: "tx submitted" } },
      },
    },
    "/api/intents": { get: { tags: ["OffRamp"], summary: "List all intents", responses: { "200": { description: "ok" } } } },
    "/api/intents/{id}": {
      get: {
        tags: ["OffRamp"],
        summary: "Get a single intent",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "ok" }, "404": { description: "not found" } },
      },
    },
    "/api/testing-report": { get: { tags: ["Testing"], summary: "Get latest internal testing report", responses: { "200": { description: "ok" } } } },
    "/api/test/run-suite": {
      post: {
        tags: ["Testing"],
        summary: "Run the internal testing suite (30 simulated off-ramps)",
        requestBody: { required: false, content: { "application/json": { example: { runsPerRail: 10 } } } },
        responses: { "200": { description: "report" } },
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

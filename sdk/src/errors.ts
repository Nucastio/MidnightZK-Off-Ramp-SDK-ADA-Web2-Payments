export class SDKError extends Error {
  constructor(message: string, public readonly code: string, public readonly cause?: unknown) {
    super(message);
    this.name = "SDKError";
  }
}

export class IntentNotFoundError extends SDKError {
  constructor(intentId: string) {
    super(`intent not found: ${intentId}`, "INTENT_NOT_FOUND");
  }
}

export class IntentStateError extends SDKError {
  constructor(from: string, to: string) {
    super(`invalid state transition ${from} → ${to}`, "INTENT_STATE");
  }
}

export class ProofVerifyError extends SDKError {
  constructor(reason: string) {
    super(`zk proof verification failed: ${reason}`, "PROOF_VERIFY");
  }
}

export class RailError extends SDKError {
  constructor(rail: string, reason: string) {
    super(`rail ${rail}: ${reason}`, "RAIL_ERROR");
  }
}

export class OracleError extends SDKError {
  constructor(reason: string) {
    super(`oracle: ${reason}`, "ORACLE");
  }
}

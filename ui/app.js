// Resolves the backend base URL: same origin if served behind the same tunnel,
// otherwise the dev port. Override at runtime with `?api=https://...`.
const API_BASE = (() => {
  const q = new URLSearchParams(location.search).get("api");
  if (q) return q.replace(/\/$/, "");
  if (location.port === "5181" || location.port === "5175" || location.port === "5174" || location.protocol === "file:") return "http://127.0.0.1:8801";
  return "";
})();

document.getElementById("api-docs").href = (API_BASE || "") + "/docs";

const $ = (id) => document.getElementById(id);
const state = {
  intent: null,
  // One-time secrets returned by /initiate; held in page memory only.
  capabilityToken: null,
  payeeHandle: null,
  payeeSalt: null,
  amountSalt: null,
  lockTxHash: null,
};

function log(col, msg, klass = "") {
  const el = $(col === "midnight" ? "log-midnight" : "log-cardano");
  const div = document.createElement("div");
  div.className = "log-entry " + klass;
  const ts = new Date().toLocaleTimeString();
  div.innerHTML = `<span class="log-time">${ts}</span>${msg}`;
  el.prepend(div);
}

function setResult(elId, payload, ok = true) {
  const el = $(elId);
  el.hidden = false;
  el.className = "result " + (ok ? "ok" : "err");
  if (typeof payload === "string") {
    el.textContent = payload;
  } else {
    el.innerHTML = Object.entries(payload).map(([k, v]) => {
      let val = v;
      if (typeof v === "string" && v.length > 40) val = `<code>${v.slice(0, 16)}…${v.slice(-8)}</code>`;
      if (typeof v === "string" && (v.startsWith("http"))) val = `<a href="${v}" target="_blank">${v}</a>`;
      return `<div class="kv"><strong>${k}</strong> ${val}</div>`;
    }).join("");
  }
}

function setStepStatus(stepId, status, label) {
  const el = $(stepId);
  el.classList.remove("active", "done", "error");
  if (status) el.classList.add(status);
  if (label) el.querySelector(".step-status").textContent = label;
}

async function api(path, body) {
  const opt = { method: body ? "POST" : "GET", headers: {} };
  if (body) {
    opt.headers["Content-Type"] = "application/json";
    opt.body = JSON.stringify(body);
  }
  // Per-intent capability token: required on every mutation + detail read.
  if (state.capabilityToken) opt.headers["X-Capability-Token"] = state.capabilityToken;
  const res = await fetch(API_BASE + path, opt);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function bootHero() {
  try {
    const h = await api("/health");
    $("hero-network").textContent = h.cardano.network;
    $("hero-escrow").textContent = h.cardano.escrowScriptAddress.slice(0, 12) + "…" + h.cardano.escrowScriptAddress.slice(-6);
    $("hero-escrow").title = h.cardano.escrowScriptAddress;
    $("hero-circuit").textContent = h.midnight.circuitId;
    $("hero-vk").textContent = h.midnight.vkHash.slice(0, 10) + "…";
    $("hero-vk").title = h.midnight.vkHash;
    $("hero-mode").textContent = h.railAdapterMode;
  } catch (e) {
    $("hero-network").textContent = "(backend offline)";
  }
  try {
    const r = await api("/api/testnet-evidence").catch(() => null);
    if (r && r.items) {
      const ul = $("testnet-list");
      ul.innerHTML = r.items.map((it) => `<li><strong>${it.kind}</strong> — <a href="${it.explorer}" target="_blank">${it.txHash.slice(0, 16)}…</a></li>`).join("");
    }
  } catch {}
}

$("btn-initiate").addEventListener("click", async () => {
  const body = {
    adapter: $("f-adapter").value,
    payeeHandle: $("f-payee").value,
    amountAda: Number($("f-lovelace").value) / 1_000_000,
    fiatAmount: $("f-fiat").value,
    fiatCurrency: $("f-currency").value,
  };
  setStepStatus("step-1", "active", "Building commitments…");
  try {
    const r = await api("/api/offramp/initiate", body);
    state.intent = r.intent;
    state.capabilityToken = r.capabilityToken; // returned exactly once
    state.payeeHandle = body.payeeHandle;      // never returned by the server
    state.payeeSalt = r.payeeSalt;
    state.amountSalt = r.amountSalt;
    state.lockTxHash = null;
    log("midnight", `intent ${r.intent.intentId.slice(0, 16)}… created  payee=${r.intent.initiate.payeeCommitment.slice(0, 12)}…`, "ok");
    setStepStatus("step-1", "done", "Done");
    setResult("r-initiate", {
      intentId: r.intent.intentId,
      state: r.intent.state,
      payeeCommitment: r.intent.initiate.payeeCommitment,
      amountCommitment: r.intent.initiate.amountCommitment,
      adapterTag: r.intent.initiate.adapterTag,
      vkHash: r.intent.initiate.vkHash,
      "rail quote digest": r.intent.quote.railQuoteDigest,
      deadline: new Date(r.intent.initiate.deadline * 1000).toISOString(),
      capabilityToken: r.capabilityToken,
    });
    $("btn-lock").disabled = false;
    $("btn-prove").disabled = false;
  } catch (e) {
    setStepStatus("step-1", "error", e.message);
    setResult("r-initiate", e.message, false);
  }
});

$("btn-lock").addEventListener("click", async () => {
  if (!state.intent) return;
  setStepStatus("step-2", "active", "Submitting LOCK tx…");
  $("btn-lock").disabled = true;
  try {
    const r = await api("/api/offramp/lock", { intentId: state.intent.intentId });
    state.lockTxHash = r.txHash;
    log("cardano", `LOCK tx ${r.txHash.slice(0, 16)}… → ${(r.scriptAddress || "").slice(0, 14)}…`, "ok");
    setStepStatus("step-2", "active", "Waiting for on-chain confirmation…");
    // The lifecycle requires LOCK_CONFIRMED before proving.
    let confirmed = false;
    for (let attempt = 0; attempt < 30 && !confirmed; attempt++) {
      try {
        const cr = await api("/api/offramp/confirm-lock", { intentId: state.intent.intentId });
        confirmed = cr.state === "LOCK_CONFIRMED" || cr.idempotent === true;
      } catch (err) {
        await sleep(10_000);
      }
    }
    if (!confirmed) throw new Error("lock tx not confirmed yet — retry Lock to re-check");
    log("cardano", "LOCK confirmed on-chain (state LOCK_CONFIRMED)", "ok");
    setStepStatus("step-2", "done", "Locked + confirmed");
    setResult("r-lock", { txHash: r.txHash, scriptAddress: r.scriptAddress, state: "LOCK_CONFIRMED" });
  } catch (e) {
    setStepStatus("step-2", "error", e.message);
    setResult("r-lock", e.message, false);
    $("btn-lock").disabled = false;
  }
});

$("btn-skip-lock").addEventListener("click", () => {
  if (!state.intent) return;
  setStepStatus("step-2", "error", "Cannot skip: lifecycle requires a confirmed lock");
  log("cardano", "lock skip unavailable — the state machine requires LOCK_CONFIRMED before proving", "err");
});

$("btn-prove").addEventListener("click", async () => {
  if (!state.intent) return;
  setStepStatus("step-3", "active", "Proving…");
  $("btn-prove").disabled = true;
  try {
    const r = await api("/api/offramp/prove", {
      intentId: state.intent.intentId,
      payeeHandle: state.payeeHandle,
      payeeSalt: state.payeeSalt,
      amountSalt: state.amountSalt,
    });
    const proveMs = r.proof.timestamps ? (r.proof.timestamps.completedAtMs - r.proof.timestamps.startedAtMs) : undefined;
    log("midnight", `intent receipt ${r.proof.receiptHash.slice(0, 16)}…  state=${r.state}`, "ok");
    setStepStatus("step-3", "done", proveMs !== undefined ? `Done (${proveMs} ms)` : "Done");
    setResult("r-prove", {
      receiptHash: r.proof.receiptHash,
      contractAddress: r.proof.contractAddress,
      payeeCommitment: r.proof.publicInputs.payeeCommitment,
      amountCommitment: r.proof.publicInputs.amountCommitment,
      state: r.state,
    });
    $("btn-submit").disabled = false;
  } catch (e) {
    setStepStatus("step-3", "error", e.message);
    setResult("r-prove", e.message, false);
    $("btn-prove").disabled = false;
  }
});

$("btn-submit").addEventListener("click", async () => {
  if (!state.intent) return;
  setStepStatus("step-4", "active", "Submitting payment…");
  $("btn-submit").disabled = true;
  try {
    const r = await api("/api/offramp/submit-payment", {
      intentId: state.intent.intentId,
      payeeHandle: state.payeeHandle,
    });
    log("midnight", `rail ${state.intent.adapter}: ${r.result.status}  ref=${r.result.railTxRef}`, r.result.status === "ACCEPTED" ? "ok" : "err");
    setStepStatus("step-4", "done", `${state.intent.adapter}: ${r.result.status}`);
    setResult("r-submit", { railTxRef: r.result.railTxRef, status: r.result.status, providerStatus: r.result.providerStatus, state: r.state });
    $("btn-settle").disabled = false;
  } catch (e) {
    setStepStatus("step-4", "error", e.message);
    setResult("r-submit", e.message, false);
    $("btn-submit").disabled = false;
  }
});

$("btn-settle").addEventListener("click", async () => {
  if (!state.intent) return;
  setStepStatus("step-5", "active", "Checking provider + signing attestation…");
  $("btn-settle").disabled = true;
  try {
    // No caller-supplied status: the backend asks the rail adapter and only
    // then has the oracle attest.
    const r = await api("/api/offramp/confirm-settlement", { intentId: state.intent.intentId });
    log("midnight", `oracle ${r.attestation.status}  digest=${r.attestation.settlementDigest.slice(0, 16)}…  state=${r.state}`, "ok");
    setStepStatus("step-5", "done", `Attested ${r.attestation.status}`);
    setResult("r-settle", {
      settlementDigest: r.attestation.settlementDigest,
      signature: r.attestation.signature.slice(0, 24) + "…",
      signedAt: new Date(r.attestation.signedAt * 1000).toISOString(),
      state: r.state,
    });
    if (state.lockTxHash) $("btn-release").disabled = false;
  } catch (e) {
    setStepStatus("step-5", "error", e.message);
    setResult("r-settle", e.message, false);
    $("btn-settle").disabled = false;
  }
});

$("btn-release").addEventListener("click", async () => {
  if (!state.intent) return;
  setStepStatus("step-6", "active", "Authorizing + submitting RELEASE tx…");
  $("btn-release").disabled = true;
  try {
    // Server uses the stored lock UTxO + datum-bound destination only.
    const r = await api("/api/offramp/release", { intentId: state.intent.intentId });
    log("cardano", `RELEASE tx ${r.txHash.slice(0, 16)}…`, "ok");
    setStepStatus("step-6", "done", "Released");
    setResult("r-release", { txHash: r.txHash, state: r.state });
  } catch (e) {
    setStepStatus("step-6", "error", e.message);
    setResult("r-release", e.message, false);
    $("btn-release").disabled = false;
  }
});

$("btn-refund").addEventListener("click", async () => {
  if (!state.intent) {
    setResult("r-release", "no intent — initiate first", false);
    return;
  }
  setStepStatus("step-6", "active", "Submitting REFUND tx…");
  try {
    // Server enforces the deadline and uses the stored lock UTxO only.
    const r = await api("/api/offramp/refund", { intentId: state.intent.intentId });
    log("cardano", `REFUND tx ${r.txHash.slice(0, 16)}…`, "ok");
    setStepStatus("step-6", "done", "Refunded");
    setResult("r-release", { txHash: r.txHash, state: r.state });
  } catch (e) {
    setStepStatus("step-6", "error", e.message);
    setResult("r-release", e.message, false);
  }
});

$("btn-test").addEventListener("click", async () => {
  const runs = Number($("f-runs").value || "10");
  $("btn-test").disabled = true;
  $("r-test").innerHTML = `<div class="test-row">Running ${runs * 3} simulated off-ramps…</div>`;
  try {
    const r = await api("/api/test/run-suite", { runsPerRail: runs });
    const report = r.report;
    const rows = [];
    rows.push(`<div class="test-row ${report.overallSuccessRate >= 0.9 ? "ok" : "fail"}"><strong>Overall</strong><span>${(report.overallSuccessRate * 100).toFixed(1)}% (${report.totalRuns} runs)</span></div>`);
    for (const [adapter, row] of Object.entries(report.perRail)) {
      rows.push(`<div class="test-row ${row.successRate >= 0.9 ? "ok" : "fail"}"><span>${adapter}</span><span>${(row.successRate * 100).toFixed(1)}% · prove ${row.avgProveMs}ms</span></div>`);
    }
    rows.push(`<div class="test-row"><span>Avg prove</span><span>${report.avgProveMs} ms (target ≤ 50 000 ms)</span></div>`);
    $("r-test").innerHTML = rows.join("");
    log("midnight", `test suite: ${(report.overallSuccessRate * 100).toFixed(1)}% over ${report.totalRuns} runs`, report.overallSuccessRate >= 0.9 ? "ok" : "err");
  } catch (e) {
    $("r-test").innerHTML = `<div class="test-row fail">${e.message}</div>`;
  } finally {
    $("btn-test").disabled = false;
  }
});

bootHero();

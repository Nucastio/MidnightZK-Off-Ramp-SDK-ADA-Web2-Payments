# E2E Run 1 — Full Off-Ramp Happy Path (REAL infrastructure)

- **Result:** PASSED
- **Started:** 2026-07-18T09:24:22.054Z — **Completed:** 2026-07-18T10:04:24.990Z
- **Flow:** SDK initiate → Preprod LOCK → Midnight intent proofs → Revolut sandbox payout (SETTLED) → oracle attestation → Midnight settlement proof → signed ReleaseAuthorization → Preprod RELEASE
- Machine-readable evidence: [`e2e-run-1.json`](./e2e-run-1.json)

## Environment

| Component | Value |
|---|---|
| Cardano | Preprod via Blockfrost (`https://cardano-preprod.blockfrost.io/api/v0`) |
| Escrow script | `addr_test1wp5lfjw2zlh4yxq8t8u6p8cxfacxdycp9w2n3j56k59h0ngyj3752` |
| Sender wallet | `addr_test1qqe7et9t7fyuwsvkxtsvauhdanmekqgj3nzuhhva7c3aqryfwv32hch4m0mfkshdul73fstpx89l7h0z73t328p06g4snrcxhg` (pkh `33ecacabf249c7419632e0cef2edecf79b01128cc5cbdd9df623d00c`) |
| Operator wallet (distinct) | `addr_test1qp6fa9elr5z32059z0mt3ps3d0yq058wpq7u8nnc3mdx2rt3kmkg85y7flkpu2ldh2uuuqfdsysu42y623x5794raxws2gaefv` (pkh `749e973f1d05153e8513f6b886116bc807d0ee083dc3ce788eda650d`) |
| Operator funding | [`411d2eeea83fe30d12eff37f2ffd0babff737049fb957047f2ebb2ec88b9c241`](https://preprod.cardanoscan.io/transaction/411d2eeea83fe30d12eff37f2ffd0babff737049fb957047f2ebb2ec88b9c241) |
| Midnight | local devnet `undeployed` — node `http://127.0.0.1:9944`, indexer `http://127.0.0.1:8088/api/v4/graphql`, proof server `http://127.0.0.1:6300` |
| Rail | Revolut Business **live sandbox** (`sandbox-b2b.revolut.com`), adapter mode `sandbox` |

## 1. Intent (SDK `initiateOffRamp`)

| Field | Value |
|---|---|
| intentId | `1fc68f0700323c4c7927fedabd79beeed00cef917655e52678d629a57b5dd5d9` |
| adapter / payee | `revolut` / `@test_user_rv` |
| fiat | 1.00 GBP |
| escrow | 5 tADA |
| payeeCommitment | `38124eb19dd0228f38258076f929ee30263bf36f826e786c4d52d58fb70d1582` |
| amountCommitment | `c6afb9f091aefef22def244c87f41b1e1cb076a759f0f5e422faf3d46cda78d2` |
| adapterTag | `dc15caf5e70789899eba52749eb21fb61da5519f4b2fc003631fb2920ba6e625` |
| artifact (vk) hash | `37bf29a720a3451c0de6479a976161fbc8350dc64c0dc4bc9d2448386dc7e7cc` |
| deadline | 2026-07-18T10:09:50.000Z (~45 min) |

## 2. Cardano LOCK

- **Tx:** [`7b711f7e5d1816e89f988a90a8c6def90f4679ab8294afe99149c373f1c580eb`](https://preprod.cardanoscan.io/transaction/7b711f7e5d1816e89f988a90a8c6def90f4679ab8294afe99149c373f1c580eb)
- Escrow UTxO: `7b711f7e5d1816e89f988a90a8c6def90f4679ab8294afe99149c373f1c580eb#0` — 5 tADA at `addr_test1wp5lfjw2zlh4yxq8t8u6p8cxfacxdycp9w2n3j56k59h0ngyj3752`
- Block 4949970, confirmed after 44s
- Hardened inline datum: distinct sender/operator PKHs, real artifact hash, oracle Ed25519 pubkey `b9979d7f1f42819a97e9ecfd904181beb38a1ff697b46de53a3613c08ad35bff`
- On-chain datum round-trip decode matches submitted datum: **true**

## 3. Midnight intent proofs (local devnet, real proof server)

- Contract (own instance): `cfb3512701425646bca3711775651f30acc589a716c48745d9a4314327ca37c3`
- Intent receipt hash: `4329bbda1a05fe2a3e3564527dc45938bd2a9c27c011a0ccdafae37ba2581f69`
- Public state hash: `2a5a49bf575da3fa06be3a674649849db816c6e336c9164752a576d5a8f489ff`
- l1Anchor bound to the LOCK tx hash: `7b711f7e5d1816e89f988a90a8c6def90f4679ab8294afe99149c373f1c580eb`
- Online verification (indexer + finalized state): **ok**, 59ms; prove 94953ms

| Operation | txId | Block | Block hash |
|---|---|---|---|
| deploy | `00fa0ccccbad9a4a030a1aca7546399b9aa9b6bce62e8b0c5b41a2834785c66c24` | 961079 | `108a21a52922f532…` |
| bindOffRampIntent | `002f92e41ed9b7a44b2b435e9ea19d929836e4db1b5c527f3a7482b6770a7b8fee` | 961083 | `80e2c6185b740eb6…` |
| provePayeeBinding | `004a30aca72b88c2a3de395437ffd2719f8930640066c3f563d9f322ffc8eaaebf` | 961087 | `1cf25b6e6fd61562…` |
| proveAmountBinding | `00ed3bc8f104dec6bed7e3820af169cd8c82c0952069bb9fffa2df4934a364039f` | 961091 | `cc9147727e490d5d…` |

## 4. Revolut live sandbox payout

- Payment id (railTxRef): `054d1c27-54d3-e347-0040-00c9be500222`
- request_id (idempotency): `e04db010-fe7a-5aee-bdfe-3ec6d109d428`
- counterparty: `510b4c7d-a7e9-4381-b12f-e4d65bf1e359`
- Submit state: `pending` → authenticated status polls → **SETTLED** (provider state `completed` at 2026-07-18T09:27:21.470Z)

## 5. Settlement oracle attestation

- settlementDigest: `460ba214e8d2d6e6887edd2565c4a2931360eaae0562ee7991cf2232983f74c5`
- signedAt: 1784366841 — signature: `e60fc306b42940cd6d040b514432a7e0…`
- Derivation: settlementDigest = sha256('offramp:settlement:v1' + '|' + intentId + '|' + railTxRef + '|' + status + '|' + signedAt); attestation body canonicalized (sorted keys) and Ed25519-signed with the operator oracle key (sdk/src/oracle/settlement-oracle.ts attestSettlement).

## 6. Midnight settlement proof

- `proveOffRampSettlement` tx: `00a989716d0b5f205a9aae3609ef0bec7e698b80e0fcef851866efdbfcb399b7e4` (block 961096)
- Settlement receipt hash: `f2645ac44628c62a0ccda11d75507e3d9789791bc03197208c436a225fae2e84`
- Ledger settlementDigest now equals the oracle digest: `460ba214e8d2d6e6887edd2565c4a2931360eaae0562ee7991cf2232983f74c5`
- Online verification: **ok**, 29ms; prove 23180ms

## 7. Release authorization (canonical bytes, two-step)

- Lock UTxO: `7b711f7e5d1816e89f988a90a8c6def90f4679ab8294afe99149c373f1c580eb#0`
- Canonical message (CBOR hex): `d8799f581b4d49444e494748545f4f464652414d505f52454c454153455f563158201fc68f0700323c4c7927fedabd79…` (full value in JSON)
- Oracle Ed25519 signature (stage 7): `df9a21816b1c20f0683b7e8d4f79a6a9428cbfcaed24a2e306742f2c81f85b69967849bd51b8ffff31695cbddd730fe06509fedb42e07fb5b750f7e58f848601`
- The confirmed release used a fresh authorization over the same message fields with a new expiry (2026-07-18T10:09:50.000Z); signature `ef37b8c6865086afa5b13a24aeeb3e4254388be5c1c0579769839816d9ae43e44c4ccdb9261b85c23bb1ae3598d034e5fc2a58c25468b8255e32275d5efb1d0a`

## 8. Cardano RELEASE

- **Tx:** [`5e6531e8e3f7327d122255c0583cf287c585be3e32023a5683841b0a23e207f9`](https://preprod.cardanoscan.io/transaction/5e6531e8e3f7327d122255c0583cf287c585be3e32023a5683841b0a23e207f9)
- Spends escrow UTxO `7b711f7e5d1816e89f988a90a8c6def90f4679ab8294afe99149c373f1c580eb#0`; pays the exact 5 tADA escrow to the operator address (output #0); fees paid from the operator's own UTxO
- Block 4950075, confirmed after 1s

### Incident (recorded honestly)

The FIRST release submission was rejected by the Preprod node with
`OutsideValidityIntervalUTxO` — the local clock was ~8 slots ahead of the
chain tip while `submitReleaseTx` pinned `validFrom = Date.now()`. The fix
back-dates `validFrom` by `CARDANO_RELEASE_CLOCK_SKEW_MS` (default 120 s)
in `sdk/src/cardano/release.ts`. Stages 0–7 were not re-run; the resume
driver re-signed a fresh authorization over the same settlement digest and
receipt hash. Original error (verbatim) is preserved at
`stages["8-cardano-release"].clockSkewIncident.firstAttempt.error` in the JSON.

## Stage timings

| Stage | Duration |
|---|---|
| 0-preflight | 27.5s |
| 1-initiate | 0s |
| 2-cardano-lock | 48.7s |
| 3-midnight-intent | 95s |
| 4-revolut-payout | 7.4s |
| 5-oracle-attestation | 0s |
| 6-midnight-settlement | 23.2s |
| 7-release-authorization | 0.8s |
| 8-cardano-release | 6.1s |

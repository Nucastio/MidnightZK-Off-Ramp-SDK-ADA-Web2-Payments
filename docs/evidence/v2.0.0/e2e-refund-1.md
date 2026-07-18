# E2E Refund Run 1 — Deadline-Gated Refund Path (REAL infrastructure)

- **Result:** PASSED
- **Started:** 2026-07-18T10:06:45.866Z — **Completed:** 2026-07-18T10:13:14.457Z
- **Flow:** SDK initiate (deadline 240 s) → Preprod LOCK → early refund attempt **rejected** → wait past deadline → REFUND confirmed, full escrow value back to the sender
- Machine-readable evidence: [`e2e-refund-1.json`](./e2e-refund-1.json)

## Environment

| Component | Value |
|---|---|
| Cardano | Preprod via Blockfrost (`https://cardano-preprod.blockfrost.io/api/v0`) |
| Escrow script | `addr_test1wp5lfjw2zlh4yxq8t8u6p8cxfacxdycp9w2n3j56k59h0ngyj3752` |
| Sender wallet | `addr_test1qqe7et9t7fyuwsvkxtsvauhdanmekqgj3nzuhhva7c3aqryfwv32hch4m0mfkshdul73fstpx89l7h0z73t328p06g4snrcxhg` (pkh `33ecacabf249c7419632e0cef2edecf79b01128cc5cbdd9df623d00c`) |
| Escrow deadline | 240 s (ESCROW_DEADLINE_SECONDS=240) |

## 1. Intent

| Field | Value |
|---|---|
| intentId | `dcb2372c2cf47b020005c28b7cad2b1b38aca6d67f6749402bbc5264b423b4c4` |
| payeeCommitment | `fd362061164d1d0641246283df2895c395ecb0cebfa457d8539e353413dd4525` |
| amountCommitment | `ae0b25430d716867b93f6825bd869149df51144f7ab2384bfb2336446a67009f` |
| escrow | 5 tADA |
| deadline | 2026-07-18T10:10:47.000Z |

## 2. Cardano LOCK

- **Tx:** [`60c740958a13ce55cbdee59af176f819f1cdf603601a5402bdd36ffddae57d1d`](https://preprod.cardanoscan.io/transaction/60c740958a13ce55cbdee59af176f819f1cdf603601a5402bdd36ffddae57d1d)
- Escrow UTxO: `60c740958a13ce55cbdee59af176f819f1cdf603601a5402bdd36ffddae57d1d#0` — 5 tADA at `addr_test1wp5lfjw2zlh4yxq8t8u6p8cxfacxdycp9w2n3j56k59h0ngyj3752`
- Block 4950088, confirmed after 27s

## 3. Early refund attempt — REJECTED (as designed)

- Attempted at 2026-07-18T10:07:18.290Z, **209 s before** the datum deadline
- The SDK pins the refund tx validity interval to start at the datum deadline, so the chain refuses it before then
- Rejection error (verbatim):

```
Error: {"contents":{"contents":{"contents":{"era":"ShelleyBasedEraConway","error":["ConwayUtxowFailure (UtxoFailure (OutsideValidityIntervalUTxO (ValidityInterval {invalidBefore = SJust (SlotNo 128686247), invalidHereafter = SJust (SlotNo 128686847)}) (SlotNo 128686032)))","ConwayUtxowFailure (UtxoFailure (CollateralContainsNonADA (MaryValue (Coin 6186074887) (MultiAsset (fromList [(PolicyID {policyID = ScriptHash \"1a9b0844f4534d2c33204bbf728fa17994a8af248766ef8678561421\"},fromList [(\"536e656b4c6f74746572795469636b657431303635\",1)]),(PolicyID {policyID = ScriptHash \"247aa233b9759c8963dfed59203f4aa35ea811813ad9bf7c3b19179b\"},fromList [(\"4d696e744578747261\",1),(\"4f776e657273686970\",1)]),(PolicyID {policyID = ScriptHash \"3f2638bb68fd93f81b7e30fc8f89c7a4fd0ff3e5d672b245e7074fcf\"},fromList [(\"4654\",99654)]),(PolicyID {policyID = ScriptHash \"485b05b350f390d7560359c92c04ddddb2ab439e12ea5452c2faa0d4\"},fromList [(\"496e766f6963652023303036\",1),(\"496e766f6963652023303131\",1),(\"496e766f6963652023303231\",1),(\"496e766f6963652023303237\",1)]),(PolicyID {policyID = ScriptHash \"5066154a102ee037390c5236f78db23239b49c5748d3d349f3ccf04b\"},fromList [(\"55534458\",60)]),(PolicyID {policyID = ScriptHash \"63f9a5fc96d4f87026e97af4569975016b50eef092a46859b61898e5\"},fromList [(\"0014df1041414441\",5399000000),(\"0014df1041584f\",12696000000000),(\"0014df10424f4f4b\",695907000000),(\"0014df1044454449\",127611000000),(\"0014df10464c4454\",24607000000),(\"0014df10484f534b59\",58823529411),(\"0014df1048554e54\",36271000000),(\"0014df10494147\",34042000000),(\"0014df10494e4459\",4855000000),(\"0014df104c51\",1778970699),(\"0014df104d494c4b\",14713000000),(\"0014df104d494e\",208361601484),(\"0014df104e5458\",184670000000),(\"0014df104e564c\",7677000000),(\"0014df10534e454b\",1565283),(\"0014df1053554e444145\",658209577235),(\"0014df106f7263666178746f6b656e\",1143154000000)]),(PolicyID {policyID = ScriptHash \"8290f871ac682f9fd8e0ab9fae80e132e0846fb2428420b45579bc8a\"},fromList [(\"55534454\",2816500000)]),(PolicyID {policyID = ScriptHash \"879834503629d77446227c99d54a89ecf211a7fafb846667ffa96b15\"},fromList [(\"3432626531663533643638386564343830333765383962353961336237303938\",1),(\"3766346161363431303433353333306361336539373433663530346263626363\",1)]),(PolicyID {policyID = ScriptHash \"c38769a334e709ad2fc85d94a58ac4fefafc4c1e763c779a72c1d0e4\"},fromList [(\"415343454e44\",913181880000),(\"494147\",999991000000),(\"74555344\",10000000)]),(PolicyID {policyID = ScriptHash \"c8e2f3c2c774f85c0199985cb9e48c11751a918f027dd23e820c9ffb\"},fromList [(\"83769eec6f77362102c8f53dcfec1c9468817196962f27e301e6c19f52e403f6\",1)]),(PolicyID {policyID = ScriptHash \"cb26d3c2b725dec6e0e0dd4b4f47d2813e0033ed481cf0f7085bbbf6\"},fromList [(\"3365356666643962333537643764626633643935336630346461363534363033\",2),(\"3432626531663533643638386564343830333765383962353961336237303938\",2),(\"3766346161363431303433353333306361336539373433663530346263626363\",2),(\"477265656e6669656c6420486f7573696e67\",1),(\"5269766572736964652041706172746d656e7473\",1),(\"536561736964652056696c6c6173\",1),(\"53756e7269736520436f6d6d756e697479\",1),(\"54455354\",32),(\"557262616e204f61736973\",1)]),(PolicyID {policyID = ScriptHash \"d83c09e89208a85fb390c771bd74e7809dc2ad5399aeb95d20c19049\"},fromList [(\"\",11),(\"41535345544e414d455f3030313233\",1),(\"41535345544e414d455f3030393837\",1),(\"524e4720444944\",1),(\"544150505f313030\",3),(\"544150505f3932\",1),(\"7465737434206e616d65\",1),(\"7465737437206e616d65\",1),(\"7465737438206e616d65\",1),(\"74657374616c696173\",1)]),(PolicyID {policyID = ScriptHash \"e871d57dd748044141f854e2ae56370932a5e3867e1ab753545ddbbf\"},fromList [(\"4d657368546f6b656e\",1)]),(PolicyID {policyID = ScriptHash \"f6c78a7b7a1ce3469ec425840f0d34121866090eaa7e8f5f2599e818\"},fromList [(\"3365356666643962333537643764626633643935336630346461363534363033\",2),(\"3432626531663533643638386564343830333765383962353961336237303938\",2),(\"3766346161363431303433353333306361336539373433663530346263626363\",2),(\"73686132353628756e646566696e65642b756e646566696e656429\",1)]),(PolicyID {policyID = ScriptHash \"f80e202fc69e7ec11e54571e8074002c040c1d46b457d452c7f4825f\"},fromList [(\"4654\",99884)]),(PolicyID {policyID = ScriptHash \"fd3a074992aaf8043624590d231bed021a353b3f1489338100c81af0\"},fromList [(\"0014df104e4d49585832303231\",19999999)])])))))","ConwayUtxowFailure (UtxoFailure (InsufficientCollateral (DeltaCoin (-6186074887)) (Coin 640116)))","ConwayUtxowFailure (UtxoFailure (IncorrectTotalCollateralField (DeltaCoin (-6186074887)) (Coin 5000000)))","ConwayUtxowFailure (UtxoFailure NoCollateralInputs)","ConwayUtxowFailure (UtxoFailure (BadInputsUTxO (NonEmptySet (fromList [TxIn (TxId {unTxId = SafeHash \"a857988d7a218b952dd17791a3b3d3d4c69d81d92f16a32af2fea6aed2a07547\"}) (TxIx {unTxIx = 1})]))))","ConwayUtxowFailure (UtxoFailure (ValueNotConservedUTxO Mismatch (RelEQ) {supplied: MaryValue (Coin 5000000) (MultiAsset (fromList [])), expected: MaryValue (Coin 6196074887) (MultiAsset (fromList [(PolicyID {policyID = ScriptHash \"1a9b0844f4534d2c33204bbf728fa17994a8af248766ef8678561421\"},fromList [(\"536e656b4c6f74746572795469636b657431303635\",1)]),(PolicyID {policyID = ScriptHash \"247aa233b9759c8963dfed59203f4aa35ea811813ad9bf7c3b19179b\"},fromList [(\"4d696e744578747261\",1),(\"4f776e657273686970\",1)]),(PolicyID {policyID = ScriptHash \"3f2638bb68fd93f81b7e30fc8f89c7a4fd0ff3e5d672b245e7074fcf\"},fromList [(\"4654\",99654)]),(PolicyID {policyID = ScriptHash \"485b05b350f390d7560359c92c04ddddb2ab439e12ea5452c2faa0d4\"},fromList [(\"496e766f6963652023303036\",1),(\"496e766f6963652023303131\",1),(\"496e766f6963652023303231\",1),(\"496e766f6963652023303237\",1)]),(PolicyID {policyID = ScriptHash \"5066154a102ee037390c5236f78db23239b49c5748d3d349f3ccf04b\"},fromList [(\"55534458\",60)]),(PolicyID {policyID = ScriptHash \"63f9a5fc96d4f87026e97af4569975016b50eef092a46859b61898e5\"},fromList [(\"0014df1041414441\",5399000000),(\"0014df1041584f\",12696000000000),(\"0014df10424f4f4b\",695907000000),(\"0014df1044454449\",127611000000),(\"0014df10464c4454\",24607000000),(\"0014df10484f534b59\",58823529411),(\"0014df1048554e54\",36271000000),(\"0014df10494147\",34042000000),(\"0014df10494e4459\",4855000000),(\"0014df104c51\",1778970699),(\"0014df104d494c4b\",14713000000),(\"0014df104d494e\",208361601484),(\"0014df104e5458\",184670000000),(\"0014df104e564c\",7677000000),(\"0014df10534e454b\",1565283),(\"0014df1053554e444145\",658209577235),(\"0014df106f7263666178746f6b656e\",1143154000000)]),(PolicyID {policyID = ScriptHash \"8290f871ac682f9fd8e0ab9fae80e132e0846fb2428420b45579bc8a\"},fromList [(\"55534454\",2816500000)]),(PolicyID {policyID = ScriptHash \"879834503629d77446227c99d54a89ecf211a7fafb846667ffa96b15\"},fromList [(\"3432626531663533643638386564343830333765383962353961336237303938\",1),(\"3766346161363431303433353333306361336539373433663530346263626363\",1)]),(PolicyID {policyID = ScriptHash \"c38769a334e709ad2fc85d94a58ac4fefafc4c1e763c779a72c1d0e4\"},fromList [(\"415343454e44\",913181880000),(\"494147\",999991000000),(\"74555344\",10000000)]),(PolicyID {policyID = ScriptHash \"c8e2f3c2c774f85c0199985cb9e48c11751a918f027dd23e820c9ffb\"},fromList [(\"83769eec6f77362102c8f53dcfec1c9468817196962f27e301e6c19f52e403f6\",1)]),(PolicyID {policyID = ScriptHash \"cb26d3c2b725dec6e0e0dd4b4f47d2813e0033ed481cf0f7085bbbf6\"},fromList [(\"3365356666643962333537643764626633643935336630346461363534363033\",2),(\"3432626531663533643638386564343830333765383962353961336237303938\",2),(\"3766346161363431303433353333306361336539373433663530346263626363\",2),(\"477265656e6669656c6420486f7573696e67\",1),(\"5269766572736964652041706172746d656e7473\",1),(\"536561736964652056696c6c6173\",1),(\"53756e7269736520436f6d6d756e697479\",1),(\"54455354\",32),(\"557262616e204f61736973\",1)]),(PolicyID {policyID = ScriptHash \"d83c09e89208a85fb390c771bd74e7809dc2ad5399aeb95d20c19049\"},fromList [(\"\",11),(\"41535345544e414d455f3030313233\",1),(\"41535345544e414d455f3030393837\",1),(\"524e4720444944\",1),(\"544150505f313030\",3),(\"544150505f3932\",1),(\"7465737434206e616d65\",1),(\"7465737437206e616d65\",1),(\"7465737438206e616d65\",1),(\"74657374616c696173\",1)]),(PolicyID {policyID = ScriptHash \"e871d57dd748044141f854e2ae56370932a5e3867e1ab753545ddbbf\"},fromList [(\"4d657368546f6b656e\",1)]),(PolicyID {policyID = ScriptHash \"f6c78a7b7a1ce3469ec425840f0d34121866090eaa7e8f5f2599e818\"},fromList [(\"3365356666643962333537643764626633643935336630346461363534363033\",2),(\"3432626531663533643638386564343830333765383962353961336237303938\",2),(\"3766346161363431303433353333306361336539373433663530346263626363\",2),(\"73686132353628756e646566696e65642b756e646566696e656429\",1)]),(PolicyID {policyID = ScriptHash \"f80e202fc69e7ec11e54571e8074002c040c1d46b457d452c7f4825f\"},fromList [(\"4654\",99884)]),(PolicyID {policyID = ScriptHash \"fd3a074992aaf8043624590d231bed021a353b3f1489338100c81af0\"},fromList [(\"0014df104e4d49585832303231\",19999999)])]))}))","ConwayUtxowFailure (UtxoFailure (UtxosFailure (CollectErrors (BadTranslation (BabbageContextError (AlonzoContextError (TranslationLogicMissingInput (TxIn (TxId {unTxId = SafeHash \"a857988d7a218b952dd17791a3b3d3d4c69d81d92f16a32af2fea6aed2a07547\"}) (TxIx {unTxIx = 1}))))) :| []))))"],"kind":"ShelleyTxValidationError"},"tag":"TxValidationErrorInCardanoMode"},"tag":"TxCmdTxSubmitValidationError"},"tag":"TxSubmitFail"}
```

## 4. Wait past deadline

- Deadline 2026-07-18T10:10:47.000Z + 60 s buffer; resumed 2026-07-18T10:11:47.887Z

## 5. Cardano REFUND — full value back to sender

- **Tx:** [`030561f88998d7a2937b23cfb0ae78cb0b078019bd4ac3ee4273d069a97ba549`](https://preprod.cardanoscan.io/transaction/030561f88998d7a2937b23cfb0ae78cb0b078019bd4ac3ee4273d069a97ba549)
- Spends escrow UTxO `60c740958a13ce55cbdee59af176f819f1cdf603601a5402bdd36ffddae57d1d#0`
- Returns the exact 5 tADA escrow to the sender's datum-bound payout address `addr_test1vqe7et9t7fyuwsvkxtsvauhdanmekqgj3nzuhhva7c3aqrq2haha6` (output #0); fees paid from the sender's own wallet input
- Block 4950101, confirmed after 82s

## Stage timings

| Stage | Duration |
|---|---|
| 0-preflight | 0.3s |
| 1-initiate | 0s |
| 2-cardano-lock | 30.9s |
| 3-early-refund-rejected | 3.2s |
| 4-wait-past-deadline | 266.4s |
| 5-cardano-refund | 86.6s |

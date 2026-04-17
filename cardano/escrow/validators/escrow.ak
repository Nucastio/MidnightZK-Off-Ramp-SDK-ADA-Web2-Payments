use aiken/collection/list
use cardano/transaction.{OutputReference, Transaction}

/// Off-ramp escrow datum.
///
/// Public on-chain payload that binds a Cardano UTxO to an off-ramp `intent_id`,
/// the Midnight ZK verification-key hash (`vk_hash`), and the rail adapter id.
/// Sensitive values (payee handle, fiat amount, KYC attributes) live only in the
/// off-chain witness; on-chain we keep their SHA-256 commitments + the deadline.
pub type EscrowDatum {
  intent_id: ByteArray,
  payee_commitment: ByteArray,
  amount_commitment: ByteArray,
  adapter_id: ByteArray,
  deadline: Int,
  vk_hash: ByteArray,
  sender_pkh: ByteArray,
  operator_pkh: ByteArray,
}

/// Redeemer selector.
///
/// `Release` is consumed by the operator after the rail has confirmed payout
/// (current build: operator-signed; a future revision will additionally
/// verify the Midnight proof + Settlement Oracle attestation on-chain).
///
/// `Refund` is consumed by the sender after the deadline has passed.
pub type EscrowAction {
  Release
  Refund
}

/// Off-ramp escrow validator (Plutus V3).
validator escrow {
  spend(
    datum: Option<EscrowDatum>,
    redeemer: EscrowAction,
    _utxo: OutputReference,
    self: Transaction,
  ) {
    when datum is {
      None -> False
      Some(d) ->
        when redeemer is {
          Release -> list.has(self.extra_signatories, d.operator_pkh)
          Refund -> list.has(self.extra_signatories, d.sender_pkh)
        }
    }
  }
}

use aiken/builtin
use aiken/collection/dict
use aiken/collection/list
use aiken/crypto
use aiken/interval
use aiken/primitive/bytearray
use cardano/address
use cardano/assets
use cardano/transaction.{OutputReference, Transaction}
use cardano/transaction

const release_domain_separator =
  #"4d49444e494748545f4f464652414d505f52454c454153455f5631"

/// Public data pinned to one off-ramp escrow UTxO.
pub type EscrowDatum {
  intent_id: ByteArray,
  payee_commitment: ByteArray,
  amount_commitment: ByteArray,
  adapter_id: ByteArray,
  deadline: Int,
  circuit_artifact_hash: ByteArray,
  sender_pkh: ByteArray,
  operator_pkh: ByteArray,
  oracle_public_key: ByteArray,
}

/// Oracle authorization for a release. The signature is over
/// `release_authorization_message(datum, output_reference, authorization)`.
pub type ReleaseAuthorization {
  settlement_digest: ByteArray,
  midnight_settlement_receipt_hash: ByteArray,
  authorization_expiry: Int,
  oracle_signature: ByteArray,
}

pub type EscrowAction {
  Release(ReleaseAuthorization)
  Refund
}

/// Canonical constructor-0 payload serialized with Plutus `serialise_data`.
/// The exact spending output reference makes an authorization single-use.
pub type ReleaseAuthorizationMessage {
  domain_separator: ByteArray,
  intent_id: ByteArray,
  payee_commitment: ByteArray,
  amount_commitment: ByteArray,
  adapter_id: ByteArray,
  deadline: Int,
  circuit_artifact_hash: ByteArray,
  sender_pkh: ByteArray,
  operator_pkh: ByteArray,
  oracle_public_key: ByteArray,
  spending_transaction_id: ByteArray,
  spending_output_index: Int,
  settlement_digest: ByteArray,
  midnight_settlement_receipt_hash: ByteArray,
  authorization_expiry: Int,
}

pub fn release_authorization_message(
  datum: EscrowDatum,
  output_reference: OutputReference,
  authorization: ReleaseAuthorization,
) -> ByteArray {
  builtin.serialise_data(
    ReleaseAuthorizationMessage {
      domain_separator: release_domain_separator,
      intent_id: datum.intent_id,
      payee_commitment: datum.payee_commitment,
      amount_commitment: datum.amount_commitment,
      adapter_id: datum.adapter_id,
      deadline: datum.deadline,
      circuit_artifact_hash: datum.circuit_artifact_hash,
      sender_pkh: datum.sender_pkh,
      operator_pkh: datum.operator_pkh,
      oracle_public_key: datum.oracle_public_key,
      spending_transaction_id: output_reference.transaction_id,
      spending_output_index: output_reference.output_index,
      settlement_digest: authorization.settlement_digest,
      midnight_settlement_receipt_hash: authorization.midnight_settlement_receipt_hash,
      authorization_expiry: authorization.authorization_expiry,
    },
  )
}

fn has_length(bytes: ByteArray, expected: Int) -> Bool {
  bytearray.length(bytes) == expected
}

fn datum_is_well_formed(datum: EscrowDatum) -> Bool {
  and {
    has_length(datum.intent_id, 32),
    has_length(datum.payee_commitment, 32),
    has_length(datum.amount_commitment, 32),
    has_length(datum.adapter_id, 32),
    datum.deadline >= 0,
    has_length(datum.circuit_artifact_hash, 32),
    has_length(datum.sender_pkh, 28),
    has_length(datum.operator_pkh, 28),
    has_length(datum.oracle_public_key, 32),
  }
}

fn authorization_is_well_formed(authorization: ReleaseAuthorization) -> Bool {
  and {
    has_length(authorization.settlement_digest, 32),
    has_length(authorization.midnight_settlement_receipt_hash, 32),
    authorization.authorization_expiry >= 0,
    has_length(authorization.oracle_signature, 64),
  }
}

fn pays_full_value_to(
  self: Transaction,
  destination_pkh: ByteArray,
  input_value,
) -> Bool {
  let destination = address.from_verification_key(destination_pkh)
  self.outputs
    |> list.any(fn(output) {
        output.address == destination && output.value == input_value
      })
}

fn validate_release(
  datum: EscrowDatum,
  authorization: ReleaseAuthorization,
  output_reference: OutputReference,
  self: Transaction,
) -> Bool {
  let own_input = self.inputs |> transaction.resolve_input(output_reference)
  if !authorization_is_well_formed(authorization) {
    False
  } else {
    and {
      list.has(self.extra_signatories, datum.operator_pkh),
      !interval.is_empty(self.validity_range),
      interval.is_entirely_before(self.validity_range, datum.deadline),
      interval.is_entirely_before(
        self.validity_range,
        authorization.authorization_expiry,
      ),
      pays_full_value_to(self, datum.operator_pkh, own_input.value),
      crypto.verify_ed25519_signature(
        datum.oracle_public_key,
        release_authorization_message(datum, output_reference, authorization),
        authorization.oracle_signature,
      ),
    }
  }
}

fn validate_refund(
  datum: EscrowDatum,
  output_reference: OutputReference,
  self: Transaction,
) -> Bool {
  let own_input = self.inputs |> transaction.resolve_input(output_reference)
  and {
    list.has(self.extra_signatories, datum.sender_pkh),
    !interval.is_empty(self.validity_range),
    interval.includes(interval.after(datum.deadline), self.validity_range),
    pays_full_value_to(self, datum.sender_pkh, own_input.value),
  }
}

pub fn validate(
  datum: Option<EscrowDatum>,
  redeemer: EscrowAction,
  output_reference: OutputReference,
  self: Transaction,
) -> Bool {
  when datum is {
    None -> False
    Some(d) ->
      if !datum_is_well_formed(d) {
        False
      } else {
        when redeemer is {
          Release(authorization) ->
            validate_release(d, authorization, output_reference, self)
          Refund -> validate_refund(d, output_reference, self)
        }
      }
  }
}

validator escrow {
  spend(
    datum: Option<EscrowDatum>,
    redeemer: EscrowAction,
    output_reference: OutputReference,
    self: Transaction,
  ) {
    validate(datum, redeemer, output_reference, self)
  }
}

const fixture_oracle_public_key =
  #"03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8"

const fixture_signature =
  #"6d82fa9bacc32df378a5b8b03cc1c5168e9c6bf0922b6fb51b2520f72b57a3bc8977df44befe9f4a97d75783c7243b93d6656339788ce88397abf4951defdd01"

const fixture_output_reference =
  OutputReference {
    transaction_id: #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    output_index: 3,
  }

const replay_output_reference =
  OutputReference {
    transaction_id: #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    output_index: 4,
  }

const fixture_datum =
  EscrowDatum {
    intent_id: #"1111111111111111111111111111111111111111111111111111111111111111",
    payee_commitment: #"2222222222222222222222222222222222222222222222222222222222222222",
    amount_commitment: #"3333333333333333333333333333333333333333333333333333333333333333",
    adapter_id: #"4444444444444444444444444444444444444444444444444444444444444444",
    deadline: 2_000_000,
    circuit_artifact_hash: #"5555555555555555555555555555555555555555555555555555555555555555",
    sender_pkh: #"66666666666666666666666666666666666666666666666666666666",
    operator_pkh: #"77777777777777777777777777777777777777777777777777777777",
    oracle_public_key: fixture_oracle_public_key,
  }

fn fixture_authorization(signature: ByteArray) -> ReleaseAuthorization {
  ReleaseAuthorization {
    settlement_digest: #"9999999999999999999999999999999999999999999999999999999999999999",
    midnight_settlement_receipt_hash: #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    authorization_expiry: 1_900_000,
    oracle_signature: signature,
  }
}

fn fixture_value() {
  assets.from_lovelace(5_000_000)
    |> assets.add(
        #"abababababababababababababababababababababababababababab",
        #"cafe",
        2,
      )
}

fn validity_range(lower: Int, upper: Int) -> interval.Interval {
  interval.Interval {
    lower_bound: interval.IntervalBound {
      bound_type: interval.Finite(lower),
      is_inclusive: True,
    },
    upper_bound: interval.IntervalBound {
      bound_type: interval.Finite(upper),
      is_inclusive: False,
    },
  }
}

fn fixture_transaction(
  reference: OutputReference,
  destination_pkh: ByteArray,
  output_value,
  lower: Int,
  upper: Int,
  signatories: List<ByteArray>,
) -> Transaction {
  let input_output =
    transaction.Output {
      address: address.from_script(
        #"88888888888888888888888888888888888888888888888888888888",
      ),
      value: fixture_value(),
      datum: transaction.NoDatum,
      reference_script: None,
    }
  let destination_output =
    transaction.Output {
      address: address.from_verification_key(destination_pkh),
      value: output_value,
      datum: transaction.NoDatum,
      reference_script: None,
    }
  Transaction {
    inputs: [
      transaction.Input { output_reference: reference, output: input_output },
    ],
    reference_inputs: [],
    outputs: [destination_output],
    fee: 0,
    mint: assets.zero,
    certificates: [],
    withdrawals: [],
    validity_range: validity_range(lower, upper),
    extra_signatories: signatories,
    redeemers: [],
    datums: dict.empty,
    id: #"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    votes: [],
    proposal_procedures: [],
    current_treasury_amount: None,
    treasury_donation: None,
  }
}

fn valid_release_transaction() -> Transaction {
  fixture_transaction(
    fixture_output_reference,
    fixture_datum.operator_pkh,
    fixture_value(),
    1_800_000,
    1_900_000,
    [fixture_datum.operator_pkh],
  )
}

fn valid_refund_transaction() -> Transaction {
  fixture_transaction(
    fixture_output_reference,
    fixture_datum.sender_pkh,
    fixture_value(),
    fixture_datum.deadline,
    fixture_datum.deadline + 60_000,
    [fixture_datum.sender_pkh],
  )
}

test release_message_known_vector() {
  release_authorization_message(
    fixture_datum,
    fixture_output_reference,
    fixture_authorization(fixture_signature),
  ) == #"d8799f581b4d49444e494748545f4f464652414d505f52454c454153455f5631582011111111111111111111111111111111111111111111111111111111111111115820222222222222222222222222222222222222222222222222222222222222222258203333333333333333333333333333333333333333333333333333333333333333582044444444444444444444444444444444444444444444444444444444444444441a001e848058205555555555555555555555555555555555555555555555555555555555555555581c66666666666666666666666666666666666666666666666666666666581c77777777777777777777777777777777777777777777777777777777582003a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b85820aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa03582099999999999999999999999999999999999999999999999999999999999999995820bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb1a001cfde0ff"
}

test release_accepts_valid_authorization() {
  validate(
    Some(fixture_datum),
    Release(fixture_authorization(fixture_signature)),
    fixture_output_reference,
    valid_release_transaction(),
  )
}

test release_accepts_deadline_boundary() {
  let tx =
    fixture_transaction(
      fixture_output_reference,
      fixture_datum.operator_pkh,
      fixture_value(),
      1_800_000,
      fixture_datum.deadline,
      [fixture_datum.operator_pkh],
    )
  validate(
    Some(fixture_datum),
    Release(
      ReleaseAuthorization {
        settlement_digest: #"9999999999999999999999999999999999999999999999999999999999999999",
        midnight_settlement_receipt_hash: #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        authorization_expiry: fixture_datum.deadline,
        oracle_signature: #"732e04118c9c6071c9d9b4fdc076bd1513d125808ff96b3de6543ec448bf5824ae827fd030b62d08f3546011b42c7b38a752f9ab86f6d06589d83d52c08be90b",
      },
    ),
    fixture_output_reference,
    tx,
  )
}

test release_rejects_missing_operator_signer() {
  let tx =
    fixture_transaction(
      fixture_output_reference,
      fixture_datum.operator_pkh,
      fixture_value(),
      1_800_000,
      1_900_000,
      [],
    )
  !validate(
    Some(fixture_datum),
    Release(fixture_authorization(fixture_signature)),
    fixture_output_reference,
    tx,
  )
}

test release_rejects_at_or_after_deadline() {
  let tx =
    fixture_transaction(
      fixture_output_reference,
      fixture_datum.operator_pkh,
      fixture_value(),
      fixture_datum.deadline,
      fixture_datum.deadline + 1,
      [fixture_datum.operator_pkh],
    )
  !validate(
    Some(fixture_datum),
    Release(fixture_authorization(fixture_signature)),
    fixture_output_reference,
    tx,
  )
}

test release_rejects_after_authorization_expiry() {
  let tx =
    fixture_transaction(
      fixture_output_reference,
      fixture_datum.operator_pkh,
      fixture_value(),
      1_900_000,
      1_900_001,
      [fixture_datum.operator_pkh],
    )
  !validate(
    Some(fixture_datum),
    Release(fixture_authorization(fixture_signature)),
    fixture_output_reference,
    tx,
  )
}

test release_rejects_invalid_signature() {
  !validate(
    Some(fixture_datum),
    Release(
      fixture_authorization(
        #"00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
      ),
    ),
    fixture_output_reference,
    valid_release_transaction(),
  )
}

test release_rejects_tampered_settlement_digest() {
  let authorization =
    ReleaseAuthorization {
      settlement_digest: #"9899999999999999999999999999999999999999999999999999999999999999",
      midnight_settlement_receipt_hash: #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      authorization_expiry: 1_900_000,
      oracle_signature: fixture_signature,
    }
  !validate(
    Some(fixture_datum),
    Release(authorization),
    fixture_output_reference,
    valid_release_transaction(),
  )
}

test release_rejects_tampered_receipt_hash() {
  let authorization =
    ReleaseAuthorization {
      settlement_digest: #"9999999999999999999999999999999999999999999999999999999999999999",
      midnight_settlement_receipt_hash: #"babbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      authorization_expiry: 1_900_000,
      oracle_signature: fixture_signature,
    }
  !validate(
    Some(fixture_datum),
    Release(authorization),
    fixture_output_reference,
    valid_release_transaction(),
  )
}

test release_rejects_tampered_authorization_expiry() {
  let authorization =
    ReleaseAuthorization {
      settlement_digest: #"9999999999999999999999999999999999999999999999999999999999999999",
      midnight_settlement_receipt_hash: #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      authorization_expiry: 1_950_000,
      oracle_signature: fixture_signature,
    }
  !validate(
    Some(fixture_datum),
    Release(authorization),
    fixture_output_reference,
    valid_release_transaction(),
  )
}

test release_rejects_tampered_datum() {
  let datum =
    EscrowDatum {
      intent_id: #"1011111111111111111111111111111111111111111111111111111111111111",
      payee_commitment: fixture_datum.payee_commitment,
      amount_commitment: fixture_datum.amount_commitment,
      adapter_id: fixture_datum.adapter_id,
      deadline: fixture_datum.deadline,
      circuit_artifact_hash: fixture_datum.circuit_artifact_hash,
      sender_pkh: fixture_datum.sender_pkh,
      operator_pkh: fixture_datum.operator_pkh,
      oracle_public_key: fixture_datum.oracle_public_key,
    }
  !validate(
    Some(datum),
    Release(fixture_authorization(fixture_signature)),
    fixture_output_reference,
    valid_release_transaction(),
  )
}

test release_rejects_replay_on_different_output_reference() {
  let tx =
    fixture_transaction(
      replay_output_reference,
      fixture_datum.operator_pkh,
      fixture_value(),
      1_800_000,
      1_900_000,
      [fixture_datum.operator_pkh],
    )
  !validate(
    Some(fixture_datum),
    Release(fixture_authorization(fixture_signature)),
    replay_output_reference,
    tx,
  )
}

test release_rejects_wrong_destination() {
  let tx =
    fixture_transaction(
      fixture_output_reference,
      fixture_datum.sender_pkh,
      fixture_value(),
      1_800_000,
      1_900_000,
      [fixture_datum.operator_pkh],
    )
  !validate(
    Some(fixture_datum),
    Release(fixture_authorization(fixture_signature)),
    fixture_output_reference,
    tx,
  )
}

test release_rejects_partial_value() {
  let tx =
    fixture_transaction(
      fixture_output_reference,
      fixture_datum.operator_pkh,
      assets.from_lovelace(5_000_000),
      1_800_000,
      1_900_000,
      [fixture_datum.operator_pkh],
    )
  !validate(
    Some(fixture_datum),
    Release(fixture_authorization(fixture_signature)),
    fixture_output_reference,
    tx,
  )
}

test release_rejects_bad_signature_length() {
  !validate(
    Some(fixture_datum),
    Release(fixture_authorization(#"00")),
    fixture_output_reference,
    valid_release_transaction(),
  )
}

test release_rejects_bad_digest_length() {
  let authorization =
    ReleaseAuthorization {
      settlement_digest: #"99",
      midnight_settlement_receipt_hash: #"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      authorization_expiry: 1_900_000,
      oracle_signature: fixture_signature,
    }
  !validate(
    Some(fixture_datum),
    Release(authorization),
    fixture_output_reference,
    valid_release_transaction(),
  )
}

test release_rejects_bad_receipt_hash_length() {
  let authorization =
    ReleaseAuthorization {
      settlement_digest: #"9999999999999999999999999999999999999999999999999999999999999999",
      midnight_settlement_receipt_hash: #"bb",
      authorization_expiry: 1_900_000,
      oracle_signature: fixture_signature,
    }
  !validate(
    Some(fixture_datum),
    Release(authorization),
    fixture_output_reference,
    valid_release_transaction(),
  )
}

test refund_accepts_deadline_boundary() {
  validate(
    Some(fixture_datum),
    Refund,
    fixture_output_reference,
    valid_refund_transaction(),
  )
}

test refund_rejects_missing_sender_signer() {
  let tx =
    fixture_transaction(
      fixture_output_reference,
      fixture_datum.sender_pkh,
      fixture_value(),
      fixture_datum.deadline,
      fixture_datum.deadline + 60_000,
      [],
    )
  !validate(Some(fixture_datum), Refund, fixture_output_reference, tx)
}

test refund_rejects_before_deadline() {
  let tx =
    fixture_transaction(
      fixture_output_reference,
      fixture_datum.sender_pkh,
      fixture_value(),
      fixture_datum.deadline - 1,
      fixture_datum.deadline + 60_000,
      [fixture_datum.sender_pkh],
    )
  !validate(Some(fixture_datum), Refund, fixture_output_reference, tx)
}

test refund_rejects_wrong_destination() {
  let tx =
    fixture_transaction(
      fixture_output_reference,
      fixture_datum.operator_pkh,
      fixture_value(),
      fixture_datum.deadline,
      fixture_datum.deadline + 60_000,
      [fixture_datum.sender_pkh],
    )
  !validate(Some(fixture_datum), Refund, fixture_output_reference, tx)
}

test refund_rejects_partial_value() {
  let tx =
    fixture_transaction(
      fixture_output_reference,
      fixture_datum.sender_pkh,
      assets.from_lovelace(4_000_000),
      fixture_datum.deadline,
      fixture_datum.deadline + 60_000,
      [fixture_datum.sender_pkh],
    )
  !validate(Some(fixture_datum), Refund, fixture_output_reference, tx)
}

test rejects_malformed_datum() {
  let datum =
    EscrowDatum {
      intent_id: #"11",
      payee_commitment: fixture_datum.payee_commitment,
      amount_commitment: fixture_datum.amount_commitment,
      adapter_id: fixture_datum.adapter_id,
      deadline: fixture_datum.deadline,
      circuit_artifact_hash: fixture_datum.circuit_artifact_hash,
      sender_pkh: fixture_datum.sender_pkh,
      operator_pkh: fixture_datum.operator_pkh,
      oracle_public_key: fixture_datum.oracle_public_key,
    }
  !validate(Some(datum), Refund, fixture_output_reference, valid_refund_transaction())
}

test rejects_bad_oracle_public_key_length() {
  let datum =
    EscrowDatum {
      intent_id: fixture_datum.intent_id,
      payee_commitment: fixture_datum.payee_commitment,
      amount_commitment: fixture_datum.amount_commitment,
      adapter_id: fixture_datum.adapter_id,
      deadline: fixture_datum.deadline,
      circuit_artifact_hash: fixture_datum.circuit_artifact_hash,
      sender_pkh: fixture_datum.sender_pkh,
      operator_pkh: fixture_datum.operator_pkh,
      oracle_public_key: #"03",
    }
  !validate(Some(datum), Refund, fixture_output_reference, valid_refund_transaction())
}

test rejects_missing_datum() {
  !validate(None, Refund, fixture_output_reference, valid_refund_transaction())
}

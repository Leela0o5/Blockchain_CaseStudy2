//! Modular host execution, receipt verification, and result extraction logic.

use matrix_format::{
    decode_journal, decode_matrix_inputs, encode_guest_input, encode_matrix_inputs,
    validate_binding, FormatError, Matrix as WireMatrix,
};
use methods::{MATRIX_MULTIPLY_GUEST_ELF, MATRIX_MULTIPLY_GUEST_ID};
use risc0_zkvm::{default_prover, ExecutorEnv, ProverOpts, Receipt};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum HostError {
    #[error("Invalid matrix input: {0}")]
    InvalidInput(String),

    #[error("Execution failed: {0}")]
    ProverError(String),

    #[error("Receipt verification failed: {0}")]
    VerificationFailed(String),

    #[error("Failed to decode journal output: {0}")]
    JournalDecodeError(String),

    #[error("Receipt result does not match the expected result")]
    ResultMismatch,

    #[error("Invalid proof journal: {0}")]
    InvalidJournal(String),

    #[error(
        "Configured approved image ID {expected} does not match this guest build ({generated})"
    )]
    ImageIdMismatch { expected: String, generated: String },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Matrix {
    pub rows: usize,
    pub cols: usize,
    pub data: Vec<i32>,
}

impl Matrix {
    pub fn new(rows: usize, cols: usize, data: Vec<i32>) -> Result<Self, HostError> {
        if rows == 0 || cols == 0 {
            return Err(HostError::InvalidInput(
                "Matrix dimensions must be non-zero".to_string(),
            ));
        }
        let expected_len = rows
            .checked_mul(cols)
            .ok_or_else(|| HostError::InvalidInput("Matrix dimensions overflow".to_string()))?;
        if data.len() != expected_len {
            return Err(HostError::InvalidInput(format!(
                "Data length mismatch: expected {}, got {}",
                expected_len,
                data.len()
            )));
        }
        Ok(Self { rows, cols, data })
    }

    pub fn multiply(&self, other: &Matrix) -> Result<Matrix, HostError> {
        if self.cols != other.rows {
            return Err(HostError::InvalidInput(format!(
                "Incompatible dimensions for multiplication: {} cols vs {} rows",
                self.cols, other.rows
            )));
        }

        let mut result_data = vec![0i32; self.rows * other.cols];

        for i in 0..self.rows {
            for k in 0..self.cols {
                let a_val = self.data[i * self.cols + k];
                for j in 0..other.cols {
                    let b_val = other.data[k * other.cols + j];
                    let idx = i * other.cols + j;
                    result_data[idx] = result_data[idx]
                        .checked_add(a_val.checked_mul(b_val).ok_or_else(|| {
                            HostError::InvalidInput("Integer overflow".to_string())
                        })?)
                        .ok_or_else(|| HostError::InvalidInput("Integer overflow".to_string()))?;
                }
            }
        }

        Ok(Matrix {
            rows: self.rows,
            cols: other.cols,
            data: result_data,
        })
    }
}

/// Constructs execution environment and generates RISC Zero receipt.
pub fn execute_and_prove(matrix_a: &Matrix, matrix_b: &Matrix) -> Result<Receipt, HostError> {
    execute_and_prove_for_job(matrix_a, matrix_b, [0u8; 32])
}

/// Generates a proof whose journal binds the given job ID and input commitment.
pub fn execute_and_prove_for_job(
    matrix_a: &Matrix,
    matrix_b: &Matrix,
    job_id: [u8; 32],
) -> Result<Receipt, HostError> {
    let canonical_inputs = canonical_input_bytes(matrix_a, matrix_b)?;
    let input_commitment: [u8; 32] = Sha256::digest(&canonical_inputs).into();
    execute_and_prove_with_canonical_input(job_id, &canonical_inputs, input_commitment)
}

/// Proves exact canonical input bytes for a job after checking them against the
/// matrix guest format and the configured approved guest image ID.
pub fn execute_and_prove_canonical_input_for_job(
    job_id: [u8; 32],
    canonical_inputs: &[u8],
    approved_image_id: [u8; 32],
) -> Result<Receipt, HostError> {
    if job_id == [0; 32] {
        return Err(HostError::InvalidInput(
            "Marketplace job ID must be nonzero".to_string(),
        ));
    }
    validate_approved_image_id(&approved_image_id)?;
    let (matrix_a, matrix_b) = decode_canonical_matrix_inputs(canonical_inputs)?;

    let input_commitment: [u8; 32] = Sha256::digest(canonical_inputs).into();
    let receipt =
        execute_and_prove_with_canonical_input(job_id, canonical_inputs, input_commitment)?;
    let result = verify_and_extract_bound(&receipt, job_id, input_commitment)?;
    let expected_result = matrix_a.multiply(&matrix_b)?;
    if result != expected_result {
        return Err(HostError::ResultMismatch);
    }
    Ok(receipt)
}

/// Decodes exact canonical matrix bytes and rejects any encoding that does not round-trip.
pub fn decode_canonical_matrix_inputs(encoded: &[u8]) -> Result<(Matrix, Matrix), HostError> {
    let (matrix_a, matrix_b) = decode_matrix_inputs(encoded).map_err(format_error)?;
    let reencoded_inputs = encode_matrix_inputs(&matrix_a, &matrix_b).map_err(format_error)?;
    if reencoded_inputs.as_slice() != encoded {
        return Err(HostError::InvalidInput(
            "Input is not in canonical matrix encoding".to_string(),
        ));
    }
    Ok((
        wire_to_host_matrix(matrix_a)?,
        wire_to_host_matrix(matrix_b)?,
    ))
}

fn execute_and_prove_with_canonical_input(
    job_id: [u8; 32],
    canonical_inputs: &[u8],
    input_commitment: [u8; 32],
) -> Result<Receipt, HostError> {
    let guest_input =
        encode_guest_input(job_id, input_commitment, canonical_inputs).map_err(format_error)?;
    let env = ExecutorEnv::builder()
        .write_slice(&guest_input)
        .build()
        .map_err(|e| HostError::ProverError(format!("Failed to build env: {e}")))?;

    let prover = default_prover();
    let prove_info = prover
        .prove_with_opts(env, MATRIX_MULTIPLY_GUEST_ELF, &ProverOpts::groth16())
        .map_err(|e| HostError::ProverError(format!("Prover failed: {e}")))?;

    Ok(prove_info.receipt)
}

/// Ensures the configured immutable marketplace image ID matches this build.
pub fn validate_approved_image_id(approved_image_id: &[u8; 32]) -> Result<(), HostError> {
    let generated = hex::encode(risc0_zkvm::sha::Digest::from(MATRIX_MULTIPLY_GUEST_ID));
    let expected = hex::encode(approved_image_id);
    if generated != expected {
        return Err(HostError::ImageIdMismatch {
            expected: format!("0x{expected}"),
            generated: format!("0x{generated}"),
        });
    }
    Ok(())
}

/// Parses a decimal or 0x-prefixed uint256 into its 32-byte big-endian form.
pub fn parse_job_id(value: &str) -> Result<[u8; 32], HostError> {
    let (digits, radix) = if let Some(hex_digits) = value.strip_prefix("0x") {
        (hex_digits, 16u32)
    } else {
        (value, 10u32)
    };
    if digits.is_empty() {
        return Err(HostError::InvalidInput(
            "Job ID must be a decimal or 0x-prefixed uint256".to_string(),
        ));
    }

    let mut bytes = [0u8; 32];
    for character in digits.chars() {
        let digit = character.to_digit(radix).ok_or_else(|| {
            HostError::InvalidInput("Job ID contains an invalid digit".to_string())
        })?;
        let mut carry = digit;
        for byte in bytes.iter_mut().rev() {
            let value = u32::from(*byte) * radix + carry;
            *byte = (value & 0xff) as u8;
            carry = value >> 8;
        }
        if carry != 0 {
            return Err(HostError::InvalidInput(
                "Job ID exceeds the uint256 range".to_string(),
            ));
        }
    }
    if bytes == [0; 32] {
        return Err(HostError::InvalidInput(
            "Marketplace job ID must be nonzero".to_string(),
        ));
    }
    Ok(bytes)
}

fn wire_to_host_matrix(matrix: WireMatrix) -> Result<Matrix, HostError> {
    Matrix::new(matrix.rows as usize, matrix.cols as usize, matrix.data)
}

/// Encodes the matrix inputs in the canonical format and returns its SHA-256 commitment.
pub fn input_commitment(matrix_a: &Matrix, matrix_b: &Matrix) -> Result<[u8; 32], HostError> {
    let canonical_inputs = canonical_input_bytes(matrix_a, matrix_b)?;
    Ok(Sha256::digest(&canonical_inputs).into())
}

/// Encodes matrices using the fixed-width canonical format committed by the guest.
pub fn canonical_input_bytes(matrix_a: &Matrix, matrix_b: &Matrix) -> Result<Vec<u8>, HostError> {
    let to_wire = |matrix: &Matrix| -> Result<WireMatrix, HostError> {
        let rows = u32::try_from(matrix.rows)
            .map_err(|_| HostError::InvalidInput("Matrix rows exceed u32".to_string()))?;
        let cols = u32::try_from(matrix.cols)
            .map_err(|_| HostError::InvalidInput("Matrix columns exceed u32".to_string()))?;
        Ok(WireMatrix {
            rows,
            cols,
            data: matrix.data.clone(),
        })
    };
    encode_matrix_inputs(&to_wire(matrix_a)?, &to_wire(matrix_b)?).map_err(format_error)
}

fn format_error(error: FormatError) -> HostError {
    HostError::InvalidInput(error.to_string())
}

/// Verifies the receipt cryptographically against the guest Image ID.
pub fn verify_receipt(receipt: &Receipt) -> Result<(), HostError> {
    receipt
        .verify(MATRIX_MULTIPLY_GUEST_ID)
        .map_err(|e| HostError::VerificationFailed(format!("Verification failed: {e}")))
}

/// Decodes the committed matrix result from the receipt journal.
pub fn extract_result(receipt: &Receipt) -> Result<Matrix, HostError> {
    let journal = decode_journal(&receipt.journal.bytes)
        .map_err(|e| HostError::JournalDecodeError(e.to_string()))?;
    Ok(Matrix {
        rows: journal.result.rows as usize,
        cols: journal.result.cols as usize,
        data: journal.result.data,
    })
}

/// Verifies receipt validity and that its journal binds the expected job and input.
pub fn verify_and_extract_bound(
    receipt: &Receipt,
    expected_job_id: [u8; 32],
    expected_input_commitment: [u8; 32],
) -> Result<Matrix, HostError> {
    verify_receipt(receipt)?;
    let journal = decode_journal(&receipt.journal.bytes)
        .map_err(|e| HostError::JournalDecodeError(e.to_string()))?;
    validate_binding(&journal, expected_job_id, expected_input_commitment)
        .map_err(|e| HostError::InvalidJournal(e.to_string()))?;
    Ok(Matrix {
        rows: journal.result.rows as usize,
        cols: journal.result.cols as usize,
        data: journal.result.data,
    })
}

/// Verifies receipt and extracts the computational result.
pub fn verify_and_extract(receipt: &Receipt) -> Result<Matrix, HostError> {
    verify_receipt(receipt)?;
    extract_result(receipt)
}

/// Verifies a receipt and checks that its committed result is the expected value.
pub fn verify_result(receipt: &Receipt, expected: &Matrix) -> Result<(), HostError> {
    let result = verify_and_extract(receipt)?;
    if &result == expected {
        Ok(())
    } else {
        Err(HostError::ResultMismatch)
    }
}

#[cfg(test)]
mod worker_input_tests {
    use super::{
        decode_canonical_matrix_inputs, parse_job_id, validate_approved_image_id, HostError,
    };
    use matrix_format::{
        decode_journal, encode_journal, encode_matrix_inputs, validate_binding, Matrix,
    };

    fn canonical_input() -> Vec<u8> {
        encode_matrix_inputs(
            &Matrix {
                rows: 1,
                cols: 2,
                data: vec![-1, 2],
            },
            &Matrix {
                rows: 2,
                cols: 1,
                data: vec![3, 4],
            },
        )
        .unwrap()
    }

    #[test]
    fn parses_arbitrary_uint256_job_ids_as_big_endian_bytes() {
        assert_eq!(parse_job_id("7").unwrap()[31], 7);
        assert_eq!(&parse_job_id("0x1234").unwrap()[30..], &[0x12, 0x34]);
        assert!(parse_job_id("0").is_err());

        let max_uint256 =
            "115792089237316195423570985008687907853269984665640564039457584007913129639935";
        assert_eq!(parse_job_id(max_uint256).unwrap(), [0xff; 32]);
        assert!(parse_job_id(
            "115792089237316195423570985008687907853269984665640564039457584007913129639936"
        )
        .is_err());
    }

    #[test]
    fn rejects_malformed_or_noncanonical_matrix_inputs() {
        let mut invalid_tag = canonical_input();
        invalid_tag[0] ^= 1;
        assert!(decode_canonical_matrix_inputs(&invalid_tag).is_err());

        let mut truncated = canonical_input();
        truncated.pop();
        assert!(decode_canonical_matrix_inputs(&truncated).is_err());

        let mut trailing = canonical_input();
        trailing.push(0);
        assert!(decode_canonical_matrix_inputs(&trailing).is_err());

        let mut incompatible = canonical_input();
        incompatible[29..33].copy_from_slice(&1u32.to_be_bytes());
        assert!(decode_canonical_matrix_inputs(&incompatible).is_err());
    }

    #[test]
    fn rejects_image_id_mismatch_before_proving() {
        let error = validate_approved_image_id(&[0xa5; 32]).unwrap_err();
        assert!(matches!(error, HostError::ImageIdMismatch { .. }));
    }

    #[test]
    fn validates_journal_job_id_and_input_commitment_bindings() {
        let job_id = [0u8; 31].into_iter().chain([0x91]).collect::<Vec<_>>();
        let job_id: [u8; 32] = job_id.try_into().unwrap();
        let commitment = [0x5a; 32];
        let journal_bytes = encode_journal(
            job_id,
            commitment,
            &Matrix {
                rows: 1,
                cols: 1,
                data: vec![-42],
            },
        )
        .unwrap();
        let journal = decode_journal(&journal_bytes).unwrap();

        assert_eq!(validate_binding(&journal, job_id, commitment), Ok(()));
        assert!(validate_binding(&journal, [0; 32], commitment).is_err());
        assert!(validate_binding(&journal, job_id, [0; 32]).is_err());
    }
}

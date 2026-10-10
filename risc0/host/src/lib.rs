//! Modular host execution, receipt verification, and result extraction logic.

use matrix_format::{
    decode_journal, encode_guest_input, encode_matrix_inputs, validate_binding, FormatError,
    Matrix as WireMatrix,
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
    let guest_input =
        encode_guest_input(job_id, input_commitment, &canonical_inputs).map_err(format_error)?;
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

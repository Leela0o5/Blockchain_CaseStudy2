//! Modular host execution, receipt verification, and result extraction logic.

use methods::{MATRIX_MULTIPLY_GUEST_ELF, MATRIX_MULTIPLY_GUEST_ID};
use risc0_zkvm::{default_prover, ExecutorEnv, ProverOpts, Receipt};
use serde::{Deserialize, Serialize};
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
        if data.len() != rows * cols {
            return Err(HostError::InvalidInput(format!(
                "Data length mismatch: expected {}, got {}",
                rows * cols,
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
    let env = ExecutorEnv::builder()
        .write(&(matrix_a, matrix_b))
        .map_err(|e| HostError::ProverError(format!("Failed to build env input: {e}")))?
        .build()
        .map_err(|e| HostError::ProverError(format!("Failed to build env: {e}")))?;

    let prover = default_prover();
    let prove_info = prover
	 .prove_with_opts(env, MATRIX_MULTIPLY_GUEST_ELF, &ProverOpts::groth16())
   	 .map_err(|e| HostError::ProverError(format!("Prover failed: {e}")))?;

    Ok(prove_info.receipt)
}

/// Verifies the receipt cryptographically against the guest Image ID.
pub fn verify_receipt(receipt: &Receipt) -> Result<(), HostError> {
    receipt
        .verify(MATRIX_MULTIPLY_GUEST_ID)
        .map_err(|e| HostError::VerificationFailed(format!("Verification failed: {e}")))
}

/// Decodes the committed matrix result from the receipt journal.
pub fn extract_result(receipt: &Receipt) -> Result<Matrix, HostError> {
    receipt
        .journal
        .decode::<Matrix>()
        .map_err(|e| HostError::JournalDecodeError(format!("Failed to decode journal: {e}")))
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

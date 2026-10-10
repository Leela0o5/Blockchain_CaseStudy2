use host::{
    execute_and_prove_for_job, input_commitment, verify_and_extract_bound, verify_receipt,
    verify_result, Matrix,
};
use risc0_zkvm::Receipt;

// ---------------------------------------------------------------------------
// Unit tests — pure Rust, no ELF, no prover required, cross-platform.
// ---------------------------------------------------------------------------

#[test]
fn test_matrix_new_valid() {
    let m = Matrix::new(2, 3, vec![1, 2, 3, 4, 5, 6]).unwrap();
    assert_eq!(m.rows, 2);
    assert_eq!(m.cols, 3);
    assert_eq!(m.data.len(), 6);
}

#[test]
fn test_matrix_new_invalid_dimensions() {
    assert!(Matrix::new(0, 2, vec![]).is_err());
    assert!(Matrix::new(2, 0, vec![]).is_err());
    assert!(Matrix::new(2, 2, vec![1, 2, 3]).is_err());
}

#[test]
fn test_matrix_multiplication_2x3_by_3x2() {
    // [1 2 3] * [7 8]   = [31 19]
    // [4 5 6]   [9 1]     [85 55]
    //           [2 3]
    let a = Matrix::new(2, 3, vec![1, 2, 3, 4, 5, 6]).unwrap();
    let b = Matrix::new(3, 2, vec![7, 8, 9, 1, 2, 3]).unwrap();
    let result = a.multiply(&b).unwrap();
    let expected = Matrix::new(2, 2, vec![31, 19, 85, 55]).unwrap();
    assert_eq!(result, expected);
}

#[test]
fn test_matrix_multiplication_identity() {
    let a = Matrix::new(2, 2, vec![3, 5, 2, 7]).unwrap();
    let id = Matrix::new(2, 2, vec![1, 0, 0, 1]).unwrap();
    let result = a.multiply(&id).unwrap();
    assert_eq!(result, a);
}

#[test]
fn test_matrix_multiplication_incompatible_dimensions() {
    let a = Matrix::new(2, 3, vec![1, 2, 3, 4, 5, 6]).unwrap();
    let b = Matrix::new(4, 2, vec![1, 2, 3, 4, 5, 6, 7, 8]).unwrap();
    assert!(a.multiply(&b).is_err());
}

#[test]
fn test_matrix_multiplication_deterministic() {
    // Same inputs must always produce the same output.
    let a = Matrix::new(2, 2, vec![2, 0, 1, 3]).unwrap();
    let b = Matrix::new(2, 2, vec![5, 1, 4, 2]).unwrap();
    let r1 = a.multiply(&b).unwrap();
    let r2 = a.multiply(&b).unwrap();
    assert_eq!(r1, r2);
}

#[test]
fn test_input_commitment_changes_with_matrix_inputs() {
    let a = Matrix::new(1, 2, vec![1, -2]).unwrap();
    let b = Matrix::new(2, 1, vec![3, 4]).unwrap();
    let original = input_commitment(&a, &b).unwrap();

    let changed_a = Matrix::new(1, 2, vec![1, -1]).unwrap();
    assert_ne!(original, input_commitment(&changed_a, &b).unwrap());
}

#[test]
fn test_input_commitment_rejects_unrepresentable_dimensions() {
    let matrix = Matrix {
        rows: usize::MAX,
        cols: 1,
        data: Vec::new(),
    };
    let valid = Matrix::new(1, 1, vec![1]).unwrap();
    assert!(input_commitment(&matrix, &valid).is_err());
}

// ---------------------------------------------------------------------------
// Integration tests — require risc0 guest toolchain and RISC0_DEV_MODE=1.
// Only compiled and run on platforms with the risc0 toolchain available
// (Linux/macOS). On Windows, the risc0 riscv32im toolchain is unavailable.
// ---------------------------------------------------------------------------
#[cfg(not(target_os = "windows"))]
mod integration {
    use super::*;

    #[test]
    fn test_groth16_proof_end_to_end() {
        let a = Matrix::new(2, 3, vec![1, 2, 3, 4, 5, 6]).unwrap();
        let b = Matrix::new(3, 2, vec![7, 8, 9, 1, 2, 3]).unwrap();

        // Generate one real Groth16 receipt.
        let job_id = [0u8; 31].into_iter().chain([7]).collect::<Vec<_>>();
        let job_id: [u8; 32] = job_id.try_into().unwrap();
        let commitment = input_commitment(&a, &b).unwrap();
        let receipt =
            execute_and_prove_for_job(&a, &b, job_id).expect("Groth16 proving should succeed");

        // 1. Cryptographic receipt verification.
        assert!(
            verify_receipt(&receipt).is_ok(),
            "Valid receipt should verify"
        );

        // 2. Extract the result from the verified receipt.
        let result = verify_and_extract_bound(&receipt, job_id, commitment)
            .expect("Receipt verification and extraction should succeed");

        let expected = Matrix::new(2, 2, vec![31, 19, 85, 55]).unwrap();

        // 3. Verify the computation result.
        assert_eq!(result, expected);

        // 4. A valid proof must not be accepted for an incorrect
        //    expected result.
        let wrong_result = Matrix::new(2, 2, vec![99, 99, 99, 99]).unwrap();

        assert!(
            verify_result(&receipt, &wrong_result).is_err(),
            "Incorrect expected result should be rejected"
        );
        assert!(
            verify_and_extract_bound(&receipt, [0u8; 32], commitment).is_err(),
            "Receipt with a mismatched job ID should be rejected"
        );

        // 5. Tampering with the committed journal must invalidate
        //    receipt verification.
        let mut tampered_journal_bytes = receipt.journal.bytes.clone();

        if let Some(last) = tampered_journal_bytes.last_mut() {
            *last ^= 0xFF;
        }

        let tampered_receipt = Receipt::new(receipt.inner.clone(), tampered_journal_bytes);

        assert!(
            verify_receipt(&tampered_receipt).is_err(),
            "Tampered receipt should fail verification"
        );
    }
}

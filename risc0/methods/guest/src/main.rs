#![no_main]

extern crate alloc;

use alloc::vec;
use matrix_format::{
    decode_matrix_inputs, encode_journal, Matrix, GUEST_INPUT_HEADER_LEN, MATRIX_INPUT_PREFIX_LEN,
};
use risc0_zkvm::guest::env;
use risc0_zkvm::sha::Sha256;

risc0_zkvm::guest::entry!(main);

fn multiply(a: &Matrix, b: &Matrix) -> Matrix {
    assert_eq!(a.cols, b.rows, "Matrix dimension mismatch");
    let result_len = (a.rows as usize)
        .checked_mul(b.cols as usize)
        .expect("Matrix result dimensions overflow");
    let mut result = vec![0i32; result_len];

    for i in 0..a.rows as usize {
        for k in 0..a.cols as usize {
            for j in 0..b.cols as usize {
                let a_value = a.data[i * a.cols as usize + k];
                let b_value = b.data[k * b.cols as usize + j];
                let index = i * b.cols as usize + j;
                result[index] = result[index]
                    .checked_add(
                        a_value
                            .checked_mul(b_value)
                            .expect("Matrix multiplication overflow"),
                    )
                    .expect("Matrix accumulation overflow");
            }
        }
    }

    Matrix {
        rows: a.rows,
        cols: b.cols,
        data: result,
    }
}

fn main() {
    let mut fixed_header = [0u8; GUEST_INPUT_HEADER_LEN];
    env::read_slice(&mut fixed_header);
    let job_id: [u8; 32] = fixed_header[..32].try_into().unwrap();
    let supplied_commitment: [u8; 32] = fixed_header[32..64].try_into().unwrap();
    let input_len = u32::from_be_bytes(fixed_header[64..68].try_into().unwrap()) as usize;
    assert!(
        input_len >= MATRIX_INPUT_PREFIX_LEN,
        "Canonical matrix input is truncated"
    );
    let mut canonical_inputs = vec![0u8; input_len];
    env::read_slice(&mut canonical_inputs);

    let (matrix_a, matrix_b) =
        decode_matrix_inputs(&canonical_inputs).expect("Invalid canonical matrix input");
    let actual_commitment = risc0_zkvm::sha::Impl::hash_bytes(&canonical_inputs);
    assert_eq!(
        actual_commitment.as_bytes(),
        supplied_commitment,
        "Input commitment mismatch"
    );

    let result = multiply(&matrix_a, &matrix_b);
    let journal = encode_journal(job_id, supplied_commitment, &result)
        .expect("Unable to encode matrix result journal");
    env::commit_slice(&journal);
}

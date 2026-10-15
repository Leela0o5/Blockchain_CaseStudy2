use host::{
    canonical_input_bytes, execute_and_prove_for_job, input_commitment, verify_and_extract_bound,
    Matrix,
};
use methods::MATRIX_MULTIPLY_GUEST_ID;
use risc0_ethereum_contracts::encode_seal;
use risc0_zkvm::InnerReceipt;
use serde::Serialize;
use sha2::{Digest as _, Sha256};

#[derive(Serialize)]
struct EthereumProof {
    image_id: String,
    job_id: String,
    input_hex: String,
    input_commitment: String,
    journal_hex: String,
    journal_sha256: String,
    seal_hex: String,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let matrix_a = Matrix::new(2, 3, vec![1, 2, 3, 4, 5, 6])?;
    let matrix_b = Matrix::new(3, 2, vec![7, 8, 9, 1, 2, 3])?;
    let mut job_id_bytes = [0u8; 32];
    job_id_bytes[31] = 7;
    let canonical_inputs = canonical_input_bytes(&matrix_a, &matrix_b)?;
    let input_commitment = input_commitment(&matrix_a, &matrix_b)?;
    let receipt = execute_and_prove_for_job(&matrix_a, &matrix_b, job_id_bytes)?;
    let result = verify_and_extract_bound(&receipt, job_id_bytes, input_commitment)?;
    if result != matrix_a.multiply(&matrix_b)? {
        return Err("Proven result does not match host computation".into());
    }

    if !matches!(&receipt.inner, InnerReceipt::Groth16(_)) {
        return Err("Prover returned a non-Groth16 receipt".into());
    }

    let journal = &receipt.journal.bytes;
    let seal = encode_seal(&receipt)?;
    let proof = EthereumProof {
        image_id: format!(
            "0x{}",
            hex::encode(risc0_zkvm::sha::Digest::from(MATRIX_MULTIPLY_GUEST_ID))
        ),
        job_id: format!("0x{}", hex::encode(job_id_bytes)),
        input_hex: format!("0x{}", hex::encode(canonical_inputs)),
        input_commitment: format!("0x{}", hex::encode(input_commitment)),
        journal_hex: format!("0x{}", hex::encode(journal)),
        journal_sha256: format!("0x{}", hex::encode(Sha256::digest(journal))),
        seal_hex: format!("0x{}", hex::encode(seal)),
    };

    println!("{}", serde_json::to_string(&proof)?);
    Ok(())
}

use host::{execute_and_prove, verify_receipt, Matrix};
use methods::MATRIX_MULTIPLY_GUEST_ID;
use risc0_ethereum_contracts::encode_seal;
use risc0_zkvm::InnerReceipt;
use serde::Serialize;
use sha2::{Digest as _, Sha256};

#[derive(Serialize)]
struct EthereumProof {
    image_id: String,
    journal_hex: String,
    journal_sha256: String,
    seal_hex: String,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let matrix_a = Matrix::new(2, 3, vec![1, 2, 3, 4, 5, 6])?;
    let matrix_b = Matrix::new(3, 2, vec![7, 8, 9, 1, 2, 3])?;
    let receipt = execute_and_prove(&matrix_a, &matrix_b)?;
    verify_receipt(&receipt)?;

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
        journal_hex: format!("0x{}", hex::encode(journal)),
        journal_sha256: format!("0x{}", hex::encode(Sha256::digest(journal))),
        seal_hex: format!("0x{}", hex::encode(seal)),
    };

    println!("{}", serde_json::to_string(&proof)?);
    Ok(())
}

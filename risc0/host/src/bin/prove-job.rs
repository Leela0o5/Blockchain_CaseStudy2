use host::{execute_and_prove_canonical_input_for_job, parse_job_id};
use methods::MATRIX_MULTIPLY_GUEST_ID;
use risc0_ethereum_contracts::encode_seal;
use risc0_zkvm::{sha::Digest, InnerReceipt};
use serde::Serialize;
use sha2::{Digest as _, Sha256};
use std::{env, fs, path::PathBuf};

#[derive(Serialize)]
struct JobProof {
    job_id: String,
    image_id: String,
    input_hex: String,
    input_commitment: String,
    journal_hex: String,
    journal_sha256: String,
    seal_hex: String,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = env::args_os().skip(1);
    let job_id_arg = args
        .next()
        .ok_or("Usage: prove-job <job-id-decimal-or-0x-uint256> <path-to-raw-canonical-input>")?;
    let input_path =
        PathBuf::from(args.next().ok_or(
            "Usage: prove-job <job-id-decimal-or-0x-uint256> <path-to-raw-canonical-input>",
        )?);
    if args.next().is_some() {
        return Err(
            "Usage: prove-job <job-id-decimal-or-0x-uint256> <path-to-raw-canonical-input>".into(),
        );
    }

    let job_id_arg = job_id_arg
        .to_str()
        .ok_or("Job ID argument must be valid UTF-8")?;
    let job_id = parse_job_id(job_id_arg)?;
    let canonical_input = fs::read(&input_path)?;
    let approved_image_id = read_approved_image_id()?;

    let receipt =
        execute_and_prove_canonical_input_for_job(job_id, &canonical_input, approved_image_id)?;
    if !matches!(&receipt.inner, InnerReceipt::Groth16(_)) {
        return Err("Prover returned a non-Groth16 receipt".into());
    }

    let image_id = format!("0x{}", hex::encode(Digest::from(MATRIX_MULTIPLY_GUEST_ID)));
    let input_commitment = Sha256::digest(&canonical_input);
    let journal = &receipt.journal.bytes;
    let seal = encode_seal(&receipt)?;
    let output = JobProof {
        job_id: format!("0x{}", hex::encode(job_id)),
        image_id,
        input_hex: format!("0x{}", hex::encode(&canonical_input)),
        input_commitment: format!("0x{}", hex::encode(input_commitment)),
        journal_hex: format!("0x{}", hex::encode(journal)),
        journal_sha256: format!("0x{}", hex::encode(Sha256::digest(journal))),
        seal_hex: format!("0x{}", hex::encode(seal)),
    };

    println!("{}", serde_json::to_string(&output)?);
    Ok(())
}

fn read_approved_image_id() -> Result<[u8; 32], Box<dyn std::error::Error>> {
    let configured = env::var("MATRIX_MULTIPLY_GUEST_ID").map_err(|_| {
        "MATRIX_MULTIPLY_GUEST_ID must contain the deployed approved guest image ID"
    })?;
    let hex_value = configured
        .strip_prefix("0x")
        .or_else(|| configured.strip_prefix("0X"))
        .unwrap_or(&configured);
    let decoded = hex::decode(hex_value)?;
    let image_id: [u8; 32] = decoded
        .try_into()
        .map_err(|_| "MATRIX_MULTIPLY_GUEST_ID must be exactly 32 bytes")?;
    if image_id == [0; 32] {
        return Err("MATRIX_MULTIPLY_GUEST_ID must not be zero".into());
    }
    Ok(image_id)
}

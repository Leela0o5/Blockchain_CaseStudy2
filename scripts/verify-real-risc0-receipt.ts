import { execFileSync } from 'node:child_process';
import { expect } from 'chai';
import { ethers, network } from 'hardhat';
import { RISC_ZERO_BN254_CONTROL_ID, RISC_ZERO_CONTROL_ROOT } from './risc0-verifier-config';

interface EthereumProof {
  image_id: string;
  job_id: string;
  input_hex: string;
  input_commitment: string;
  journal_hex: string;
  journal_sha256: string;
  seal_hex: string;
}

async function main() {
  if (network.name !== 'hardhat' && network.name !== 'localhost') {
    throw new Error(`Refusing to verify the local RISC Zero receipt on ${network.name}.`);
  }

  console.log('Generating a genuine Groth16 receipt with the Rust host...');
  const proofJson = execFileSync(
    'cargo',
    ['run', '--locked', '-p', 'host', '--bin', 'export-ethereum-proof', '--quiet'],
    { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  const proof = JSON.parse(proofJson) as EthereumProof;
  const journalBytes = ethers.getBytes(proof.journal_hex);
  const inputBytes = ethers.getBytes(proof.input_hex);
  const sealBytes = ethers.getBytes(proof.seal_hex);

  const u32be = (value: number) => {
    const encoded = Buffer.alloc(4);
    encoded.writeUInt32BE(value);
    return encoded;
  };
  const i32be = (value: number) => {
    const encoded = Buffer.alloc(4);
    encoded.writeInt32BE(value);
    return encoded;
  };
  const expectedInput = Buffer.concat([
    Buffer.from('RZMM_INPUT_V1', 'ascii'),
    u32be(2), u32be(3), ...[1, 2, 3, 4, 5, 6].map(i32be),
    u32be(3), u32be(2), ...[7, 8, 9, 1, 2, 3].map(i32be),
  ]);
  expect(ethers.hexlify(inputBytes)).to.equal(ethers.hexlify(expectedInput));
  expect(ethers.sha256(inputBytes)).to.equal(proof.input_commitment);
  expect(proof.job_id).to.equal(ethers.toBeHex(7, 32));

  const expectedJournal = Buffer.concat([
    Buffer.from('RZMM_JOURNAL_V1', 'ascii'),
    Buffer.from(proof.job_id.slice(2), 'hex'),
    Buffer.from(proof.input_commitment.slice(2), 'hex'),
    u32be(2), u32be(2), ...[31, 19, 85, 55].map(i32be),
  ]);
  expect(ethers.hexlify(journalBytes)).to.equal(ethers.hexlify(expectedJournal));
  expect(ethers.sha256(journalBytes)).to.equal(proof.journal_sha256);

  const Verifier = await ethers.getContractFactory('RiscZeroGroth16Verifier');
  const verifier = await Verifier.deploy(RISC_ZERO_CONTROL_ROOT, RISC_ZERO_BN254_CONTROL_ID);
  await verifier.waitForDeployment();

  const selector = await verifier.SELECTOR();
  expect(ethers.hexlify(sealBytes.slice(0, 4))).to.equal(selector);

  await verifier.verify(proof.seal_hex, proof.image_id, proof.journal_sha256);

  const alteredDigest = ethers.toBeHex(BigInt(proof.journal_sha256) ^ 1n, 32);
  await expect(
    verifier.verify(proof.seal_hex, proof.image_id, alteredDigest),
  ).to.be.revertedWithCustomError(verifier, 'VerificationFailed');

  console.log('Real Groth16 receipt verified by the official Solidity verifier.');
  console.log(`Verifier address: ${await verifier.getAddress()}`);
  console.log(`Image ID: ${proof.image_id}`);
  console.log(`Journal bytes (hex): ${proof.journal_hex}`);
  console.log(`Journal SHA-256: ${proof.journal_sha256}`);
  console.log(`Selector-prefixed Ethereum seal: ${proof.seal_hex}`);
  console.log('Altered journal digest was rejected.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

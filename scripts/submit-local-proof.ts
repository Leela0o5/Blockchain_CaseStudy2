import { ethers, network } from 'hardhat';
import { readFile } from 'node:fs/promises';

const MARKETPLACE_ADDRESS = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
const APPROVED_IMAGE_ID =
  '0x58076cdaca000bc1a82f44c960c49cdf413454e49d1de6913bc1a0332d047932';

async function main() {
  if (network.name !== 'localhost') {
    throw new Error(`Expected localhost network, got ${network.name}`);
  }

  const proof = JSON.parse(await readFile('job-1-proof.json', 'utf8'));
  const jobId = 1n;

  const signers = await ethers.getSigners();
  const requester = signers[0];
  const worker = signers[1];

  if (!requester || !worker) throw new Error('Hardhat accounts #0 and #1 are required');

  const marketplace = await ethers.getContractAt(
    'ComputeMarketplace',
    MARKETPLACE_ADDRESS,
  );

  // Validate proof metadata before changing job state.
  if (BigInt(proof.job_id) !== jobId) throw new Error('Proof job ID mismatch');
  if (proof.image_id.toLowerCase() !== APPROVED_IMAGE_ID.toLowerCase()) {
    throw new Error('Proof image ID mismatch');
  }

  const job = await marketplace.getJob(jobId);
  if (job.requester.toLowerCase() !== requester.address.toLowerCase()) {
    throw new Error('Job requester is not Hardhat account #0');
  }
  if (job.imageId.toLowerCase() !== APPROVED_IMAGE_ID.toLowerCase()) {
    throw new Error('On-chain image ID does not match proof');
  }
  if (job.inputData.toLowerCase() !== proof.input_hex.toLowerCase()) {
    throw new Error('On-chain input does not match proof input');
  }
  if (ethers.sha256(ethers.getBytes(proof.input_hex)).toLowerCase() !==
      proof.input_commitment.toLowerCase()) {
    throw new Error('Input commitment mismatch');
  }
  if (ethers.sha256(ethers.getBytes(proof.journal_hex)).toLowerCase() !==
      proof.journal_sha256.toLowerCase()) {
    throw new Error('Journal SHA-256 mismatch');
  }

  console.log('Preflight checks passed.');
  console.log('Requester:', requester.address);
  console.log('Worker:', worker.address);
  console.log('Reward:', ethers.formatEther(job.reward), 'ETH');

  if (job.status !== 1n) {
    throw new Error(`Expected Created status (1), got ${job.status}`);
  }

  const workerMarketplace = marketplace.connect(worker);

  if (!(await marketplace.isWorkerRegistered(worker.address))) {
    console.log('Registering worker...');
    await (await workerMarketplace.registerWorker()).wait();
  }

  console.log('Accepting job #1...');
  await (await workerMarketplace.acceptJob(jobId)).wait();

  console.log('Submitting proof to the real verifier...');
  const tx = await workerMarketplace.submitResultWithProof(
    jobId,
    proof.journal_hex,
    proof.seal_hex,
    { gasLimit: 5_000_000 },
  );
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error('Proof submission transaction failed');
  }

  const completedJob = await marketplace.getJob(jobId);
  if (completedJob.status !== 3n) {
    throw new Error(`Expected Completed status (3), got ${completedJob.status}`);
  }

  console.log('SUCCESS: proof verified on-chain and job completed.');
  console.log('Transaction:', receipt.hash);
  console.log('Worker:', completedJob.worker);
  console.log('Result journal:', completedJob.result);
  console.log('Reward paid:', ethers.formatEther(job.reward), 'ETH');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

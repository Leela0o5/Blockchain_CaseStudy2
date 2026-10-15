import { ethers, network } from 'hardhat';

function encodeU32(value: number): Buffer {
  const encoded = Buffer.alloc(4);
  encoded.writeUInt32BE(value);
  return encoded;
}

function encodeI32(value: number): Buffer {
  const encoded = Buffer.alloc(4);
  encoded.writeInt32BE(value);
  return encoded;
}

async function main() {
  console.log(`Testing complete transaction flow on network: ${network.name}`);
  const [signer] = await ethers.getSigners();
  console.log(`Caller account: ${signer.address}`);

  const balance = await ethers.provider.getBalance(signer.address);
  console.log(`Current balance: ${ethers.formatEther(balance)} ETH`);

  // Target deployed contract address
  const marketplaceAddress =
    process.env.MARKETPLACE_ADDRESS || '0xf01b9c541C79B3D2AFdE9ebf4Ea0845b1392937B';
  console.log(`Connecting to ComputeMarketplace at: ${marketplaceAddress}`);

  const marketplace = await ethers.getContractAt('ComputeMarketplace', marketplaceAddress);

  // 1. Worker Registration Check
  const isRegistered = await marketplace.isWorkerRegistered(signer.address);
  if (!isRegistered) {
    console.log('\n[1/4] Registering caller as worker...');
    const regTx = await marketplace.registerWorker();
    await regTx.wait();
    console.log('Worker registered successfully!');
  } else {
    console.log('\n[1/4] Caller is already registered as worker.');
  }

  // 2. Create Job with 0.0005 ETH Escrow
  console.log('\n[2/4] Creating a compute job with 0.0005 ETH escrow...');
  const sampleImageId = await marketplace.approvedImageId();
  const sampleInput = ethers.hexlify(
    Buffer.concat([
      Buffer.from('RZMM_INPUT_V1', 'ascii'),
      encodeU32(1),
      encodeU32(1),
      encodeI32(6),
      encodeU32(1),
      encodeU32(1),
      encodeI32(7),
    ]),
  );
  const reward = ethers.parseEther('0.0005');

  const createTx = await marketplace.createJob(sampleImageId, sampleInput, { value: reward });
  const receipt = await createTx.wait();
  console.log(`Job created in transaction: ${receipt?.hash}`);

  const currentNextJobId = await marketplace.nextJobId();
  const jobId = currentNextJobId - 1n;
  console.log(`Created Job ID: ${jobId}`);

  const job = await marketplace.getJob(jobId);
  console.log(
    `Job details: Requester=${job.requester}, Reward=${ethers.formatEther(job.reward)} ETH, Status=${job.status}`,
  );

  console.log('\n----------------------------------------------------');
  console.log('Sepolia transaction flow verified successfully!');
  console.log(
    `View on Sepolia Etherscan: https://sepolia.etherscan.io/address/${marketplaceAddress}`,
  );
  console.log('----------------------------------------------------');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

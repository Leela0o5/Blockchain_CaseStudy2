import { ethers } from "hardhat";
import { writeFile } from "node:fs/promises";

async function main() {
  const jobId = BigInt(process.env.JOB_ID ?? "1");
  const marketplaceAddress = process.env.MARKETPLACE_ADDRESS;

  if (!marketplaceAddress) {
    throw new Error("Set MARKETPLACE_ADDRESS to your deployed marketplace address");
  }

  const provider = ethers.provider;
  const network = await provider.getNetwork();

  if (network.chainId !== 31337n) {
    throw new Error(`Expected Hardhat Local (31337), got ${network.chainId}`);
  }

  const marketplace = await ethers.getContractAt(
    "ComputeMarketplace",
    marketplaceAddress,
  );

  const job = await marketplace.getJob(jobId);
  const inputData = ethers.getBytes(job.inputData);

  if (inputData.length === 0) {
    throw new Error(`Job ${jobId} has empty inputData`);
  }

  const outputPath = `job-${jobId}-input.bin`;
  await writeFile(outputPath, inputData);

  console.log(`Job ID: ${jobId}`);
  console.log(`Input bytes: ${inputData.length}`);
  console.log(`Image ID: ${job.imageId}`);
  console.log(`Status: ${job.status}`);
  console.log(`Saved raw input to: ${outputPath}`);
  console.log(`Input hex: ${ethers.hexlify(inputData)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

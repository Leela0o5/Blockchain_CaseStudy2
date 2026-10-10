import { ethers, network } from 'hardhat';

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('----------------------------------------------------');
  console.log(`Deploying contracts to network: ${network.name}`);
  console.log(`Deployer address: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Deployer balance: ${ethers.formatEther(balance)} ETH`);
  console.log('----------------------------------------------------');

  let verifierAddress = process.env.VERIFIER_ADDRESS;

  if (!verifierAddress) {
    console.log('No VERIFIER_ADDRESS provided. Deploying MockRiscZeroVerifier for testing...');
    const MockVerifierFactory = await ethers.getContractFactory('MockRiscZeroVerifier');
    const mockVerifier = await MockVerifierFactory.deploy();
    await mockVerifier.waitForDeployment();
    verifierAddress = await mockVerifier.getAddress();
    console.log(`MockRiscZeroVerifier deployed at: ${verifierAddress}`);
  } else {
    console.log(`Using existing Verifier at: ${verifierAddress}`);
  }

  console.log('Deploying ComputeMarketplace...');
  const MarketplaceFactory = await ethers.getContractFactory('ComputeMarketplace');
  const marketplace = await MarketplaceFactory.deploy(verifierAddress);
  await marketplace.waitForDeployment();
  const marketplaceAddress = await marketplace.getAddress();

  console.log('----------------------------------------------------');
  console.log(`ComputeMarketplace deployed successfully at: ${marketplaceAddress}`);
  console.log(`Initial Verifier set to: ${verifierAddress}`);
  console.log('----------------------------------------------------');

  if (network.name === 'sepolia') {
    console.log('To verify on Etherscan, run:');
    console.log(
      `npx.cmd hardhat verify --network sepolia ${marketplaceAddress} "${verifierAddress}"`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

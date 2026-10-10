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
  const deployDevelopmentMock = process.env.DEPLOY_MOCK_VERIFIER === 'true';

  if (verifierAddress && deployDevelopmentMock) {
    throw new Error('Set VERIFIER_ADDRESS or DEPLOY_MOCK_VERIFIER=true, not both.');
  }

  if (!verifierAddress && deployDevelopmentMock) {
    if (network.name !== 'hardhat' && network.name !== 'localhost') {
      throw new Error('Mock verifier deployment is restricted to local development networks.');
    }
    console.warn('WARNING: deploying a development-only mock verifier; proofs are not verified.');
    const MockVerifierFactory = await ethers.getContractFactory('MockRiscZeroVerifier');
    const mockVerifier = await MockVerifierFactory.deploy();
    await mockVerifier.waitForDeployment();
    verifierAddress = await mockVerifier.getAddress();
    console.log(`MockRiscZeroVerifier deployed at: ${verifierAddress}`);
  } else if (!verifierAddress) {
    throw new Error(
      'VERIFIER_ADDRESS is required. For local logic development only, set DEPLOY_MOCK_VERIFIER=true.',
    );
  }

  const configuredVerifierAddress = verifierAddress;
  if (
    !configuredVerifierAddress ||
    !ethers.isAddress(configuredVerifierAddress) ||
    configuredVerifierAddress === ethers.ZeroAddress
  ) {
    throw new Error(`Invalid verifier address: ${configuredVerifierAddress}`);
  }
  if ((await ethers.provider.getCode(configuredVerifierAddress)) === '0x') {
    throw new Error(`No verifier contract code found at ${configuredVerifierAddress}`);
  }
  console.log(`Using verifier at: ${configuredVerifierAddress}`);

  console.log('Deploying ComputeMarketplace...');
  const MarketplaceFactory = await ethers.getContractFactory('ComputeMarketplace');
  const marketplace = await MarketplaceFactory.deploy(configuredVerifierAddress);
  await marketplace.waitForDeployment();
  const marketplaceAddress = await marketplace.getAddress();

  console.log('----------------------------------------------------');
  console.log(`ComputeMarketplace deployed successfully at: ${marketplaceAddress}`);
  console.log(`Initial Verifier set to: ${configuredVerifierAddress}`);
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

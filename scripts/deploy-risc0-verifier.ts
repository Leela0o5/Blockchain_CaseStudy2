import { ethers, network } from 'hardhat';
import { RISC_ZERO_BN254_CONTROL_ID, RISC_ZERO_CONTROL_ROOT } from './risc0-verifier-config';

async function main() {
  if (
    network.name !== 'hardhat' &&
    network.name !== 'localhost' &&
    (network.name !== 'sepolia' || process.env.DEPLOY_RISC0_VERIFIER !== 'true')
  ) {
    throw new Error(
      `Verifier deployment is allowed only on local networks, or on Sepolia when DEPLOY_RISC0_VERIFIER=true (current: ${network.name}).`,
    );
  }

  const [deployer] = await ethers.getSigners();
  console.log(`Deploying RISC Zero Groth16 verifier on ${network.name}`);
  console.log(`Deployer: ${deployer.address}`);

  const Verifier = await ethers.getContractFactory('RiscZeroGroth16Verifier');
  const verifier = await Verifier.deploy(RISC_ZERO_CONTROL_ROOT, RISC_ZERO_BN254_CONTROL_ID);
  await verifier.waitForDeployment();

  console.log(`RiscZeroGroth16Verifier: ${await verifier.getAddress()}`);
  console.log(`Version: ${await verifier.VERSION()}`);
  console.log(`Selector: ${await verifier.SELECTOR()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  RISC_ZERO_BN254_CONTROL_ID,
  RISC_ZERO_CONTROL_ROOT,
} from '../../scripts/risc0-verifier-config';

describe('RiscZeroGroth16Verifier (official v1.2.1 source)', () => {
  it('deploys with the pinned control IDs and exposes the expected verifier interface', async () => {
    const Verifier = await ethers.getContractFactory('RiscZeroGroth16Verifier');
    const verifier = await Verifier.deploy(RISC_ZERO_CONTROL_ROOT, RISC_ZERO_BN254_CONTROL_ID);
    await verifier.waitForDeployment();

    expect(await ethers.provider.getCode(await verifier.getAddress())).not.to.equal('0x');
    const verify = verifier.interface.getFunction('verify(bytes,bytes32,bytes32)');
    expect(verify).not.to.equal(null);
    expect(verify?.outputs.length).to.equal(0);
    expect(verify?.stateMutability).to.equal('view');
    expect(await verifier.VERSION()).to.equal('1.2.0');
    expect(await verifier.SELECTOR()).to.equal('0xc101b42b');
    expect(await verifier.BN254_CONTROL_ID()).to.equal(RISC_ZERO_BN254_CONTROL_ID);
  });
});

import { expect } from 'chai';
import { ethers } from 'hardhat';
import type { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';

describe('ComputeMarketplace', () => {
  let marketplace: any;
  let mockVerifier: any;
  let owner: SignerWithAddress;
  let requester: SignerWithAddress;
  let worker: SignerWithAddress;
  let worker2: SignerWithAddress;
  let attacker: SignerWithAddress;

  const SAMPLE_IMAGE_ID = ethers.keccak256(ethers.toUtf8Bytes('guest_program_fibonacci_v1'));
  const SAMPLE_INPUT = ethers.toUtf8Bytes('n=40');
  const SAMPLE_RESULT = ethers.toUtf8Bytes('fib(40)=102334155');
  const SAMPLE_PROOF = ethers.toUtf8Bytes('mock_zk_proof_seal_bytes_12345');
  const ONE_ETH = ethers.parseEther('1.0');

  const JobStatus = {
    None: 0n,
    Created: 1n,
    Accepted: 2n,
    Completed: 3n,
    Cancelled: 4n,
  } as const;

  beforeEach(async () => {
    [owner, requester, worker, worker2, attacker] = await ethers.getSigners();

    const MockVerifierFactory = await ethers.getContractFactory('MockRiscZeroVerifier');
    mockVerifier = await MockVerifierFactory.deploy();
    await mockVerifier.waitForDeployment();

    const MarketplaceFactory = await ethers.getContractFactory('ComputeMarketplace');
    marketplace = await MarketplaceFactory.deploy(await mockVerifier.getAddress());
    await marketplace.waitForDeployment();
  });

  describe('Deployment & Initial State', () => {
    it('should set the deployer as owner', async () => {
      expect(await marketplace.owner()).to.equal(owner.address);
    });

    it('should set the initial verifier address', async () => {
      expect(await marketplace.verifier()).to.equal(await mockVerifier.getAddress());
    });

    it('should initialize nextJobId to 1', async () => {
      expect(await marketplace.nextJobId()).to.equal(1n);
    });
  });

  describe('Worker Registration', () => {
    it('should allow a worker to register and emit WorkerRegistered event', async () => {
      await expect(marketplace.connect(worker).registerWorker())
        .to.emit(marketplace, 'WorkerRegistered')
        .withArgs(worker.address);

      expect(await marketplace.isWorkerRegistered(worker.address)).to.be.true;
    });

    it('should revert if worker is already registered', async () => {
      await marketplace.connect(worker).registerWorker();
      await expect(marketplace.connect(worker).registerWorker())
        .to.be.revertedWithCustomError(marketplace, 'WorkerAlreadyRegistered')
        .withArgs(worker.address);
    });

    it('should allow registered worker to unregister and emit WorkerUnregistered event', async () => {
      await marketplace.connect(worker).registerWorker();
      await expect(marketplace.connect(worker).unregisterWorker())
        .to.emit(marketplace, 'WorkerUnregistered')
        .withArgs(worker.address);

      expect(await marketplace.isWorkerRegistered(worker.address)).to.be.false;
    });

    it('should revert when unregistering if not registered', async () => {
      await expect(marketplace.connect(worker).unregisterWorker())
        .to.be.revertedWithCustomError(marketplace, 'WorkerNotRegistered')
        .withArgs(worker.address);
    });
  });

  describe('Job Creation & Escrow', () => {
    it('should allow requester to create a job and lock ETH in escrow', async () => {
      const marketplaceAddress = await marketplace.getAddress();
      const initialContractBalance = await ethers.provider.getBalance(marketplaceAddress);

      const tx = await marketplace
        .connect(requester)
        .createJob(SAMPLE_IMAGE_ID, SAMPLE_INPUT, { value: ONE_ETH });

      await expect(tx)
        .to.emit(marketplace, 'JobCreated')
        .withArgs(1n, requester.address, ONE_ETH, SAMPLE_IMAGE_ID);

      const postContractBalance = await ethers.provider.getBalance(marketplaceAddress);
      expect(postContractBalance - initialContractBalance).to.equal(ONE_ETH);

      const job = await marketplace.getJob(1n);
      expect(job.id).to.equal(1n);
      expect(job.requester).to.equal(requester.address);
      expect(job.worker).to.equal(ethers.ZeroAddress);
      expect(job.reward).to.equal(ONE_ETH);
      expect(job.imageId).to.equal(SAMPLE_IMAGE_ID);
      expect(job.inputData).to.equal(ethers.hexlify(SAMPLE_INPUT));
      expect(job.status).to.equal(JobStatus.Created);
      expect(job.createdAt).to.be.gt(0n);
      expect(job.completedAt).to.equal(0n);

      expect(await marketplace.nextJobId()).to.equal(2n);
    });

    it('should revert if reward payment is zero', async () => {
      await expect(
        marketplace.connect(requester).createJob(SAMPLE_IMAGE_ID, SAMPLE_INPUT, { value: 0n }),
      ).to.be.revertedWithCustomError(marketplace, 'ZeroReward');
    });

    it('should revert if imageId is bytes32(0)', async () => {
      await expect(
        marketplace.connect(requester).createJob(ethers.ZeroHash, SAMPLE_INPUT, { value: ONE_ETH }),
      ).to.be.revertedWithCustomError(marketplace, 'InvalidImageId');
    });
  });

  describe('Job Acceptance', () => {
    beforeEach(async () => {
      await marketplace.connect(worker).registerWorker();
      await marketplace.connect(worker2).registerWorker();
      await marketplace
        .connect(requester)
        .createJob(SAMPLE_IMAGE_ID, SAMPLE_INPUT, { value: ONE_ETH });
    });

    it('should allow a registered worker to accept an open job', async () => {
      await expect(marketplace.connect(worker).acceptJob(1n))
        .to.emit(marketplace, 'JobAccepted')
        .withArgs(1n, worker.address);

      const job = await marketplace.getJob(1n);
      expect(job.worker).to.equal(worker.address);
      expect(job.status).to.equal(JobStatus.Accepted);
    });

    it('should revert if caller is not registered as a worker', async () => {
      await expect(marketplace.connect(attacker).acceptJob(1n))
        .to.be.revertedWithCustomError(marketplace, 'WorkerNotRegistered')
        .withArgs(attacker.address);
    });

    it('should revert if requester attempts to accept their own job', async () => {
      await marketplace.connect(requester).registerWorker();
      await expect(marketplace.connect(requester).acceptJob(1n)).to.be.revertedWithCustomError(
        marketplace,
        'RequesterCannotBeWorker',
      );
    });

    it('should revert if accepting a non-existent job', async () => {
      await expect(marketplace.connect(worker).acceptJob(999n))
        .to.be.revertedWithCustomError(marketplace, 'JobNotFound')
        .withArgs(999n);
    });

    it('should prevent multiple workers from accepting the same job', async () => {
      await marketplace.connect(worker).acceptJob(1n);

      await expect(marketplace.connect(worker2).acceptJob(1n))
        .to.be.revertedWithCustomError(marketplace, 'InvalidJobStatus')
        .withArgs(1n, JobStatus.Accepted, JobStatus.Created);
    });
  });

  describe('Result & Proof Submission & Escrow Release', () => {
    beforeEach(async () => {
      await marketplace.connect(worker).registerWorker();
      await marketplace
        .connect(requester)
        .createJob(SAMPLE_IMAGE_ID, SAMPLE_INPUT, { value: ONE_ETH });
      await marketplace.connect(worker).acceptJob(1n);
    });

    it('should verify proof and release escrow payment to worker on valid proof', async () => {
      const initialWorkerBalance = await ethers.provider.getBalance(worker.address);

      const tx = await marketplace
        .connect(worker)
        .submitResultWithProof(1n, SAMPLE_RESULT, SAMPLE_PROOF);
      const receipt = await tx.wait();
      const gasPrice = receipt?.gasPrice ?? 0n;
      const gasCost = BigInt(receipt?.gasUsed ?? 0n) * BigInt(gasPrice);

      await expect(tx)
        .to.emit(marketplace, 'JobCompleted')
        .withArgs(1n, worker.address, ONE_ETH, ethers.hexlify(SAMPLE_RESULT));

      const postWorkerBalance = await ethers.provider.getBalance(worker.address);
      expect(postWorkerBalance + gasCost - initialWorkerBalance).to.equal(ONE_ETH);

      const job = await marketplace.getJob(1n);
      expect(job.status).to.equal(JobStatus.Completed);
      expect(job.result).to.equal(ethers.hexlify(SAMPLE_RESULT));
      expect(job.proof).to.equal(ethers.hexlify(SAMPLE_PROOF));
      expect(job.completedAt).to.be.gt(0n);
    });

    it('should revert if non-assigned worker tries to submit result', async () => {
      await marketplace.connect(worker2).registerWorker();
      await expect(
        marketplace.connect(worker2).submitResultWithProof(1n, SAMPLE_RESULT, SAMPLE_PROOF),
      )
        .to.be.revertedWithCustomError(marketplace, 'OnlyAssignedWorker')
        .withArgs(1n, worker2.address, worker.address);
    });

    it('should revert if verifier rejects invalid proof seal', async () => {
      // Empty proof causes mock verifier to return false
      await expect(marketplace.connect(worker).submitResultWithProof(1n, SAMPLE_RESULT, '0x'))
        .to.be.revertedWithCustomError(marketplace, 'ProofVerificationFailed')
        .withArgs(1n);

      // Verify job status remains Accepted and escrow stays locked
      const job = await marketplace.getJob(1n);
      expect(job.status).to.equal(JobStatus.Accepted);
    });

    it('should revert if verifier forceFail is enabled', async () => {
      await mockVerifier.setForceFail(true);

      await expect(
        marketplace.connect(worker).submitResultWithProof(1n, SAMPLE_RESULT, SAMPLE_PROOF),
      )
        .to.be.revertedWithCustomError(marketplace, 'ProofVerificationFailed')
        .withArgs(1n);

      const job = await marketplace.getJob(1n);
      expect(job.status).to.equal(JobStatus.Accepted);
    });

    it('should prevent duplicate submissions / double payment release', async () => {
      await marketplace.connect(worker).submitResultWithProof(1n, SAMPLE_RESULT, SAMPLE_PROOF);

      await expect(
        marketplace.connect(worker).submitResultWithProof(1n, SAMPLE_RESULT, SAMPLE_PROOF),
      )
        .to.be.revertedWithCustomError(marketplace, 'InvalidJobStatus')
        .withArgs(1n, JobStatus.Completed, JobStatus.Accepted);
    });
  });

  describe('Job Cancellation & Escrow Refunds', () => {
    beforeEach(async () => {
      await marketplace.connect(worker).registerWorker();
      await marketplace
        .connect(requester)
        .createJob(SAMPLE_IMAGE_ID, SAMPLE_INPUT, { value: ONE_ETH });
    });

    it('should allow requester to cancel an unaccepted job and refund escrow', async () => {
      const initialRequesterBalance = await ethers.provider.getBalance(requester.address);

      const tx = await marketplace.connect(requester).cancelJob(1n);
      const receipt = await tx.wait();
      const gasPrice = receipt?.gasPrice ?? 0n;
      const gasCost = BigInt(receipt?.gasUsed ?? 0n) * BigInt(gasPrice);

      await expect(tx)
        .to.emit(marketplace, 'JobCancelled')
        .withArgs(1n, requester.address, ONE_ETH);

      const postRequesterBalance = await ethers.provider.getBalance(requester.address);
      expect(postRequesterBalance + gasCost - initialRequesterBalance).to.equal(ONE_ETH);

      const job = await marketplace.getJob(1n);
      expect(job.status).to.equal(JobStatus.Cancelled);
    });

    it('should revert if non-requester attempts to cancel the job', async () => {
      await expect(marketplace.connect(attacker).cancelJob(1n))
        .to.be.revertedWithCustomError(marketplace, 'OnlyRequester')
        .withArgs(1n, attacker.address, requester.address);
    });

    it('should revert if attempting to cancel an already accepted job', async () => {
      await marketplace.connect(worker).acceptJob(1n);

      await expect(marketplace.connect(requester).cancelJob(1n))
        .to.be.revertedWithCustomError(marketplace, 'InvalidJobStatus')
        .withArgs(1n, JobStatus.Accepted, JobStatus.Created);
    });

    it('should revert if attempting to cancel an already cancelled job', async () => {
      await marketplace.connect(requester).cancelJob(1n);

      await expect(marketplace.connect(requester).cancelJob(1n))
        .to.be.revertedWithCustomError(marketplace, 'InvalidJobStatus')
        .withArgs(1n, JobStatus.Cancelled, JobStatus.Created);
    });
  });

  describe('Administration & Owner Controls', () => {
    it('should allow owner to update verifier address', async () => {
      const newVerifierAddress = attacker.address;
      await expect(marketplace.connect(owner).setVerifier(newVerifierAddress))
        .to.emit(marketplace, 'VerifierUpdated')
        .withArgs(await mockVerifier.getAddress(), newVerifierAddress);

      expect(await marketplace.verifier()).to.equal(newVerifierAddress);
    });

    it('should revert if non-owner attempts to update verifier', async () => {
      await expect(marketplace.connect(attacker).setVerifier(attacker.address))
        .to.be.revertedWithCustomError(marketplace, 'OnlyOwner')
        .withArgs(attacker.address, owner.address);
    });

    it('should allow owner to transfer ownership', async () => {
      await expect(marketplace.connect(owner).transferOwnership(worker.address))
        .to.emit(marketplace, 'OwnershipTransferred')
        .withArgs(owner.address, worker.address);

      expect(await marketplace.owner()).to.equal(worker.address);
    });

    it('should revert if non-owner attempts to transfer ownership', async () => {
      await expect(marketplace.connect(attacker).transferOwnership(attacker.address))
        .to.be.revertedWithCustomError(marketplace, 'OnlyOwner')
        .withArgs(attacker.address, owner.address);
    });

    it('should revert when transferring ownership to address(0)', async () => {
      await expect(
        marketplace.connect(owner).transferOwnership(ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(marketplace, 'InvalidVerifierAddress');
    });
  });

  describe('Edge Cases & Invariants', () => {
    it('should revert getJob for non-existent job ID', async () => {
      await expect(marketplace.getJob(100n))
        .to.be.revertedWithCustomError(marketplace, 'JobNotFound')
        .withArgs(100n);
    });

    it('should execute complete end-to-end multi-job pipeline correctly', async () => {
      // Register 2 workers
      await marketplace.connect(worker).registerWorker();
      await marketplace.connect(worker2).registerWorker();

      // Requester creates 2 distinct jobs
      await marketplace
        .connect(requester)
        .createJob(SAMPLE_IMAGE_ID, SAMPLE_INPUT, { value: ONE_ETH });
      await marketplace
        .connect(requester)
        .createJob(SAMPLE_IMAGE_ID, SAMPLE_INPUT, { value: ONE_ETH * 2n });

      // Worker 1 accepts Job 1, Worker 2 accepts Job 2
      await marketplace.connect(worker).acceptJob(1n);
      await marketplace.connect(worker2).acceptJob(2n);

      // Both workers submit valid proofs
      await marketplace.connect(worker).submitResultWithProof(1n, SAMPLE_RESULT, SAMPLE_PROOF);
      await marketplace.connect(worker2).submitResultWithProof(2n, SAMPLE_RESULT, SAMPLE_PROOF);

      const job1 = await marketplace.getJob(1n);
      const job2 = await marketplace.getJob(2n);

      expect(job1.status).to.equal(JobStatus.Completed);
      expect(job2.status).to.equal(JobStatus.Completed);
      expect(job1.worker).to.equal(worker.address);
      expect(job2.worker).to.equal(worker2.address);
    });
  });
});

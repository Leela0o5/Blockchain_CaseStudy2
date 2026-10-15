import { expect } from 'chai';
import { ethers } from 'hardhat';
import type { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';

describe('ComputeMarketplace (mock verifier logic tests; not cryptographic proof verification)', () => {
  let marketplace: any;
  let mockVerifier: any;
  let owner: SignerWithAddress;
  let requester: SignerWithAddress;
  let worker: SignerWithAddress;
  let worker2: SignerWithAddress;
  let attacker: SignerWithAddress;

  const SAMPLE_IMAGE_ID = ethers.keccak256(ethers.toUtf8Bytes('approved_matrix_multiply_guest'));
  const OTHER_IMAGE_ID = ethers.keccak256(ethers.toUtf8Bytes('unapproved_guest'));
  const SAMPLE_INPUT = encodeMatrixInputs();
  const SAMPLE_RESULT = encodeJournal();
  const SAMPLE_PROOF = ethers.concat(['0xc101b42b', ethers.toUtf8Bytes('mock seal')]);
  const ONE_ETH = ethers.parseEther('1.0');

  const JobStatus = {
    None: 0n,
    Created: 1n,
    Accepted: 2n,
    Completed: 3n,
    Cancelled: 4n,
  } as const;

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

  function encodeMatrixInputs(): Buffer {
    return Buffer.concat([
      Buffer.from('RZMM_INPUT_V1', 'ascii'),
      encodeU32(2),
      encodeU32(2),
      ...[1, 2, 3, 4].map(encodeI32),
      encodeU32(2),
      encodeU32(2),
      ...[5, 6, 7, 8].map(encodeI32),
    ]);
  }

  function encodeJournal(
    jobId = 1n,
    inputCommitment = ethers.sha256(encodeMatrixInputs()),
    rows = 2,
    cols = 2,
    values = [19, 22, 43, 50],
    tag = Buffer.from('RZMM_JOURNAL_V1', 'ascii'),
  ): Buffer {
    return Buffer.concat([
      tag,
      ethers.getBytes(ethers.toBeHex(jobId, 32)),
      ethers.getBytes(inputCommitment),
      encodeU32(rows),
      encodeU32(cols),
      ...values.map(encodeI32),
    ]);
  }

  async function prepareExpectedVerifierCall(journal = SAMPLE_RESULT): Promise<void> {
    await mockVerifier.setExpectedCall(
      SAMPLE_IMAGE_ID,
      ethers.sha256(journal),
      ethers.keccak256(SAMPLE_PROOF),
    );
  }

  async function expectFailedSubmission(errorName: string, journal = SAMPLE_RESULT): Promise<void> {
    const marketplaceAddress = await marketplace.getAddress();
    await expect(
      marketplace.connect(worker).submitResultWithProof(1n, journal, SAMPLE_PROOF),
    ).to.be.revertedWithCustomError(
      errorName === 'MockVerificationFailed' ? mockVerifier : marketplace,
      errorName,
    );

    const job = await marketplace.getJob(1n);
    expect(job.status).to.equal(JobStatus.Accepted);
    expect(job.result).to.equal('0x');
    expect(job.proof).to.equal('0x');
    expect(job.completedAt).to.equal(0n);
    expect(await ethers.provider.getBalance(marketplaceAddress)).to.equal(ONE_ETH);
  }

  beforeEach(async () => {
    [owner, requester, worker, worker2, attacker] = await ethers.getSigners();

    const MockVerifierFactory = await ethers.getContractFactory('MockRiscZeroVerifier');
    mockVerifier = await MockVerifierFactory.deploy();
    await mockVerifier.waitForDeployment();

    const MarketplaceFactory = await ethers.getContractFactory('ComputeMarketplace');
    marketplace = await MarketplaceFactory.deploy(await mockVerifier.getAddress(), SAMPLE_IMAGE_ID);
    await marketplace.waitForDeployment();
  });

  describe('Deployment & Initial State', () => {
    it('uses the official verifier ABI shape with no return value', async () => {
      const verify = mockVerifier.interface.getFunction('verify(bytes,bytes32,bytes32)');
      expect(verify).not.to.equal(null);
      expect(verify?.outputs.length).to.equal(0);
      expect(verify?.stateMutability).to.equal('view');
    });

    it('should set the deployer as owner', async () => {
      expect(await marketplace.owner()).to.equal(owner.address);
    });

    it('should set the initial verifier address', async () => {
      expect(await marketplace.verifier()).to.equal(await mockVerifier.getAddress());
    });

    it('stores the approved image ID at deployment', async () => {
      expect(await marketplace.approvedImageId()).to.equal(SAMPLE_IMAGE_ID);
    });

    it('should initialize nextJobId to 1', async () => {
      expect(await marketplace.nextJobId()).to.equal(1n);
    });

    it('rejects a zero or non-contract verifier at deployment', async () => {
      const MarketplaceFactory = await ethers.getContractFactory('ComputeMarketplace');
      await expect(
        MarketplaceFactory.deploy(ethers.ZeroAddress, SAMPLE_IMAGE_ID),
      ).to.be.revertedWithCustomError(MarketplaceFactory, 'InvalidVerifierAddress');
      await expect(
        MarketplaceFactory.deploy(attacker.address, SAMPLE_IMAGE_ID),
      ).to.be.revertedWithCustomError(MarketplaceFactory, 'InvalidVerifierAddress');
      await expect(
        MarketplaceFactory.deploy(await mockVerifier.getAddress(), ethers.ZeroHash),
      ).to.be.revertedWithCustomError(MarketplaceFactory, 'InvalidApprovedImageId');
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

    it('rejects a different nonzero image ID', async () => {
      await expect(
        marketplace.connect(requester).createJob(OTHER_IMAGE_ID, SAMPLE_INPUT, { value: ONE_ETH }),
      )
        .to.be.revertedWithCustomError(marketplace, 'UnsupportedImageId')
        .withArgs(OTHER_IMAGE_ID, SAMPLE_IMAGE_ID);
    });

    it('rejects input data that is not the exact canonical matrix encoding', async () => {
      const wrongTag = Buffer.from(SAMPLE_INPUT);
      wrongTag[0] ^= 0xff;
      await expect(
        marketplace.connect(requester).createJob(SAMPLE_IMAGE_ID, wrongTag, { value: ONE_ETH }),
      ).to.be.revertedWithCustomError(marketplace, 'InvalidInputTag');

      await expect(
        marketplace
          .connect(requester)
          .createJob(SAMPLE_IMAGE_ID, Buffer.concat([SAMPLE_INPUT, Buffer.from([0])]), {
            value: ONE_ETH,
          }),
      ).to.be.revertedWithCustomError(marketplace, 'InvalidInputLength');

      const zeroRows = Buffer.from(SAMPLE_INPUT);
      zeroRows.writeUInt32BE(0, 13);
      await expect(
        marketplace.connect(requester).createJob(SAMPLE_IMAGE_ID, zeroRows, { value: ONE_ETH }),
      ).to.be.revertedWithCustomError(marketplace, 'InvalidInputDimensions');
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

    it('accepts a canonical journal when the mock verifier accepts and releases escrow', async () => {
      await prepareExpectedVerifierCall();
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

    it('passes the stored image ID and exact raw-journal SHA-256 to the verifier', async () => {
      await prepareExpectedVerifierCall();
      await marketplace.connect(worker).submitResultWithProof(1n, SAMPLE_RESULT, SAMPLE_PROOF);
      const job = await marketplace.getJob(1n);
      expect(job.imageId).to.equal(SAMPLE_IMAGE_ID);
      expect(job.result).to.equal(ethers.hexlify(SAMPLE_RESULT));
    });

    it('should revert if non-assigned worker tries to submit result', async () => {
      await marketplace.connect(worker2).registerWorker();
      await expect(
        marketplace.connect(worker2).submitResultWithProof(1n, SAMPLE_RESULT, SAMPLE_PROOF),
      )
        .to.be.revertedWithCustomError(marketplace, 'OnlyAssignedWorker')
        .withArgs(1n, worker2.address, worker.address);
      const job = await marketplace.getJob(1n);
      expect(job.status).to.equal(JobStatus.Accepted);
      expect(job.result).to.equal('0x');
      expect(await ethers.provider.getBalance(await marketplace.getAddress())).to.equal(ONE_ETH);
    });

    it('rejects a journal containing the wrong job ID without releasing escrow', async () => {
      await expectFailedSubmission('JournalJobIdMismatch', encodeJournal(2n));
    });

    it('rejects a journal containing the wrong input commitment without releasing escrow', async () => {
      await expectFailedSubmission(
        'JournalInputCommitmentMismatch',
        encodeJournal(1n, ethers.ZeroHash),
      );
    });

    it('rejects a wrong journal tag without releasing escrow', async () => {
      await expectFailedSubmission(
        'InvalidJournalTag',
        encodeJournal(1n, ethers.sha256(SAMPLE_INPUT), 2, 2, [19, 22, 43, 50], Buffer.alloc(15)),
      );
    });

    it('rejects a truncated journal without releasing escrow', async () => {
      await expectFailedSubmission('InvalidJournalLength', SAMPLE_RESULT.subarray(0, 86));
      const truncatedJournal = SAMPLE_RESULT.subarray(0, SAMPLE_RESULT.length - 1);
      await expectFailedSubmission('InvalidJournalLength', truncatedJournal);
    });

    it('rejects zero result dimensions without releasing escrow', async () => {
      const invalidDimensions = Buffer.from(SAMPLE_RESULT);
      invalidDimensions.writeUInt32BE(0, 79);
      await expectFailedSubmission('InvalidJournalDimensions', invalidDimensions);
    });

    it('rejects result dimensions inconsistent with the canonical input', async () => {
      await expectFailedSubmission(
        'JournalResultDimensionsMismatch',
        encodeJournal(1n, ethers.sha256(SAMPLE_INPUT), 1, 4, [1, 2, 3, 4]),
      );
    });

    it('rejects an incorrect element count or trailing journal bytes', async () => {
      await expectFailedSubmission(
        'InvalidJournalLength',
        SAMPLE_RESULT.subarray(0, SAMPLE_RESULT.length - 4),
      );
      await expectFailedSubmission(
        'InvalidJournalLength',
        Buffer.concat([SAMPLE_RESULT, Buffer.from([0])]),
      );
    });

    it('rejects when the verifier expects an image ID other than the stored job image ID', async () => {
      await mockVerifier.setExpectedCall(
        ethers.ZeroHash,
        ethers.sha256(SAMPLE_RESULT),
        ethers.keccak256(SAMPLE_PROOF),
      );
      await expectFailedSubmission('MockVerificationFailed');
    });

    it('should revert if verifier rejects the proof and preserve escrow/job state', async () => {
      await mockVerifier.setForceFail(true);
      await expectFailedSubmission('MockVerificationFailed');
    });

    it('should prevent duplicate submissions / double payment release', async () => {
      await prepareExpectedVerifierCall();
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
      const NewVerifierFactory = await ethers.getContractFactory('MockRiscZeroVerifier');
      const newVerifier = await NewVerifierFactory.deploy();
      await newVerifier.waitForDeployment();
      const newVerifierAddress = await newVerifier.getAddress();
      await expect(marketplace.connect(owner).setVerifier(newVerifierAddress))
        .to.emit(marketplace, 'VerifierUpdated')
        .withArgs(await mockVerifier.getAddress(), newVerifierAddress);

      expect(await marketplace.verifier()).to.equal(newVerifierAddress);
      expect(await marketplace.approvedImageId()).to.equal(SAMPLE_IMAGE_ID);
    });

    it('rejects zero and non-contract verifier updates', async () => {
      await expect(
        marketplace.connect(owner).setVerifier(ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(marketplace, 'InvalidVerifierAddress');
      await expect(
        marketplace.connect(owner).setVerifier(attacker.address),
      ).to.be.revertedWithCustomError(marketplace, 'InvalidVerifierAddress');
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

      // Both workers submit journals accepted by the mock logic verifier.
      await marketplace.connect(worker).submitResultWithProof(1n, SAMPLE_RESULT, SAMPLE_PROOF);
      await marketplace.connect(worker2).submitResultWithProof(2n, encodeJournal(2n), SAMPLE_PROOF);

      const job1 = await marketplace.getJob(1n);
      const job2 = await marketplace.getJob(2n);

      expect(job1.status).to.equal(JobStatus.Completed);
      expect(job2.status).to.equal(JobStatus.Completed);
      expect(job1.worker).to.equal(worker.address);
      expect(job2.worker).to.equal(worker2.address);
      expect(job1.result).to.equal(ethers.hexlify(SAMPLE_RESULT));
      expect(job2.result).to.equal(ethers.hexlify(encodeJournal(2n)));
    });
  });
});

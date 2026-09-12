// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IRiscZeroVerifier} from "./interfaces/IRiscZeroVerifier.sol";

/// @title ComputeMarketplace
/// @notice Decentralized compute marketplace and escrow contract.
/// Coordinates off-chain compute jobs with on-chain verification boundary and payment release.
/// Follows Tiger-style principles: explicit assertions, custom errors, strict invariants.
contract ComputeMarketplace {
    // -------------------------------------------------------------------------
    // Enums and Structs
    // -------------------------------------------------------------------------

    /// @notice Lifecycle statuses for a compute job
    enum JobStatus {
        None, // Default uninitialized state
        Created, // Job created and reward escrowed by requester
        Accepted, // Job accepted by a registered worker
        Completed, // Result + proof verified, reward released to worker
        Cancelled // Job cancelled by requester before acceptance, reward refunded
    }

    /// @notice Record representing a single compute job
    struct Job {
        uint256 id;
        address requester;
        address worker;
        uint256 reward;
        bytes32 imageId;
        bytes inputData;
        bytes result;
        bytes proof;
        JobStatus status;
        uint256 createdAt;
        uint256 completedAt;
    }

    // -------------------------------------------------------------------------
    // Custom Errors (Tiger-Style Zero-Cost Diagnostics)
    // -------------------------------------------------------------------------

    error ZeroReward();
    error InvalidImageId();
    error InvalidVerifierAddress();
    error JobNotFound(uint256 jobId);
    error InvalidJobStatus(uint256 jobId, JobStatus currentStatus, JobStatus expectedStatus);
    error WorkerAlreadyRegistered(address worker);
    error WorkerNotRegistered(address worker);
    error RequesterCannotBeWorker();
    error OnlyAssignedWorker(uint256 jobId, address caller, address expectedWorker);
    error OnlyRequester(uint256 jobId, address caller, address expectedRequester);
    error OnlyOwner(address caller, address expectedOwner);
    error ProofVerificationFailed(uint256 jobId);
    error PaymentTransferFailed(address recipient, uint256 amount);
    error ReentrancyGuardLocked();

    // -------------------------------------------------------------------------
    // State Variables
    // -------------------------------------------------------------------------

    /// @notice Contract owner (can update verifier address)
    address public owner;

    /// @notice Address of the RISC Zero verifier contract
    address public verifier;

    /// @notice Auto-incrementing identifier for created jobs
    uint256 public nextJobId;

    /// @notice Mapping from job ID to Job record
    mapping(uint256 => Job) private _jobs;

    /// @notice Registry of authorized workers
    mapping(address => bool) public isWorkerRegistered;

    /// @notice Reentrancy guard lock status (1 = unlocked, 2 = locked)
    uint256 private _locked;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event WorkerRegistered(address indexed worker);
    event WorkerUnregistered(address indexed worker);
    event JobCreated(
        uint256 indexed jobId,
        address indexed requester,
        uint256 reward,
        bytes32 indexed imageId
    );
    event JobAccepted(uint256 indexed jobId, address indexed worker);
    event JobCompleted(uint256 indexed jobId, address indexed worker, uint256 reward, bytes result);
    event JobCancelled(uint256 indexed jobId, address indexed requester, uint256 refundAmount);
    event VerifierUpdated(address indexed previousVerifier, address indexed newVerifier);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // -------------------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------------------

    modifier nonReentrant() {
        if (_locked == 2) revert ReentrancyGuardLocked();
        _locked = 2;
        _;
        _locked = 1;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner(msg.sender, owner);
        _;
    }

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /// @notice Initializes marketplace contract with an optional verifier contract address
    /// @param verifierAddress Initial address of the proof verifier
    constructor(address verifierAddress) {
        owner = msg.sender;
        verifier = verifierAddress;
        nextJobId = 1;
        _locked = 1;

        emit OwnershipTransferred(address(0), msg.sender);
        if (verifierAddress != address(0)) {
            emit VerifierUpdated(address(0), verifierAddress);
        }
    }

    // -------------------------------------------------------------------------
    // Worker Registration
    // -------------------------------------------------------------------------

    /// @notice Registers caller as a worker in the compute marketplace
    function registerWorker() external {
        if (isWorkerRegistered[msg.sender]) {
            revert WorkerAlreadyRegistered(msg.sender);
        }
        isWorkerRegistered[msg.sender] = true;
        emit WorkerRegistered(msg.sender);
    }

    /// @notice Unregisters caller as a worker from the compute marketplace
    function unregisterWorker() external {
        if (!isWorkerRegistered[msg.sender]) {
            revert WorkerNotRegistered(msg.sender);
        }
        isWorkerRegistered[msg.sender] = false;
        emit WorkerUnregistered(msg.sender);
    }

    // -------------------------------------------------------------------------
    // Job Lifecycle & Escrow
    // -------------------------------------------------------------------------

    /// @notice Creates a new compute job and locks the reward payment into contract escrow
    /// @param imageId RISC Zero guest binary image ID corresponding to the deterministic workload
    /// @param inputData Input parameters/payload provided for off-chain execution
    /// @return jobId The unique identifier for the created job
    function createJob(
        bytes32 imageId,
        bytes calldata inputData
    ) external payable returns (uint256 jobId) {
        if (msg.value == 0) revert ZeroReward();
        if (imageId == bytes32(0)) revert InvalidImageId();

        jobId = nextJobId;
        nextJobId = jobId + 1;

        Job storage job = _jobs[jobId];
        job.id = jobId;
        job.requester = msg.sender;
        job.reward = msg.value;
        job.imageId = imageId;
        job.inputData = inputData;
        job.status = JobStatus.Created;
        job.createdAt = block.timestamp;

        emit JobCreated(jobId, msg.sender, msg.value, imageId);
    }

    /// @notice Allows a registered worker to claim and accept an open job
    /// @param jobId The identifier of the job to accept
    function acceptJob(uint256 jobId) external {
        if (!isWorkerRegistered[msg.sender]) {
            revert WorkerNotRegistered(msg.sender);
        }

        Job storage job = _jobs[jobId];
        if (job.status == JobStatus.None) {
            revert JobNotFound(jobId);
        }
        if (job.status != JobStatus.Created) {
            revert InvalidJobStatus(jobId, job.status, JobStatus.Created);
        }
        if (job.requester == msg.sender) {
            revert RequesterCannotBeWorker();
        }

        job.worker = msg.sender;
        job.status = JobStatus.Accepted;

        emit JobAccepted(jobId, msg.sender);
    }

    /// @notice Submits computation result and proof, verifies proof via verifier, and releases escrow payment
    /// @param jobId The identifier of the accepted job
    /// @param result The computation result bytes produced by off-chain guest execution
    /// @param proof The cryptographic proof seal bytes
    function submitResultWithProof(
        uint256 jobId,
        bytes calldata result,
        bytes calldata proof
    ) external nonReentrant {
        Job storage job = _jobs[jobId];
        if (job.status == JobStatus.None) {
            revert JobNotFound(jobId);
        }
        if (job.status != JobStatus.Accepted) {
            revert InvalidJobStatus(jobId, job.status, JobStatus.Accepted);
        }
        if (job.worker != msg.sender) {
            revert OnlyAssignedWorker(jobId, msg.sender, job.worker);
        }

        // Verification Boundary Check
        if (verifier != address(0)) {
            bool valid = IRiscZeroVerifier(verifier).verify(job.imageId, result, proof);
            if (!valid) {
                revert ProofVerificationFailed(jobId);
            }
        }

        // State Transition (Checks-Effects-Interactions pattern)
        uint256 rewardAmount = job.reward;
        address workerAddress = job.worker;

        job.result = result;
        job.proof = proof;
        job.status = JobStatus.Completed;
        job.completedAt = block.timestamp;

        emit JobCompleted(jobId, workerAddress, rewardAmount, result);

        // Release escrowed payment to worker
        (bool success, ) = workerAddress.call{value: rewardAmount}("");
        if (!success) {
            revert PaymentTransferFailed(workerAddress, rewardAmount);
        }
    }

    /// @notice Cancels an open job that has not been accepted and refunds escrowed funds to requester
    /// @param jobId The identifier of the created job to cancel
    function cancelJob(uint256 jobId) external nonReentrant {
        Job storage job = _jobs[jobId];
        if (job.status == JobStatus.None) {
            revert JobNotFound(jobId);
        }
        if (job.status != JobStatus.Created) {
            revert InvalidJobStatus(jobId, job.status, JobStatus.Created);
        }
        if (job.requester != msg.sender) {
            revert OnlyRequester(jobId, msg.sender, job.requester);
        }

        uint256 refundAmount = job.reward;
        address requesterAddress = job.requester;

        job.status = JobStatus.Cancelled;

        emit JobCancelled(jobId, requesterAddress, refundAmount);

        // Refund escrowed payment to requester
        (bool success, ) = requesterAddress.call{value: refundAmount}("");
        if (!success) {
            revert PaymentTransferFailed(requesterAddress, refundAmount);
        }
    }

    // -------------------------------------------------------------------------
    // Administration & Setters
    // -------------------------------------------------------------------------

    /// @notice Updates the verifier contract address
    /// @param newVerifier The address of the new verifier contract
    function setVerifier(address newVerifier) external onlyOwner {
        address previousVerifier = verifier;
        verifier = newVerifier;
        emit VerifierUpdated(previousVerifier, newVerifier);
    }

    /// @notice Transfers contract ownership to a new address
    /// @param newOwner The address of the new owner
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) {
            revert InvalidVerifierAddress();
        }
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    // -------------------------------------------------------------------------
    // View Functions
    // -------------------------------------------------------------------------

    /// @notice Returns full details of a specific job
    /// @param jobId Identifier of the job
    /// @return job The Job record
    function getJob(uint256 jobId) external view returns (Job memory job) {
        job = _jobs[jobId];
        if (job.status == JobStatus.None) {
            revert JobNotFound(jobId);
        }
    }
}

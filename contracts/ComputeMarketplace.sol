// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IRiscZeroVerifier} from "./interfaces/IRiscZeroVerifier.sol";

/// @title ComputeMarketplace
/// @notice Decentralized compute marketplace and escrow contract.
/// Coordinates off-chain compute jobs with on-chain verification boundary and payment release.
/// Follows Tiger-style principles: explicit assertions, custom errors, strict invariants.
contract ComputeMarketplace {
    bytes13 private constant MATRIX_INPUT_TAG = "RZMM_INPUT_V1";
    bytes15 private constant MATRIX_JOURNAL_TAG = "RZMM_JOURNAL_V1";
    uint256 private constant INPUT_TAG_LENGTH = 13;
    uint256 private constant JOURNAL_TAG_LENGTH = 15;
    uint256 private constant JOURNAL_HEADER_LENGTH = 87;

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
    error InvalidInputTag();
    error InvalidInputDimensions();
    error InvalidInputLength();
    error InvalidJournalTag();
    error InvalidJournalLength();
    error JournalJobIdMismatch(uint256 journalJobId, uint256 expectedJobId);
    error JournalInputCommitmentMismatch(bytes32 journalCommitment, bytes32 expectedCommitment);
    error InvalidJournalDimensions();
    error JournalResultDimensionsMismatch();
    error MatrixLengthOverflow();
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

    /// @notice Initializes marketplace contract with a deployed proof verifier
    /// @param verifierAddress Initial address of the proof verifier
    constructor(address verifierAddress) {
        if (verifierAddress == address(0) || verifierAddress.code.length == 0) {
            revert InvalidVerifierAddress();
        }
        owner = msg.sender;
        verifier = verifierAddress;
        nextJobId = 1;
        _locked = 1;

        emit OwnershipTransferred(address(0), msg.sender);
        emit VerifierUpdated(address(0), verifierAddress);
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
        _validateCanonicalInput(inputData);

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

    /// @notice Submits the raw Stage 3 journal and selector-prefixed proof seal.
    /// Verifies all journal bindings and the RISC Zero proof before releasing escrow.
    /// @param jobId The identifier of the accepted job
    /// @param result The exact raw journal bytes committed by the guest
    /// @param proof The selector-prefixed RISC Zero Groth16 seal
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

        address verifierAddress = verifier;
        if (verifierAddress == address(0) || verifierAddress.code.length == 0) {
            revert InvalidVerifierAddress();
        }
        _validateJournal(jobId, job.inputData, result);

        // The official verifier reverts on invalid seals and returns no boolean.
        IRiscZeroVerifier(verifierAddress).verify(proof, job.imageId, sha256(result));

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
        if (newVerifier == address(0) || newVerifier.code.length == 0) {
            revert InvalidVerifierAddress();
        }
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

    function _validateCanonicalInput(
        bytes memory inputData
    ) private pure returns (uint32 resultRows, uint32 resultCols) {
        if (inputData.length < INPUT_TAG_LENGTH + 16) revert InvalidInputLength();

        bytes32 firstWord;
        assembly {
            firstWord := mload(add(inputData, 32))
        }
        if (bytes13(firstWord) != MATRIX_INPUT_TAG) revert InvalidInputTag();

        uint32 aRows = _readUint32Memory(inputData, INPUT_TAG_LENGTH);
        uint32 aCols = _readUint32Memory(inputData, INPUT_TAG_LENGTH + 4);
        if (aRows == 0 || aCols == 0) revert InvalidInputDimensions();

        uint256 aElementBytes = _checkedMatrixByteLength(aRows, aCols);
        uint256 bHeaderOffset = _checkedLengthSum(INPUT_TAG_LENGTH + 8, aElementBytes);
        if (bHeaderOffset > inputData.length || inputData.length - bHeaderOffset < 8) {
            revert InvalidInputLength();
        }
        uint32 bRows = _readUint32Memory(inputData, bHeaderOffset);
        uint32 bCols = _readUint32Memory(inputData, bHeaderOffset + 4);
        if (bRows == 0 || bCols == 0 || aCols != bRows) {
            revert InvalidInputDimensions();
        }

        uint256 expectedLength = _checkedLengthSum(
            _checkedLengthSum(bHeaderOffset, 8),
            _checkedMatrixByteLength(bRows, bCols)
        );
        if (inputData.length != expectedLength) revert InvalidInputLength();
        return (aRows, bCols);
    }

    function _validateJournal(
        uint256 jobId,
        bytes memory inputData,
        bytes calldata journal
    ) private pure {
        if (journal.length < JOURNAL_HEADER_LENGTH) revert InvalidJournalLength();

        bytes32 tagWord;
        assembly {
            tagWord := calldataload(journal.offset)
        }
        if (bytes15(tagWord) != MATRIX_JOURNAL_TAG) revert InvalidJournalTag();

        uint256 journalJobId = _readUint256(journal, JOURNAL_TAG_LENGTH);
        if (journalJobId != jobId) {
            revert JournalJobIdMismatch(journalJobId, jobId);
        }

        bytes32 journalCommitment = _readBytes32(journal, JOURNAL_TAG_LENGTH + 32);
        bytes32 expectedCommitment = sha256(inputData);
        if (journalCommitment != expectedCommitment) {
            revert JournalInputCommitmentMismatch(journalCommitment, expectedCommitment);
        }

        uint32 rows = _readUint32(journal, JOURNAL_TAG_LENGTH + 64);
        uint32 cols = _readUint32(journal, JOURNAL_TAG_LENGTH + 68);
        if (rows == 0 || cols == 0) revert InvalidJournalDimensions();

        (uint32 expectedRows, uint32 expectedCols) = _validateCanonicalInput(inputData);
        if (rows != expectedRows || cols != expectedCols) {
            revert JournalResultDimensionsMismatch();
        }

        uint256 expectedJournalLength = _checkedLengthSum(
            JOURNAL_HEADER_LENGTH,
            _checkedMatrixByteLength(rows, cols)
        );
        if (journal.length != expectedJournalLength) {
            revert InvalidJournalLength();
        }
    }

    function _checkedMatrixByteLength(uint32 rows, uint32 cols) private pure returns (uint256) {
        uint256 rowCount = uint256(rows);
        uint256 columnCount = uint256(cols);
        if (columnCount != 0 && rowCount > type(uint256).max / columnCount) {
            revert MatrixLengthOverflow();
        }
        uint256 elementCount = rowCount * columnCount;
        if (elementCount > type(uint256).max / 4) revert MatrixLengthOverflow();
        return elementCount * 4;
    }

    function _checkedLengthSum(uint256 left, uint256 right) private pure returns (uint256) {
        if (right > type(uint256).max - left) revert MatrixLengthOverflow();
        return left + right;
    }

    function _readUint32Memory(
        bytes memory data,
        uint256 offset
    ) private pure returns (uint32 value) {
        uint256 word;
        assembly {
            word := mload(add(add(data, 32), offset))
        }
        value = uint32(word >> 224);
    }

    function _readUint32(bytes calldata data, uint256 offset) private pure returns (uint32 value) {
        uint256 word;
        assembly {
            word := calldataload(add(data.offset, offset))
        }
        value = uint32(word >> 224);
    }

    function _readUint256(
        bytes calldata data,
        uint256 offset
    ) private pure returns (uint256 value) {
        assembly {
            value := calldataload(add(data.offset, offset))
        }
    }

    function _readBytes32(
        bytes calldata data,
        uint256 offset
    ) private pure returns (bytes32 value) {
        assembly {
            value := calldataload(add(data.offset, offset))
        }
    }
}

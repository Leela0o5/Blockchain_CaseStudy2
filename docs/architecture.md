# Architecture

The Decentralized Compute Marketplace consists of two decoupled subsystems:

1. **Blockchain Layer (`contracts/`, `scripts/`, `test/contract/`)**:
   - `ComputeMarketplace.sol`: Coordinates jobs, manages escrow, enforces state transitions, and releases payments.
   - `IRiscZeroVerifier.sol`: Clean interface boundary for verifying cryptographic execution proofs.
   - `MockRiscZeroVerifier.sol`: Test verifier for staging and local development.
   - Automated test suite ensuring deterministic escrow, safety invariants, and Tiger-style assertions.

2. **Off-Chain RISC Zero Layer (`risc0/`, `test/risc0/`)**:
   - Deterministic guest program execution.
   - Host program for job fetching, workload execution, receipt generation, and submission.
   - Proving and receipt serialization.

The interface between the two systems is defined by the `IRiscZeroVerifier` boundary. The marketplace contract receives only the minimum required metadata (`imageId`, `result`, `proof`) without needing internal knowledge of off-chain execution mechanisms.

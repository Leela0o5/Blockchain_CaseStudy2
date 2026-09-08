# Problem Statement

Decentralized cloud computing platforms often depend on trusted intermediaries to coordinate jobs, verify execution, and manage payments. This creates central points of failure, increases costs, and requires requesters to trust workers before results can be verified.
This project proposes a **decentralized compute marketplace** on Ethereum Sepolia in which requesters can post computational jobs, workers can register and accept those jobs, and off-chain computations can be verified using **RISC Zero** before payment is released. The smart contract serves as the coordination and escrow layer, storing job details, managing worker assignment, verifying proof outcomes, and automatically releasing funds only when the computation is proven correct.

The prototype is intended to demonstrate a trust-minimized workflow for exchanging computing resources without relying on a centralized platform or direct trust between requesters and workers.

## Assumptions

- The system supports only **predefined computational tasks**.
- All supported workloads are **deterministic**, meaning the same input and program always produce the same output.
- Computation is performed **off-chain** by workers.
- Proof generation and verification use **RISC Zero**.
- Payments are locked in **smart-contract escrow** before job execution.
- The initial prototype focuses on **CPU-based workloads** such as numerical calculations, matrix operations, and basic data processing.
- The system is deployed and demonstrated on the **Ethereum Sepolia Testnet**.
- The prototype does **not** support arbitrary user-uploaded programs, GPU workloads, or production-scale distributed computing.

## System Goals

- Allow requesters to create computational jobs
- Allow workers to register and accept available jobs
- Execute computational workloads off-chain
- Generate cryptographic proofs for completed computations
- Verify computation proofs before releasing payment
- Lock requester payments securely using smart-contract escrow
- Automatically release payment to workers after successful verification
- Provide a decentralized mechanism for exchanging computing resources
- Demonstrate the complete workflow on the Ethereum Sepolia Testnet

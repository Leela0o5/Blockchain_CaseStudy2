# Architecture

The project has two independently developed technical areas:

1. The blockchain side owns Solidity contracts, deployment scripts, and contract tests.
2. The RISC Zero side owns deterministic guest computation, the host program, proof generation, receipt handling, and RISC Zero tests.

The contract boundary should receive only the data needed to coordinate a job and verify a computation result. Computation and proving details remain off-chain. Shared assumptions and any interface changes belong in this documentation directory.

No implementation is defined in this document yet.
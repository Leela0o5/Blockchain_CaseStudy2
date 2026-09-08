# Verification Flow

RISC Zero will provide evidence that a specified deterministic computation was executed. The blockchain side will eventually validate the proof through an Ethereum-compatible verification boundary before treating a result as verified.

The exact receipt format, verifier integration, public inputs, and failure behavior are intentionally left for the implementation branches. Keep proof generation and receipt handling in `risc0/`; keep on-chain verification integration in `contracts/`.
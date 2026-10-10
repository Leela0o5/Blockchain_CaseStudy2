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

## RISC Zero Groth16 verifier (Stage 1)

The repository pins the official [`risc0-ethereum`](https://github.com/risc0/risc0-ethereum)
source at tag `v1.2.1`, commit
`b9b22c396a0d5ef97bf02702da9415d5bb79a85a`, as a Git submodule in
`vendor/risc0-ethereum`. Initialize it after a fresh clone with:

```sh
git submodule update --init vendor/risc0-ethereum
npm ci
```

The pinned source files are
[`RiscZeroGroth16Verifier.sol`](./vendor/risc0-ethereum/contracts/src/groth16/RiscZeroGroth16Verifier.sol)
and [`ControlID.sol`](./vendor/risc0-ethereum/contracts/src/groth16/ControlID.sol).

The pinned official `RiscZeroGroth16Verifier` imports
`openzeppelin/contracts/utils/math/SafeCast.sol`. The `openzeppelin`
development dependency downloads the official OpenZeppelin Contracts v5.0.1
source archive at commit `01ef448981be9d20ca85f2faf6ebdf591ce409f3`, pinned in
`package-lock.json`. npm places it under `node_modules/openzeppelin`, matching
the import prefix used by the upstream source. The official verifier Solidity
source is not modified. It is compiled by Hardhat with the project's Solidity
0.8.28 compiler.

Deploy the verifier to a local Hardhat node in separate terminals:

```sh
npx hardhat node
npx hardhat run scripts/deploy-risc0-verifier.ts --network localhost
```

The script deploys the official contract with the `CONTROL_ROOT` and
`BN254_CONTROL_ID` values from the pinned release's `ControlID.sol`. It is
restricted to the ephemeral `hardhat` network or the configured local
`localhost` node and prints the deployed address, upstream semantic version,
and verifier selector. To deploy only to an ephemeral in-memory Hardhat
network, omit `--network localhost`.

The Stage 1 test deploys the official contract and checks that it has code,
exposes `verify(bytes,bytes32,bytes32)`, and reports the expected version,
selector, and BN254 control ID. **This interface/deployment smoke test does not
verify a RISC Zero receipt or Groth16 proof.** The marketplace still uses its
existing mock verifier and has not been wired to the official verifier in this
stage.

## Real RISC Zero receipt verification (Stage 2)

The real-proof check is separate from the marketplace and its mock-verifier
tests. It generates a fresh Groth16 receipt from the existing matrix guest,
locally verifies the receipt, rejects non-Groth16 (including dev-mode fake)
receipts, and uses the pinned official `risc0-ethereum-contracts` 1.2.1
`encode_seal(&receipt)` helper. That upstream helper prefixes the proof seal
with the verifier selector. The Rust exporter preserves the receipt journal
bytes and emits their SHA-256 digest; the Hardhat script independently checks
that digest before calling the official verifier. It also confirms an altered
journal digest is rejected.

Prerequisites are the Rust dependencies in `Cargo.lock`, the RISC Zero guest
toolchain needed by `risc0/methods/build.rs`, and the Node dependencies installed
with `npm ci`. The existing Rust integration tests exclude Windows, and this
integration path has not been validated with the Windows guest/native toolchain;
run it on Linux or macOS with a toolchain compatible with the locked RISC Zero
1.2.6 crates. Run from the repository root:

```sh
npm run verify:risc0:real
```

This command starts an ephemeral local Hardhat network, generates the actual
Groth16 proof through
`cargo run --locked -p host --bin export-ethereum-proof`, deploys
`RiscZeroGroth16Verifier` with the pinned control IDs, and invokes
`verify(bytes,bytes32,bytes32)`. For a persistent local node, start
`npx hardhat node` in another terminal and run:

```sh
npm run verify:risc0:real -- --network localhost
```

Success prints the verifier address, guest image ID, exact journal bytes in
hex, SHA-256 journal digest, and selector-prefixed Ethereum seal, followed by
confirmation of real on-chain verification and rejection of the altered
digest. Do not set `RISC0_DEV_MODE=1` for this check. The Rust exporter requires
a genuine `Groth16` receipt; the existing mock verifier and Stage 1 interface
smoke test do not establish this result.

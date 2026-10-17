>**Report:** [docs/BC_Report.pdf](docs/Case_Study_Report.pdf)

# Problem Statement

Centralized cloud computing platforms often depend on trusted intermediaries to coordinate jobs, verify execution, and manage payments. This creates central points of failure, increases costs, and requires requesters to trust workers before results can be verified.
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
restricted to local networks, except Sepolia deployment which requires the
explicit `DEPLOY_RISC0_VERIFIER=true` opt-in described in Stage 4. It prints
the deployed address, upstream semantic version, and verifier selector. To
deploy only to an ephemeral in-memory Hardhat network, omit
`--network localhost`.

The Stage 1 test deploys the official contract and checks that it has code,
exposes `verify(bytes,bytes32,bytes32)`, and reports the expected version,
selector, and BN254 control ID. **This interface/deployment smoke test does not
verify a RISC Zero receipt or Groth16 proof.** Marketplace mock tests cover
logic only; Stage 4 describes the official verifier call path.

## Real RISC Zero receipt verification (Stage 2)

The real-proof check is separate from marketplace logic tests. It generates a
fresh Groth16 receipt from the existing matrix guest,
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
`verify(bytes,bytes32,bytes32)`. It also submits the same genuine receipt
through `ComputeMarketplace` and checks the completed job and escrow release.
For a persistent local node, start
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

### Invalid proof rejection and escrow safety

The real-verifier integration script also tests rejection of a corrupted Groth16 seal through `ComputeMarketplace`. After the job is accepted, the script modifies a byte in the seal and attempts to submit it with the genuine journal.

The test asserts that:

- The corrupted proof is rejected by the official verifier.
- The job remains in the `Accepted` state.
- The job result remains empty.
- The marketplace escrow balance remains unchanged.
- Submitting the original genuine proof afterward successfully completes the job and releases the reward.
- A genuine proof for job 7 cannot be replayed against job 8; the second job remains accepted, its result remains empty, and its escrow remains locked.

The script also tests rejection of a modified journal digest directly against the official verifier. These checks complement the fast mock-verifier unit tests; they exercise the actual cryptographic verification path on a local Hardhat network.

**Scope:** These are local integration tests. They do not demonstrate deployment or verification on Ethereum Sepolia.
## Matrix proof input and journal binding (Stage 3)

The matrix guest receives a byte-framed request and independently recomputes
the input commitment before it performs the multiplication. Stage 4 validates
the canonical input bytes on job creation and binds the journal commitment to
the exact stored `inputData`.

Canonical matrix input bytes are:

| Field             | Encoding                                            |
| ----------------- | --------------------------------------------------- |
| Version tag       | ASCII `RZMM_INPUT_V1` (13 bytes)                    |
| A rows, A columns | `u32` big-endian                                    |
| A elements        | Row-major signed `i32`, two's-complement big-endian |
| B rows, B columns | `u32` big-endian                                    |
| B elements        | Row-major signed `i32`, two's-complement big-endian |

All dimensions must be nonzero, element counts must match dimensions, and
A's column count must equal B's row count. The input commitment is
`SHA-256(canonical matrix input bytes)`; it excludes the job ID.

The guest transport prepends a 32-byte big-endian `uint256` job ID, the
32-byte input commitment, and the canonical input byte length as `u32`
big-endian. The journal is raw, non-serde data:

| Field                       | Encoding                                            |
| --------------------------- | --------------------------------------------------- |
| Version tag                 | ASCII `RZMM_JOURNAL_V1` (15 bytes)                  |
| Job ID                      | 32-byte big-endian `uint256`                        |
| Input commitment            | 32 bytes                                            |
| Result rows, result columns | `u32` big-endian                                    |
| Result elements             | Row-major signed `i32`, two's-complement big-endian |

The Ethereum journal digest remains SHA-256 of the exact raw journal bytes.
The proof exporter validates the bound journal and the local EVM script checks
the canonical input, input commitment, journal fields, journal SHA-256, and
then submits the genuine selector-prefixed Groth16 seal through the official
verifier and marketplace. See the Stage 4 instructions below.

The job ID in this proof demonstration is the fixed value `7`; production job
creation is not wired to the proof exporter beyond this local integration
demonstration. The existing expensive Rust Groth16 test remains separate from
the fast unit tests in `risc0/matrix-format` and `risc0/host`.

## Marketplace verification and escrow release (Stage 4)

The marketplace uses the official no-return ABI
`verify(bytes seal, bytes32 imageId, bytes32 journalDigest)`. It passes the
selector-prefixed proof, the image ID stored on the job, and SHA-256 of the
exact raw journal bytes. The official verifier reverts on failure. Before
calling it, the marketplace checks the Stage 3 journal tag, big-endian job ID,
input commitment (`sha256` of the exact stored canonical input bytes),
nonzero result dimensions, result dimensions matching the input matrices, and
the exact journal size `87 + rows * columns * 4`. The raw journal remains in
the existing `Job.result` field. Invalid journals or failed verifier calls
revert before completion state or worker payment can persist.

The marketplace enforces a single immutable approved guest image ID at job
creation and verifies proofs against the image ID stored in each job. Workers
should compare a job's image ID with their locally generated guest image ID
before accepting it.

`npm test` uses `MockRiscZeroVerifier` for fast **marketplace logic tests only**;
the mock reverts or checks call arguments but does not verify cryptographic
proofs. `npm run verify:risc0` generates one genuine Groth16 receipt, verifies
it directly with the pinned official verifier, then submits it through the
marketplace and checks the completed job and released escrow.

## Job-oriented proof export (worker runner step 1)

The `prove-job` host binary proves an existing job's exact canonical
`inputData` bytes without connecting to Ethereum or submitting transactions.
Save the raw bytes returned by `getJob(jobId).inputData` to a binary file (do
not save its `0x`-prefixed textual hex representation). From the repository
root, configure `MATRIX_MULTIPLY_GUEST_ID` to the approved image ID read from
the deployed marketplace, then run:

```sh
export MATRIX_MULTIPLY_GUEST_ID=0xREPLACE_WITH_64_HEX_CHARACTERS
cargo run --locked -p host --bin prove-job -- 123 ./job-input.bin
```

For PowerShell, set the environment variable with
`$env:MATRIX_MULTIPLY_GUEST_ID = "0xREPLACE_WITH_64_HEX_CHARACTERS"` before the
command `cargo run --locked -p host --bin prove-job -- 123 .\\job-input.bin`.
Replace `123` with the existing marketplace job ID in decimal or `0x` form.
The tool verifies that this configured image ID
matches the ID generated by the current methods build, validates and
round-trips the canonical matrix encoding, constructs the job-bound guest
input, generates and locally verifies a Groth16 receipt, checks journal
bindings and the computed result, and prints JSON containing the seal and
verification data. Stdout is a single JSON object; proof progress/errors are
reported separately. This is a proving/export utility only: it does not
register or accept a job, read from a node, or submit the proof. Proof
generation requires the RISC Zero guest toolchain and prover prerequisites
described above.

For a persistent local Hardhat node, deploy the official verifier first and
explicitly pass its address and the matrix guest image ID into marketplace
deployment. `MATRIX_MULTIPLY_GUEST_ID` must be the nonzero `bytes32` image ID
generated for the guest build you intend to accept; there is no production
default. The marketplace stores this value as an immutable approval, rejects
jobs for other image IDs, and changing the guest requires deploying a new
marketplace.

```sh
npx hardhat node
npx hardhat run scripts/deploy-risc0-verifier.ts --network localhost
VERIFIER_ADDRESS=0x... MATRIX_MULTIPLY_GUEST_ID=0x... npx hardhat run scripts/deploy.ts --network localhost
```

The local mock deployment must be explicitly requested and is development-only:

```sh
DEPLOY_MOCK_VERIFIER=true npx hardhat run scripts/deploy.ts --network localhost
```

`deploy.ts` requires a nonzero `VERIFIER_ADDRESS` with deployed contract code
and a nonzero `MATRIX_MULTIPLY_GUEST_ID`; it rejects mock mode on public
networks. For Sepolia, configure `SEPOLIA_RPC_URL` and `PRIVATE_KEY` in the
environment, then explicitly opt in to deploying the official verifier. Use
its printed address and the matrix guest ID for marketplace deployment:

```sh
DEPLOY_RISC0_VERIFIER=true npx hardhat run scripts/deploy-risc0-verifier.ts --network sepolia
VERIFIER_ADDRESS=0x... MATRIX_MULTIPLY_GUEST_ID=0x... npx hardhat run scripts/deploy.ts --network sepolia
```

## Technology Stack

### Smart Contract Tech Stack

- **Blockchain:** Ethereum
- **Network:** Ethereum Sepolia Testnet
- **Smart Contract Language:** Solidity
- **Development Framework:** Hardhat
- **Contract Testing:** Hardhat + TypeScript
- **Contract Deployment:** Hardhat deployment scripts
- **Wallet / Transactions:** MetaMask
- **Proof Verification:** RISC Zero Ethereum verifier/verification mechanism
- **Code Formatting:** Prettier
- **Solidity Linting:** Solhint
- **TypeScript/JavaScript Linting:** ESLint
- **Version Control:** Git + GitHub

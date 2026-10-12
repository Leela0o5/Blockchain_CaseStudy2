# ComputeLayer dashboard

Vite + React + TypeScript dashboard for the ComputeMarketplace contract. The
frontend supports creating matrix-computation jobs and reading recent jobs; it
does not accept jobs, execute matrix computations, generate proofs, or submit
results.

## Configure

Create `frontend/.env.local`:

```dotenv
VITE_MARKETPLACE_ADDRESS=0x...
VITE_CHAIN_ID=11155111
```

Use the address of the deployed `ComputeMarketplace` and the chain ID where it
is deployed. The example chain ID is Sepolia; change it when targeting another
network. The app compares this configured ID with the connected wallet and
shows a warning on mismatch.

The contract ABI is copied from the compiled Hardhat artifact to
`src/contracts/ComputeMarketplace.json`. To refresh it after a contract ABI
change, compile the root Hardhat project and copy only the artifact's `abi`
array; do not include bytecode.

## Run

From the `frontend/` directory:

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite and connect an injected wallet such as
MetaMask. The dashboard reads `approvedImageId()` and `nextJobId()` from the
configured contract. When connected to the configured chain, it reads up to 10
recent jobs through `getJob(jobId)`, newest first. Job details are hidden when
the wallet is disconnected or on a different chain; the list refreshes on new
blocks and can also be refreshed manually.

The **New job** form accepts comma-separated integer rows for matrices A and B
and a positive ETH reward. It encodes matrix inputs using the canonical
`RZMM_INPUT_V1` format and calls the contract's payable `createJob` function
with the contract's current `approvedImageId()`. The reward is escrowed on
submission. Confirm the transaction in MetaMask; the UI reports success only
after the transaction is mined and a `JobCreated` event supplies the job ID.
The frontend does not generate or verify a proof.

## Verify

From the `frontend/` directory:

```sh
npm run build
npm run lint
npm run test
```

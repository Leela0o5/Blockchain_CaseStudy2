# End-to-End Workflow

The intended workflow is:

1. A requester submits a job request to the blockchain layer.
2. A worker obtains the job inputs and runs the deterministic computation off-chain.
3. The worker creates a RISC Zero receipt for the computation.
4. The result and proof data are sent to the blockchain verification boundary.
5. The contract accepts or rejects the verified result according to the future marketplace design.

This is a design outline only. It does not define job states, payment behavior, or contract interfaces.
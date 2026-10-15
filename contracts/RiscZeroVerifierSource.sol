// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.28;

import {RiscZeroGroth16Verifier} from "../vendor/risc0-ethereum/contracts/src/groth16/RiscZeroGroth16Verifier.sol";

// This abstract shell adds the upstream verifier to Hardhat's source graph.
// solhint-disable-next-line no-empty-blocks
abstract contract RiscZeroVerifierSource is RiscZeroGroth16Verifier {}

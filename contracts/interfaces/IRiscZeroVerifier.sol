// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Official RISC Zero verifier interface.
interface IRiscZeroVerifier {
    /// @notice Verifies a selector-prefixed seal against an image ID and journal digest.
    /// Reverts when verification fails.
    /// @param seal The selector-prefixed RISC Zero Groth16 seal
    /// @param imageId The RISC Zero guest program image ID
    /// @param journalDigest SHA-256 digest of the exact journal bytes
    function verify(bytes calldata seal, bytes32 imageId, bytes32 journalDigest) external view;
}

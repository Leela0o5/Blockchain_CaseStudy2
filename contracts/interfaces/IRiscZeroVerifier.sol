// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IRiscZeroVerifier
/// @notice Interface for RISC Zero proof verification boundary
interface IRiscZeroVerifier {
    /// @notice Verifies a RISC Zero proof seal against an expected imageId and journal bytes
    /// @param imageId The RISC Zero guest program image ID (binary digest)
    /// @param journal The committed output/journal bytes from the guest execution
    /// @param seal The cryptographic proof / receipt seal bytes
    /// @return valid True if the proof is valid, false otherwise
    function verify(
        bytes32 imageId,
        bytes calldata journal,
        bytes calldata seal
    ) external view returns (bool valid);
}

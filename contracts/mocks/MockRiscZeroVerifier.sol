// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IRiscZeroVerifier} from "../interfaces/IRiscZeroVerifier.sol";

/// @title MockRiscZeroVerifier
/// @notice Test verifier to simulate valid and invalid RISC Zero proofs in development
contract MockRiscZeroVerifier is IRiscZeroVerifier {
    bool private _forceFail;

    event ForceFailConfigured(bool forceFail);

    /// @notice Sets whether future verification calls should fail
    /// @param forceFail True to reject all proofs, false to verify normally
    function setForceFail(bool forceFail) external {
        _forceFail = forceFail;
        emit ForceFailConfigured(forceFail);
    }

    /// @notice Returns current forceFail status
    function isForceFail() external view returns (bool) {
        return _forceFail;
    }

    /// @notice Verifies proof based on mock logic (accepts unless forceFail or empty seal/imageId)
    /// @param imageId The RISC Zero guest program image ID
    /// @param seal The cryptographic proof bytes
    /// @return valid True if verification succeeds
    function verify(
        bytes32 imageId,
        bytes calldata /* journal */,
        bytes calldata seal
    ) external view override returns (bool valid) {
        if (_forceFail) {
            return false;
        }
        if (imageId == bytes32(0)) {
            return false;
        }
        if (seal.length == 0) {
            return false;
        }
        return true;
    }
}

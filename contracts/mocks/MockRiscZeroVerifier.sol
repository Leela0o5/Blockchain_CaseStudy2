// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IRiscZeroVerifier} from "../interfaces/IRiscZeroVerifier.sol";

/// @notice Test stub for marketplace logic tests; it does not verify proofs cryptographically.
contract MockRiscZeroVerifier is IRiscZeroVerifier {
    bool private _forceFail;
    bool private _checkExpectedCall;
    bytes32 private _expectedImageId;
    bytes32 private _expectedJournalDigest;
    bytes32 private _expectedSealHash;

    event ForceFailConfigured(bool forceFail);
    event ExpectedCallConfigured(bytes32 imageId, bytes32 journalDigest, bytes32 sealHash);

    error MockVerificationFailed();

    function setForceFail(bool forceFail) external {
        _forceFail = forceFail;
        emit ForceFailConfigured(forceFail);
    }

    function isForceFail() external view returns (bool) {
        return _forceFail;
    }

    function setExpectedCall(bytes32 imageId, bytes32 journalDigest, bytes32 sealHash) external {
        _checkExpectedCall = true;
        _expectedImageId = imageId;
        _expectedJournalDigest = journalDigest;
        _expectedSealHash = sealHash;
        emit ExpectedCallConfigured(imageId, journalDigest, sealHash);
    }

    function verify(
        bytes calldata seal,
        bytes32 imageId,
        bytes32 journalDigest
    ) external view override {
        if (_forceFail || imageId == bytes32(0) || seal.length == 0) {
            revert MockVerificationFailed();
        }
        if (
            _checkExpectedCall &&
            (imageId != _expectedImageId ||
                journalDigest != _expectedJournalDigest ||
                keccak256(seal) != _expectedSealHash)
        ) {
            revert MockVerificationFailed();
        }
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {MockUSDC} from "./MockUSDC.sol";

interface ITokenReceiver {
    function onTokenReceived(uint256 amount) external;
}

/// @notice A USDC that calls back the recipient on every transfer (like ERC-777 hooks).
///         Arc's USDC doesn't do this; the escrow must stay safe even if a token did.
contract HookUSDC is MockUSDC {
    function transfer(address to, uint256 value) external override returns (bool) {
        _transfer(msg.sender, to, value);
        if (to.code.length > 0) ITokenReceiver(to).onTokenReceived(value);
        return true;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {AttnnRegistry} from "../src/AttnnRegistry.sol";
import {AttnnEscrow} from "../src/AttnnEscrow.sol";

contract Deploy is Script {
    // Arc USDC ERC-20 interface (6 decimals). Same address on Arc Testnet (5042002)
    // and Arc mainnet (5042).
    address constant USDC = 0x3600000000000000000000000000000000000000;


    function run() external returns (AttnnRegistry registry, AttnnEscrow escrow) {
        require(block.chainid == 5042 || block.chainid == 5042002, "Deploy: not an Arc network");
        console.log(block.chainid == 5042 ? "Network: Arc MAINNET (real USDC)" : "Network: Arc Testnet");
        // Read private key from environment
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        
        // Start broadcasting transactions
        vm.startBroadcast(deployerPrivateKey);
        
        // Deploy AttnnRegistry
        registry = new AttnnRegistry();
        
        // Deploy AttnnEscrow with registry and USDC addresses
        escrow = new AttnnEscrow(USDC, address(registry));
        
        vm.stopBroadcast();
        
        // Log addresses
        console.log("AttnnRegistry deployed at:", address(registry));
        console.log("AttnnEscrow deployed at:", address(escrow));
        console.log("USDC address:", USDC);
        console.log("Escrow MIN_BID (atomic):", escrow.MIN_BID());
        console.log("Escrow REFUND_PERIOD (s):", escrow.REFUND_PERIOD());
    }
}
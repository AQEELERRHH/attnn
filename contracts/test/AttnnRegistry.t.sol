// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {AttnnRegistry} from "../src/AttnnRegistry.sol";

contract AttnnRegistryTest is Test {
    AttnnRegistry public registry;
    address public creator = makeAddr("creator");
    address public anotherCreator = makeAddr("anotherCreator");

    function setUp() public {
        registry = new AttnnRegistry();
    }

    function test_RegisterCreator() public {
        vm.startPrank(creator);
        string[] memory tags = new string[](2);
        tags[0] = "ai";
        tags[1] = "tech";
        registry.registerCreator("alice", 10 * 10**6, tags, "ipfs://Qm...");
        vm.stopPrank();

        (address addr, uint256 minBid, string[] memory retrievedTags, string memory profileURI, bool isActive) =
            registry.getCreatorProfile("alice");
        assertEq(addr, creator);
        assertEq(minBid, 10 * 10**6);
        assertEq(retrievedTags.length, 2);
        assertEq(retrievedTags[0], "ai");
        assertEq(retrievedTags[1], "tech");
        assertEq(profileURI, "ipfs://Qm...");
        assertTrue(isActive);
    }

    function test_RegisterCreator_HandleTaken() public {
        vm.startPrank(creator);
        string[] memory tags;
        registry.registerCreator("alice", 10 * 10**6, tags, "");
        vm.stopPrank();

        vm.startPrank(anotherCreator);
        vm.expectRevert("AttnnRegistry: handle already taken");
        registry.registerCreator("alice", 15 * 10**6, tags, "");
        vm.stopPrank();
    }

    function test_RegisterCreator_MinBidTooLow() public {
        vm.startPrank(creator);
        string[] memory tags;
        vm.expectRevert("AttnnRegistry: minBid too low (min 5 USDC)");
        registry.registerCreator("alice", 4 * 10**6, tags, "");
        vm.stopPrank();
    }

    function test_RegisterCreator_MinBidTooHigh() public {
        vm.startPrank(creator);
        string[] memory tags;
        vm.expectRevert("AttnnRegistry: minBid too high (max 1000 USDC)");
        registry.registerCreator("alice", 1001 * 10**6, tags, "");
        vm.stopPrank();
    }

    function test_DeactivateAndActivate() public {
        vm.startPrank(creator);
        string[] memory tags;
        registry.registerCreator("alice", 10 * 10**6, tags, "");
        assertTrue(registry.isActiveCreator(creator));
        
        registry.deactivateCreator();
        assertFalse(registry.isActiveCreator(creator));
        
        registry.activateCreator();
        assertTrue(registry.isActiveCreator(creator));
        vm.stopPrank();
    }

    function test_GetCreatorsByTag() public {
        vm.startPrank(creator);
        string[] memory tags = new string[](1);
        tags[0] = "ai";
        registry.registerCreator("alice", 10 * 10**6, tags, "");
        vm.stopPrank();

        vm.startPrank(anotherCreator);
        string[] memory tags2 = new string[](2);
        tags2[0] = "ai";
        tags2[1] = "design";
        registry.registerCreator("bob", 20 * 10**6, tags2, "");
        vm.stopPrank();

        address[] memory aiCreators = registry.getCreatorsByTag("ai");
        assertEq(aiCreators.length, 2);
        assertEq(aiCreators[0], creator);
        assertEq(aiCreators[1], anotherCreator);

        address[] memory designCreators = registry.getCreatorsByTag("design");
        assertEq(designCreators.length, 1);
        assertEq(designCreators[0], anotherCreator);
    }

    function test_CreatorExists() public {
        assertFalse(registry.creatorExists("alice"));
        vm.startPrank(creator);
        string[] memory tags;
        registry.registerCreator("alice", 10 * 10**6, tags, "");
        vm.stopPrank();
        assertTrue(registry.creatorExists("alice"));
        assertTrue(registry.creatorExists("ALICE")); // case-insensitive
    }

    function test_GetCreatorCount() public {
        assertEq(registry.getCreatorCount(), 0);
        vm.startPrank(creator);
        string[] memory tags;
        registry.registerCreator("alice", 10 * 10**6, tags, "");
        vm.stopPrank();
        assertEq(registry.getCreatorCount(), 1);
        
        vm.startPrank(anotherCreator);
        registry.registerCreator("bob", 15 * 10**6, tags, "");
        vm.stopPrank();
        assertEq(registry.getCreatorCount(), 2);
    }
}
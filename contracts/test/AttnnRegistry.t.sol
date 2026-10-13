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
        vm.expectRevert("AttnnRegistry: minBid too low (min 1 USDC)");
        registry.registerCreator("alice", 1 * 10**6 - 1, tags, "");
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

    // ---- updateProfile ----

    function _tags(string memory a, string memory b) internal pure returns (string[] memory t) {
        t = new string[](2);
        t[0] = a;
        t[1] = b;
    }

    function test_UpdateProfile_ReplacesFloorTagsAndURI() public {
        vm.startPrank(creator);
        registry.registerCreator("alice", 10 * 10**6, _tags("ai", "tech"), "old");
        vm.expectEmit(true, false, false, true);
        emit CreatorUpdated(creator, 3 * 10**6);
        registry.updateProfile(3 * 10**6, _tags("design", "tech"), "new");
        vm.stopPrank();

        (, uint256 minBid, string[] memory tags, string memory uri, bool active) = registry.getCreatorProfile("alice");
        assertEq(minBid, 3 * 10**6);
        assertEq(tags.length, 2);
        assertEq(tags[0], "design");
        assertEq(tags[1], "tech");
        assertEq(uri, "new");
        assertTrue(active);

        assertEq(registry.getCreatorsByTag("ai").length, 0);
        assertEq(registry.getCreatorsByTag("design").length, 1);
        assertEq(registry.getCreatorsByTag("tech").length, 1);
        assertEq(registry.getCreatorsByTag("tech")[0], creator);
    }

    function test_UpdateProfile_KeepsOtherCreatorsListed() public {
        address carol = makeAddr("carol");
        vm.prank(creator);
        registry.registerCreator("alice", 10 * 10**6, _tags("ai", "x"), "");
        vm.prank(anotherCreator);
        registry.registerCreator("bob", 10 * 10**6, _tags("ai", "y"), "");
        vm.prank(carol);
        registry.registerCreator("carol", 10 * 10**6, _tags("ai", "z"), "");

        // alice (first in the "ai" list) leaves the tag: carol is swapped into her slot
        vm.prank(creator);
        registry.updateProfile(10 * 10**6, _tags("x", "w"), "");
        address[] memory ai = registry.getCreatorsByTag("ai");
        assertEq(ai.length, 2);
        assertEq(ai[0], carol);
        assertEq(ai[1], anotherCreator);

        // carol leaves too, then alice comes back: no stale or duplicate entries
        vm.prank(carol);
        registry.updateProfile(10 * 10**6, _tags("z", "w"), "");
        vm.prank(creator);
        registry.updateProfile(10 * 10**6, _tags("ai", "ai"), "");
        ai = registry.getCreatorsByTag("ai");
        assertEq(ai.length, 2);
        assertEq(ai[0], anotherCreator);
        assertEq(ai[1], creator);
        assertEq(registry.getCreatorsByTag("w").length, 1);
        assertEq(registry.getCreatorsByTag("w")[0], carol);
    }

    function test_RegisterCreator_DuplicateTagsListedOnce() public {
        vm.prank(creator);
        registry.registerCreator("alice", 10 * 10**6, _tags("ai", "ai"), "");
        (,, string[] memory tags,,) = registry.getCreatorProfile("alice");
        assertEq(tags.length, 1);
        assertEq(registry.getCreatorsByTag("ai").length, 1);
    }

    function test_UpdateProfile_OnlyRegisteredCreator() public {
        vm.prank(creator);
        vm.expectRevert("AttnnRegistry: not a registered creator");
        registry.updateProfile(10 * 10**6, _tags("ai", "x"), "");
    }

    function test_UpdateProfile_Bounds() public {
        vm.startPrank(creator);
        registry.registerCreator("alice", 10 * 10**6, _tags("ai", "x"), "");
        vm.expectRevert("AttnnRegistry: minBid too low (min 1 USDC)");
        registry.updateProfile(1 * 10**6 - 1, _tags("ai", "x"), "");
        vm.expectRevert("AttnnRegistry: minBid too high (max 1000 USDC)");
        registry.updateProfile(1001 * 10**6, _tags("ai", "x"), "");
        vm.expectRevert("AttnnRegistry: too many tags");
        registry.updateProfile(10 * 10**6, new string[](11), "");
        vm.stopPrank();
    }

    function test_UpdateProfile_KeepsActiveFlag() public {
        vm.startPrank(creator);
        registry.registerCreator("alice", 10 * 10**6, _tags("ai", "x"), "");
        registry.deactivateCreator();
        registry.updateProfile(5 * 10**6, _tags("ai", "y"), "");
        assertFalse(registry.isActiveCreator(creator));
        vm.stopPrank();
    }

    event CreatorUpdated(address indexed creator, uint256 minBid);
}

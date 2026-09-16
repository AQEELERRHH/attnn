// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {AttnnRegistry} from "../src/AttnnRegistry.sol";
import {AttnnEscrow} from "../src/AttnnEscrow.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract AttnnEscrowTest is Test {
    MockUSDC public usdc;
    AttnnRegistry public registry;
    AttnnEscrow public escrow;

    address public creator = makeAddr("creator");
    address public bidder = makeAddr("bidder");
    address public anotherBidder = makeAddr("anotherBidder");

    uint256 constant MIN_BID = 5 * 10**6;
    uint256 constant MAX_BID = 1000 * 10**6;

    function setUp() public {
        usdc = new MockUSDC();
        registry = new AttnnRegistry();
        escrow = new AttnnEscrow(address(usdc), address(registry));

        // Mint USDC to bidder and approve escrow
        usdc.mint(bidder, 1000 * 10**6);
        usdc.mint(anotherBidder, 1000 * 10**6);
        vm.prank(bidder);
        usdc.approve(address(escrow), type(uint256).max);
        vm.prank(anotherBidder);
        usdc.approve(address(escrow), type(uint256).max);

        // Register creator
        vm.prank(creator);
        string[] memory tags;
        registry.registerCreator("alice", MIN_BID, tags, "");
    }

    function test_PlaceBid() public {
        uint256 bidAmount = 10 * 10**6;
        vm.prank(bidder);
        uint256 bidId = escrow.placeBid(creator, bidAmount, "Hello", false);

        assertEq(bidId, 1);
        assertEq(escrow.getBidCount(), 1);
        assertEq(usdc.balanceOf(address(escrow)), bidAmount);

        (
            address bidderAddr,
            address creatorAddr,
            uint256 amount,
            string memory message,
            string memory reply,
            uint8 status,
            uint256 createdAt
        ) = escrow.getBid(bidId);
        assertEq(bidderAddr, bidder);
        assertEq(creatorAddr, creator);
        assertEq(amount, bidAmount);
        assertEq(message, "Hello");
        assertEq(reply, "");
        assertEq(status, 0); // Pending
        assertEq(createdAt, block.timestamp);
    }

    function test_PlaceBid_PrivateMessage() public {
        vm.prank(bidder);
        uint256 bidId = escrow.placeBid(creator, MIN_BID, "Secret", true);

        (, , , string memory message, , , ) = escrow.getBid(bidId);
        assertEq(message, ""); // Private bids have empty public message
    }

    function test_PlaceBid_InsufficientAllowance() public {
        address newBidder = makeAddr("newBidder");
        usdc.mint(newBidder, MIN_BID);
        // No approval set

        vm.prank(newBidder);
        vm.expectRevert("ERC20: insufficient allowance");
        escrow.placeBid(creator, MIN_BID, "Hi", false);
    }

    function test_PlaceBid_CreatorNotActive() public {
        vm.prank(creator);
        registry.deactivateCreator();

        vm.prank(bidder);
        vm.expectRevert("AttnnEscrow: creator not active");
        escrow.placeBid(creator, MIN_BID, "Hi", false);
    }

    function test_AcceptBid() public {
        vm.prank(bidder);
        uint256 bidId = escrow.placeBid(creator, MIN_BID, "Hello", false);

        uint256 escrowBalanceBefore = usdc.balanceOf(address(escrow));
        uint256 creatorBalanceBefore = usdc.balanceOf(creator);

        vm.prank(creator);
        escrow.acceptBid(bidId, "Thanks!");

        uint256 escrowBalanceAfter = usdc.balanceOf(address(escrow));
        uint256 creatorBalanceAfter = usdc.balanceOf(creator);

        assertEq(escrowBalanceAfter, escrowBalanceBefore - MIN_BID);
        assertEq(creatorBalanceAfter, creatorBalanceBefore + MIN_BID);

        (, , , , string memory reply, uint8 status, ) = escrow.getBid(bidId);
        assertEq(reply, "Thanks!");
        assertEq(status, 1); // Accepted
    }

    function test_AcceptBid_NotCreator() public {
        vm.prank(bidder);
        uint256 bidId = escrow.placeBid(creator, MIN_BID, "Hello", false);

        vm.prank(anotherBidder);
        vm.expectRevert("AttnnEscrow: not the creator");
        escrow.acceptBid(bidId, "Thanks!");
    }

    function test_RejectBid() public {
        vm.prank(bidder);
        uint256 bidId = escrow.placeBid(creator, MIN_BID, "Hello", false);

        uint256 escrowBalanceBefore = usdc.balanceOf(address(escrow));
        uint256 bidderBalanceBefore = usdc.balanceOf(bidder);

        vm.prank(creator);
        escrow.rejectBid(bidId);

        uint256 escrowBalanceAfter = usdc.balanceOf(address(escrow));
        uint256 bidderBalanceAfter = usdc.balanceOf(bidder);

        assertEq(escrowBalanceAfter, escrowBalanceBefore - MIN_BID);
        assertEq(bidderBalanceAfter, bidderBalanceBefore + MIN_BID);

        (, , , , , uint8 status, ) = escrow.getBid(bidId);
        assertEq(status, 2); // Rejected
    }

    function test_ClaimRefund_AfterPeriod() public {
        vm.prank(bidder);
        uint256 bidId = escrow.placeBid(creator, MIN_BID, "Hello", false);

        // Fast-forward 14 days + 1 second
        vm.warp(block.timestamp + 14 days + 1 seconds);

        uint256 escrowBalanceBefore = usdc.balanceOf(address(escrow));
        uint256 bidderBalanceBefore = usdc.balanceOf(bidder);

        vm.prank(bidder);
        escrow.claimRefund(bidId);

        uint256 escrowBalanceAfter = usdc.balanceOf(address(escrow));
        uint256 bidderBalanceAfter = usdc.balanceOf(bidder);

        assertEq(escrowBalanceAfter, escrowBalanceBefore - MIN_BID);
        assertEq(bidderBalanceAfter, bidderBalanceBefore + MIN_BID);

        (, , , , , uint8 status, ) = escrow.getBid(bidId);
        assertEq(status, 3); // Refunded
    }

    function test_ClaimRefund_BeforePeriod() public {
        vm.prank(bidder);
        uint256 bidId = escrow.placeBid(creator, MIN_BID, "Hello", false);

        vm.prank(bidder);
        vm.expectRevert("AttnnEscrow: refund period not passed");
        escrow.claimRefund(bidId);
    }

    function test_GetCreatorBids() public {
        vm.prank(bidder);
        uint256 bidId1 = escrow.placeBid(creator, MIN_BID, "First", false);

        vm.prank(anotherBidder);
        uint256 bidId2 = escrow.placeBid(creator, MIN_BID * 2, "Second", false);

        uint256[] memory creatorBids = escrow.getCreatorBids(creator);
        assertEq(creatorBids.length, 2);
        assertEq(creatorBids[0], bidId1);
        assertEq(creatorBids[1], bidId2);
    }

    function test_GetBidderBids() public {
        vm.prank(bidder);
        uint256 bidId1 = escrow.placeBid(creator, MIN_BID, "First", false);
        vm.prank(bidder);
        uint256 bidId2 = escrow.placeBid(creator, MIN_BID * 2, "Second", false);

        uint256[] memory bidderBids = escrow.getBidderBids(bidder);
        assertEq(bidderBids.length, 2);
        assertEq(bidderBids[0], bidId1);
        assertEq(bidderBids[1], bidId2);
    }

    function test_IsRefundable() public {
        vm.prank(bidder);
        uint256 bidId = escrow.placeBid(creator, MIN_BID, "Hello", false);

        assertFalse(escrow.isRefundable(bidId));

        vm.warp(block.timestamp + 14 days + 1 seconds);
        assertTrue(escrow.isRefundable(bidId));

        vm.prank(bidder);
        escrow.claimRefund(bidId);

        assertFalse(escrow.isRefundable(bidId)); // Now refunded, not pending
    }
}
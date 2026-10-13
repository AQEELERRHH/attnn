// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {AttnnRegistry} from "../src/AttnnRegistry.sol";
import {AttnnEscrow} from "../src/AttnnEscrow.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {HookUSDC} from "./mocks/HookUSDC.sol";
import {IAttnnEscrow} from "../src/interfaces/IAttnnInterfaces.sol";

contract AttnnEscrowTest is Test {
    MockUSDC public usdc;
    AttnnRegistry public registry;
    AttnnEscrow public escrow;

    address public creator = makeAddr("creator");
    address public bidder = makeAddr("bidder");
    address public anotherBidder = makeAddr("anotherBidder");
    address public admin = makeAddr("admin");
    address public newAdmin = makeAddr("newAdmin");
    bytes32 constant SALT = keccak256("salt");
    bytes32 constant RH = keccak256("a reply fingerprint");
    bytes32 constant MH = keccak256("a message fingerprint");

    uint256 constant MIN_BID = 1 * 10**6;
    uint256 constant MAX_BID = 1000 * 10**6;

    function setUp() public {
        usdc = new MockUSDC();
        registry = new AttnnRegistry();
        escrow = new AttnnEscrow(address(usdc), address(registry), admin);

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
        uint256 bidId = escrow.placeBid(creator, bidAmount, MH);

        assertEq(bidId, 1);
        assertEq(escrow.getBidCount(), 1);
        assertEq(usdc.balanceOf(address(escrow)), bidAmount);

        (
            address bidderAddr,
            address creatorAddr,
            uint256 amount,
            bytes32 messageHash,
            bytes32 replyHash,
            uint8 status,
            uint256 createdAt
        ) = escrow.getBid(bidId);
        assertEq(bidderAddr, bidder);
        assertEq(creatorAddr, creator);
        assertEq(amount, bidAmount);
        assertEq(messageHash, MH);
        assertEq(replyHash, bytes32(0));
        assertEq(status, 0); // Pending
        assertEq(createdAt, block.timestamp);
    }

    function test_PlaceBid_NoMessage() public {
        vm.prank(bidder);
        uint256 bidId = escrow.placeBid(creator, MIN_BID, bytes32(0));
        (, , , bytes32 messageHash, , , ) = escrow.getBid(bidId);
        assertEq(messageHash, bytes32(0));
    }

    function test_PlaceBid_InsufficientAllowance() public {
        address newBidder = makeAddr("newBidder");
        usdc.mint(newBidder, MIN_BID);
        // No approval set

        vm.prank(newBidder);
        vm.expectRevert("ERC20: insufficient allowance");
        escrow.placeBid(creator, MIN_BID, MH);
    }

    function test_PlaceBid_CreatorNotActive() public {
        vm.prank(creator);
        registry.deactivateCreator();

        vm.prank(bidder);
        vm.expectRevert("AttnnEscrow: creator not active");
        escrow.placeBid(creator, MIN_BID, MH);
    }

    function test_AcceptBid() public {
        vm.prank(bidder);
        uint256 bidId = escrow.placeBid(creator, MIN_BID, MH);

        uint256 escrowBalanceBefore = usdc.balanceOf(address(escrow));
        uint256 creatorBalanceBefore = usdc.balanceOf(creator);

        vm.prank(creator);
        escrow.acceptBid(bidId, RH);

        uint256 escrowBalanceAfter = usdc.balanceOf(address(escrow));
        uint256 creatorBalanceAfter = usdc.balanceOf(creator);

        assertEq(escrowBalanceAfter, escrowBalanceBefore - MIN_BID);
        assertEq(creatorBalanceAfter, creatorBalanceBefore + MIN_BID);

        (, , , , bytes32 replyHash, uint8 status, ) = escrow.getBid(bidId);
        assertEq(replyHash, RH);
        assertEq(status, 1); // Accepted
    }

    function test_AcceptBid_NotCreator() public {
        vm.prank(bidder);
        uint256 bidId = escrow.placeBid(creator, MIN_BID, MH);

        vm.prank(anotherBidder);
        vm.expectRevert("AttnnEscrow: not the creator");
        escrow.acceptBid(bidId, RH);
    }

    function test_RejectBid() public {
        vm.prank(bidder);
        uint256 bidId = escrow.placeBid(creator, MIN_BID, MH);

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
        uint256 bidId = escrow.placeBid(creator, MIN_BID, MH);

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
        uint256 bidId = escrow.placeBid(creator, MIN_BID, MH);

        vm.prank(bidder);
        vm.expectRevert("AttnnEscrow: refund period not passed");
        escrow.claimRefund(bidId);
    }

    function test_GetCreatorBids() public {
        vm.prank(bidder);
        uint256 bidId1 = escrow.placeBid(creator, MIN_BID, MH);

        vm.prank(anotherBidder);
        uint256 bidId2 = escrow.placeBid(creator, MIN_BID * 2, MH);

        uint256[] memory creatorBids = escrow.getCreatorBids(creator);
        assertEq(creatorBids.length, 2);
        assertEq(creatorBids[0], bidId1);
        assertEq(creatorBids[1], bidId2);
    }

    function test_GetBidderBids() public {
        vm.prank(bidder);
        uint256 bidId1 = escrow.placeBid(creator, MIN_BID, MH);
        vm.prank(bidder);
        uint256 bidId2 = escrow.placeBid(creator, MIN_BID * 2, MH);

        uint256[] memory bidderBids = escrow.getBidderBids(bidder);
        assertEq(bidderBids.length, 2);
        assertEq(bidderBids[0], bidId1);
        assertEq(bidderBids[1], bidId2);
    }

    function test_IsRefundable() public {
        vm.prank(bidder);
        uint256 bidId = escrow.placeBid(creator, MIN_BID, MH);

        assertFalse(escrow.isRefundable(bidId));

        vm.warp(block.timestamp + 14 days + 1 seconds);
        assertTrue(escrow.isRefundable(bidId));

        vm.prank(bidder);
        escrow.claimRefund(bidId);

        assertFalse(escrow.isRefundable(bidId)); // Now refunded, not pending
    }

    // ---- settled bids stay settled ----

    function _bid(uint256 amount) internal returns (uint256 id) {
        vm.prank(bidder);
        id = escrow.placeBid(creator, amount, MH);
    }

    function test_CannotSettleTwice() public {
        uint256 a = _bid(MIN_BID);
        vm.startPrank(creator);
        escrow.rejectBid(a);
        vm.expectRevert("AttnnEscrow: bid not pending");
        escrow.acceptBid(a, RH);
        vm.expectRevert("AttnnEscrow: bid not pending");
        escrow.rejectBid(a);
        vm.stopPrank();

        uint256 b = _bid(MIN_BID);
        vm.prank(creator);
        escrow.acceptBid(b, RH);
        vm.warp(block.timestamp + escrow.REFUND_PERIOD());
        vm.prank(bidder);
        vm.expectRevert("AttnnEscrow: bid not pending");
        escrow.claimRefund(b);
    }

    function test_AcceptBid_ExpiresExactlyAtRefundPeriod() public {
        uint256 id = _bid(MIN_BID);
        vm.warp(block.timestamp + escrow.REFUND_PERIOD());
        vm.prank(creator);
        vm.expectRevert("AttnnEscrow: bid expired");
        escrow.acceptBid(id, RH);
        // ...and from that same second the bidder can take it back
        vm.prank(bidder);
        escrow.claimRefund(id);
        assertEq(usdc.balanceOf(bidder), 1000 * 10**6);
    }

    function testFuzz_PlaceBid_Bounds(uint256 amount) public {
        amount = bound(amount, 0, 2000 * 10**6);
        usdc.mint(bidder, amount);
        vm.prank(bidder);
        if (amount < MIN_BID) {
            vm.expectRevert("AttnnEscrow: amount below minimum");
        } else if (amount > MAX_BID) {
            vm.expectRevert("AttnnEscrow: amount above maximum");
        }
        escrow.placeBid(creator, amount, MH);
    }

    function testFuzz_EscrowAlwaysHoldsExactlyOpenBids(uint96 a, uint96 b, uint8 action) public {
        uint256 x = bound(a, MIN_BID, MAX_BID);
        uint256 y = bound(b, MIN_BID, MAX_BID);
        usdc.mint(bidder, x + y);
        uint256 id1 = _bid(x);
        uint256 id2 = _bid(y);
        assertEq(escrow.getTotalLocked(), x + y);

        vm.startPrank(creator);
        if (action % 2 == 0) escrow.acceptBid(id1, RH);
        else escrow.rejectBid(id1);
        vm.stopPrank();
        assertEq(escrow.getTotalLocked(), y);

        vm.warp(block.timestamp + escrow.REFUND_PERIOD());
        vm.prank(bidder);
        escrow.claimRefund(id2);
        assertEq(escrow.getTotalLocked(), 0);
    }

    // ---- D1: fingerprints, never text ----

    function test_Fingerprint_IsKeccakOfSaltThenText() public view {
        string memory text = "A reply of any length, with unicode too: naira \u20a6";
        assertEq(escrow.fingerprint(SALT, text), keccak256(bytes.concat(SALT, bytes(text))));
        // A different salt or one changed character gives a different fingerprint.
        assertTrue(escrow.fingerprint(keccak256("other"), text) != escrow.fingerprint(SALT, text));
        assertTrue(escrow.fingerprint(SALT, "abc") != escrow.fingerprint(SALT, "abd"));
    }

    /// Same vector as tests/unit/rules.test.mts: the app (lib/escrow.ts) and the
    /// contract must agree byte for byte, including non-ASCII text.
    function test_Fingerprint_MatchesTheApp() public view {
        bytes32 salt = 0xabababababababababababababababababababababababababababababababab;
        assertEq(
            escrow.fingerprint(salt, unicode"Naira ₦ reply, with unicode: café"),
            0x353b97b4a5c624e72c31bbbe16cae6612611f3140c7e17e4635ec3734a7f6586
        );
    }

    function test_AcceptBid_EmptyFingerprintRefused() public {
        uint256 id = _bid(MIN_BID);
        vm.prank(creator);
        vm.expectRevert("AttnnEscrow: empty reply");
        escrow.acceptBid(id, bytes32(0));
    }

    function test_AcceptBid_EmitsFingerprint() public {
        uint256 id = _bid(MIN_BID);
        bytes32 h = escrow.fingerprint(SALT, "Thanks for the bid, here is my considered answer.");
        vm.expectEmit(true, true, false, true, address(escrow));
        emit IAttnnEscrow.BidAccepted(id, creator, h);
        vm.prank(creator);
        escrow.acceptBid(id, h);
    }

    // ---- D5: the owner can pause NEW bids, and nothing else ----

    function test_Constructor_RejectsZeroOwner() public {
        vm.expectRevert("AttnnEscrow: zero owner address");
        new AttnnEscrow(address(usdc), address(registry), address(0));
    }

    function test_Owner_IsSetAtDeploy() public view {
        assertEq(escrow.owner(), admin);
        assertEq(escrow.pendingOwner(), address(0));
        assertFalse(escrow.paused());
    }

    function test_Pause_OnlyOwner() public {
        vm.prank(bidder);
        vm.expectRevert("AttnnEscrow: not the owner");
        escrow.pause();
        vm.prank(creator);
        vm.expectRevert("AttnnEscrow: not the owner");
        escrow.pause();

        vm.prank(admin);
        escrow.pause();
        assertTrue(escrow.paused());

        vm.prank(bidder);
        vm.expectRevert("AttnnEscrow: not the owner");
        escrow.unpause();
    }

    function test_Pause_EmitsAndCannotRepeat() public {
        vm.expectEmit(true, false, false, false, address(escrow));
        emit IAttnnEscrow.Paused(admin);
        vm.prank(admin);
        escrow.pause();
        vm.prank(admin);
        vm.expectRevert("AttnnEscrow: already paused");
        escrow.pause();

        vm.expectEmit(true, false, false, false, address(escrow));
        emit IAttnnEscrow.Unpaused(admin);
        vm.prank(admin);
        escrow.unpause();
        vm.prank(admin);
        vm.expectRevert("AttnnEscrow: not paused");
        escrow.unpause();
    }

    function test_Pause_BlocksNewBidsOnly() public {
        uint256 toAccept = _bid(MIN_BID);
        uint256 toReject = _bid(MIN_BID * 2);
        uint256 toRefund = _bid(MIN_BID * 3);
        uint256 bidderBefore = usdc.balanceOf(bidder);

        vm.prank(admin);
        escrow.pause();

        // No new bid from anyone, and no USDC taken.
        vm.prank(bidder);
        vm.expectRevert("AttnnEscrow: new bids are paused");
        escrow.placeBid(creator, MIN_BID, MH);
        vm.prank(admin);
        vm.expectRevert("AttnnEscrow: new bids are paused");
        escrow.placeBid(creator, MIN_BID, MH);
        assertEq(usdc.balanceOf(bidder), bidderBefore);

        // Every way out still works while paused.
        vm.startPrank(creator);
        escrow.acceptBid(toAccept, RH);
        escrow.rejectBid(toReject);
        vm.stopPrank();
        vm.warp(block.timestamp + escrow.REFUND_PERIOD());
        vm.prank(bidder);
        escrow.claimRefund(toRefund);

        assertEq(usdc.balanceOf(creator), MIN_BID);
        assertEq(usdc.balanceOf(bidder), bidderBefore + MIN_BID * 5);
        assertEq(escrow.getTotalLocked(), 0);

        // Unpaused, bids work again.
        vm.prank(admin);
        escrow.unpause();
        _bid(MIN_BID);
        assertEq(escrow.getTotalLocked(), MIN_BID);
    }

    function test_Owner_CannotTouchEscrowedUsdc() public {
        uint256 id = _bid(MIN_BID * 5);
        vm.startPrank(admin);
        escrow.pause();
        vm.expectRevert("AttnnEscrow: not the creator");
        escrow.acceptBid(id, RH);
        vm.expectRevert("AttnnEscrow: not the creator");
        escrow.rejectBid(id);
        vm.warp(block.timestamp + escrow.REFUND_PERIOD());
        vm.expectRevert("AttnnEscrow: not the bidder");
        escrow.claimRefund(id);
        vm.stopPrank();
        assertEq(usdc.balanceOf(admin), 0);
        assertEq(escrow.getTotalLocked(), MIN_BID * 5);
    }

    function test_OwnershipHandover_TwoSteps() public {
        vm.prank(bidder);
        vm.expectRevert("AttnnEscrow: not the owner");
        escrow.transferOwnership(bidder);

        vm.prank(admin);
        escrow.transferOwnership(newAdmin);
        assertEq(escrow.owner(), admin, "nothing changes until accepted");
        assertEq(escrow.pendingOwner(), newAdmin);

        vm.prank(bidder);
        vm.expectRevert("AttnnEscrow: not the pending owner");
        escrow.acceptOwnership();

        vm.prank(newAdmin);
        escrow.acceptOwnership();
        assertEq(escrow.owner(), newAdmin);
        assertEq(escrow.pendingOwner(), address(0));

        vm.prank(admin);
        vm.expectRevert("AttnnEscrow: not the owner");
        escrow.pause();
        vm.prank(newAdmin);
        escrow.pause();
        assertTrue(escrow.paused());
    }

    function test_OwnershipHandover_CanBeCancelled() public {
        vm.startPrank(admin);
        escrow.transferOwnership(newAdmin);
        escrow.transferOwnership(address(0));
        vm.stopPrank();
        vm.prank(newAdmin);
        vm.expectRevert("AttnnEscrow: not the pending owner");
        escrow.acceptOwnership();
        assertEq(escrow.owner(), admin);
    }

    function testFuzz_PausedEscrowStillReleasesEverything(uint96 a, uint96 b, uint8 action) public {
        uint256 x = bound(a, MIN_BID, MAX_BID);
        uint256 y = bound(b, MIN_BID, MAX_BID);
        usdc.mint(bidder, x + y);
        uint256 id1 = _bid(x);
        uint256 id2 = _bid(y);
        vm.prank(admin);
        escrow.pause();
        vm.startPrank(creator);
        if (action % 2 == 0) escrow.acceptBid(id1, RH);
        else escrow.rejectBid(id1);
        vm.stopPrank();
        vm.warp(block.timestamp + escrow.REFUND_PERIOD());
        vm.prank(bidder);
        escrow.claimRefund(id2);
        assertEq(escrow.getTotalLocked(), 0);
    }

    function test_ReentrantCreatorIsPaidOnce() public {
        HookUSDC hook = new HookUSDC();
        AttnnEscrow e = new AttnnEscrow(address(hook), address(registry), admin);
        GreedyCreator greedy = new GreedyCreator(e);
        string[] memory tags;
        vm.prank(address(greedy));
        registry.registerCreator("greedy", MIN_BID, tags, "");

        hook.mint(bidder, 20 * 10**6);
        hook.mint(address(e), 20 * 10**6); // other bidders' escrowed USDC
        vm.startPrank(bidder);
        hook.approve(address(e), type(uint256).max);
        uint256 id = e.placeBid(address(greedy), 10 * 10**6, MH);
        vm.stopPrank();

        greedy.accept(id);
        assertEq(hook.balanceOf(address(greedy)), 10 * 10**6, "paid once");
        assertTrue(greedy.reentered());
        assertFalse(greedy.reentrySucceeded());
    }
}

/// Accepts a bid and, when paid, tries to accept the same bid again.
contract GreedyCreator {
    bytes32 constant RH = keccak256("a reply fingerprint");
    AttnnEscrow public immutable escrow;
    uint256 private _bidId;
    bool public reentered;
    bool public reentrySucceeded;

    constructor(AttnnEscrow e) {
        escrow = e;
    }

    function accept(uint256 bidId) external {
        _bidId = bidId;
        escrow.acceptBid(bidId, RH);
    }

    function onTokenReceived(uint256) external {
        if (reentered) return;
        reentered = true;
        try escrow.acceptBid(_bidId, RH) {
            reentrySucceeded = true;
        } catch {}
    }
}

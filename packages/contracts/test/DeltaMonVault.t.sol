// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {DeltaMonVault} from "../src/DeltaMonVault.sol";
import {IWMON} from "../src/interfaces/external/IWMON.sol";
import {ISpotVenue} from "../src/interfaces/ISpotVenue.sol";
import {IPriceOracle} from "../src/interfaces/IPriceOracle.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockOracle} from "./mocks/MockOracle.sol";
import {MockWMON} from "./mocks/MockKuru.sol";
import {IMonadStaking} from "../src/interfaces/external/IMonadStaking.sol";
import {
    MockDeskVenue,
    MockStakingPrecompile,
    LyingVenue,
    ReenteringVenue,
    GasHungryOracle
} from "./mocks/MockProtocols.sol";

/// @dev Identical to the deployed vault except that it points at a mock precompile.
contract TestableVault is DeltaMonVault {
    IMonadStaking private immutable _mockStaking;

    constructor(
        IERC20 usdc_,
        IWMON wmon_,
        IERC20 ausd_,
        ISpotVenue spotVenue_,
        IPriceOracle oracle_,
        uint256 depositCap_,
        uint16 performanceFeeBps_,
        IMonadStaking mockStaking_
    ) DeltaMonVault(usdc_, wmon_, ausd_, spotVenue_, oracle_, depositCap_, performanceFeeBps_) {
        _mockStaking = mockStaking_;
    }

    function _staking() internal view override returns (IMonadStaking) {
        return _mockStaking;
    }
}

contract DeltaMonVaultTest is Test {
    MockERC20 usdc;
    MockERC20 ausd;
    MockWMON wmon;
    MockOracle oracle;
    MockDeskVenue venue;
    MockStakingPrecompile staking;
    DeltaMonVault vault;

    address admin = makeAddr("admin");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address treasury = makeAddr("treasury");

    uint256 constant MON_PRICE = 0.025e18;
    uint256 constant CAP = 10_000_000e6;
    uint64 constant VAL = 7;
    uint256 constant START = 1_000_000e6;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        ausd = new MockERC20("AUSD", "AUSD", 6);
        wmon = new MockWMON();

        oracle = new MockOracle();
        oracle.setPrice(address(usdc), 1e18);
        oracle.setPrice(address(ausd), 1e18);
        oracle.setPrice(address(wmon), MON_PRICE);

        venue = new MockDeskVenue(oracle);

        staking = new MockStakingPrecompile();
        vm.deal(address(staking), 1_000_000e18);

        // Pre-fund the venue so swaps pay from real inventory.
        usdc.mint(address(venue), 100_000_000e6);
        ausd.mint(address(venue), 100_000_000e6);
        vm.deal(address(this), 100_000_000e18);
        wmon.deposit{value: 100_000_000e18}();
        wmon.transfer(address(venue), 100_000_000e18);

        vm.prank(admin);
        vault = new TestableVault(
            IERC20(address(usdc)),
            IWMON(address(wmon)),
            IERC20(address(ausd)),
            ISpotVenue(address(venue)),
            IPriceOracle(address(oracle)),
            CAP,
            1000, // 10 % performance fee
            IMonadStaking(address(staking))
        );

        usdc.mint(alice, START);
        usdc.mint(bob, START);
        vm.prank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(vault), type(uint256).max);
    }

    function _deposit(address who, uint256 amount) internal returns (uint256 shares) {
        vm.prank(who);
        shares = vault.deposit(amount, who);
    }

    function _buyMon(uint256 usdcIn) internal {
        vm.prank(admin);
        vault.swapUsdcForMon(usdcIn, 0);
    }

    // ───────────────────────────── basics ─────────────────────────────

    function test_metadataAndOwner() public view {
        assertEq(vault.symbol(), "sdMON");
        assertEq(vault.decimals(), 18);
        assertEq(vault.asset(), address(usdc));
        assertEq(vault.owner(), admin);
        assertEq(vault.performanceFeeBps(), 1000);
    }

    function test_depositMintsSharesAndRecordsBasis() public {
        uint256 shares = _deposit(alice, 1000e6);
        assertEq(shares, 1000e18);
        assertEq(vault.costBasis(alice), 1000e6);
        assertEq(vault.totalAssets(), 1000e6);
        assertApproxEqAbs(vault.pricePerShare(), 1e6, 1);
    }

    function test_minDepositEnforced() public {
        vm.prank(alice);
        vm.expectPartialRevert(DeltaMonVault.BelowMinDeposit.selector);
        vault.deposit(5e6, alice);
    }

    function test_depositCapEnforced() public {
        vm.prank(admin);
        vault.setLimits(500e6, 10e6);
        vm.prank(alice);
        vm.expectPartialRevert(ERC4626.ERC4626ExceededMaxDeposit.selector);
        vault.deposit(600e6, alice);
    }

    // ───────────────────────────── profit-only fee ─────────────────────────────

    function test_feeChargedOnProfitOnly() public {
        _deposit(alice, 1000e6);
        usdc.mint(address(vault), 200e6); // vault gains 20 %

        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        uint256 out = vault.redeem(shares, alice, alice);

        assertApproxEqAbs(out, 1180e6, 2); // 1200 minus 10 % of the 200 profit
        assertApproxEqAbs(vault.accruedFees(), 20e6, 2);
        assertEq(vault.costBasis(alice), 0);
    }

    function test_noFeeWhenAtALoss() public {
        _deposit(alice, 1000e6);
        usdc.burn(address(vault), 100e6);

        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        uint256 out = vault.redeem(shares, alice, alice);

        assertApproxEqAbs(out, 900e6, 2);
        assertEq(vault.accruedFees(), 0);
    }

    function test_laterDepositorPaysNoFeeOnEarlierGains() public {
        _deposit(alice, 1000e6);
        usdc.mint(address(vault), 200e6);

        _deposit(bob, 600e6);
        assertEq(vault.costBasis(bob), 600e6);

        uint256 bobShares = vault.balanceOf(bob);
        vm.prank(bob);
        uint256 out = vault.redeem(bobShares, bob, bob);

        assertApproxEqRel(out, 600e6, 1e12); // flat entry to exit, so no fee
        assertEq(vault.accruedFees(), 0);
    }

    function test_partialExitChargesProportionalProfit() public {
        _deposit(alice, 1000e6);
        usdc.mint(address(vault), 200e6);

        uint256 half = vault.balanceOf(alice) / 2;
        vm.prank(alice);
        uint256 out = vault.redeem(half, alice, alice);

        assertApproxEqAbs(out, 590e6, 2); // 600 minus 10 % of 100 profit
        assertApproxEqAbs(vault.costBasis(alice), 500e6, 2);
        assertApproxEqAbs(vault.accruedFees(), 10e6, 2);
    }

    function test_costBasisFollowsTransferredShares() public {
        _deposit(alice, 1000e6);
        uint256 halfShares = vault.balanceOf(alice) / 2;
        vm.prank(alice);
        vault.transfer(bob, halfShares);

        assertApproxEqAbs(vault.costBasis(alice), 500e6, 2);
        assertApproxEqAbs(vault.costBasis(bob), 500e6, 2);
    }

    function test_adminCannotTakeMoreThanAccruedFees() public {
        _deposit(alice, 1000e6);
        vm.prank(admin);
        vm.expectRevert();
        vault.withdrawFees(treasury, 1e6);
    }

    function test_adminWithdrawsFeesToChosenAddress() public {
        _deposit(alice, 1000e6);
        usdc.mint(address(vault), 200e6);
        uint256 aliceShares = vault.balanceOf(alice);
        vm.prank(alice);
        vault.redeem(aliceShares, alice, alice);

        uint256 fees = vault.accruedFees();
        vm.prank(admin);
        vault.withdrawFees(treasury, fees);
        assertEq(usdc.balanceOf(treasury), fees);
        assertEq(vault.accruedFees(), 0);
    }

    // ───────────────────────────── redemption queue ─────────────────────────────

    function test_queuedRedemptionPaysAfterAdminFrees() public {
        _deposit(alice, 1000e6);
        _buyMon(900e6);
        assertEq(vault.availableLiquidity(), 100e6);

        uint256 shares = vault.balanceOf(alice);
        assertLt(vault.maxRedeem(alice), shares);

        vm.prank(alice);
        uint256 id = vault.requestRedeem(shares);
        assertEq(vault.balanceOf(alice), 0);

        vm.expectPartialRevert(DeltaMonVault.InsufficientLiquidity.selector);
        vault.claimRedemption(id);

        uint256 monHeld = wmon.balanceOf(address(vault));
        vm.prank(admin);
        vault.swapMonForUsdc(monHeld, 0);

        vault.claimRedemption(id);
        assertApproxEqRel(usdc.balanceOf(alice), START, 1e12);
        assertEq(vault.totalSupply(), 0);
    }

    function test_overdueQueueFreezesAdminAllocation() public {
        _deposit(alice, 1000e6);
        _buyMon(900e6);
        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        uint256 id = vault.requestRedeem(shares);

        assertFalse(vault.hasOverdueRedemptions());
        skip(37 hours);
        assertTrue(vault.hasOverdueRedemptions());

        vm.startPrank(admin);
        vm.expectRevert(DeltaMonVault.RedemptionsOverdue.selector);
        vault.swapUsdcForMon(1e6, 0);
        vm.expectRevert(DeltaMonVault.RedemptionsOverdue.selector);
        vault.stake(VAL, 1e18);
        vm.expectRevert(DeltaMonVault.RedemptionsOverdue.selector);
        vault.withdrawFees(treasury, 0);
        vm.expectRevert(DeltaMonVault.RedemptionsOverdue.selector);
        vault.swapUsdcForAusd(1e6, 0);

        // Unwinding towards the queue stays allowed.
        vault.swapMonForUsdc(wmon.balanceOf(address(vault)), 0);
        vm.stopPrank();

        vault.claimRedemption(id);
        assertFalse(vault.hasOverdueRedemptions());
    }

    function test_cancelRedemptionRestoresSharesAndBasis() public {
        _deposit(alice, 1000e6);
        _buyMon(900e6);
        uint256 shares = vault.balanceOf(alice);

        vm.prank(alice);
        uint256 id = vault.requestRedeem(shares);
        assertEq(vault.costBasis(alice), 0);

        vm.prank(alice);
        vault.cancelRedemption(id);
        assertEq(vault.balanceOf(alice), shares);
        assertApproxEqAbs(vault.costBasis(alice), 1000e6, 2);
        assertFalse(vault.hasOverdueRedemptions());
    }

    function test_onlyOwnerCancelsOwnRequest() public {
        _deposit(alice, 1000e6);
        _buyMon(900e6);
        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        uint256 id = vault.requestRedeem(shares);

        vm.prank(bob);
        vm.expectRevert(DeltaMonVault.NotRequestOwner.selector);
        vault.cancelRedemption(id);
    }

    // ───────────────────────────── swap guards ─────────────────────────────

    function test_oracleFloorBlocksBadSwap() public {
        _deposit(alice, 1000e6);
        venue.setFeeBps(100); // 1 % worse than oracle, tolerance is 0.5 %
        vm.prank(admin);
        vm.expectRevert("MockDeskVenue: slippage");
        vault.swapUsdcForMon(500e6, 0); // admin asks for no protection, vault imposes its own
    }

    function test_swapDoesNotChangeVaultValue() public {
        _deposit(alice, 1000e6);
        _buyMon(600e6);
        assertEq(vault.usdcBalance(), 400e6);
        assertEq(wmon.balanceOf(address(vault)), 24_000e18);
        assertApproxEqRel(vault.totalAssets(), 1000e6, 1e12);
    }

    function test_onlyAdminSwaps() public {
        _deposit(alice, 1000e6);
        vm.prank(alice);
        vm.expectPartialRevert(Ownable.OwnableUnauthorizedAccount.selector);
        vault.swapUsdcForMon(100e6, 0);
    }

    // ───────────────────────────── staking ─────────────────────────────

    function test_stakeUnstakeRoundTrip() public {
        _deposit(alice, 1000e6);
        _buyMon(600e6);
        uint256 mon = wmon.balanceOf(address(vault));

        vm.prank(admin);
        vault.stake(VAL, mon);
        assertEq(vault.stakedMon(), mon);
        assertEq(wmon.balanceOf(address(vault)), 0);
        assertApproxEqRel(vault.totalAssets(), 1000e6, 1e12);

        vm.prank(admin);
        uint8 wid = vault.unstake(VAL, mon);
        assertEq(vault.stakedMon(), 0);
        assertEq(vault.unstakingMon(), mon);
        assertApproxEqRel(vault.totalAssets(), 1000e6, 1e12);

        vm.expectRevert("MockStaking: unbonding");
        vault.claimUnstaked(VAL, wid);

        skip(7 hours);
        vault.claimUnstaked(VAL, wid);
        assertEq(vault.unstakingMon(), 0);
        assertEq(wmon.balanceOf(address(vault)), mon);
    }

    function test_stakingRewardsRaiseVaultValue() public {
        _deposit(alice, 1000e6);
        _buyMon(600e6);
        uint256 monHeld = wmon.balanceOf(address(vault));
        vm.prank(admin);
        vault.stake(VAL, monHeld);

        staking.setReward(address(vault), VAL, 400e18); // 400 MON = $10
        uint256 before = vault.totalAssets();
        vm.prank(admin);
        vault.claimStakingRewards(VAL);

        assertEq(wmon.balanceOf(address(vault)), 400e18);
        assertApproxEqAbs(vault.totalAssets(), before + 10e6, 2);
    }

    function test_validatorCommissionCapEnforced() public {
        _deposit(alice, 1000e6);
        _buyMon(600e6);
        staking.setCommission(9, 3e17); // 30 %, cap is 20 %

        vm.prank(admin);
        vm.expectPartialRevert(DeltaMonVault.ValidatorCommissionTooHigh.selector);
        vault.stake(9, 1e18);
    }

    function test_onlyAdminStakes() public {
        vm.prank(alice);
        vm.expectPartialRevert(Ownable.OwnableUnauthorizedAccount.selector);
        vault.stake(VAL, 1e18);
    }

    // ───────────────────────────── perp book reporting ─────────────────────────────

    function _fundManager(uint256 amount) internal {
        if (!vault.isPerpManager(perpManager)) _whitelistManager();
        vm.prank(admin);
        vault.sendFundPerpManager(perpManager, address(usdc), amount);
    }

    function test_reportedPnlMovesValueAndIsBounded() public {
        _deposit(alice, 1000e6);
        _fundManager(500e6);

        vm.prank(admin);
        vault.reportPerpPnl(50e6);
        assertEq(vault.perpEquity(), 550e6);
        assertApproxEqRel(vault.totalAssets(), 1050e6, 1e12);

        vm.prank(admin);
        vm.expectRevert(DeltaMonVault.PnlOutOfBand.selector);
        vault.reportPerpPnl(300e6); // band is 50 % of 500
    }

    function test_staleReportBlocksDepositsButNeverTrapsAnExit() public {
        _deposit(alice, 1000e6);
        _fundManager(400e6);
        vm.prank(admin);
        vault.reportPerpPnl(100e6); // an unconfirmed gain

        skip(7 hours);
        assertTrue(vault.perpReportIsStale());

        // Nobody may buy in against a mark nobody has confirmed.
        vm.prank(bob);
        vm.expectRevert(DeltaMonVault.StalePerpReport.selector);
        vault.deposit(100e6, bob);

        // The stale gain is dropped, so the book is valued conservatively rather than optimistically.
        assertEq(vault.perpEquity(), 400e6);
        assertApproxEqRel(vault.totalAssets(), 1000e6, 1e12);

        // An admin who simply stops reporting must not be able to trap anyone.
        uint256 someShares = vault.balanceOf(alice) / 4;
        vm.prank(alice);
        uint256 out = vault.redeem(someShares, alice, alice);
        assertGt(out, 0);

        vm.prank(admin);
        vault.reportPerpPnl(0);
        _deposit(bob, 100e6);
    }

    function test_queuedExitSurvivesASilentAdmin() public {
        _deposit(alice, 1000e6);
        _fundManager(400e6);
        _buyMon(550e6);

        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        uint256 id = vault.requestRedeem(shares);

        // Admin goes quiet, then unwinds enough to cover the queue but still never reports.
        skip(40 hours);
        assertTrue(vault.perpReportIsStale());
        assertTrue(vault.hasOverdueRedemptions());

        uint256 monHeld = wmon.balanceOf(address(vault));
        vm.prank(admin);
        vault.swapMonForUsdc(monHeld, 0);
        vm.startPrank(perpManager);
        usdc.approve(address(vault), 400e6);
        vault.perpManagerDeposit(address(usdc), 400e6);
        vm.stopPrank();

        vault.claimRedemption(id); // must not depend on the admin speaking up
        assertApproxEqRel(usdc.balanceOf(alice), START, 1e15);
    }

    function test_reentrantVenueCannotMintAgainstADeflatedBook() public {
        _deposit(alice, 1000e6);
        address attacker = makeAddr("attacker");
        ReenteringVenue evil = new ReenteringVenue(address(vault), usdc, attacker);

        vm.prank(admin);
        vault.proposeVenue(ISpotVenue(address(evil)), IPriceOracle(address(oracle)));
        skip(3 days + 1);
        vm.prank(admin);
        vault.applyVenue();

        vm.prank(admin);
        vm.expectRevert(); // ReentrancyGuardReentrantCall
        vault.swapUsdcForMon(500e6, 0);

        assertEq(vault.balanceOf(attacker), 0);
        assertEq(vault.usdcBalance(), 1000e6);
    }

    function test_aFeeCutCancelsAQueuedRise() public {
        vm.startPrank(admin);
        vault.proposePerformanceFee(500); // down from 1000, immediate
        vault.proposePerformanceFee(900); // queued rise
        assertEq(vault.pendingPerformanceFeeBps(), 900);

        vault.proposePerformanceFee(300); // a cut must also withdraw the queued rise
        assertEq(vault.performanceFeeBps(), 300);
        assertEq(vault.pendingPerformanceFeeBps(), 0);
        assertEq(vault.pendingFeeEffectiveAt(), 0);

        skip(2 days);
        vm.expectRevert(DeltaMonVault.NoFeeTimelockPending.selector);
        vault.applyPerformanceFee();
        vm.stopPrank();
        assertEq(vault.performanceFeeBps(), 300);
    }

    function test_leftoverReportCannotInflateAnEmptyBook() public {
        _deposit(alice, 1000e6);
        _fundManager(500e6);
        vm.prank(admin);
        vault.reportPerpPnl(100e6);
        assertApproxEqRel(vault.totalAssets(), 1100e6, 1e12);

        usdc.mint(perpManager, 100e6);
        vm.startPrank(perpManager);
        usdc.approve(address(vault), 600e6);
        vault.perpManagerDeposit(address(usdc), 600e6);
        vm.stopPrank();

        assertEq(vault.perpDeployed(), 0);
        assertEq(vault.perpEquity(), 0); // the stale gain cannot be counted twice
        assertEq(vault.totalAssets(), 1100e6);
    }

    // ───────────────────────────── perp managers ─────────────────────────────

    address perpManager = makeAddr("perpManager");

    /// @dev Adding a manager is timelocked, so this proposes, waits it out, then applies.
    function _whitelistManager() internal {
        vm.prank(admin);
        vault.controlPerpManagers(perpManager, true);
        skip(vault.CONFIG_TIMELOCK());
        vm.prank(admin);
        vault.applyPerpManager(perpManager);
    }

    function test_onlyWhitelistedManagerCanBeFunded() public {
        _deposit(alice, 1000e6);
        vm.prank(admin);
        vm.expectPartialRevert(DeltaMonVault.NotAPerpManager.selector);
        vault.sendFundPerpManager(perpManager, address(usdc), 100e6);

        _whitelistManager();
        vm.prank(admin);
        vault.sendFundPerpManager(perpManager, address(usdc), 100e6);
        assertEq(usdc.balanceOf(perpManager), 100e6);
    }

    function test_fundingAManagerDoesNotChangeVaultValue() public {
        _deposit(alice, 1000e6);
        _whitelistManager();

        vm.prank(admin);
        vault.sendFundPerpManager(perpManager, address(usdc), 400e6);

        assertEq(vault.perpManagerOutstanding(perpManager), 400e6);
        assertEq(vault.perpManagerDeployed(), 400e6);
        assertEq(vault.usdcBalance(), 600e6);
        assertEq(vault.totalAssets(), 1000e6); // still counted, just held elsewhere
        assertEq(vault.availableLiquidity(), 600e6);
    }

    function test_managerReturnMintsNoShares() public {
        _deposit(alice, 1000e6);
        _whitelistManager();
        vm.prank(admin);
        vault.sendFundPerpManager(perpManager, address(usdc), 400e6);

        uint256 supplyBefore = vault.totalSupply();
        vm.startPrank(perpManager);
        usdc.approve(address(vault), 400e6);
        vault.perpManagerDeposit(address(usdc), 400e6);
        vm.stopPrank();

        assertEq(vault.totalSupply(), supplyBefore); // a return of capital, not a subscription
        assertEq(vault.balanceOf(perpManager), 0);
        assertEq(vault.perpManagerOutstanding(perpManager), 0);
        assertEq(vault.perpManagerDeployed(), 0);
        assertEq(vault.usdcBalance(), 1000e6);
        assertEq(vault.totalAssets(), 1000e6);
    }

    function test_managerProfitGoesToDepositorsNotTheManager() public {
        _deposit(alice, 1000e6);
        _whitelistManager();
        vm.prank(admin);
        vault.sendFundPerpManager(perpManager, address(usdc), 400e6);

        usdc.mint(perpManager, 100e6); // funding income earned on the short
        vm.startPrank(perpManager);
        usdc.approve(address(vault), 500e6);
        vault.perpManagerDeposit(address(usdc), 500e6);
        vm.stopPrank();

        assertEq(vault.perpManagerDeployed(), 0);
        assertEq(vault.totalAssets(), 1100e6);
        assertEq(vault.totalSupply(), 1000e18);
        assertApproxEqRel(vault.convertToAssets(vault.balanceOf(alice)), 1100e6, 1e12);
    }

    function test_reportedLossOnTheManagerBookReducesValue() public {
        _deposit(alice, 1000e6);
        _whitelistManager();
        vm.prank(admin);
        vault.sendFundPerpManager(perpManager, address(usdc), 400e6);

        vm.prank(admin);
        vault.reportPerpPnl(-100e6);
        assertEq(vault.perpEquity(), 300e6);
        assertEq(vault.totalAssets(), 900e6);

        vm.startPrank(perpManager);
        usdc.approve(address(vault), 300e6);
        vault.perpManagerDeposit(address(usdc), 300e6);
        vm.stopPrank();

        assertEq(vault.perpManagerOutstanding(perpManager), 100e6);
        assertEq(vault.totalAssets(), 900e6); // the loss stays booked, not conjured back
    }

    function test_perpAllocationCeilingEnforced() public {
        _deposit(alice, 1000e6);
        _whitelistManager();

        vm.prank(admin);
        vm.expectPartialRevert(DeltaMonVault.PerpAllocationTooHigh.selector);
        vault.sendFundPerpManager(perpManager, address(usdc), 600e6); // over the 50 % default

        vm.prank(admin);
        vault.sendFundPerpManager(perpManager, address(usdc), 500e6);
        assertEq(vault.perpManagerDeployed(), 500e6);

        vm.prank(admin);
        vault.setMaxPerpAllocation(2000);
        vm.prank(admin);
        vm.expectPartialRevert(DeltaMonVault.PerpAllocationTooHigh.selector);
        vault.sendFundPerpManager(perpManager, address(usdc), 1);
    }

    function test_removedManagerCanStillReturnWhatTheyHold() public {
        _deposit(alice, 1000e6);
        _whitelistManager();
        vm.prank(admin);
        vault.sendFundPerpManager(perpManager, address(usdc), 400e6);

        vm.prank(admin);
        vault.controlPerpManagers(perpManager, false);
        assertFalse(vault.isPerpManager(perpManager));

        vm.prank(admin);
        vm.expectPartialRevert(DeltaMonVault.NotAPerpManager.selector);
        vault.sendFundPerpManager(perpManager, address(usdc), 1e6);

        vm.startPrank(perpManager);
        usdc.approve(address(vault), 400e6);
        vault.perpManagerDeposit(address(usdc), 400e6);
        vm.stopPrank();
        assertEq(vault.perpManagerOutstanding(perpManager), 0);
    }

    function test_strangerCannotUseTheReturnPath() public {
        _deposit(alice, 1000e6);
        usdc.mint(bob, 100e6);
        vm.startPrank(bob);
        usdc.approve(address(vault), 100e6);
        vm.expectPartialRevert(DeltaMonVault.NotAPerpManager.selector);
        vault.perpManagerDeposit(address(usdc), 100e6);
        vm.stopPrank();
    }

    function test_onlySettlementTokensCanMove() public {
        _deposit(alice, 1000e6);
        _whitelistManager();
        vm.prank(admin);
        vm.expectPartialRevert(DeltaMonVault.UnsupportedToken.selector);
        vault.sendFundPerpManager(perpManager, address(wmon), 1e18);
    }

    function test_pauseStopsNewRiskButNotUnwinding() public {
        _deposit(alice, 1000e6);
        _whitelistManager();
        vm.prank(admin);
        vault.sendFundPerpManager(perpManager, address(usdc), 400e6);
        _buyMon(200e6);

        vm.prank(admin);
        vault.pause();

        vm.startPrank(admin);
        vm.expectRevert();
        vault.sendFundPerpManager(perpManager, address(usdc), 1e6);
        vm.expectRevert();
        vault.swapUsdcForMon(1e6, 0);
        vm.stopPrank();

        // Unwinding is still open.
        uint256 monHeld = wmon.balanceOf(address(vault));
        vm.prank(admin);
        vault.swapMonForUsdc(monHeld, 0);
        vm.startPrank(perpManager);
        usdc.approve(address(vault), 400e6);
        vault.perpManagerDeposit(address(usdc), 400e6);
        vm.stopPrank();
        assertEq(vault.perpManagerDeployed(), 0);
    }

    function test_fundingAManagerIsFrozenWhileRedemptionsAreOverdue() public {
        _deposit(alice, 1000e6);
        _whitelistManager();
        _buyMon(900e6);
        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        vault.requestRedeem(shares);
        skip(37 hours);

        vm.prank(admin);
        vm.expectRevert(DeltaMonVault.RedemptionsOverdue.selector);
        vault.sendFundPerpManager(perpManager, address(usdc), 1e6);
    }

    // ───────────────────────────── access and config ─────────────────────────────

    function test_whitelistModeTogglesDynamically() public {
        vm.prank(admin);
        vault.setWhitelistEnabled(true);
        assertEq(vault.maxDeposit(alice), 0);

        vm.prank(alice);
        vm.expectPartialRevert(ERC4626.ERC4626ExceededMaxDeposit.selector);
        vault.deposit(100e6, alice);

        address[] memory allowed = new address[](1);
        allowed[0] = alice;
        vm.prank(admin);
        vault.setDepositors(allowed, true);
        _deposit(alice, 100e6);

        vm.prank(bob);
        vm.expectPartialRevert(ERC4626.ERC4626ExceededMaxDeposit.selector);
        vault.deposit(100e6, bob);

        vm.prank(admin);
        vault.setWhitelistEnabled(false);
        _deposit(bob, 100e6);
    }

    function test_feeIncreaseIsTimelockedDecreaseIsNot() public {
        vm.prank(admin);
        vault.proposePerformanceFee(500);
        assertEq(vault.performanceFeeBps(), 500);

        vm.prank(admin);
        vault.proposePerformanceFee(1000);
        assertEq(vault.performanceFeeBps(), 500);

        vm.prank(admin);
        vm.expectPartialRevert(DeltaMonVault.FeeTimelockActive.selector);
        vault.applyPerformanceFee();

        // Still locked after the redemption deadline, so a depositor who objects is out first.
        skip(vault.REDEMPTION_DEADLINE() + 1);
        vm.prank(admin);
        vm.expectPartialRevert(DeltaMonVault.FeeTimelockActive.selector);
        vault.applyPerformanceFee();

        skip(vault.FEE_TIMELOCK());
        vm.prank(admin);
        vault.applyPerformanceFee();
        assertEq(vault.performanceFeeBps(), 1000);
    }

    function test_feeCannotExceedTenPercent() public {
        vm.prank(admin);
        vm.expectRevert(DeltaMonVault.InvalidBps.selector);
        vault.proposePerformanceFee(1001);
    }

    function test_pauseStopsDepositsNotExits() public {
        _deposit(alice, 1000e6);
        vm.prank(admin);
        vault.pause();

        assertEq(vault.maxDeposit(alice), 0);
        vm.prank(bob);
        vm.expectPartialRevert(ERC4626.ERC4626ExceededMaxDeposit.selector);
        vault.deposit(100e6, bob);

        uint256 shares_alice = vault.balanceOf(alice);
        vm.prank(alice);
        uint256 out = vault.redeem(shares_alice, alice, alice);
        assertApproxEqAbs(out, 1000e6, 2);
    }

    // ───────────────────────────── pre-mainnet hardening ─────────────────────────────

    function test_venueChangeIsTimelocked() public {
        LyingVenue liar = new LyingVenue();

        vm.prank(admin);
        vault.proposeVenue(ISpotVenue(address(liar)), IPriceOracle(address(oracle)));
        assertEq(address(vault.spotVenue()), address(venue)); // unchanged for now

        vm.prank(admin);
        vm.expectPartialRevert(DeltaMonVault.VenueTimelockActive.selector);
        vault.applyVenue();

        // A depositor who dislikes the proposal has longer than the redemption deadline to leave.
        skip(3 days + 1);
        vm.prank(admin);
        vault.applyVenue();
        assertEq(address(vault.spotVenue()), address(liar));
    }

    function test_venueChangeCanBeCancelled() public {
        LyingVenue liar = new LyingVenue();
        vm.prank(admin);
        vault.proposeVenue(ISpotVenue(address(liar)), IPriceOracle(address(oracle)));
        vm.prank(admin);
        vault.cancelVenueChange();
        skip(4 days);
        vm.prank(admin);
        vm.expectRevert(DeltaMonVault.NoVenueChangePending.selector);
        vault.applyVenue();
    }

    function test_swapRevertsWhenTheVenueDeliversNothing() public {
        _deposit(alice, 1000e6);
        LyingVenue liar = new LyingVenue();
        vm.prank(admin);
        vault.proposeVenue(ISpotVenue(address(liar)), IPriceOracle(address(oracle)));
        skip(3 days + 1);
        vm.prank(admin);
        vault.applyVenue();

        // The venue claims it paid out. The vault checks its own balance and refuses.
        vm.prank(admin);
        vm.expectPartialRevert(DeltaMonVault.VenueShortchanged.selector);
        vault.swapUsdcForMon(500e6, 0);
        assertEq(vault.usdcBalance(), 1000e6);
    }

    function test_deployingUsdcCannotInflateTheSharePriceViaAccruedFees() public {
        _deposit(alice, 1000e6);
        _deposit(bob, 1000e6);
        usdc.mint(address(vault), 400e6); // +20 % for both

        uint256 aliceShares = vault.balanceOf(alice);
        vm.prank(alice);
        vault.redeem(aliceShares, alice, alice);
        uint256 fees = vault.accruedFees();
        assertApproxEqAbs(fees, 20e6, 2);

        uint256 bobValueBefore = vault.convertToAssets(vault.balanceOf(bob));
        assertApproxEqAbs(bobValueBefore, 1200e6, 2);

        // Deploy almost everything, leaving less idle USDC than the fee that is owed.
        vm.prank(admin);
        vault.swapUsdcForMon(1210e6, 0);
        assertLt(vault.usdcBalance(), fees);

        // Bob's claim must not move just because the USDC backing the fee was put to work.
        assertApproxEqAbs(vault.convertToAssets(vault.balanceOf(bob)), bobValueBefore, 2);
    }

    function test_dustTopUpCannotRefreshAStaleMark() public {
        _deposit(alice, 1000e6);
        _fundManager(400e6);

        skip(7 hours);
        vm.prank(bob);
        vm.expectRevert(DeltaMonVault.StalePerpReport.selector);
        vault.deposit(100e6, bob);

        // Topping up must not pass for a fresh mark.
        vm.prank(admin);
        vault.sendFundPerpManager(perpManager, address(usdc), 1);
        vm.prank(bob);
        vm.expectRevert(DeltaMonVault.StalePerpReport.selector);
        vault.deposit(100e6, bob);

        vm.prank(admin);
        vault.reportPerpPnl(0);
        _deposit(bob, 100e6);
    }

    // ───────────────────────────── fuzz ─────────────────────────────

    function testFuzz_redeemNeverReturnsMoreThanDeposited(uint96 amount) public {
        amount = uint96(bound(uint256(amount), 10e6, START));
        _deposit(alice, amount);
        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        uint256 out = vault.redeem(shares, alice, alice);
        assertLe(out, amount);
        assertApproxEqRel(out, amount, 1e12);
    }

    function testFuzz_secondDepositorNeverDilutesTheFirst(uint96 a, uint96 b, uint96 gain) public {
        a = uint96(bound(uint256(a), 10e6, 400_000e6));
        b = uint96(bound(uint256(b), 10e6, 400_000e6));
        gain = uint96(bound(uint256(gain), 0, 100_000e6));

        _deposit(alice, a);
        usdc.mint(address(vault), gain);
        uint256 aliceValueBefore = vault.convertToAssets(vault.balanceOf(alice));

        _deposit(bob, b);
        assertApproxEqRel(vault.convertToAssets(vault.balanceOf(alice)), aliceValueBefore, 1e12);
        assertApproxEqRel(vault.convertToAssets(vault.balanceOf(bob)), b, 1e12);
    }

    // ───────────────────────────── mainnet review, second pass ─────────────────────────────

    function test_reopeningAnEmptyBookStartsFromAZeroMark() public {
        _deposit(alice, 1000e6);
        _fundManager(500e6);
        vm.prank(admin);
        vault.reportPerpPnl(250e6);

        // The manager closes out: principal plus the realised gain comes home.
        usdc.mint(perpManager, 250e6);
        vm.startPrank(perpManager);
        usdc.approve(address(vault), 750e6);
        vault.perpManagerDeposit(address(usdc), 750e6);
        vm.stopPrank();
        assertEq(vault.perpReportedPnl(), 0);
        assertEq(vault.totalAssets(), 1250e6);

        // Days later the book reopens with 1 USDC. The old gain must not come back with it.
        skip(3 days);
        vm.prank(admin);
        vault.sendFundPerpManager(perpManager, address(usdc), 1e6);
        assertFalse(vault.perpReportIsStale());
        assertEq(vault.perpEquity(), 1e6);
        assertEq(vault.totalAssets(), 1250e6);
    }

    function test_aReturnAboveOneManagersBalanceIsNotCountedTwice() public {
        address second = makeAddr("second");
        _deposit(alice, 1000e6);
        vm.startPrank(admin);
        vault.controlPerpManagers(perpManager, true);
        vault.controlPerpManagers(second, true);
        skip(vault.CONFIG_TIMELOCK());
        vault.applyPerpManager(perpManager);
        vault.applyPerpManager(second);
        vault.sendFundPerpManager(perpManager, address(usdc), 400e6);
        vault.sendFundPerpManager(second, address(usdc), 100e6);
        vault.reportPerpPnl(200e6); // the gain sits with the first manager
        vm.stopPrank();
        assertEq(vault.totalAssets(), 1200e6);

        // The first manager closes and returns principal plus gain. The second still holds 100.
        usdc.mint(perpManager, 200e6);
        vm.startPrank(perpManager);
        usdc.approve(address(vault), 600e6);
        vault.perpManagerDeposit(address(usdc), 600e6);
        vm.stopPrank();

        // 1100 idle plus the 100 still out. The gain now lives in the idle USDC and nowhere else.
        assertEq(vault.perpReportedPnl(), 0);
        assertEq(vault.totalAssets(), 1200e6);

        // The mark no longer describes the book, so nobody may buy in until it is reported again.
        assertTrue(vault.perpReportIsStale());
        vm.prank(bob);
        vm.expectRevert(DeltaMonVault.StalePerpReport.selector);
        vault.deposit(100e6, bob);
        vm.prank(admin);
        vault.reportPerpPnl(0);
        _deposit(bob, 100e6);
    }

    function test_aLongSettledRunCannotMakeTheHeadUnsettleable() public {
        _deposit(alice, 1000e6);
        uint256 aliceShares = vault.balanceOf(alice);
        vm.prank(alice);
        uint256 head = vault.requestRedeem(aliceShares);

        // A griefer queues and cancels hundreds of requests behind Alice's.
        _deposit(bob, 10e6);
        uint256 unit = 10 ** vault.decimals();
        vm.startPrank(bob);
        for (uint256 i; i < 300; i++) {
            vault.cancelRedemption(vault.requestRedeem(unit));
        }
        vm.stopPrank();

        vm.cool(address(vault));
        uint256 gasBefore = gasleft();
        vault.claimRedemption(head);
        assertLt(gasBefore - gasleft(), 500_000); // bounded however long the run behind it grows

        // The head moved on as far as one call may. The rest is anyone's to clear.
        assertEq(vault.queueHead(), vault.MAX_QUEUE_SCAN());
        assertTrue(vault.hasOverdueRedemptions()); // cannot prove the queue healthy yet
        vault.advanceQueue(1000);
        assertEq(vault.queueHead(), vault.redemptionCount());
        assertFalse(vault.hasOverdueRedemptions());
    }

    function test_queueRequestsHaveAFloorExceptForAWholeBalance() public {
        _deposit(alice, 1000e6);
        uint256 unit = 10 ** vault.decimals();
        vm.prank(alice);
        vm.expectPartialRevert(DeltaMonVault.BelowMinRedemption.selector);
        vault.requestRedeem(unit - 1);

        // A holder whose whole position is under the floor can still queue all of it.
        vm.prank(alice);
        vault.transfer(bob, 1);
        vm.prank(bob);
        vault.requestRedeem(1);
        assertEq(vault.queuedShares(), 1);
    }

    function test_addingAPerpManagerIsTimelocked() public {
        _deposit(alice, 1000e6);
        vm.prank(admin);
        vault.controlPerpManagers(perpManager, true);
        assertFalse(vault.isPerpManager(perpManager));

        vm.prank(admin);
        vm.expectPartialRevert(DeltaMonVault.TimelockActive.selector);
        vault.applyPerpManager(perpManager);
        vm.prank(admin);
        vm.expectPartialRevert(DeltaMonVault.NotAPerpManager.selector);
        vault.sendFundPerpManager(perpManager, address(usdc), 100e6);

        // Removal applies at once and withdraws a pending add too.
        vm.prank(admin);
        vault.controlPerpManagers(perpManager, false);
        skip(vault.CONFIG_TIMELOCK());
        vm.prank(admin);
        vm.expectRevert(DeltaMonVault.NoChangePending.selector);
        vault.applyPerpManager(perpManager);
    }

    function test_adminCannotReachTheBookInOneBlock() public {
        _deposit(alice, 1000e6);
        _deposit(bob, 1000e6);

        vm.startPrank(admin);
        vault.controlPerpManagers(admin, true);
        vault.setMaxPerpAllocation(10_000);
        vm.expectPartialRevert(DeltaMonVault.NotAPerpManager.selector);
        vault.sendFundPerpManager(admin, address(usdc), 2000e6);
        vm.stopPrank();
        assertEq(vault.maxPerpAllocationBps(), 5000); // the raise is only pending
        assertEq(vault.pendingMaxPerpAllocationBps(), 10_000);

        // Both proposals are public and outlast the redemption deadline, so anyone can leave first.
        assertGt(vault.CONFIG_TIMELOCK(), vault.REDEMPTION_DEADLINE());
        uint256 aliceShares = vault.balanceOf(alice);
        vm.prank(alice);
        vault.redeem(aliceShares, alice, alice);
        assertEq(usdc.balanceOf(admin), 0);
    }

    function test_raisingThePerpCeilingIsTimelockedLoweringIsNot() public {
        vm.startPrank(admin);
        vault.setMaxPerpAllocation(8000);
        assertEq(vault.maxPerpAllocationBps(), 5000);
        vm.expectPartialRevert(DeltaMonVault.TimelockActive.selector);
        vault.applyMaxPerpAllocation();

        vault.setMaxPerpAllocation(3000); // a cut lands at once and withdraws the queued raise
        assertEq(vault.maxPerpAllocationBps(), 3000);
        assertEq(vault.pendingMaxPerpAllocationAt(), 0);

        vault.setMaxPerpAllocation(8000);
        skip(vault.CONFIG_TIMELOCK());
        vault.applyMaxPerpAllocation();
        assertEq(vault.maxPerpAllocationBps(), 8000);
        vm.stopPrank();
    }

    function test_looseningRiskLimitsIsTimelockedTighteningIsNot() public {
        vm.startPrank(admin);
        vault.setRiskParams(500, 100, 2e17, 5000, 6 hours); // wider slippage
        assertEq(vault.maxSwapSlippageBps(), 50);
        vm.expectPartialRevert(DeltaMonVault.TimelockActive.selector);
        vault.applyRiskParams();

        vault.setRiskParams(30, 100, 2e17, 5000, 6 hours); // tighter: lands at once, drops the pending set
        assertEq(vault.maxSwapSlippageBps(), 30);
        assertEq(vault.pendingRiskParamsAt(), 0);

        vault.setRiskParams(30, 100, 2e17, 5000, 30 days); // a longer stale window loosens too
        assertEq(vault.perpReportMaxAge(), 6 hours);
        skip(vault.CONFIG_TIMELOCK());
        vault.applyRiskParams();
        assertEq(vault.perpReportMaxAge(), 30 days);
        vm.stopPrank();
    }

    function test_ownershipCannotBeRenounced() public {
        vm.prank(admin);
        vm.expectRevert(DeltaMonVault.RenounceDisabled.selector);
        vault.renounceOwnership();
        assertEq(vault.owner(), admin);
    }

    function test_aFeeRiseCannotReachARequestQueuedBeforeIt() public {
        assertGt(vault.FEE_TIMELOCK(), vault.REDEMPTION_DEADLINE());
        vm.prank(admin);
        vault.proposePerformanceFee(100); // 1 %, a cut, so it applies at once
        _deposit(alice, 1000e6);
        _buyMon(900e6);
        oracle.setPrice(address(wmon), MON_PRICE * 2); // MON doubles

        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        uint256 id = vault.requestRedeem(shares);

        vm.prank(admin);
        vault.proposePerformanceFee(1000);
        skip(vault.FEE_TIMELOCK());
        vm.prank(admin);
        vault.applyPerformanceFee();
        assertEq(vault.performanceFeeBps(), 1000);

        uint256 monHeld = wmon.balanceOf(address(vault));
        vm.prank(admin);
        vault.swapMonForUsdc(monHeld, 0);
        vault.claimRedemption(id);
        assertApproxEqRel(vault.accruedFees(), 9e6, 0.01e18); // the 1 % it was queued under
    }

    function test_keeperMarksTheBookAndClaimsRewardsAndNothingElse() public {
        address keeperKey = makeAddr("keeper");
        vm.prank(admin);
        vault.setKeeper(keeperKey);
        _deposit(alice, 1000e6);
        _fundManager(400e6);

        vm.prank(keeperKey);
        vault.reportPerpPnl(-150e6); // inside the 50 % band
        assertEq(vault.perpEquity(), 250e6);

        // A loss past the band is the admin's to mark, not the hot key's.
        vm.prank(keeperKey);
        vm.expectRevert(DeltaMonVault.PnlOutOfBand.selector);
        vault.reportPerpPnl(-300e6);
        vm.prank(admin);
        vault.reportPerpPnl(-400e6); // the whole book
        assertEq(vault.perpEquity(), 0);
        vm.prank(admin);
        vm.expectRevert(DeltaMonVault.PnlOutOfBand.selector);
        vault.reportPerpPnl(250e6); // gains stay inside the band for everyone

        vm.prank(keeperKey);
        vault.claimStakingRewards(VAL);

        vm.startPrank(keeperKey);
        vm.expectPartialRevert(Ownable.OwnableUnauthorizedAccount.selector);
        vault.swapUsdcForMon(1e6, 0);
        vm.expectPartialRevert(Ownable.OwnableUnauthorizedAccount.selector);
        vault.sendFundPerpManager(perpManager, address(usdc), 1e6);
        vm.stopPrank();
    }

    function test_strangersCannotClaimStakingRewards() public {
        _deposit(alice, 10_000e6);
        _buyMon(5000e6);
        uint256 mon = wmon.balanceOf(address(vault));
        vm.prank(admin);
        vault.stake(VAL, mon);
        staking.setReward(address(vault), VAL, mon * 2 / 100);

        // The deposit, claim, redeem sandwich no longer has a claim to wrap.
        vm.prank(bob);
        vm.expectPartialRevert(DeltaMonVault.NotKeeperOrOwner.selector);
        vault.claimStakingRewards(VAL);
    }

    function test_redeemInKindOpensWhileTheOracleIsDown() public {
        _deposit(alice, 1000e6);
        _deposit(bob, 1000e6);
        _buyMon(800e6); // 32,000 MON at 0.025
        vm.startPrank(admin);
        vault.swapUsdcForAusd(200e6, 0);
        vault.stake(VAL, 16_000e18); // half the MON is staked and cannot be paid in kind
        vm.stopPrank();
        // Now 1000 USDC idle, 16,000 WMON, 200 AUSD, and 16,000 MON staked.

        oracle.setPrice(address(wmon), 0); // the feed goes dark
        assertFalse(vault.oracleIsLive());

        uint256 aliceShares = vault.balanceOf(alice);
        vm.prank(alice);
        vm.expectRevert(bytes("MockOracle: unset"));
        vault.redeem(aliceShares, alice, alice);

        vm.prank(alice);
        (uint256 usdcOut, uint256 monOut, uint256 ausdOut) = vault.redeemInKind(aliceShares, alice);
        assertApproxEqAbs(usdcOut, 500e6, 1);
        assertApproxEqAbs(monOut, 8000e18, 1);
        assertApproxEqAbs(ausdOut, 100e6, 1);
        assertEq(vault.balanceOf(alice), 0);
        assertEq(vault.accruedFees(), 0);

        // The feed returns. Bob kept all the staked MON Alice could not take, so he is ahead.
        oracle.setPrice(address(wmon), MON_PRICE);
        assertApproxEqAbs(vault.convertToAssets(vault.balanceOf(bob)), 1200e6, 2);
    }

    function test_redeemInKindIsClosedWhileTheOracleIsLive() public {
        _deposit(alice, 1000e6);
        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        vm.expectRevert(DeltaMonVault.OracleIsLive.selector);
        vault.redeemInKind(shares, alice);
    }

    function test_anOutageCannotBeFakedByStarvingTheOracle() public {
        // An oracle that needs 400k gas to answer. Handed less, it would fail as if the feed were down.
        GasHungryOracle hungry = new GasHungryOracle(400_000, MON_PRICE);
        vm.prank(admin);
        vault.proposeVenue(ISpotVenue(address(venue)), IPriceOracle(address(hungry)));
        skip(vault.VENUE_TIMELOCK());
        vm.prank(admin);
        vault.applyVenue();

        _deposit(alice, 1000e6);
        _buyMon(500e6);
        uint256 shares = vault.balanceOf(alice);
        // Whatever gas the caller picks, the oracle gets its full stipend or the call refuses.
        for (uint256 g = 100_000; g <= 2_000_000; g += 25_000) {
            vm.prank(alice);
            (bool ok,) = address(vault).call{gas: g}(abi.encodeCall(DeltaMonVault.redeemInKind, (shares, alice)));
            assertFalse(ok);
        }
        assertEq(vault.balanceOf(alice), shares);
        assertTrue(vault.oracleIsLive());
    }
}

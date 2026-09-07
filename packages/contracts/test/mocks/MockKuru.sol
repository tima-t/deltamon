// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IKuruRouter} from "../../src/interfaces/external/IKuruRouter.sol";
import {IKuruOrderBook} from "../../src/interfaces/external/IKuruOrderBook.sol";
import {MockERC20} from "./MockERC20.sol";
import {MockOracle} from "./MockOracle.sol";

/// @dev WETH9-style wrapped MON.
contract MockWMON is ERC20 {
    constructor() ERC20("Wrapped MON", "WMON") {}

    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "MockWMON: send failed");
    }

    receive() external payable {
        _mint(msg.sender, msg.value);
    }
}

contract MockKuruOrderBook is IKuruOrderBook {
    address public base;
    address public quote;

    constructor(address base_, address quote_) {
        base = base_;
        quote = quote_;
    }

    function getMarketParams()
        external
        view
        returns (uint32, uint96, address, uint256, address, uint256, uint32, uint96, uint96, uint256, uint256)
    {
        return (1e8, 1e10, base, 18, quote, 6, 100, 2e12, 2e18, 0, 0);
    }

    function bestBidAsk() external pure returns (uint256, uint256) {
        return (0, 0);
    }
}

/// @dev Single-hop MON/USDC router: native MON (address(0)) ⇄ a 6-decimal quote token, priced by the oracle.
contract MockKuruRouter is IKuruRouter {
    using SafeERC20 for IERC20;
    using Math for uint256;

    MockOracle public immutable oracle;
    MockERC20 public immutable quoteToken;
    address public immutable priceKey; // WMON address the oracle is keyed by
    uint256 public feeBps;

    constructor(MockOracle oracle_, MockERC20 quoteToken_, address priceKey_) {
        oracle = oracle_;
        quoteToken = quoteToken_;
        priceKey = priceKey_;
    }

    function setFeeBps(uint256 bps) external {
        feeBps = bps;
    }

    function anyToAnySwap(
        address[] calldata markets,
        bool[] calldata isBuy,
        bool[] calldata nativeSend,
        address debitToken,
        address creditToken,
        uint256 amount,
        uint256 minAmountOut
    ) external payable returns (uint256 amountOut) {
        require(markets.length == 1 && isBuy.length == 1 && nativeSend.length == 1, "MockKuruRouter: one hop");
        uint256 price = oracle.price(priceKey);
        if (debitToken == address(0)) {
            require(msg.value == amount && nativeSend[0] && !isBuy[0], "MockKuruRouter: bad native sell");
            require(creditToken == address(quoteToken), "MockKuruRouter: credit");
            amountOut = amount.mulDiv(price, 1e18).mulDiv(1e6, 1e18);
            amountOut = amountOut.mulDiv(10_000 - feeBps, 10_000);
            require(amountOut >= minAmountOut, "MockKuruRouter: slippage");
            quoteToken.mint(msg.sender, amountOut);
        } else {
            require(msg.value == 0 && !nativeSend[0] && isBuy[0], "MockKuruRouter: bad buy");
            require(debitToken == address(quoteToken) && creditToken == address(0), "MockKuruRouter: tokens");
            IERC20(debitToken).safeTransferFrom(msg.sender, address(this), amount);
            amountOut = amount.mulDiv(1e18, 1e6).mulDiv(1e18, price);
            amountOut = amountOut.mulDiv(10_000 - feeBps, 10_000);
            require(amountOut >= minAmountOut, "MockKuruRouter: slippage");
            (bool ok,) = msg.sender.call{value: amountOut}("");
            require(ok, "MockKuruRouter: native send");
        }
    }

    receive() external payable {}
}

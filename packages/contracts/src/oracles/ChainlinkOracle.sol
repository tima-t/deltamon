// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IPriceOracle} from "../interfaces/IPriceOracle.sol";
import {AggregatorV3Interface} from "../interfaces/external/AggregatorV3Interface.sol";

/// @title ChainlinkOracle
/// @notice Token → Chainlink aggregator mapping with optional quote-token chaining
///         (e.g. aprMON/MON × MON/USD). Returns USD per whole token scaled to 1e18.
contract ChainlinkOracle is IPriceOracle, Ownable {
    struct Feed {
        AggregatorV3Interface aggregator;
        address quoteToken; // address(0) = USD
        uint256 maxStaleness;
    }

    mapping(address => Feed) public feeds;

    event FeedSet(address indexed token, address aggregator, address quoteToken, uint256 maxStaleness);

    error FeedNotSet(address token);
    error InvalidPrice(address token);
    error StalePrice(address token, uint256 updatedAt);

    constructor(address owner_) Ownable(owner_) {}

    function setFeed(address token, address aggregator, address quoteToken, uint256 maxStaleness) external onlyOwner {
        feeds[token] = Feed(AggregatorV3Interface(aggregator), quoteToken, maxStaleness);
        emit FeedSet(token, aggregator, quoteToken, maxStaleness);
    }

    function price(address token) external view returns (uint256) {
        return _price(token, 0);
    }

    function _price(address token, uint8 depth) internal view returns (uint256) {
        Feed memory f = feeds[token];
        if (address(f.aggregator) == address(0)) revert FeedNotSet(token);
        (, int256 answer,, uint256 updatedAt,) = f.aggregator.latestRoundData();
        if (answer <= 0) revert InvalidPrice(token);
        if (block.timestamp - updatedAt > f.maxStaleness) revert StalePrice(token, updatedAt);
        uint256 p = uint256(answer) * 1e18 / 10 ** f.aggregator.decimals();
        if (f.quoteToken != address(0) && depth < 2) {
            p = p * _price(f.quoteToken, depth + 1) / 1e18;
        }
        return p;
    }
}

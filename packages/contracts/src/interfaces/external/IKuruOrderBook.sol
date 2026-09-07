// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Kuru OrderBook market. Native MON is represented as address(0) in base/quote.
interface IKuruOrderBook {
    function getMarketParams()
        external
        view
        returns (
            uint32 pricePrecision,
            uint96 sizePrecision,
            address baseAsset,
            uint256 baseAssetDecimals,
            address quoteAsset,
            uint256 quoteAssetDecimals,
            uint32 tickSize,
            uint96 minSize,
            uint96 maxSize,
            uint256 takerFeeBps,
            uint256 makerFeeBps
        );

    function bestBidAsk() external view returns (uint256 bestBid, uint256 bestAsk);
}

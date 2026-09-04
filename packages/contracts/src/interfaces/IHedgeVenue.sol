// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Short-side venue (Perpl perp, or a borrow-and-sell lending market).
interface IHedgeVenue {
    function collateralToken() external view returns (address);

    /// @dev Pulls `amount` of collateralToken from msg.sender.
    function depositCollateral(uint256 amount) external;

    function withdrawCollateral(uint256 amount, address to) external returns (uint256 withdrawn);

    /// @param notionalDelta collateral-token units; positive grows the short, negative shrinks it.
    function adjustShort(int256 notionalDelta) external;

    /// @notice Open short size in collateral-token units.
    function shortNotional() external view returns (uint256);

    /// @notice Collateral ± unrealised PnL ± accrued funding, collateral-token units.
    function equity() external view returns (uint256);
}

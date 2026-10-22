#pragma once
#include <array>

namespace bot::detail {
inline constexpr int mateScore = 30000;
inline constexpr int infinityScore = 32000;
inline constexpr std::array<int, 6> pieceValues{100, 320, 335, 500, 900, 0};
} // namespace bot::detail

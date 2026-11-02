#pragma once
#include "chess/chess.hpp"

#include <optional>
#include <random>

namespace bot {
// A short weighted opening book for the standard starting position, so that games against the
// bot do not all open the same way. Positions are matched by their repetition key, so move
// orders that transpose into a book position are recognized too.
std::optional<chess::Move> bookMove(const chess::BoardState &board, std::mt19937_64 &random);
} // namespace bot

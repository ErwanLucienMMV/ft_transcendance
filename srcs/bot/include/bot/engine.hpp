#pragma once
#include "chess/chess.hpp"

#include <chrono>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace bot {
enum class Difficulty { Easy, Medium, Hard };
Difficulty parseDifficulty(const std::string &name);
std::string difficultyName(Difficulty difficulty);

struct Limits {
	int depth;
	std::uint64_t nodes;
	std::chrono::milliseconds time;
};

Limits limitsFor(Difficulty difficulty);

struct Position {
	chess::BoardState board;
	// Includes the initial position and the current position, for draw scoring.
	std::vector<std::string> history;
};

Position position(const std::string &fen, const std::vector<std::string> &moves);

struct SearchResult {
	std::optional<chess::Move> move;
	int score = 0; // centipawns from the root side to move; mate ~= 30000
	int depth = 0; // last fully completed iteration
	std::uint64_t nodes = 0;
	std::int64_t elapsedMs = 0;
};

class BotEngine {
public:
	virtual ~BotEngine() = default;
	virtual SearchResult bestMove(const Position &position, Difficulty difficulty) = 0;
};

class SearchEngine final : public BotEngine {
public:
	SearchResult bestMove(const Position &position, Difficulty difficulty) override;
	// Injectable bounded budget for deterministic search tests and embedding in this executable.
	SearchResult search(const Position &position, Limits limits);
};
} // namespace bot

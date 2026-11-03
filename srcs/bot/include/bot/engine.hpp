#pragma once
#include "chess/chess.hpp"

#include <chrono>
#include <cstdint>
#include <optional>
#include <random>
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

// How a level chooses among the moves it searched. Every root move scoring within `margin`
// centipawns of the best one can be played, the closer the likelier. With `mistakePercent`
// chance, the level plays a clearly weaker move instead, at most `mistakeMargin` below the best.
// Forced mates are always played and never spoiled.
struct Style {
	int margin = 0;
	int mistakePercent = 0;
	int mistakeMargin = 0;
	bool book = false;	 // play a known opening move while the game is still in the book
	bool varied = false; // try equal root moves in random order, so ties change between games
};

Style styleFor(Difficulty difficulty);

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
	bool book = false; // the move comes from the opening book, without a search
};

class BotEngine {
public:
	virtual ~BotEngine() = default;
	virtual SearchResult bestMove(const Position &position, Difficulty difficulty) = 0;
};

class SearchEngine final : public BotEngine {
public:
	// Seeded from the system unless a seed is given; the same seed replays the same choices
	// whenever the same search iterations complete.
	SearchEngine();
	explicit SearchEngine(std::uint64_t seed);
	SearchResult bestMove(const Position &position, Difficulty difficulty) override;
	// Injectable bounded budget for deterministic search tests and embedding in this executable.
	// Without a style, the best scored move is always played.
	SearchResult search(const Position &position, Limits limits, Style style = {});

private:
	std::mt19937_64 random_;
};
} // namespace bot

#include "bot/engine.hpp"

#include "bot/search.hpp"

#include <stdexcept>

namespace bot {
using namespace chess;

Difficulty parseDifficulty(const std::string &name)
{
	if (name == "EASY") {
		return Difficulty::Easy;
	}
	if (name == "MEDIUM") {
		return Difficulty::Medium;
	}
	if (name == "HARD") {
		return Difficulty::Hard;
	}
	throw std::invalid_argument("difficulty must be EASY, MEDIUM or HARD");
}

std::string difficultyName(Difficulty difficulty)
{
	switch (difficulty) {
	case Difficulty::Easy:
		return "EASY";
	case Difficulty::Medium:
		return "MEDIUM";
	case Difficulty::Hard:
		return "HARD";
	}
	throw std::invalid_argument("Invalid difficulty");
}

Limits limitsFor(Difficulty difficulty)
{
	switch (difficulty) {
	case Difficulty::Easy:
		return {1, 1500, std::chrono::milliseconds(100)};
	case Difficulty::Medium:
		return {3, 16000, std::chrono::milliseconds(700)};
	case Difficulty::Hard:
		return {5, 100000, std::chrono::milliseconds(2200)};
	}
	throw std::invalid_argument("Invalid difficulty");
}

Position position(const std::string &fen, const std::vector<std::string> &moves)
{
	if (moves.size() > 2048) {
		throw std::invalid_argument("History exceeds 2048 plies");
	}
	BoardState board = fen.empty() ? BoardState::initial() : BoardState::fromFen(fen);
	Position position{board, {board.repetitionKey()}};
	for (const auto &move : moves) {
		position.board = position.board.play(Move::parse(move));
		position.history.push_back(position.board.repetitionKey());
	}

	return position;
}

SearchResult SearchEngine::bestMove(const Position &position, Difficulty difficulty)
{
	return search(position, limitsFor(difficulty));
}

SearchResult SearchEngine::search(const Position &position, Limits limits)
{
	if (limits.depth < 1 || limits.depth > 8 || limits.nodes < 1 || limits.time.count() < 1 ||
		position.history.empty() || position.history.back() != position.board.repetitionKey()) {
		throw std::invalid_argument("Invalid search limits or history");
	}

	return detail::Search(limits, position.history).run(position);
}

} // namespace bot

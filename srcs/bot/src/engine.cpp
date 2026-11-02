#include "bot/engine.hpp"

#include "bot/book.hpp"
#include "bot/evaluation.hpp"
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
		return {3, 40000, std::chrono::milliseconds(1000)};
	case Difficulty::Hard:
		return {5, 100000, std::chrono::milliseconds(2200)};
	}
	throw std::invalid_argument("Invalid difficulty");
}

Style styleFor(Difficulty difficulty)
{
	switch (difficulty) {
	case Difficulty::Easy:
		return {80, 15, 350, true, true};
	case Difficulty::Medium:
		return {20, 0, 0, true, true};
	case Difficulty::Hard:
		// A wider root window would cost HARD a ply; it varies through the book and ties only.
		return {0, 0, 0, true, true};
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

SearchEngine::SearchEngine() : random_(std::random_device{}())
{
}

SearchEngine::SearchEngine(std::uint64_t seed) : random_(seed)
{
}

SearchResult SearchEngine::bestMove(const Position &position, Difficulty difficulty)
{
	return search(position, limitsFor(difficulty), styleFor(difficulty));
}

SearchResult SearchEngine::search(const Position &position, Limits limits, Style style)
{
	if (limits.depth < 1 || limits.depth > 8 || limits.nodes < 1 || limits.time.count() < 1 ||
		position.history.empty() || position.history.back() != position.board.repetitionKey()) {
		throw std::invalid_argument("Invalid search limits or history");
	}

	if (style.book) {
		if (auto move = bookMove(position.board, random_)) {
			SearchResult result;
			result.move = move;
			result.score = evaluate(position.board);
			result.book = true;
			return result;
		}
	}
	return detail::Search(limits, position.history).run(position, style, random_);
}

} // namespace bot

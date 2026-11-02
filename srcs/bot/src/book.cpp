#include "bot/book.hpp"

#include <sstream>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace bot {
using chess::BoardState;
using chess::Move;

namespace {
struct Line {
	const char *moves; // played from the starting position, space separated
	std::vector<std::pair<const char *, int>> replies; // UCI move and relative weight
};

// Main lines of the most common openings, a few plies deep. Weights favour the usual choices
// while keeping the rarer ones possible.
const std::vector<Line> &lines()
{
	static const std::vector<Line> book{
		{"", {{"e2e4", 40}, {"d2d4", 35}, {"g1f3", 15}, {"c2c4", 10}}},
		{"e2e4",
			{{"e7e5", 30}, {"c7c5", 30}, {"e7e6", 15}, {"c7c6", 15}, {"d7d5", 5}, {"g8f6", 5}}},
		{"d2d4", {{"g8f6", 45}, {"d7d5", 40}, {"e7e6", 10}, {"f7f5", 5}}},
		{"g1f3", {{"d7d5", 50}, {"g8f6", 50}}},
		{"c2c4", {{"e7e5", 40}, {"g8f6", 40}, {"c7c5", 20}}},
		{"e2e4 e7e5", {{"g1f3", 70}, {"f1c4", 20}, {"b1c3", 10}}},
		{"e2e4 e7e5 g1f3", {{"b8c6", 80}, {"g8f6", 20}}},
		{"e2e4 e7e5 g1f3 b8c6", {{"f1b5", 45}, {"f1c4", 40}, {"d2d4", 15}}},
		{"e2e4 e7e5 g1f3 b8c6 f1b5", {{"a7a6", 70}, {"g8f6", 30}}},
		{"e2e4 e7e5 g1f3 b8c6 f1c4", {{"f8c5", 60}, {"g8f6", 40}}},
		{"e2e4 c7c5", {{"g1f3", 75}, {"b1c3", 25}}},
		{"e2e4 c7c5 g1f3", {{"d7d6", 40}, {"b8c6", 35}, {"e7e6", 25}}},
		{"e2e4 e7e6", {{"d2d4", 100}}},
		{"e2e4 e7e6 d2d4", {{"d7d5", 100}}},
		{"e2e4 c7c6", {{"d2d4", 100}}},
		{"e2e4 c7c6 d2d4", {{"d7d5", 100}}},
		{"d2d4 d7d5", {{"c2c4", 60}, {"g1f3", 40}}},
		{"d2d4 d7d5 c2c4", {{"e7e6", 50}, {"c7c6", 50}}},
		{"d2d4 g8f6", {{"c2c4", 70}, {"g1f3", 30}}},
		{"d2d4 g8f6 c2c4", {{"e7e6", 50}, {"g7g6", 50}}},
	};
	return book;
}

using Entries = std::vector<std::pair<Move, int>>;

std::unordered_map<std::string, Entries> build()
{
	std::unordered_map<std::string, Entries> positions;
	for (const auto &line : lines()) {
		BoardState board = BoardState::initial();
		std::istringstream played(line.moves);
		std::string uci;
		while (played >> uci) {
			board = board.play(Move::parse(uci));
		}
		auto &entries = positions[board.repetitionKey()];
		for (const auto &[reply, weight] : line.replies) {
			Move move = Move::parse(reply);
			if (!board.isLegal(move) || weight <= 0) {
				throw std::logic_error("Opening book holds an illegal move");
			}
			entries.emplace_back(move, weight);
		}
	}
	return positions;
}
} // namespace

std::optional<Move> bookMove(const BoardState &board, std::mt19937_64 &random)
{
	static const std::unordered_map<std::string, Entries> positions = build();
	auto found = positions.find(board.repetitionKey());
	if (found == positions.end()) {
		return std::nullopt;
	}
	std::vector<int> weights;
	for (const auto &entry : found->second) {
		weights.push_back(entry.second);
	}
	std::discrete_distribution<std::size_t> pick(weights.begin(), weights.end());
	Move move = found->second[pick(random)].first;
	// The book is built from legal lines, but the board is checked again before trusting it.
	if (!board.isLegal(move)) {
		return std::nullopt;
	}
	return move;
}
} // namespace bot

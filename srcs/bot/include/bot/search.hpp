#pragma once
#include "bot/engine.hpp"

#include <unordered_map>

namespace bot::detail {
struct SearchAborted {};

struct TranspositionEntry {
	int depth;
	int score;
	int bound;
	std::string best;
};

class Search {
public:
	Search(Limits limits, const std::vector<std::string> &history);
	SearchResult run(const Position &position);

private:
	int quiescence(const chess::BoardState &board, std::vector<chess::Move> moves, bool inCheck,
		int alpha, int beta, int ply, int remainingDepth);
	std::string transpositionKey(const chess::BoardState &board) const;
	void visitNode();
	std::int64_t elapsedMilliseconds() const;
	bool isCapture(const chess::BoardState &board, const chess::Move &move) const;
	int movePriority(const chess::BoardState &board, const chess::Move &move,
		const std::string &preferred) const;
	void orderMoves(const chess::BoardState &board, std::vector<chess::Move> &moves,
		const std::string &preferred = "") const;
	int searchChild(const chess::BoardState &board, const chess::Move &move, int depth, int alpha,
		int beta, int ply, int quiescenceRemaining);
	int negamax(const chess::BoardState &board, int depth, int alpha, int beta, int ply,
		int quiescenceRemaining = 6);

	Limits limits_;
	std::chrono::steady_clock::time_point started_ = std::chrono::steady_clock::now();
	std::vector<std::string> history_;
	std::unordered_map<std::string, TranspositionEntry> table_;
	std::size_t tableBytes_ = 0;
	std::uint64_t visitedNodes_ = 0;
};
} // namespace bot::detail

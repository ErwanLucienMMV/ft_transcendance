#include "bot/search.hpp"

#include "bot/constants.hpp"
#include "bot/evaluation.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <utility>

namespace bot::detail {
using chess::BoardState;
using chess::Move;
using chess::PieceType;

Search::Search(Limits limits, const std::vector<std::string> &history)
	: limits_(limits), history_(history)
{
}

void Search::visitNode()
{
	if (visitedNodes_ >= limits_.nodes ||
		std::chrono::steady_clock::now() - started_ >= limits_.time) {
		throw SearchAborted{};
	}
	++visitedNodes_;
}

std::int64_t Search::elapsedMilliseconds() const
{
	return std::chrono::duration_cast<std::chrono::milliseconds>(
		std::chrono::steady_clock::now() - started_)
		.count();
}

bool Search::isCapture(const BoardState &board, const Move &move) const
{
	return board.at(move.to).has_value() ||
		(board.at(move.from)->type == PieceType::Pawn && move.from.file() != move.to.file());
}

int Search::movePriority(
	const BoardState &board, const Move &move, const std::string &preferred) const
{
	if (move.uci() == preferred) {
		return 1000000;
	}
	int score = move.promotion ? 20000 + pieceValues[static_cast<int>(*move.promotion)] : 0;
	if (isCapture(board, move)) {
		int victim =
			board.at(move.to) ? pieceValues[static_cast<int>(board.at(move.to)->type)] : 100;
		score += 10000 + 10 * victim - pieceValues[static_cast<int>(board.at(move.from)->type)];
	}

	return score;
}

void Search::orderMoves(
	const BoardState &board, std::vector<Move> &moves, const std::string &preferred) const
{
	std::stable_sort(moves.begin(), moves.end(), [&](const Move &lhs, const Move &rhs) {
		return movePriority(board, lhs, preferred) > movePriority(board, rhs, preferred);
	});
}

int Search::searchChild(const BoardState &board, const Move &move, int depth, int alpha, int beta,
	int ply, int quiescenceRemaining)
{
	BoardState next = board.play(move); // authoritative engine, including self-check/special moves
	history_.push_back(next.repetitionKey());
	int score = -negamax(next, depth, -beta, -alpha, ply + 1, quiescenceRemaining);
	history_.pop_back();

	return score;
}

int Search::quiescence(const BoardState &board, std::vector<Move> moves, bool check, int alpha,
	int beta, int ply, int quiescenceRemaining)
{
	if (quiescenceRemaining <= 0) {
		return evaluate(board);
	}
	if (!check) {
		int stand = evaluate(board);
		if (stand >= beta) {
			return stand;
		}
		alpha = std::max(alpha, stand);
		auto isQuietMove = [&](const Move &move) {
			return !isCapture(board, move) && !move.promotion;
		};
		moves.erase(std::remove_if(moves.begin(), moves.end(), isQuietMove), moves.end());
	}
	orderMoves(board, moves);
	for (const auto &move : moves) {
		int score = searchChild(board, move, 0, alpha, beta, ply, quiescenceRemaining - 1);
		if (score >= beta) {
			return score;
		}
		alpha = std::max(alpha, score);
	}

	return alpha;
}

std::string Search::transpositionKey(const BoardState &board) const
{
	// Include the exact path's repetition counts in the TT key. Position-only
	// keys would be unsound when the same board has different draw histories.
	auto relevant =
		std::min<std::size_t>(history_.size(), static_cast<std::size_t>(board.halfmoveClock) + 1);
	std::vector<std::string> sorted(history_.end() - relevant, history_.end());
	std::sort(sorted.begin(), sorted.end());
	std::string key = board.fen();
	for (const auto &h : sorted) {
		key += '\n';
		key += h;
	}
	return key;
}

int Search::negamax(
	const BoardState &board, int depth, int alpha, int beta, int ply, int quiescenceRemaining)
{
	visitNode();
	auto moves = board.legalMoves();
	bool check = board.inCheck(board.turn);
	if (moves.empty()) {
		return check ? -mateScore + ply : 0;
	}
	if (board.insufficientMaterial() || board.fiftyMoveClaimable() ||
		std::count(history_.begin(), history_.end(), history_.back()) >= 3) {
		return 0;
	}
	if (depth <= 0) {
		return quiescence(board, std::move(moves), check, alpha, beta, ply, quiescenceRemaining);
	}
	std::string key = transpositionKey(board);
	auto found = table_.find(key);
	std::string preferred;
	int originalAlpha = alpha, originalBeta = beta;
	if (found != table_.end()) {
		preferred = found->second.best;
		if (found->second.depth >= depth && std::abs(found->second.score) < mateScore - 256) {
			auto entry = found->second;
			if (entry.bound == 0) {
				return entry.score;
			}
			if (entry.bound == 1) {
				alpha = std::max(alpha, entry.score);
			}
			if (entry.bound == -1) {
				beta = std::min(beta, entry.score);
			}
			if (alpha >= beta) {
				return entry.score;
			}
		}
	}
	orderMoves(board, moves, preferred);
	int best = -infinityScore;
	std::string bestMove;
	for (const auto &move : moves) {
		int score = searchChild(board, move, depth - 1, alpha, beta, ply, quiescenceRemaining);
		if (score > best) {
			best = score;
			bestMove = move.uci();
		}
		alpha = std::max(alpha, score);
		if (alpha >= beta) {
			break;
		}
	}
	if (tableBytes_ + key.size() + sizeof(TranspositionEntry) < 16 * 1024 * 1024) {
		if (table_.find(key) == table_.end()) {
			tableBytes_ += key.size() + sizeof(TranspositionEntry);
		}
		table_[key] = {depth, best,
			best <= originalAlpha	   ? -1
				: best >= originalBeta ? 1
									   : 0,
			bestMove};
	}

	return best;
}

SearchResult Search::run(const Position &position)
{
	SearchResult result;
	auto moves = position.board.legalMoves();
	if (moves.empty() || position.board.insufficientMaterial()) {
		return result;
	}
	// Always retain lhs validated legal fallback, even if the first iteration expires.
	orderMoves(position.board, moves);
	result.move = moves.front();
	result.score = evaluate(position.board);
	for (int depth = 1; depth <= limits_.depth; ++depth) {
		int best = -infinityScore;
		std::optional<Move> selected;
		orderMoves(position.board, moves, result.move->uci());
		try {
			for (const auto &move : moves) {
				visitNode();
				int score = searchChild(position.board, move, depth - 1, best, infinityScore, 0, 6);
				if (score > best) {
					best = score;
					selected = move;
				}
			}
		} catch (const SearchAborted &) {
			break;
		}
		result.move = selected;
		result.score = best;
		result.depth = depth;
		if (best >= mateScore - 128) {
			break;
		}
	}
	result.nodes = visitedNodes_;
	result.elapsedMs = elapsedMilliseconds();
	if (result.move && !position.board.isLegal(*result.move)) {
		throw std::logic_error("Search produced an illegal move");
	}

	return result;
}

} // namespace bot::detail

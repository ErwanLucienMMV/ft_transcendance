#include "bot/engine.hpp"
#include <algorithm>
#include <array>
#include <cmath>
#include <stdexcept>
#include <unordered_map>

namespace bot {
using namespace chess;
namespace {
constexpr int mate = 30000, infinity = 32000;
constexpr std::array<int, 6> values{100, 320, 335, 500, 900, 0};
struct Abort {};
struct Entry { int depth; int score; int bound; std::string best; };
class Search {
    Limits limits_;
    std::chrono::steady_clock::time_point started_ = std::chrono::steady_clock::now();
    std::vector<std::string> history_;
    std::unordered_map<std::string, Entry> table_;
    std::size_t tableBytes_ = 0;
public:
    std::uint64_t nodes = 0;
    Search(Limits limits, const std::vector<std::string>& history) : limits_(limits), history_(history) {}
    void tick() {
        if (nodes >= limits_.nodes || std::chrono::steady_clock::now() - started_ >= limits_.time) throw Abort{};
        ++nodes;
    }
    std::int64_t elapsed() const {
        return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - started_).count();
    }
    bool capture(const BoardState& b, const Move& m) const {
        return b.at(m.to).has_value() || (b.at(m.from)->type == PieceType::Pawn && m.from.file() != m.to.file());
    }
    int ordering(const BoardState& b, const Move& m, const std::string& preferred) const {
        if (m.uci() == preferred) return 1000000;
        int score = m.promotion ? 20000 + values[static_cast<int>(*m.promotion)] : 0;
        if (capture(b, m)) {
            int victim = b.at(m.to) ? values[static_cast<int>(b.at(m.to)->type)] : 100;
            score += 10000 + 10 * victim - values[static_cast<int>(b.at(m.from)->type)];
        }
        return score;
    }
    void order(const BoardState& b, std::vector<Move>& moves, const std::string& preferred = "") const {
        std::stable_sort(moves.begin(), moves.end(), [&](const Move& a, const Move& c) {
            return ordering(b, a, preferred) > ordering(b, c, preferred);
        });
    }
    int child(const BoardState& b, const Move& m, int depth, int alpha, int beta, int ply, int qleft) {
        BoardState next = b.play(m); // authoritative engine, including self-check/special moves
        history_.push_back(next.repetitionKey());
        int score = -negamax(next, depth, -beta, -alpha, ply + 1, qleft);
        history_.pop_back();
        return score;
    }
    int negamax(const BoardState& b, int depth, int alpha, int beta, int ply, int qleft = 6) {
        tick();
        auto moves = b.legalMoves();
        bool check = b.inCheck(b.turn);
        if (moves.empty()) return check ? -mate + ply : 0;
        if (b.insufficientMaterial() || b.fiftyMoveClaimable() ||
            std::count(history_.begin(), history_.end(), history_.back()) >= 3) return 0;
        // Quiescence: resolve captures/promotions and ALL evasions when in check.
        if (depth <= 0) {
            if (qleft <= 0) return evaluate(b);
            if (!check) {
                int stand = evaluate(b);
                if (stand >= beta) return stand;
                alpha = std::max(alpha, stand);
                moves.erase(std::remove_if(moves.begin(), moves.end(), [&](const Move& m) { return !capture(b, m) && !m.promotion; }), moves.end());
            }
            order(b, moves);
            for (const auto& m : moves) {
                int score = child(b, m, 0, alpha, beta, ply, qleft - 1);
                if (score >= beta) return score;
                alpha = std::max(alpha, score);
            }
            return alpha;
        }
        // Include the exact path's repetition counts in the TT key. Position-only
        // keys would be unsound when the same board has different draw histories.
        auto relevant = std::min<std::size_t>(history_.size(), static_cast<std::size_t>(b.halfmoveClock) + 1);
        std::vector<std::string> sorted(history_.end() - relevant, history_.end());
        std::sort(sorted.begin(), sorted.end());
        std::string key = b.fen();
        for (const auto& h : sorted) { key += '\n'; key += h; }
        auto found = table_.find(key);
        std::string preferred;
        int originalAlpha = alpha, originalBeta = beta;
        if (found != table_.end()) {
            preferred = found->second.best;
            if (found->second.depth >= depth && std::abs(found->second.score) < mate - 256) {
                auto entry = found->second;
                if (entry.bound == 0) return entry.score;
                if (entry.bound == 1) alpha = std::max(alpha, entry.score);
                if (entry.bound == -1) beta = std::min(beta, entry.score);
                if (alpha >= beta) return entry.score;
            }
        }
        order(b, moves, preferred);
        int best = -infinity;
        std::string bestMove;
        for (const auto& m : moves) {
            int score = child(b, m, depth - 1, alpha, beta, ply, qleft);
            if (score > best) { best = score; bestMove = m.uci(); }
            alpha = std::max(alpha, score);
            if (alpha >= beta) break;
        }
        if (tableBytes_ + key.size() + sizeof(Entry) < 16 * 1024 * 1024) {
            if (table_.find(key) == table_.end()) tableBytes_ += key.size() + sizeof(Entry);
            table_[key] = {depth, best, best <= originalAlpha ? -1 : best >= originalBeta ? 1 : 0, bestMove};
        }
        return best;
    }
    SearchResult run(const Position& p) {
        SearchResult result;
        auto moves = p.board.legalMoves();
        if (moves.empty() || p.board.insufficientMaterial()) return result;
        // Always retain a validated legal fallback, even if the first iteration expires.
        order(p.board, moves);
        result.move = moves.front();
        result.score = evaluate(p.board);
        for (int depth = 1; depth <= limits_.depth; ++depth) {
            int best = -infinity;
            std::optional<Move> selected;
            order(p.board, moves, result.move->uci());
            try {
                for (const auto& m : moves) {
                    tick();
                    int score = child(p.board, m, depth - 1, best, infinity, 0, 6);
                    if (score > best) { best = score; selected = m; }
                }
            } catch (const Abort&) { break; }
            result.move = selected;
            result.score = best;
            result.depth = depth;
            if (best >= mate - 128) break;
        }
        result.nodes = nodes; result.elapsedMs = elapsed();
        if (result.move && !p.board.isLegal(*result.move)) throw std::logic_error("Search produced an illegal move");
        return result;
    }
};
}
Difficulty parseDifficulty(const std::string& name) {
    if (name == "EASY") return Difficulty::Easy;
    if (name == "MEDIUM") return Difficulty::Medium;
    if (name == "HARD") return Difficulty::Hard;
    throw std::invalid_argument("difficulty must be EASY, MEDIUM or HARD");
}
std::string difficultyName(Difficulty d) {
    switch (d) { case Difficulty::Easy: return "EASY"; case Difficulty::Medium: return "MEDIUM"; case Difficulty::Hard: return "HARD"; }
    throw std::invalid_argument("Invalid difficulty");
}
Limits limitsFor(Difficulty d) {
    switch (d) {
        case Difficulty::Easy: return {1, 1500, std::chrono::milliseconds(100)};
        case Difficulty::Medium: return {3, 16000, std::chrono::milliseconds(700)};
        case Difficulty::Hard: return {5, 100000, std::chrono::milliseconds(2200)};
    }
    throw std::invalid_argument("Invalid difficulty");
}
Position position(const std::string& fen, const std::vector<std::string>& moves) {
    if (moves.size() > 2048) throw std::invalid_argument("History exceeds 2048 plies");
    BoardState board = fen.empty() ? BoardState::initial() : BoardState::fromFen(fen);
    Position p{board, {board.repetitionKey()}};
    for (const auto& move : moves) {
        p.board = p.board.play(Move::parse(move));
        p.history.push_back(p.board.repetitionKey());
    }
    return p;
}
int evaluate(const BoardState& b) {
    int white = 0, bishops[2]{0, 0}, material = 0;
    for (auto p : b.squares) if (p && p->type != PieceType::King) material += values[static_cast<int>(p->type)];
    for (int i = 0; i < 64; ++i) if (auto p = b.squares[i]) {
        int f = i % 8, r = p->color == ChessColor::White ? i / 8 : 7 - i / 8;
        int center = 7 - (std::abs(2 * f - 7) + std::abs(2 * r - 7)) / 2;
        int score = values[static_cast<int>(p->type)];
        switch (p->type) {
            case PieceType::Pawn: score += r * 7 + center * 3; if (r >= 5) score += (r - 4) * 20; break;
            case PieceType::Knight: score += center * 11; if (r == 0) score -= 15; break;
            case PieceType::Bishop: score += center * 5; ++bishops[static_cast<int>(p->color)]; break;
            case PieceType::Rook: if (r == 6) score += 20; break;
            case PieceType::Queen: score += center * 2; break;
            case PieceType::King:
                if (material < 2200) score += center * 10;
                else {
                    score -= center * 8 + r * 6;
                    if (r == 0 && (f == 6 || f == 2)) score += 45;
                    int forward = p->color == ChessColor::White ? 1 : -1;
                    int rank = i / 8 + forward;
                    for (int df = -1; df <= 1; ++df) if (rank >= 0 && rank < 8 && f + df >= 0 && f + df < 8) {
                        auto shield = b.at(Square(f + df, rank));
                        if (shield && shield->color == p->color && shield->type == PieceType::Pawn) score += 12;
                    }
                }
                break;
        }
        white += p->color == ChessColor::White ? score : -score;
    }
    if (bishops[0] >= 2) white += 30;
    if (bishops[1] >= 2) white -= 30;
    return b.turn == ChessColor::White ? white : -white;
}
SearchResult SearchEngine::bestMove(const Position& p, Difficulty d) { return search(p, limitsFor(d)); }
SearchResult SearchEngine::search(const Position& p, Limits limits) {
    if (limits.depth < 1 || limits.depth > 8 || limits.nodes < 1 || limits.time.count() < 1 || p.history.empty() || p.history.back() != p.board.repetitionKey())
        throw std::invalid_argument("Invalid search limits or history");
    return Search(limits, p.history).run(p);
}
} // namespace bot

#include "chess/chess.hpp"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <limits>
#include <sstream>
#include <stdexcept>

namespace chess {
namespace {
constexpr const char* startFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
bool inside(int f, int r) { return f >= 0 && f < 8 && r >= 0 && r < 8; }
char symbol(Piece p) {
    const char* symbols = "pnbrqk";
    char c = symbols[static_cast<int>(p.type)];
    return p.color == ChessColor::White ? static_cast<char>(std::toupper(c)) : c;
}
Piece decode(char c) {
    std::string symbols = "pnbrqk";
    auto pos = symbols.find(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
    if (pos == std::string::npos) throw std::invalid_argument("Invalid FEN piece");
    return {static_cast<PieceType>(pos), std::isupper(static_cast<unsigned char>(c)) ? ChessColor::White : ChessColor::Black};
}
std::uint64_t number(const std::string& s, bool positive) {
    if (s.empty() || s.find_first_not_of("0123456789") != std::string::npos)
        throw std::invalid_argument("Invalid FEN clock");
    std::uint64_t n;
    try { n = std::stoull(s); } catch (...) { throw std::invalid_argument("FEN clock overflow"); }
    if (positive && n == 0) throw std::invalid_argument("Fullmove number must be positive");
    return n;
}
}
ChessColor opposite(ChessColor c) { return c == ChessColor::White ? ChessColor::Black : ChessColor::White; }
Square::Square(int f, int r) : index_(0) {
    if (!inside(f, r)) throw std::invalid_argument("Square outside board");
    index_ = r * 8 + f;
}
Square Square::parse(const std::string& s) {
    if (s.size() != 2) throw std::invalid_argument("Expected algebraic square");
    return Square(s[0] - 'a', s[1] - '1');
}
std::string Square::str() const { return std::string{static_cast<char>('a' + file()), static_cast<char>('1' + rank())}; }
Move Move::parse(const std::string& s) {
    if (s.size() != 4 && s.size() != 5) throw std::invalid_argument("Expected UCI move, e.g. e2e4 or a7a8q");
    Move m{Square::parse(s.substr(0, 2)), Square::parse(s.substr(2, 2)), std::nullopt};
    if (s.size() == 5) {
        if (std::string("qrbn").find(s[4]) == std::string::npos) throw std::invalid_argument("Invalid promotion");
        m.promotion = decode(s[4]).type;
    }
    return m;
}
std::string Move::uci() const {
    return from.str() + to.str() + (promotion ? std::string(1, symbol({*promotion, ChessColor::Black})) : "");
}
bool Move::operator==(const Move& m) const { return from == m.from && to == m.to && promotion == m.promotion; }
BoardState BoardState::initial() { return fromFen(startFen); }
BoardState BoardState::fromFen(const std::string& fen) {
    std::istringstream input(fen);
    std::string placement, side, rights, ep, half, full, extra;
    if (!(input >> placement >> side >> rights >> ep >> half >> full) || input >> extra)
        throw std::invalid_argument("FEN requires exactly six fields");
    BoardState b;
    int rank = 7, file = 0, kings[2] = {0, 0};
    for (char c : placement) {
        if (c == '/') {
            if (file != 8 || rank == 0) throw std::invalid_argument("Invalid FEN rank");
            --rank; file = 0;
        } else if (c >= '1' && c <= '8') {
            file += c - '0';
            if (file > 8) throw std::invalid_argument("FEN rank too long");
        } else {
            if (file >= 8) throw std::invalid_argument("FEN rank too long");
            Piece p = decode(c);
            if (p.type == PieceType::King) ++kings[static_cast<int>(p.color)];
            if (p.type == PieceType::Pawn && (rank == 0 || rank == 7)) throw std::invalid_argument("Pawn on promotion rank");
            b.squares[Square(file++, rank).index()] = p;
        }
    }
    if (rank != 0 || file != 8 || kings[0] != 1 || kings[1] != 1) throw std::invalid_argument("FEN requires eight ranks and one king per color");
    if (side != "w" && side != "b") throw std::invalid_argument("Invalid FEN active color");
    b.turn = side == "w" ? ChessColor::White : ChessColor::Black;
    if (rights != "-") for (char c : rights) {
        auto pos = std::string("KQkq").find(c);
        if (pos == std::string::npos || (b.castling & (1u << pos))) throw std::invalid_argument("Invalid castling rights");
        b.castling |= 1u << pos;
    }
    auto has = [&](int f, int r, PieceType type, ChessColor color) {
        auto p = b.at(Square(f, r)); return p && p->type == type && p->color == color;
    };
    for (int i = 0; i < 4; ++i) if (b.castling & (1u << i)) {
        auto color = i < 2 ? ChessColor::White : ChessColor::Black;
        int r = i < 2 ? 0 : 7;
        if (!has(4, r, PieceType::King, color) || !has(i % 2 == 0 ? 7 : 0, r, PieceType::Rook, color))
            throw std::invalid_argument("Castling rights lack king or rook");
    }
    b.halfmoveClock = number(half, false); b.fullmoveNumber = number(full, true);
    if (ep != "-") {
        b.enPassant = Square::parse(ep);
        int r = b.turn == ChessColor::White ? 5 : 2;
        int pawnRank = b.turn == ChessColor::White ? 4 : 3;
        int originRank = b.turn == ChessColor::White ? 6 : 1;
        int f = b.enPassant->file();
        if (b.enPassant->rank() != r || b.at(*b.enPassant) || !has(f, pawnRank, PieceType::Pawn, opposite(b.turn)) || b.at(Square(f, originRank)) || b.halfmoveClock != 0)
            throw std::invalid_argument("Invalid en passant target");
    }
    // The side that just moved cannot have left its own king in check.
    if (b.inCheck(opposite(b.turn))) throw std::invalid_argument("Inactive king is in check");
    return b;
}
std::string BoardState::fen() const {
    std::string out;
    for (int r = 7; r >= 0; --r) {
        int empty = 0;
        for (int f = 0; f < 8; ++f) {
            auto p = at(Square(f, r));
            if (!p) ++empty;
            else { if (empty) out += static_cast<char>('0' + empty); empty = 0; out += symbol(*p); }
        }
        if (empty) out += static_cast<char>('0' + empty);
        if (r) out += '/';
    }
    out += turn == ChessColor::White ? " w " : " b ";
    if (!castling) out += '-';
    for (int i = 0; i < 4; ++i) if (castling & (1u << i)) out += "KQkq"[i];
    return out + " " + (enPassant ? enPassant->str() : "-") + " " + std::to_string(halfmoveClock) + " " + std::to_string(fullmoveNumber);
}
bool BoardState::attacked(Square target, ChessColor by) const {
    for (int i = 0; i < 64; ++i) {
        auto p = squares[i]; if (!p || p->color != by) continue;
        Square from(i % 8, i / 8);
        int df = target.file() - from.file(), dr = target.rank() - from.rank();
        int af = std::abs(df), ar = std::abs(dr);
        if (p->type == PieceType::Pawn && af == 1 && dr == (by == ChessColor::White ? 1 : -1)) return true;
        if (p->type == PieceType::Knight && af * ar == 2) return true;
        if (p->type == PieceType::King && std::max(af, ar) == 1) return true;
        bool diagonal = af == ar && af > 0, straight = (df == 0) != (dr == 0);
        if (!((p->type == PieceType::Bishop && diagonal) || (p->type == PieceType::Rook && straight) || (p->type == PieceType::Queen && (diagonal || straight)))) continue;
        int sf = (df > 0) - (df < 0), sr = (dr > 0) - (dr < 0);
        int f = from.file() + sf, r = from.rank() + sr;
        bool clear = true;
        while (f != target.file() || r != target.rank()) { if (at(Square(f, r))) { clear = false; break; } f += sf; r += sr; }
        if (clear) return true;
    }
    return false;
}
bool BoardState::inCheck(ChessColor color) const {
    for (int i = 0; i < 64; ++i) if (squares[i] && squares[i]->type == PieceType::King && squares[i]->color == color)
        return attacked(Square(i % 8, i / 8), opposite(color));
    throw std::logic_error("Missing king");
}

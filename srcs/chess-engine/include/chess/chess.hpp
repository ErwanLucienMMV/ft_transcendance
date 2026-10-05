#pragma once

#include <array>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace chess {
enum class ChessColor { White, Black };
ChessColor opposite(ChessColor color);
enum class PieceType { Pawn, Knight, Bishop, Rook, Queen, King };
struct Piece {
    PieceType type;
    ChessColor color;
};
class Square {
public:
    Square(int file, int rank);
    static Square parse(const std::string& name);
    int file() const { return index_ % 8; }
    int rank() const { return index_ / 8; }
    int index() const { return index_; }
    std::string str() const;
    bool operator==(Square other) const { return index_ == other.index_; }
    bool operator!=(Square other) const { return !(*this == other); }
private:
    int index_;
};
struct Move {
    Square from;
    Square to;
    std::optional<PieceType> promotion;
    static Move parse(const std::string& uci);
    std::string uci() const;
    bool operator==(const Move& other) const;
};
struct BoardState {
    std::array<std::optional<Piece>, 64> squares{};
    ChessColor turn = ChessColor::White;
    // K Q k q, respectively.
    unsigned castling = 0;
    std::optional<Square> enPassant;
    std::uint64_t halfmoveClock = 0;
    std::uint64_t fullmoveNumber = 1;
    static BoardState initial();
    static BoardState fromFen(const std::string& fen);
    std::string fen() const;
    const std::optional<Piece>& at(Square square) const { return squares[square.index()]; }
    bool attacked(Square square, ChessColor by) const;
    bool inCheck(ChessColor color) const;
    std::vector<Move> legalMoves() const;
    bool isLegal(const Move& move) const;
    BoardState play(const Move& move) const;
    bool checkmate() const;
    bool stalemate() const;
    bool insufficientMaterial() const;
    bool fiftyMoveClaimable() const { return halfmoveClock >= 100; }
    std::string repetitionKey() const;
private:
    std::vector<Move> pseudoMoves() const;
    BoardState applyUnchecked(const Move& move) const;
};
class Game {
public:
    explicit Game(BoardState initial = BoardState::initial());
    const BoardState& board() const { return board_; }
    void play(const Move& move);
    unsigned repetitionCount() const;
    bool threefoldClaimable() const { return repetitionCount() >= 3; }
private:
    BoardState board_;
    std::vector<std::string> history_;
};
} // namespace chess

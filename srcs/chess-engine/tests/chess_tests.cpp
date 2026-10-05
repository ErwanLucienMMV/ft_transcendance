#include "chess/chess.hpp"
#include <functional>
#include <iostream>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>
using namespace chess;
namespace {
int checks = 0;
void require(bool value, const std::string& message) {
    ++checks; if (!value) throw std::runtime_error(message);
}
void rejects(const std::function<void()>& fn) {
    bool threw = false; try { fn(); } catch (const std::invalid_argument&) { threw = true; }
    require(threw, "Expected invalid_argument");
}
BoardState fen(const std::string& s) { return BoardState::fromFen(s); }
void legal(const BoardState& b, const std::string& m, bool expected = true) { require(b.isLegal(Move::parse(m)) == expected, m + " legality"); }
BoardState play(BoardState b, const std::string& m) { return b.play(Move::parse(m)); }
void piece(const BoardState& b, const std::string& square, PieceType type, ChessColor color) {
    auto p = b.at(Square::parse(square)); require(p && p->type == type && p->color == color, "Piece at " + square);
}
std::uint64_t perft(const BoardState& b, int depth) {
    if (depth == 0) return 1;
    auto moves = b.legalMoves();
    if (depth == 1) return moves.size();
    std::uint64_t count = 0;
    for (const auto& m : moves) count += perft(b.play(m), depth - 1);
    return count;
}
void typesAndFen() {
    require(Square::parse("a1").index() == 0 && Square::parse("h8").index() == 63, "Square indices");
    require(Square(3, 4).str() == "d5", "Square format");
    rejects([] { Square(-1, 0); }); rejects([] { Square::parse("i3"); }); rejects([] { Square::parse("a0"); });
    require(opposite(ChessColor::White) == ChessColor::Black, "Colors");
    auto b = BoardState::initial();
    require(b.fen() == "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", "Initial FEN");
    require(b.legalMoves().size() == 20, "Initial moves");
    int count = 0; for (auto p : b.squares) if (p) ++count;
    require(count == 32, "Initial pieces");
    piece(b, "e1", PieceType::King, ChessColor::White); piece(b, "d8", PieceType::Queen, ChessColor::Black);
    b = play(b, "e2e4");
    require(b.fen() == "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1", "Double pawn FEN");
    require(fen(b.fen()).fen() == b.fen(), "FEN round trip");
    for (const auto& s : std::vector<std::string>{
        "", "8/8/8/8/8/8/8/8 w - - 0 1", "4k3/8/8/8/8/8/8/4K3 w - - -1 1",
        "4k3/8/8/8/8/8/8/4K3 x - - 0 1", "4k3/8/8/8/8/8/8/4K3 w K - 0 1",
        "4k3/8/8/8/8/8/8/4K3 w - a3 0 1", "4k3/8/8/8/8/8/8/4K3 w - - 0 0",
        "4k3/8/8/8/8/8/8/4K3 w - - 0 1 extra", "4k3/8/8/8/8/8/8/4K3 w - - 18446744073709551616 1",
        "4k3/8/8/8/8/8/4K3/4K3 w - - 0 1", "4k3/8/8/8/8/8/8/P3K3 w - - 0 1",
        "8/8/8/8/8/8/4k3/4K3 w - - 0 1", "4k3/8/8/8/8/8/8/4R1K1 w - - 0 1",
        "4k3/8/8/8/8/8/8/4K3/8 w - - 0 1", "4k3/8/8/8/8/8/8/9K w - - 0 1",
        "r3k2r/8/8/8/8/8/8/R3K2R w KK - 0 1"}) rejects([&] { fen(s); });
    for (auto s : {"e2e", "e2e44", "a7a8k", "a7a8Q", "z2a4"}) rejects([&] { Move::parse(s); });
}
void movements() {
    auto b = BoardState::initial();
    for (auto m : {"e2e3", "e2e4", "b1a3", "b1c3", "g1f3", "g1h3"}) legal(b, m);
    for (auto m : {"e2e5", "e2d3", "e2e1", "e7e5", "a1a3", "c1h6", "d1d4", "e1e2", "b1b3", "b1d2", "e2e2"}) legal(b, m, false);
    b = play(b, "e2e4"); legal(b, "e7e5"); legal(b, "e7e6"); legal(b, "e7e4", false);
    b = play(b, "a7a6"); legal(b, "e4e6", false); legal(b, "e4e5");
    auto blocked = fen("4k3/8/8/8/8/4n3/4P3/4K3 w - - 0 1");
    legal(blocked, "e2e3", false); legal(blocked, "e2e4", false);
    auto bishop = fen("8/8/7k/8/3B4/8/8/K7 w - - 0 1");
    legal(bishop, "d4g7"); legal(bishop, "d4a7"); legal(bishop, "d4d5", false);
    auto rook = fen("7k/8/8/8/3R4/8/8/K7 w - - 0 1");
    legal(rook, "d4d8"); legal(rook, "d4h4"); legal(rook, "d4e5", false);
    auto queen = fen("8/8/7k/8/3Q4/8/8/1K6 w - - 0 1");
    legal(queen, "d4g7"); legal(queen, "d4d8"); legal(queen, "d4h4"); legal(queen, "d4f5", false);
    auto king = fen("7k/8/8/8/3K4/8/8/8 w - - 0 1");
    require(king.legalMoves().size() == 8, "King eight directions"); legal(king, "d4f4", false);
    auto adjacent = fen("8/8/8/4k3/8/4K3/8/8 w - - 0 1"); legal(adjacent, "e3e4", false);
    auto knight = fen("7k/8/8/2PPP3/2PNP3/2PPP3/8/K7 w - - 0 1");
    for (auto m : {"d4b3", "d4b5", "d4c2", "d4c6", "d4e2", "d4e6", "d4f3", "d4f5"}) legal(knight, m);
}
void captures() {
    auto b = fen("7k/8/8/2p1p3/3P4/8/8/K7 w - - 9 1");
    legal(b, "d4c5"); legal(b, "d4e5"); legal(b, "d4c3", false);
    auto c = play(b, "d4e5"); piece(c, "e5", PieceType::Pawn, ChessColor::White);
    require(!c.at(Square::parse("d4")) && c.halfmoveClock == 0, "Capture removes origin and resets clock");
    auto black = fen("7k/8/8/8/3p4/2P1P3/8/K7 b - - 7 1"); legal(black, "d4c3"); legal(black, "d4e3");
    const std::vector<std::pair<std::string, std::string>> fixtures = {
        {"7k/8/8/4p3/3B4/8/8/K7 w - - 6 1", "d4e5"},
        {"7k/8/8/3p4/3R4/8/8/K7 w - - 6 1", "d4d5"},
        {"8/8/7k/3p4/3Q4/8/8/K7 w - - 6 1", "d4d5"},
        {"7k/8/4p3/8/3N4/8/8/K7 w - - 6 1", "d4e6"},
        {"7k/8/8/3p4/3K4/8/8/8 w - - 6 1", "d4d5"}
    };
    for (const auto& fixture : fixtures) { auto x = play(fen(fixture.first), fixture.second); require(x.halfmoveClock == 0, "Capture clock"); }
    auto blockers = fen("7k/8/3p4/3P4/3R4/8/8/K7 w - - 0 1");
    legal(blockers, "d4d5", false); legal(blockers, "d4d6", false);
    auto enemyBlock = fen("7k/8/3p4/3p4/3R4/8/8/K7 w - - 0 1"); legal(enemyBlock, "d4d5"); legal(enemyBlock, "d4d6", false);
    auto unsafeKing = fen("7k/8/3r4/3p4/3K4/8/8/8 w - - 0 1"); legal(unsafeKing, "d4d5", false);
}
void promotions() {
    for (auto suffix : {"q", "r", "b", "n"}) {
        auto b = fen("7k/P7/8/8/8/8/8/7K w - - 0 1");
        auto m = Move::parse(std::string("a7a8") + suffix); legal(b, m.uci());
        auto c = b.play(m); piece(c, "a8", *m.promotion, ChessColor::White);
        require(c.halfmoveClock == 0, "Promotion clock");
        auto black = fen("7k/8/8/8/8/8/p7/7K b - - 0 1"); legal(black, std::string("a2a1") + suffix);
        auto capture = fen("1r5k/P7/8/8/8/8/8/7K w - - 0 1"); legal(capture, std::string("a7b8") + suffix);
    }
    auto b = fen("7k/P7/8/8/8/8/8/7K w - - 0 1"); legal(b, "a7a8", false);
    legal(BoardState::initial(), "e2e4q", false);
}
void castling() {
    const std::string position = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
    auto b = fen(position); legal(b, "e1g1"); legal(b, "e1c1");
    auto ks = play(b, "e1g1"); piece(ks, "g1", PieceType::King, ChessColor::White); piece(ks, "f1", PieceType::Rook, ChessColor::White);
    require(!ks.at(Square::parse("h1")) && ks.castling == 12 && ks.halfmoveClock == 1, "Kingside state");
    auto qs = play(b, "e1c1"); piece(qs, "c1", PieceType::King, ChessColor::White); piece(qs, "d1", PieceType::Rook, ChessColor::White);
    auto black = fen("r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1");
    legal(black, "e8g8"); legal(black, "e8c8"); piece(play(black, "e8c8"), "d8", PieceType::Rook, ChessColor::Black);
    legal(fen("r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1"), "e1g1", false);
    legal(fen("4kr2/8/8/8/8/8/8/4K2R w K - 0 1"), "e1g1", false); // through check
    legal(fen("4k1r1/8/8/8/8/8/8/4K2R w K - 0 1"), "e1g1", false); // into check
    legal(fen("k3r3/8/8/8/8/8/8/4K2R w K - 0 1"), "e1g1", false); // in check
    legal(fen("4k3/8/8/8/8/8/8/RN2K3 w Q - 0 1"), "e1c1", false); // b-file must be empty
    legal(fen("1r2k3/8/8/8/8/8/8/R3K3 w Q - 0 1"), "e1c1"); // b-file may be attacked
    require((play(b, "h1h2").castling & 1) == 0, "Rook move clears right");
    require((play(b, "e1e2").castling & 3) == 0, "King move clears rights");
    require((play(b, "a1a8").castling & 10) == 0, "Rook capture clears both corner rights");
    b = play(b, "h1h2"); b = play(b, "h8h7"); b = play(b, "h2h1"); b = play(b, "h7h8"); legal(b, "e1g1", false);
}
void enPassant() {
    auto b = fen("7k/8/8/3pP3/8/8/8/K7 w - d6 0 2"); legal(b, "e5d6");
    auto c = play(b, "e5d6"); piece(c, "d6", PieceType::Pawn, ChessColor::White);
    require(!c.at(Square::parse("d5")) && !c.enPassant && c.halfmoveClock == 0, "EP capture state");
    auto black = fen("7k/8/8/8/3Pp3/8/8/K7 b - d3 0 2"); legal(black, "e4d3");
    piece(play(black, "e4d3"), "d3", PieceType::Pawn, ChessColor::Black);
    b = play(b, "a1a2"); b = play(b, "h8h7"); legal(b, "e5d6", false);
    auto pinned = fen("7k/8/8/r4pPK/8/8/8/8 w - f6 0 2"); legal(pinned, "g5f6", false);
    auto evasion = fen("7k/8/8/3pP3/4K3/8/8/8 w - d6 0 2"); require(evasion.inCheck(ChessColor::White), "Pawn check"); legal(evasion, "e5d6");
}
void checkAndMate() {
    auto pinned = fen("4r2k/8/8/8/8/8/4R3/4K3 w - - 0 1");
    legal(pinned, "e2d2", false); legal(pinned, "e2e8"); legal(pinned, "e2e3");
    auto check = fen("4r2k/8/8/8/8/8/8/4K3 w - - 0 1"); require(check.inCheck(ChessColor::White), "Rook check"); require(!check.checkmate(), "Check is not mate");
    auto knight = fen("7k/8/8/8/8/5n2/8/4K3 w - - 0 1"); require(knight.inCheck(ChessColor::White), "Knight check");
    auto bishop = fen("7k/8/8/8/1b6/8/8/4K3 w - - 0 1"); require(bishop.inCheck(ChessColor::White), "Bishop check");
    auto doubleCheck = fen("4r2k/8/8/8/1b6/8/R7/4K3 w - - 0 1");
    for (auto m : doubleCheck.legalMoves()) require(m.from == Square::parse("e1"), "Double check needs king move");
    Game fools;
    for (auto m : {"f2f3", "e7e5", "g2g4", "d8h4"}) fools.play(Move::parse(m));
    require(fools.board().checkmate() && !fools.board().stalemate(), "Fool's mate");
    auto blackMate = fen("7k/6Q1/5K2/8/8/8/8/8 b - - 0 1"); require(blackMate.checkmate(), "Black mated");
    auto stalemate = fen("7k/5K2/6Q1/8/8/8/8/8 b - - 0 1"); require(stalemate.stalemate() && !stalemate.checkmate(), "Stalemate");
    require(!BoardState::initial().inCheck(ChessColor::White), "Initial no check");
    // A pinned enemy piece still attacks squares for king movement.
    auto pinnedAttack = fen("4k3/4n3/8/6K1/8/8/8/4R3 w - - 0 1"); legal(pinnedAttack, "g5f5", false);
}
void material() {
    for (const auto& s : {"7k/8/8/8/8/8/8/K7 w - - 0 1", "7k/8/8/8/8/8/8/KN6 w - - 0 1",
        "7k/8/8/8/8/8/8/KB6 w - - 0 1", "5b1k/8/8/8/8/8/8/K1B5 w - - 0 1",
        "7k/8/8/8/8/4B3/8/K1B5 w - - 0 1"}) require(fen(s).insufficientMaterial(), "Dead material");
    for (const auto& s : {"7k/8/8/8/8/8/8/KNN5 w - - 0 1", "7k/8/8/8/8/8/8/KNB5 w - - 0 1",
        "6bk/8/8/8/8/8/8/K1B5 w - - 0 1", "7k/8/8/8/8/8/P7/K7 w - - 0 1",
        "7k/8/8/8/8/8/8/KR6 w - - 0 1"}) require(!fen(s).insufficientMaterial(), "Possible mating material");
}
void repetition() {
    Game g; require(g.repetitionCount() == 1, "Initial history");
    for (int n = 0; n < 2; ++n) {
        for (auto m : {"g1f3", "g8f6", "f3g1", "f6g8"}) g.play(Move::parse(m));
        require(g.repetitionCount() == static_cast<unsigned>(n + 2), "Cycle count");
        require(g.threefoldClaimable() == (n == 1), "Threefold threshold");
    }
    auto a = fen("7k/8/8/3pP3/8/8/8/K7 w - d6 0 2");
    auto b = a; b.enPassant.reset(); require(a.repetitionKey() != b.repetitionKey(), "Legal EP changes identity");
    a = fen("7k/8/8/r4pPK/8/8/8/8 w - f6 0 2"); b = a; b.enPassant.reset();
    require(a.repetitionKey() == b.repetitionKey(), "Pinned EP ignored in identity");
    a = play(BoardState::initial(), "e2e4"); b = a; b.enPassant.reset(); require(a.repetitionKey() == b.repetitionKey(), "Uncapturable EP ignored");
    a = BoardState::initial(); b = a; b.castling = 0; require(a.repetitionKey() != b.repetitionKey(), "Castling identity");
    b = a; b.turn = ChessColor::Black; require(a.repetitionKey() != b.repetitionKey(), "Turn identity");
    b = a; b.fullmoveNumber = 9; b.halfmoveClock = 14; require(a.repetitionKey() == b.repetitionKey(), "Clocks ignored");
    std::string before = g.board().fen(); rejects([&] { g.play(Move::parse("e2e5")); }); require(before == g.board().fen() && g.repetitionCount() == 3, "Rejected move atomic");
}
void fiftyMoves() {
    auto b = fen("7k/8/8/8/8/8/P7/KN6 w - - 99 50");
    require(!b.fiftyMoveClaimable(), "99 halfmoves"); auto c = play(b, "b1c3");
    require(c.fiftyMoveClaimable() && c.halfmoveClock == 100 && c.fullmoveNumber == 50, "100 halfmoves");
    c = play(c, "h8g8"); require(c.fullmoveNumber == 51 && c.halfmoveClock == 101, "Black increments fullmove");
    require(play(b, "a2a3").halfmoveClock == 0, "Pawn resets clock");
    b = fen("7k/8/8/8/8/2p5/8/KN6 w - - 99 50"); require(!play(b, "b1c3").fiftyMoveClaimable(), "Capture resets clock");
}
void moveCounts() {
    auto initial = BoardState::initial();
    require(perft(initial, 2) == 400, "Initial perft 2");
    require(perft(initial, 3) == 8902, "Initial perft 3");
    require(perft(initial, 4) == 197281, "Initial perft 4");
    auto kiwipete = fen("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1");
    require(perft(kiwipete, 1) == 48, "Kiwipete perft 1");
    require(perft(kiwipete, 2) == 2039, "Kiwipete perft 2");
    require(perft(kiwipete, 3) == 97862, "Kiwipete perft 3");
    auto endgame = fen("8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1");
    require(perft(endgame, 3) == 2812, "EP/rook endgame perft 3");
    auto promotion = fen("r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1");
    require(perft(promotion, 3) == 9467, "Promotion perft 3");
}
}
int main() {
    std::vector<std::pair<std::string, std::function<void()>>> suites = {
        {"CHESS-01..08 types / FEN", typesAndFen}, {"CHESS-28 movements", movements},
        {"CHESS-29 captures", captures}, {"CHESS-30 promotion", promotions}, {"CHESS-31 castling", castling},
        {"CHESS-32 en passant", enPassant}, {"CHESS-33/34 check and mate; CHESS-22 stalemate", checkAndMate},
        {"CHESS-23 material", material}, {"CHESS-36 repetition", repetition}, {"CHESS-37 fifty moves", fiftyMoves},
        {"CHESS-27 reference perft", moveCounts}};
    int failed = 0;
    for (const auto& suite : suites) {
        try { suite.second(); std::cout << "PASS " << suite.first << '\n'; }
        catch (const std::exception& e) { ++failed; std::cerr << "FAIL " << suite.first << ": " << e.what() << '\n'; }
    }
    std::cout << checks << " checks, " << failed << " failed suites\n";
    return failed ? 1 : 0;
}

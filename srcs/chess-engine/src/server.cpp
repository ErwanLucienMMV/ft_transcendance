#include "chess/protocol.hpp"
#include <boost/asio.hpp>
#include <boost/beast.hpp>
#include <csignal>
#include <cstdlib>
#include <iostream>
#include <memory>
#include <string>

namespace asio = boost::asio;
namespace beast = boost::beast;
namespace websocket = beast::websocket;
using tcp = asio::ip::tcp;

namespace {
// Single event loop: asynchronous idle sockets do not consume worker threads.
class Session : public std::enable_shared_from_this<Session> {
    websocket::stream<beast::tcp_stream> ws_;
    beast::flat_buffer input_;
    std::string output_;
    std::size_t& connections_;
public:
    Session(tcp::socket socket, std::size_t& connections) : ws_(std::move(socket)), connections_(connections) { ++connections_; }
    ~Session() { --connections_; }
    void start() {
        auto timeout = websocket::stream_base::timeout::suggested(beast::role_type::server);
        timeout.handshake_timeout = std::chrono::seconds(10);
        timeout.idle_timeout = std::chrono::seconds(60);
        timeout.keep_alive_pings = true;
        ws_.set_option(timeout);
        ws_.read_message_max(131072);
        ws_.async_accept([self = shared_from_this()](beast::error_code ec) { if (!ec) self->read(); });
    }
private:
    void read() {
        ws_.async_read(input_, [self = shared_from_this()](beast::error_code ec, std::size_t) {
            if (ec) return;
            if (!self->ws_.got_text()) {
                self->ws_.async_close(websocket::close_code::unknown_data, [self](beast::error_code) {});
                return;
            }
            self->output_ = chess::handleRequest(beast::buffers_to_string(self->input_.data()));
            self->input_.consume(self->input_.size());
            self->ws_.text(true);
            self->ws_.async_write(asio::buffer(self->output_), [self](beast::error_code error, std::size_t) { if (!error) self->read(); });
        });
    }
};
class Listener {
    tcp::acceptor acceptor_;
    std::size_t& connections_;
public:
    Listener(asio::io_context& io, tcp::endpoint endpoint, std::size_t& count) : acceptor_(io), connections_(count) {
        acceptor_.open(endpoint.protocol());
        acceptor_.set_option(asio::socket_base::reuse_address(true));
        acceptor_.bind(endpoint); acceptor_.listen();
    }
    void accept() {
        acceptor_.async_accept([this](beast::error_code ec, tcp::socket socket) {
            if (!ec && connections_ < 256) std::make_shared<Session>(std::move(socket), connections_)->start();
            if (acceptor_.is_open()) accept();
        });
    }
};
}
int main(int argc, char** argv) {
    try {
        std::string host = std::getenv("CHESS_ENGINE_HOST") ? std::getenv("CHESS_ENGINE_HOST") : "127.0.0.1";
        std::string portText = std::getenv("CHESS_ENGINE_PORT") ? std::getenv("CHESS_ENGINE_PORT") : "8081";
        for (int i = 1; i < argc; ++i) {
            std::string arg = argv[i];
            if (arg == "--help") { std::cout << "chess_engine [--host IP] [--port PORT]\n"; return 0; }
            if ((arg == "--host" || arg == "--port") && i + 1 < argc) {
                (arg == "--host" ? host : portText) = argv[++i];
            } else throw std::invalid_argument("Unknown or incomplete argument: " + arg);
        }
        if (portText.empty() || portText.find_first_not_of("0123456789") != std::string::npos) throw std::invalid_argument("Invalid port");
        unsigned long port = std::stoul(portText);
        if (!port || port > 65535) throw std::invalid_argument("Port must be 1..65535");
        // Count must outlive io_context and its outstanding session handlers.
        std::size_t connections = 0;
        asio::io_context io(1);
        Listener listener(io, {asio::ip::make_address(host), static_cast<unsigned short>(port)}, connections);
        asio::signal_set signals(io, SIGINT, SIGTERM);
        signals.async_wait([&io](beast::error_code, int) { io.stop(); });
        listener.accept();
        std::cout << "chess_engine listening on ws://" << host << ':' << port << std::endl;
        io.run();
    } catch (const std::exception& e) { std::cerr << "chess_engine: " << e.what() << '\n'; return 1; }
}

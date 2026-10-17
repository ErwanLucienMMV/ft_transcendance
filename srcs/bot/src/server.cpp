#include "bot/engine.hpp"
#include <boost/asio.hpp>
#include <boost/beast.hpp>
#include <csignal>
#include <cstdlib>
#include <iostream>
#include <memory>
#include <string>
namespace asio = boost::asio;
namespace beast = boost::beast;
namespace ws = beast::websocket;
using tcp = asio::ip::tcp;
namespace {
struct Runtime {
    asio::io_context io{1};
    asio::thread_pool workers{2};
    std::size_t connections = 0, pending = 0;
};
class Session : public std::enable_shared_from_this<Session> {
    Runtime& runtime_;
    ws::stream<beast::tcp_stream> socket_;
    beast::flat_buffer input_;
    std::string output_;
public:
    Session(Runtime& r, tcp::socket socket) : runtime_(r), socket_(std::move(socket)) { ++runtime_.connections; }
    ~Session() { --runtime_.connections; }
    void start() {
        auto timeout = ws::stream_base::timeout::suggested(beast::role_type::server);
        timeout.handshake_timeout = std::chrono::seconds(10);
        timeout.idle_timeout = std::chrono::seconds(60);
        timeout.keep_alive_pings = true;
        socket_.set_option(timeout);
        socket_.read_message_max(131072);
        socket_.async_accept([self = shared_from_this()](beast::error_code ec) { if (!ec) self->read(); });
    }
private:
    void send(std::string response) {
        output_ = std::move(response);
        socket_.text(true);
        socket_.async_write(asio::buffer(output_), [self = shared_from_this()](beast::error_code ec, std::size_t) { if (!ec) self->read(); });
    }
    void read() {
        socket_.async_read(input_, [self = shared_from_this()](beast::error_code ec, std::size_t) {
            if (ec) return;
            if (!self->socket_.got_text()) {
                self->socket_.async_close(ws::close_code::unknown_data, [self](beast::error_code) {}); return;
            }
            auto text = beast::buffers_to_string(self->input_.data());
            self->input_.consume(self->input_.size());
            if (self->runtime_.pending >= 4) {
                // Close explicitly rather than return an uncorrelated response.
                self->socket_.async_close(ws::close_reason(ws::close_code::try_again_later), [self](beast::error_code) {});
                return;
            }
            ++self->runtime_.pending;
            asio::post(self->runtime_.workers, [self, text = std::move(text)] {
                auto response = bot::handleRequest(text);
                asio::post(self->runtime_.io, [self, response = std::move(response)]() mutable {
                    --self->runtime_.pending;
                    self->send(std::move(response));
                });
            });
        });
    }
};
class Listener {
    Runtime& runtime_;
    tcp::acceptor acceptor_;
public:
    Listener(Runtime& r, tcp::endpoint endpoint) : runtime_(r), acceptor_(r.io) {
        acceptor_.open(endpoint.protocol()); acceptor_.set_option(asio::socket_base::reuse_address(true));
        acceptor_.bind(endpoint); acceptor_.listen();
    }
    void start() {
        acceptor_.async_accept([this](beast::error_code ec, tcp::socket socket) {
            if (!ec && runtime_.connections < 64) std::make_shared<Session>(runtime_, std::move(socket))->start();
            if (acceptor_.is_open()) start();
        });
    }
};
}
int main(int argc, char** argv) {
    try {
        std::string host = std::getenv("BOT_HOST") ? std::getenv("BOT_HOST") : "127.0.0.1";
        std::string portText = std::getenv("BOT_PORT") ? std::getenv("BOT_PORT") : "8082";
        for (int i = 1; i < argc; ++i) {
            std::string arg = argv[i];
            if (arg == "--help") { std::cout << "chess_bot [--host IP] [--port PORT]\n"; return 0; }
            if ((arg == "--host" || arg == "--port") && i + 1 < argc) (arg == "--host" ? host : portText) = argv[++i];
            else throw std::invalid_argument("Invalid command line");
        }
        if (portText.empty() || portText.find_first_not_of("0123456789") != std::string::npos) throw std::invalid_argument("Invalid port");
        auto port = std::stoul(portText); if (!port || port > 65535) throw std::invalid_argument("Port must be 1..65535");
        Runtime runtime;
        Listener listener(runtime, {asio::ip::make_address(host), static_cast<unsigned short>(port)});
        asio::signal_set signals(runtime.io, SIGINT, SIGTERM);
        signals.async_wait([&](beast::error_code, int) { runtime.io.stop(); });
        listener.start();
        std::cout << "chess_bot listening on ws://" << host << ':' << port << std::endl;
        runtime.io.run();
        runtime.workers.join(); // finish bounded in-flight work before destroying io/sessions
    } catch (const std::exception& e) { std::cerr << "chess_bot: " << e.what() << '\n'; return 1; }
}

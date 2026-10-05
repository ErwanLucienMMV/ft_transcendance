#include "chess/server.hpp"

#include <boost/asio.hpp>
#include <boost/beast.hpp>

#include <csignal>
#include <cstdlib>
#include <iostream>
#include <stdexcept>
#include <string>

namespace asio = boost::asio;
namespace beast = boost::beast;

int main(int argc, char** argv) {
    try {
        const char* hostEnv = std::getenv("CHESS_ENGINE_HOST");
        const char* portEnv = std::getenv("CHESS_ENGINE_PORT");

        std::string host = hostEnv ? hostEnv : "127.0.0.1";
        std::string portText = portEnv ? portEnv : "8081";

        for (int i = 1; i < argc; ++i) {
            const std::string arg = argv[i];

            if (arg == "--help") {
                std::cout
                    << "chess_engine [--host IP] [--port PORT]\n";

                return 0;
            }

            if ((arg == "--host" || arg == "--port") &&
                i + 1 < argc) {
                if (arg == "--host") {
                    host = argv[++i];
                } else {
                    portText = argv[++i];
                }
            } else {
                throw std::invalid_argument(
                    "Unknown or incomplete argument: " + arg
                );
            }
        }

        if (
            portText.empty() ||
            portText.find_first_not_of("0123456789") !=
                std::string::npos
        ) {
            throw std::invalid_argument("Invalid port");
        }

        const unsigned long port = std::stoul(portText);

        if (port == 0 || port > 65535) {
            throw std::invalid_argument(
                "Port must be 1..65535"
            );
        }

        asio::io_context io(1);

        chess::Server server(
            io,
            {
                asio::ip::make_address(host),
                static_cast<unsigned short>(port)
            }
        );

        asio::signal_set signals(io, SIGINT, SIGTERM);

        signals.async_wait(
            [&io](beast::error_code, int) {
                io.stop();
            }
        );

        server.start();

        std::cout
            << "chess_engine listening on ws://"
            << host
            << ':'
            << port
            << '\n';

        io.run();

    } catch (const std::exception& e) {
        std::cerr
            << "chess_engine: "
            << e.what()
            << '\n';

        return 1;
    }
}
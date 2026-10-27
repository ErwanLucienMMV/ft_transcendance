#include "bot/listener.hpp"

#include <csignal>
#include <cstdlib>
#include <iostream>
#include <stdexcept>
#include <string>

namespace asio = boost::asio;

int main(int argc, char **argv)
{
	try {
		std::string host = std::getenv("BOT_HOST") ? std::getenv("BOT_HOST") : "127.0.0.1";
		std::string portText = std::getenv("BOT_PORT") ? std::getenv("BOT_PORT") : "8082";
		for (int i = 1; i < argc; ++i) {
			std::string arg = argv[i];
			if (arg == "--help") {
				std::cout << "chess_bot [--host IP] [--port PORT]\n";

				return 0;
			}
			if ((arg == "--host" || arg == "--port") && i + 1 < argc) {
				if (arg == "--host") {
					host = argv[++i];
				} else {
					portText = argv[++i];
				}
			} else {
				throw std::invalid_argument("Invalid command line");
			}
		}
		if (portText.empty() || portText.find_first_not_of("0123456789") != std::string::npos) {
			throw std::invalid_argument("Invalid port");
		}
		auto port = std::stoul(portText);
		if (!port || port > 65535) {
			throw std::invalid_argument("Port must be 1..65535");
		}
		bot::Runtime runtime;
		bot::Listener listener(
			runtime, {asio::ip::make_address(host), static_cast<unsigned short>(port)});
		asio::signal_set signals(runtime.io, SIGINT, SIGTERM);
		signals.async_wait([&](boost::system::error_code, int) {
			runtime.io.stop();
		});
		listener.start();
		std::cout << "chess_bot listening on ws://" << host << ':' << port << std::endl;
		runtime.io.run();
		runtime.workers.join(); // finish bounded in-flight work before destroying io/sessions
	} catch (const std::exception &e) {
		std::cerr << "chess_bot: " << e.what() << '\n';

		return 1;
	}

	return 0;
}

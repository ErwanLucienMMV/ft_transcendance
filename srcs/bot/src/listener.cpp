#include "bot/listener.hpp"

#include "bot/session.hpp"

#include <utility>

namespace asio = boost::asio;
namespace beast = boost::beast;
namespace ws = beast::websocket;
using tcp = asio::ip::tcp;

namespace bot {

Listener::Listener(Runtime &runtime, tcp::endpoint endpoint)
	: runtime_(runtime), acceptor_(runtime.io)
{
	acceptor_.open(endpoint.protocol());
	acceptor_.set_option(asio::socket_base::reuse_address(true));
	acceptor_.bind(endpoint);
	acceptor_.listen();
}

void Listener::start()
{
	acceptor_.async_accept([this](beast::error_code ec, tcp::socket socket) {
		if (!ec && runtime_.connections < 64) {
			std::make_shared<Session>(runtime_, std::move(socket))->start();
		}
		if (acceptor_.is_open()) {
			start();
		}
	});
}

} // namespace bot

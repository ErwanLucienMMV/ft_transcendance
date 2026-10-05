#include "chess/listener.hpp"

#include "chess/session.hpp"

#include <boost/asio.hpp>
#include <boost/beast.hpp>

#include <memory>
#include <utility>

namespace asio = boost::asio;
namespace beast = boost::beast;

namespace chess {

Listener::Listener(
	asio::io_context& io,
	asio::ip::tcp::endpoint endpoint,
	std::size_t& connections
)
	: acceptor_(io),
	  connections_(connections) {
	acceptor_.open(endpoint.protocol());

	acceptor_.set_option(
		asio::socket_base::reuse_address(true)
	);

	acceptor_.bind(endpoint);
	acceptor_.listen();
}

void Listener::start() {
	accept();
}

void Listener::accept() {
	acceptor_.async_accept(
		[this](
			beast::error_code ec,
			asio::ip::tcp::socket socket
		) {
			if (!ec && connections_ < 256) {
				std::make_shared<Session>(
					std::move(socket),
					connections_
				)->start();
			}

			if (acceptor_.is_open()) {
				accept();
			}
		}
	);
}

} // namespace chess
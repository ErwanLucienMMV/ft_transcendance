#include "chess/session.hpp"

#include "chess/protocol.hpp"

#include <boost/asio.hpp>
#include <boost/beast.hpp>

#include <chrono>
#include <utility>

namespace asio = boost::asio;
namespace beast = boost::beast;
namespace websocket = beast::websocket;

namespace chess {

Session::Session(
	asio::ip::tcp::socket socket,
	std::size_t& connections
)
	: ws_(std::move(socket)),
	  connections_(connections) {
	++connections_;
}

Session::~Session() {
	--connections_;
}

void Session::start() {
	auto timeout =
		websocket::stream_base::timeout::suggested(
			beast::role_type::server
		);

	timeout.handshake_timeout = std::chrono::seconds(10);
	timeout.idle_timeout = std::chrono::seconds(60);
	timeout.keep_alive_pings = true;

	ws_.set_option(timeout);
	ws_.read_message_max(131072);

	ws_.async_accept(
		[self = shared_from_this()](beast::error_code ec) {
			if (!ec) {
				self->read();
			}
		}
	);
}

void Session::read() {
	ws_.async_read(
		input_,
		[self = shared_from_this()](
			beast::error_code ec,
			std::size_t
		) {
			if (ec) {
				return;
			}

			if (!self->ws_.got_text()) {
				self->ws_.async_close(
					websocket::close_code::unknown_data,
					[self](beast::error_code) {}
				);

				return;
			}

			self->output_ = handleRequest(
				beast::buffers_to_string(
					self->input_.data()
				)
			);

			self->input_.consume(
				self->input_.size()
			);

			self->ws_.text(true);

			self->ws_.async_write(
				asio::buffer(self->output_),
				[self](
					beast::error_code error,
					std::size_t
				) {
					if (!error) {
						self->read();
					}
				}
			);
		}
	);
}

} // namespace chess
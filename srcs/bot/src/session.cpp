#include "bot/session.hpp"

#include "bot/protocol.hpp"

#include <utility>

namespace asio = boost::asio;
namespace beast = boost::beast;
namespace ws = beast::websocket;
using tcp = asio::ip::tcp;

namespace bot {

Session::Session(Runtime &runtime, tcp::socket socket)
	: runtime_(runtime), socket_(std::move(socket))
{
	++runtime_.connections;
}

Session::~Session()
{
	--runtime_.connections;
}

void Session::start()
{
	auto timeout = ws::stream_base::timeout::suggested(beast::role_type::server);
	timeout.handshake_timeout = std::chrono::seconds(10);
	timeout.idle_timeout = std::chrono::seconds(60);
	timeout.keep_alive_pings = true;
	socket_.set_option(timeout);
	socket_.read_message_max(131072);
	socket_.async_accept([self = shared_from_this()](beast::error_code ec) {
		if (!ec) {
			self->read();
		}
	});
}

void Session::send(std::string response)
{
	output_ = std::move(response);
	socket_.text(true);
	socket_.async_write(
		asio::buffer(output_), [self = shared_from_this()](beast::error_code ec, std::size_t) {
			if (!ec) {
				self->read();
			}
		});
}

void Session::read()
{
	socket_.async_read(input_, [self = shared_from_this()](beast::error_code error, std::size_t) {
		self->onRead(error);
	});
}

void Session::onRead(beast::error_code error)
{
	if (error) {
		return;
	}
	if (!socket_.got_text()) {
		close(ws::close_code::unknown_data);
		return;
	}

	auto request = beast::buffers_to_string(input_.data());
	input_.consume(input_.size());

	if (runtime_.pending >= 4) {
		close(ws::close_code::try_again_later);
		return;
	}
	queueSearch(std::move(request));
}

void Session::queueSearch(std::string request)
{
	++runtime_.pending;
	asio::post(runtime_.workers, [self = shared_from_this(), request = std::move(request)] {
		auto response = handleRequest(request);
		asio::post(self->runtime_.io, [self, response = std::move(response)]() mutable {
			--self->runtime_.pending;
			self->send(std::move(response));
		});
	});
}

void Session::close(ws::close_code reason)
{
	socket_.async_close(
		ws::close_reason(reason), [self = shared_from_this()](beast::error_code) {});
}

} // namespace bot

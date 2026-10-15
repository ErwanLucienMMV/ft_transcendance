#pragma once

#include <boost/asio/ip/tcp.hpp>
#include <boost/beast/core/flat_buffer.hpp>
#include <boost/beast/core/tcp_stream.hpp>
#include <boost/beast/websocket/stream.hpp>

#include <cstddef>
#include <memory>
#include <string>

namespace chess {

class Session : public std::enable_shared_from_this<Session> {
public:
	Session(
		boost::asio::ip::tcp::socket socket,
		std::size_t& connections
	);

	~Session();

	void start();

private:
	void read();

private:
	boost::beast::websocket::stream<
		boost::beast::tcp_stream
	> ws_;

	boost::beast::flat_buffer input_;
	std::string output_;

	std::size_t& connections_;
};

} // namespace chess
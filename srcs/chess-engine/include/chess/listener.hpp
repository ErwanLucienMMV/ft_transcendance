#pragma once

#include <boost/asio/ip/tcp.hpp>

#include <cstddef>

namespace chess {

class Listener {
public:
	Listener(
		boost::asio::io_context& io,
		boost::asio::ip::tcp::endpoint endpoint,
		std::size_t& connections
	);

	void start();

private:
	void accept();

private:
	boost::asio::ip::tcp::acceptor acceptor_;
	std::size_t& connections_;
};

} // namespace chess
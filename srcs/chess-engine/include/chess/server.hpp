#pragma once

#include <boost/asio/io_context.hpp>
#include <boost/asio/ip/tcp.hpp>

#include <cstddef>
#include <memory>

namespace chess {

class Listener;

class Server {
public:
	Server(
		boost::asio::io_context& io,
		boost::asio::ip::tcp::endpoint endpoint
	);

	~Server();

	void start();

	std::size_t connectionCount() const noexcept;

private:
	std::size_t connections_ = 0;
	std::unique_ptr<Listener> listener_;
};

} // namespace chess
#pragma once
#include <boost/asio.hpp>
#include <cstddef>

namespace bot {
struct Runtime {
	// Counters outlive the io_context's pending session handlers.
	std::size_t connections = 0;
	std::size_t pending = 0;
	boost::asio::io_context io{1};
	boost::asio::thread_pool workers{2};
};
} // namespace bot

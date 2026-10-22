#pragma once
#include "bot/runtime.hpp"

namespace bot {
class Listener {
public:
	Listener(Runtime &runtime, boost::asio::ip::tcp::endpoint endpoint);
	void start();

private:
	Runtime &runtime_;
	boost::asio::ip::tcp::acceptor acceptor_;
};
} // namespace bot

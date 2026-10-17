#pragma once
#include "bot/runtime.hpp"

#include <boost/beast.hpp>
#include <memory>
#include <string>

namespace bot {
class Session : public std::enable_shared_from_this<Session> {
public:
	Session(Runtime &runtime, boost::asio::ip::tcp::socket socket);
	~Session();
	void start();

private:
	void send(std::string response);
	void read();
	void onRead(boost::beast::error_code error);
	void queueSearch(std::string request);
	void close(boost::beast::websocket::close_code reason);

	Runtime &runtime_;
	boost::beast::websocket::stream<boost::beast::tcp_stream> socket_;
	boost::beast::flat_buffer input_;
	std::string output_;
};
} // namespace bot

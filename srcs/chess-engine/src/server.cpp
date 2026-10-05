#include "chess/server.hpp"

#include "chess/listener.hpp"

#include <memory>
#include <utility>

namespace chess {

Server::Server(
    boost::asio::io_context& io,
    boost::asio::ip::tcp::endpoint endpoint
)
    : listener_(
        std::make_unique<Listener>(
            io,
            endpoint,
            connections_
        )
    ) {
}

Server::~Server() = default;

void Server::start() {
    listener_->start();
}

std::size_t Server::connectionCount() const noexcept {
    return connections_;
}

} // namespace chess
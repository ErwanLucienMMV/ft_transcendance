#pragma once
#include <string>
namespace chess {
	// One JSON request and one JSON response. No process-global game state.
	std::string handleRequest(const std::string& request);
}

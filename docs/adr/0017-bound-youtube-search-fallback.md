# Bound the YouTube search fallback in a worker

YouTube search prefers the configured Google API and uses the scraper when its
key is absent, the request fails, or the API circuit breaker is open. The scraper
runs in a worker because its underlying promise can outlive a request deadline.
The route terminates the worker when the deadline expires and after a result or
error, keeping stalled scraper work from lingering past that request.

The route tests replace the worker boundary so response parsing and mapping can
run without a live scraper.

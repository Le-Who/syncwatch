# Pin the destination for outbound metadata requests

The metadata route can retrieve titles from user-supplied HTTP destinations. The
request helper validates the resolved addresses and connects to a validated
address while preserving the original hostname for HTTP authority and TLS
verification. Only globally routable unicast destinations qualify. A failed
address parse also rejects the destination.

The request opens a dedicated connection and accepts successful responses
directly. Connection reuse and automatic redirect handling would move destination
selection outside the address validation step. The same deadline covers name
resolution and the request, and the response body has a fixed size limit.

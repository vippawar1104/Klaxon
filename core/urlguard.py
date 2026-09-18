"""Refuse webhook URLs that point back inside the network.

An alert rule makes the *server* issue an outbound POST to a URL the customer
chose. Unchecked, that is a server-side request forgery primitive: anyone with
an account can aim it at the cloud metadata endpoint (169.254.169.254, which
hands out instance credentials on most providers), at a database or admin panel
bound to a private address, or at the API's own loopback interface — and read
the outcome through the `delivered` flag on the alert.

The check resolves the hostname rather than pattern-matching the string,
because a name like `internal.example.com` can resolve straight to 10.0.0.5,
and it rejects if *any* resolved address is private: a host that answers with
both a public and a private address must not be treated as public.
"""

import ipaddress
import socket
from urllib.parse import urlparse

ALLOWED_SCHEMES = ("http", "https")


def _is_blocked(ip: str) -> bool:
    address = ipaddress.ip_address(ip)
    # is_global is the inverse of every reserved range at once — private,
    # loopback, link-local (which covers cloud metadata), multicast and the
    # unspecified address — so new reserved blocks are handled without a list
    # here needing to be updated.
    return not address.is_global


def check_webhook_url(url: str) -> tuple[bool, str]:
    """Return (allowed, reason). Reason is empty when allowed."""
    try:
        parsed = urlparse(url)
    except ValueError:
        return False, "Not a valid URL"

    if parsed.scheme not in ALLOWED_SCHEMES:
        return False, f"URL scheme must be one of {ALLOWED_SCHEMES}"
    if not parsed.hostname:
        return False, "URL has no host"

    try:
        # Every address the name resolves to, not just the first: a host that
        # answers with a public address and a private one is still a way in.
        infos = socket.getaddrinfo(parsed.hostname, parsed.port or 0, proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        return False, "Host does not resolve"

    for info in infos:
        ip = str(info[4][0])
        try:
            if _is_blocked(ip):
                return False, f"URL resolves to a non-public address ({ip})"
        except ValueError:
            return False, "Host resolved to an address that could not be parsed"

    return True, ""

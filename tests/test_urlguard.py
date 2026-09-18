"""A webhook target is a URL the server itself will fetch, chosen by a customer.

Every case here is a way that becomes a route into the network it runs in.
"""

import pytest

from core.urlguard import check_webhook_url


class TestRejected:
    @pytest.mark.parametrize(
        "url, why",
        [
            ("http://169.254.169.254/latest/meta-data/", "cloud metadata: instance credentials"),
            ("http://127.0.0.1:8000/api/health", "the API's own loopback interface"),
            ("http://localhost:5432/", "a database bound to localhost"),
            ("http://10.0.0.5/admin", "RFC1918 private range"),
            ("http://192.168.1.1/", "home/office private range"),
            ("http://172.16.0.1/", "the third private range"),
            ("http://[::1]:8000/", "IPv6 loopback"),
            ("http://0.0.0.0/", "the unspecified address"),
        ],
    )
    def test_internal_addresses(self, url, why):
        allowed, reason = check_webhook_url(url)
        assert not allowed, f"{why} was allowed: {url}"
        assert reason

    @pytest.mark.parametrize(
        "url",
        [
            "file:///etc/passwd",
            "gopher://example.com/",
            "ftp://example.com/",
            "not-a-url",
            "",
        ],
    )
    def test_non_http_schemes(self, url):
        allowed, reason = check_webhook_url(url)
        assert not allowed
        assert reason

    def test_unresolvable_host(self):
        allowed, reason = check_webhook_url("https://no-such-host.invalid/hook")
        assert not allowed
        assert "resolve" in reason.lower()


class TestAllowed:
    def test_a_public_https_endpoint(self):
        # example.com is reserved for documentation and resolves publicly.
        allowed, reason = check_webhook_url("https://example.com/hooks/klaxon")
        assert allowed, reason


class TestBoundary:
    def test_a_name_resolving_to_loopback_is_refused(self):
        """String matching is not enough — the hostname has to be resolved.

        `localhost` is the obvious case, but any domain can point an A record
        at 127.0.0.1, which is how this is bypassed in practice.
        """
        allowed, _ = check_webhook_url("http://localhost./")
        assert not allowed

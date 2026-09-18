from core.fingerprint import compute_fingerprint
from core.stacktrace import parse_event, parse_frames

CHROME = """TypeError: Cannot read property 'total' of undefined
    at renderCart (https://shop.example.com/assets/cart.js:42:18)
    at checkout (https://shop.example.com/assets/checkout.js:118:5)
    at <anonymous>
"""

FIREFOX = """renderCart@https://shop.example.com/assets/cart.js:42:18
checkout@https://shop.example.com/assets/checkout.js:118:5
"""


class TestParseFrames:
    def test_chrome_format(self):
        frames = parse_frames(CHROME)
        assert frames[0].function == "renderCart"
        assert frames[0].filename == "cart.js"
        assert frames[0].lineno == 42
        assert frames[0].colno == 18

    def test_firefox_format(self):
        frames = parse_frames(FIREFOX)
        assert frames[0].function == "renderCart"
        assert frames[0].filename == "cart.js"
        assert frames[0].lineno == 42

    def test_header_line_is_not_a_frame(self):
        assert all(f.function != "TypeError" for f in parse_frames(CHROME))

    def test_host_is_stripped_from_module(self):
        """Same code behind a CDN vs origin must not split the issue."""
        frames = parse_frames(CHROME)
        assert frames[0].module == "/assets/cart.js"

    def test_second_frame_parsed(self):
        frames = parse_frames(CHROME)
        assert frames[1].filename == "checkout.js"
        assert frames[1].lineno == 118

    def test_handles_empty_and_garbage(self):
        assert parse_frames("") == []
        assert parse_frames("not a stack trace at all\n\n") == []


class TestCrossBrowserGrouping:
    def test_chrome_and_firefox_produce_same_group(self):
        """The same bug reported by two browsers is one issue, not two."""
        a = parse_event("TypeError", "Cannot read property 'total' of undefined", CHROME)
        b = parse_event("TypeError", "Cannot read property 'total' of undefined", FIREFOX)
        assert compute_fingerprint(a) == compute_fingerprint(b)

    def test_different_host_same_group(self):
        staging = CHROME.replace("shop.example.com", "staging.example.com")
        a = parse_event("TypeError", "x", CHROME)
        b = parse_event("TypeError", "x", staging)
        assert compute_fingerprint(a) == compute_fingerprint(b)

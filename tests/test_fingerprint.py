from core.fingerprint import (
    Frame,
    ParsedEvent,
    compute_fingerprint,
    culprit,
    normalise_message,
)


def ev(value="boom", type_="TypeError", frames=None):
    return ParsedEvent(type=type_, value=value, frames=frames or [])


class TestNormaliseMessage:
    def test_strips_varying_ids(self):
        a = normalise_message("Cannot read property 'total' of undefined at user 48211")
        b = normalise_message("Cannot read property 'total' of undefined at user 90733")
        assert a == b

    def test_strips_uuid(self):
        a = normalise_message("order 3f2504e0-4f89-11d3-9a0c-0305e82c3301 failed")
        b = normalise_message("order 7c9e6679-7425-40de-944b-e07fc1f90ae7 failed")
        assert a == b
        assert "<uuid>" in a

    def test_uuid_not_shredded_by_integer_rule(self):
        # Regression guard: rule order must put UUID before bare integers.
        assert normalise_message("id 3f2504e0-4f89-11d3-9a0c-0305e82c3301") == "id <uuid>"

    def test_keeps_different_bugs_apart(self):
        a = normalise_message("Cannot read property 'total' of undefined")
        b = normalise_message("Network request failed")
        assert a != b


class TestGrouping:
    def test_same_trace_groups_together(self):
        frames = [Frame(function="renderCart", filename="cart.js", lineno=42)]
        assert compute_fingerprint(ev(frames=frames)) == compute_fingerprint(ev(frames=frames))

    def test_line_number_change_does_not_split_issue(self):
        """An edit above the throw site must not create a second issue."""
        before = [Frame(function="renderCart", filename="cart.js", lineno=42)]
        after = [Frame(function="renderCart", filename="cart.js", lineno=57)]
        assert compute_fingerprint(ev(frames=before)) == compute_fingerprint(ev(frames=after))

    def test_different_exception_type_splits_issue(self):
        """Two error types thrown from the same handler are two bugs.

        Caught in real-browser testing: several errors raised inside one click
        handler share a top frame, and a frames-only fingerprint merged them.
        """
        frame = [Frame(function="onclick", filename="demo.html", lineno=66)]
        a = compute_fingerprint(ev(type_="TypeError", frames=frame))
        b = compute_fingerprint(ev(type_="ReferenceError", frames=frame))
        assert a != b

    def test_different_function_splits_issue(self):
        a = [Frame(function="renderCart", filename="cart.js", lineno=42)]
        b = [Frame(function="checkout", filename="checkout.js", lineno=118)]
        assert compute_fingerprint(ev(frames=a)) != compute_fingerprint(ev(frames=b))

    def test_vendor_frames_ignored_when_app_frames_exist(self):
        vendor = Frame(function="dispatch", filename="node_modules/react/index.js", lineno=9)
        app = Frame(function="renderCart", filename="cart.js", lineno=42)
        assert compute_fingerprint(ev(frames=[vendor, app])) == compute_fingerprint(ev(frames=[app]))

    def test_build_hash_in_filename_ignored(self):
        """A redeploy changes the bundle hash; it must not orphan the issue."""
        a = [Frame(function="renderCart", filename="/assets/main-a1b2c3d4.js", lineno=42)]
        b = [Frame(function="renderCart", filename="/assets/main-99887766.js", lineno=42)]
        assert compute_fingerprint(ev(frames=a)) == compute_fingerprint(ev(frames=b))

    def test_falls_back_to_message_without_trace(self):
        a = compute_fingerprint(ev(value="Network request failed after 3000 ms"))
        b = compute_fingerprint(ev(value="Network request failed after 9000 ms"))
        assert a == b

    def test_message_fallback_still_separates_real_bugs(self):
        a = compute_fingerprint(ev(value="Network request failed"))
        b = compute_fingerprint(ev(value="Out of memory"))
        assert a != b

    def test_fingerprint_is_short_and_stable(self):
        fp = compute_fingerprint(ev(frames=[Frame(function="f", filename="a.js")]))
        assert len(fp) == 16
        assert fp == compute_fingerprint(ev(frames=[Frame(function="f", filename="a.js")]))


class TestCulprit:
    def test_prefers_first_in_app_frame(self):
        frames = [
            Frame(function="dispatch", filename="node_modules/react/index.js", lineno=9),
            Frame(function="renderCart", filename="cart.js", lineno=42),
        ]
        assert culprit(ev(frames=frames)) == "cart.js:42"

    def test_falls_back_to_type(self):
        assert culprit(ev(type_="TypeError")) == "TypeError"

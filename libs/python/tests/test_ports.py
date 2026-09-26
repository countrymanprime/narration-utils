import json
from dataclasses import FrozenInstanceError, dataclass, field

import pytest
from narration_common import contract_files, ports
from narration_common.ports import Descriptor, Level, NotSupportedError, Registry, conformance

# --- Level ------------------------------------------------------------------------------------------------------------


def test_levels_have_the_go_names_in_go_order_and_the_go_wire_strings():
    assert [level.name for level in Level] == ["Unsupported", "NotYetAvailable", "Experimental", "Supported"]
    assert [int(level) for level in Level] == [0, 1, 2, 3]
    assert [level.wire for level in Level] == ["unsupported", "not_yet_available", "experimental", "supported"]


def test_levels_order_least_to_most_capable_like_go():
    assert Level.Experimental >= Level.Experimental > Level.NotYetAvailable > Level.Unsupported
    assert Level.Supported.usable and Level.Experimental.usable
    assert not Level.NotYetAvailable.usable and not Level.Unsupported.usable


def test_level_from_wire_round_trips_and_refuses_an_unknown_string():
    assert all(Level.from_wire(level.wire) is level for level in Level)
    with pytest.raises(ValueError, match="deprecated"):
        Level.from_wire("deprecated")


# --- NotSupportedError ------------------------------------------------------------------------------------------------


def test_not_supported_error_carries_name_level_and_the_narrators_sentence():
    error = NotSupportedError("moonshine", Level.Unsupported, "Moonshine runs on Windows only.")

    assert (error.name, error.level, error.message) == ("moonshine", Level.Unsupported, "Moonshine runs on Windows only.")
    assert str(error) == "Moonshine runs on Windows only."
    # A ValueError, so the callers that catch today's `raise ValueError(f"Unknown ... source")` keep catching it.
    assert isinstance(error, ValueError)


def test_not_supported_error_needs_a_message():
    with pytest.raises(ValueError, match="message"):
        NotSupportedError("x", Level.Unsupported, "  ")


# --- Descriptor -------------------------------------------------------------------------------------------------------


def test_descriptor_is_frozen_and_hashable_with_tuple_fields():
    descriptor = Descriptor("whisper", "Whisper", platforms=["windows", "linux"], modes=["live", "batch"])

    assert descriptor.platforms == ("windows", "linux") and descriptor.modes == ("live", "batch")
    assert hash(descriptor) == hash(Descriptor("whisper", "Whisper", ("windows", "linux"), ("live", "batch")))
    with pytest.raises(FrozenInstanceError):
        descriptor.name = "other"  # type: ignore[misc]


def test_descriptor_with_no_platforms_runs_everywhere():
    everywhere = Descriptor("whisper", "Whisper")
    windows_only = Descriptor("moonshine", "Moonshine", platforms=("windows",))

    assert everywhere.runs_on("darwin") and everywhere.runs_on("windows")
    assert windows_only.runs_on("windows") and not windows_only.runs_on("darwin")


def test_descriptor_supports_only_its_declared_modes():
    descriptor = Descriptor("moonshine", "Moonshine", modes=("live",))

    assert descriptor.supports("live") and not descriptor.supports("batch")


@pytest.mark.parametrize(
    ("kwargs", "complaint"),
    [
        ({"name": "", "label": "X"}, "name"),
        ({"name": "has space", "label": "X"}, "name"),
        ({"name": "x", "label": ""}, "label"),
        ({"name": "x", "label": "X", "platforms": ("win32",)}, "win32"),
        ({"name": "x", "label": "X", "platforms": ("linux", "linux")}, "twice"),
        ({"name": "x", "label": "X", "modes": ("live", "live")}, "twice"),
        ({"name": "x", "label": "X", "modes": ("",)}, "mode"),
    ],
)
def test_descriptor_refuses_a_malformed_row(kwargs, complaint):
    with pytest.raises(ValueError, match=complaint):
        Descriptor(**kwargs)


def test_a_port_can_extend_the_descriptor_with_its_own_fields():
    @dataclass(frozen=True)
    class AsrDescriptor(Descriptor):
        languages: tuple[str, ...] = field(default=())

    descriptor = AsrDescriptor("moonshine", "Moonshine", ("windows",), ("live",), languages=("en",))

    assert descriptor.languages == ("en",) and descriptor.runs_on("windows")


@pytest.mark.parametrize(("sys_platform", "goos"), [("win32", "windows"), ("darwin", "darwin"), ("linux", "linux"), ("cygwin", "windows")])
def test_current_platform_speaks_gos_platform_names(monkeypatch, sys_platform, goos):
    monkeypatch.setattr(ports.registry.sys, "platform", sys_platform)

    assert ports.current_platform() == goos


def test_current_platform_refuses_one_the_host_does_not_ship_on(monkeypatch):
    monkeypatch.setattr(ports.registry.sys, "platform", "sunos5")

    with pytest.raises(NotSupportedError, match="sunos5") as refusal:
        ports.current_platform()
    assert refusal.value.level is Level.Unsupported


# --- Registry ---------------------------------------------------------------------------------------------------------


@dataclass
class FakeEngine:
    descriptor: Descriptor
    closed: int = 0

    def live(self):
        if not self.descriptor.supports("live"):
            raise NotSupportedError(self.descriptor.name, Level.Unsupported, f"{self.descriptor.label} has no live mode.")
        return self

    def batch(self):
        if not self.descriptor.supports("batch"):
            raise NotSupportedError(self.descriptor.name, Level.Unsupported, f"{self.descriptor.label} has no batch mode.")
        return self

    def close(self):
        self.closed += 1


WHISPER = FakeEngine(Descriptor("whisper", "Whisper", modes=("live", "batch")))
MOONSHINE = FakeEngine(Descriptor("moonshine", "Moonshine", platforms=("windows",), modes=("live",)))


def engines() -> Registry[FakeEngine]:
    registry: Registry[FakeEngine] = Registry("speech engine")
    registry.register(WHISPER)
    registry.register(MOONSHINE)
    return registry


def test_register_returns_the_port_and_lookup_finds_it_by_its_setting_name():
    registry: Registry[FakeEngine] = Registry("speech engine")

    assert registry.register(WHISPER) is WHISPER
    assert registry.lookup("whisper") is WHISPER
    assert "whisper" in registry and "moonshine" not in registry and len(registry) == 1


def test_register_refuses_a_duplicate_name_and_keeps_the_first_row():
    registry = engines()
    impostor = FakeEngine(Descriptor("whisper", "Another Whisper"))

    with pytest.raises(ValueError, match='"whisper" is already registered'):
        registry.register(impostor)
    assert registry.lookup("whisper") is WHISPER


def test_register_refuses_a_port_without_a_descriptor():
    with pytest.raises(TypeError, match="descriptor"):
        Registry("speech engine").register(object())  # type: ignore[arg-type]


def test_lookup_of_an_unknown_name_is_a_not_supported_error_with_a_sentence():
    with pytest.raises(NotSupportedError) as refusal:
        engines().lookup("vosk")

    assert refusal.value.name == "vosk" and refusal.value.level is Level.Unsupported
    assert str(refusal.value) == 'There is no speech engine called "vosk".'


def test_lookup_for_a_platform_refuses_a_row_declared_elsewhere():
    registry = engines()

    assert registry.lookup("moonshine", platform="windows") is MOONSHINE
    with pytest.raises(NotSupportedError, match="Moonshine is not available on darwin") as refusal:
        registry.lookup("moonshine", platform="darwin")
    assert refusal.value.level is Level.Unsupported


def test_names_keep_registration_order_so_the_default_comes_first():
    registry = engines()

    assert registry.names() == ["whisper", "moonshine"]
    assert registry.names("windows") == ["whisper", "moonshine"]
    assert registry.names("darwin") == ["whisper"] and registry.names("linux") == ["whisper"]
    assert registry.default("darwin") == "whisper"


def test_names_filter_by_mode_too():
    registry = engines()

    assert registry.names("windows", mode="batch") == ["whisper"]
    assert registry.names(mode="live") == ["whisper", "moonshine"]


def test_default_is_none_when_nothing_runs_on_the_platform():
    registry: Registry[FakeEngine] = Registry("capture backend")
    registry.register(FakeEngine(Descriptor("dshow", "DirectShow", platforms=("windows",))))

    assert registry.default("darwin") is None and registry.default("windows") == "dshow"


def test_iterating_a_registry_yields_ports_in_order_and_descriptors_list_them():
    registry = engines()

    assert list(registry) == [WHISPER, MOONSHINE]
    assert registry.descriptors() == [WHISPER.descriptor, MOONSHINE.descriptor]
    assert registry.kind == "speech engine"


def test_a_registry_needs_a_kind_for_its_sentences():
    with pytest.raises(ValueError, match="kind"):
        Registry("")


# --- conformance ------------------------------------------------------------------------------------------------------


def test_check_descriptor_passes_a_well_formed_port_and_names_a_missing_one():
    conformance.check_descriptor(WHISPER)

    with pytest.raises(conformance.ConformanceError, match="no descriptor"):
        conformance.check_descriptor(object())


def test_check_roles_passes_when_declared_roles_work_and_undeclared_ones_refuse():
    roles = {"live": FakeEngine.live, "batch": FakeEngine.batch}

    conformance.check_roles(WHISPER, roles)
    conformance.check_roles(MOONSHINE, roles)


def test_check_roles_fails_a_declared_role_that_raises():
    class Broken(FakeEngine):
        def live(self):
            raise RuntimeError("model missing")

    broken = Broken(Descriptor("broken", "Broken", modes=("live",)))

    with pytest.raises(conformance.ConformanceError, match=r'"broken" declares live, but it raised RuntimeError: model missing'):
        conformance.check_roles(broken, {"live": Broken.live})


def test_check_roles_fails_a_declared_role_that_returns_nothing():
    class Empty(FakeEngine):
        def live(self):
            return None

    with pytest.raises(conformance.ConformanceError, match="returned None"):
        conformance.check_roles(Empty(Descriptor("empty", "Empty", modes=("live",))), {"live": Empty.live})


def test_check_roles_fails_an_undeclared_role_that_works_anyway():
    class Eager(FakeEngine):
        def batch(self):
            return self

    eager = Eager(Descriptor("eager", "Eager", modes=("live",)))

    with pytest.raises(conformance.ConformanceError, match=r'"eager" does not declare batch, but it did not raise NotSupportedError'):
        conformance.check_roles(eager, {"live": Eager.live, "batch": Eager.batch})


def test_check_roles_fails_an_undeclared_role_that_refuses_the_wrong_way():
    class Rude(FakeEngine):
        def batch(self):
            raise RuntimeError("nope")

    with pytest.raises(conformance.ConformanceError, match="RuntimeError"):
        conformance.check_roles(Rude(Descriptor("rude", "Rude", modes=("live",))), {"live": Rude.live, "batch": Rude.batch})


def test_check_roles_fails_a_refusal_that_names_another_port_or_claims_a_usable_level():
    class Confused(FakeEngine):
        def batch(self):
            raise NotSupportedError("someone-else", Level.Unsupported, "Not here.")

    class Boastful(FakeEngine):
        def batch(self):
            raise NotSupportedError("boastful", Level.Supported, "Not here.")

    with pytest.raises(conformance.ConformanceError, match='names "someone-else"'):
        conformance.check_roles(Confused(Descriptor("confused", "C", modes=("live",))), {"live": Confused.live, "batch": Confused.batch})
    with pytest.raises(conformance.ConformanceError, match="usable level Supported"):
        conformance.check_roles(Boastful(Descriptor("boastful", "B", modes=("live",))), {"live": Boastful.live, "batch": Boastful.batch})


def test_check_roles_fails_a_declared_mode_the_suite_has_no_role_for():
    with pytest.raises(conformance.ConformanceError, match='declares mode "batch", which this port has no role for'):
        conformance.check_roles(WHISPER, {"live": FakeEngine.live})


def test_check_close_twice_is_safe_and_names_a_close_that_raises():
    engine = FakeEngine(Descriptor("whisper", "Whisper"))
    conformance.check_close_twice(engine)
    assert engine.closed == 2

    class Fragile:
        closed = False

        def close(self):
            if self.closed:
                raise RuntimeError("already closed")
            self.closed = True

    with pytest.raises(conformance.ConformanceError, match="second close"):
        conformance.check_close_twice(Fragile())


@pytest.mark.parametrize(
    "spans",
    [[], [(0.0, 0.0)], [(0.0, 0.5), (0.5, 1.0), (1.0, 1.0)], [(0, 1), (0.25, 2)]],
)
def test_check_timings_passes_non_negative_monotonic_spans(spans):
    conformance.check_timings(spans)


@pytest.mark.parametrize(
    ("spans", "complaint"),
    [
        ([(-0.1, 0.5)], "negative"),
        ([(0.5, 0.4)], "ends before it starts"),
        ([(1.0, 2.0), (0.5, 3.0)], "starts before"),
        ([(0.0, float("nan"))], "not a number"),
    ],
)
def test_check_timings_names_the_first_bad_span(spans, complaint):
    with pytest.raises(conformance.ConformanceError, match=complaint):
        conformance.check_timings(spans)


def test_run_over_registry_runs_the_suite_on_every_row_and_reports_every_failure():
    registry = engines()
    registry.register(FakeEngine(Descriptor("third", "Third", modes=("batch",))))
    seen = []

    def suite(engine):
        seen.append(engine.descriptor.name)
        if engine.descriptor.name != "whisper":
            raise conformance.ConformanceError(f"{engine.descriptor.name} failed")

    with pytest.raises(conformance.ConformanceError) as failure:
        conformance.run_over_registry(registry, suite)

    assert seen == ["whisper", "moonshine", "third"]
    assert "moonshine failed" in str(failure.value) and "third failed" in str(failure.value)
    assert "2 of 3 speech engines" in str(failure.value)


def test_run_over_registry_passes_when_every_row_passes_and_refuses_an_empty_registry():
    def suite(engine):
        conformance.check_descriptor(engine)
        conformance.check_roles(engine, {"live": FakeEngine.live, "batch": FakeEngine.batch})

    conformance.run_over_registry(engines(), suite)
    with pytest.raises(conformance.ConformanceError, match="no rows"):
        conformance.run_over_registry(Registry("speech engine"), suite)


def test_run_over_registry_does_not_hide_a_crash_in_the_suite_itself():
    def suite(engine):
        raise KeyError("bug in the suite")

    with pytest.raises(KeyError):
        conformance.run_over_registry(engines(), suite)


# --- the Go level vocabulary ------------------------------------------------------------------------------------------

LEVEL_GOLDEN = "port-levels"


@pytest.mark.parametrize(
    "payload",
    [
        ["Unsupported", "NotYetAvailable", "Experimental", "Supported"],
        ["unsupported", "not_yet_available", "experimental", "supported"],
        {"levels": ["unsupported", "not_yet_available", "experimental", "supported"]},
        [{"name": "Unsupported", "value": 0}, {"name": "NotYetAvailable", "value": 1}, {"name": "Experimental", "value": 2}, {"name": "Supported", "value": 3}],
        {
            "levels": [
                {"level": 0, "wire": "unsupported"},
                {"level": 1, "wire": "not_yet_available"},
                {"level": 2, "wire": "experimental"},
                {"level": 3, "wire": "supported"},
            ]
        },
        {"Unsupported": 0, "NotYetAvailable": 1, "Experimental": 2, "Supported": 3},
        {"supported": 3, "experimental": 2, "not_yet_available": 1, "unsupported": 0},
        {"unsupported": "Unsupported", "not_yet_available": "NotYetAvailable", "experimental": "Experimental", "supported": "Supported"},
    ],
)
def test_the_vocabulary_check_accepts_the_go_levels_in_any_plain_shape(payload):
    assert ports.levels_in_golden(payload) == list(Level)


@pytest.mark.parametrize(
    ("payload", "complaint"),
    [
        (["Unsupported", "NotYetAvailable", "Experimental", "Supported", "Deprecated"], "Deprecated"),
        (["Unsupported", "Experimental", "Supported"], "3 levels"),
        (["NotYetAvailable", "Unsupported", "Experimental", "Supported"], "order"),
        (
            [
                {"name": "Unsupported", "value": 1},
                {"name": "NotYetAvailable", "value": 0},
                {"name": "Experimental", "value": 2},
                {"name": "Supported", "value": 3},
            ],
            "value",
        ),
        ({"Unsupported": 0, "Pending": 1, "Experimental": 2, "Supported": 3}, "Pending"),
        ("Unsupported", "shape"),
        ([{"colour": "red"}], "shape"),
    ],
)
def test_the_vocabulary_check_fails_when_the_go_levels_differ(payload, complaint):
    with pytest.raises(AssertionError, match=complaint):
        ports.levels_in_golden(payload)


def test_python_levels_match_the_golden_the_go_port_test_writes():
    path = contract_files.contracts_dir() / f"{LEVEL_GOLDEN}.json"
    if not path.is_file():
        pytest.skip(
            f"{path.name} is absent: the Go internal/port test writes it (UPDATE_CONTRACTS=1, provider-ports phase 2 / daw-port "
            "phase 1). Until it lands the level names cannot be compared across languages."
        )

    assert ports.levels_in_golden(json.loads(path.read_text(encoding="utf-8"))) == list(Level)

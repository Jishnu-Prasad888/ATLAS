import pytest

from apps.ai_agents.tools import TOOL_SPECS, TOOL_FN_MAP


def test_tool_specs_names_unique():
    names = [f["function"]["name"] for f in TOOL_SPECS]
    assert len(names) == len(set(names)), "tool names must be unique"


def test_tool_map_has_all_specs():
    names = [f["function"]["name"] for f in TOOL_SPECS]
    for name in names:
        assert name in TOOL_FN_MAP, f"missing tool fn for {name}"


@pytest.mark.parametrize("tool_name", ["fetch_data", "run_code"])
def test_tool_map_callable(tool_name):
    assert callable(TOOL_FN_MAP[tool_name])

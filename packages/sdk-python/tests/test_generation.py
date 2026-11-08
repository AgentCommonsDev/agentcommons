import importlib.util
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location(
    "generate_sdk", Path(__file__).parents[1] / "scripts/generate.py"
)
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)


# @req R-SDK-01
def test_schema_adaptations_preserve_bounds_and_do_not_mutate_contract():
    coordinate = {"type": "integer", "minimum": 0}
    source = {
        "type": "array",
        "prefixItems": [coordinate, coordinate],
        "items": False,
        "minItems": 2,
        "maxItems": 2,
    }
    assert generator.normalize_contract(source) == {
        "type": "array",
        "items": coordinate,
        "minItems": 2,
        "maxItems": 2,
    }
    assert "prefixItems" in source
    assert generator.normalize_contract({"$ref": "#/components/schemas/JsonValue"}) == {}
    with pytest.raises(ValueError, match="tuple shape"):
        generator.normalize_contract(
            {"prefixItems": [{"type": "integer"}, {"type": "string"}], "items": False}
        )
    with pytest.raises(ValueError, match="template changed"):
        generator.replace_once("new upstream template", "old template", "replacement")

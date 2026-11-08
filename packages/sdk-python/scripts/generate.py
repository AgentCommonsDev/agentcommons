"""Generate the Python client from the API contract, failing on any omitted schema."""

import argparse
import copy
import json
import shutil
import tempfile
from pathlib import Path
from typing import Any

import openapi_python_client
from openapi_python_client import generate
from openapi_python_client.config import Config, ConfigFile, MetaType

PACKAGE = Path(__file__).resolve().parents[1]
CONTRACT = PACKAGE.parents[1] / "apps/api/openapi.json"
TARGET = PACKAGE / "src/agentcommons"
GENERATED_PATHS = {"api", "models", "client.py", "errors.py", "types.py", "py.typed"}
JSON_REFS = {"#/components/schemas/JsonValue", "#/components/schemas/JsonValueInput"}


def normalize_contract(value: Any) -> Any:
    """Equivalent schemas for constructs the pinned generator cannot represent."""
    if isinstance(value, list):
        return [normalize_contract(item) for item in value]
    if not isinstance(value, dict):
        return value
    # Any JSON value is already the universe of values in a JSON document. In Python
    # these dynamic leaves use Any; surrounding request/response models stay typed.
    if value.get("$ref") in JSON_REFS:
        return {key: item for key, item in value.items() if key != "$ref"}
    result = {key: normalize_contract(item) for key, item in value.items()}
    if "prefixItems" in result:
        items = result.pop("prefixItems")
        if (
            not items
            or not all(item == items[0] for item in items)
            or result.get("items") is not False
        ):
            raise ValueError("New tuple shape requires a reviewed Python SDK representation")
        result["items"] = items[0]
        result["maxItems"] = min(result.get("maxItems", len(items)), len(items))
    return result


def prepare_contract(source: dict[str, Any]) -> dict[str, Any]:
    contract = normalize_contract(copy.deepcopy(source))
    schemas = contract["components"]["schemas"]
    for name in ("JsonValue", "JsonValueInput"):
        schemas.pop(name, None)
    # Naming each object union member avoids duplicate nested model names when the
    # same union is used through multiple refs. Payloads and validation stay unchanged.
    for name, schema in list(schemas.items()):
        for keyword in ("oneOf", "anyOf"):
            for index, variant in enumerate(schema.get(keyword, [])):
                if variant.get("type") != "object":
                    continue
                variant_name = f"{name}Variant{index}"
                if variant_name in schemas:
                    raise ValueError(f"Schema name collision: {variant_name}")
                schemas[variant_name] = variant
                schema[keyword][index] = {"$ref": f"#/components/schemas/{variant_name}"}
    return contract


def replace_once(source: str, old: str, new: str) -> str:
    if source.count(old) != 1:
        raise ValueError("Upstream generator template changed; review the SDK customization")
    return source.replace(old, new, 1)


def templates(target: Path) -> None:
    """Small overlays on the pinned upstream templates; never edit generated files."""
    upstream = Path(openapi_python_client.__file__).parent / "templates"
    macros = (upstream / "endpoint_macros.py.jinja").read_text()
    macros = replace_once(
        macros,
        '    {%- if not property.json_is_dict %}\nparams["{{ property.name | in_double_quote_literal }}"] = {{ destination }}\n    {% else %}\n{{ guarded_statement(property, destination, "params.update(" + destination + ")") }}\n    {% endif %}',
        'params["{{ property.name | in_double_quote_literal }}"] = {{ destination }}',
    )
    macros = replace_once(
        macros,
        "params = {k: v for k, v in params.items() if v is not UNSET and v is not None}",
        "params = serialize_query({k: v for k, v in params.items() if v is not UNSET and v is not None})",
    )
    endpoint = (upstream / "endpoint_module.py.jinja").read_text()
    endpoint = replace_once(
        endpoint,
        "import httpx",
        "import httpx\nfrom ...runtime import check_response, serialize_query",
    )
    endpoint = replace_once(
        endpoint,
        "def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> {{return_type}}:",
        "def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> {{return_type}}:\n"
        "    check_response(response)\n"
        '    if response.headers.get("content-type", "").split(";", 1)[0] == "text/csv":\n'
        "        return None",
    )
    target.mkdir()
    (target / "endpoint_macros.py.jinja").write_text(macros)
    (target / "endpoint_module.py.jinja").write_text(endpoint)


def files(directory: Path) -> dict[str, bytes]:
    return {
        str(path.relative_to(directory)): path.read_bytes()
        for path in directory.rglob("*")
        if path.is_file()
        and (path.suffix == ".py" or path.name == "py.typed")
        and path.relative_to(directory).parts[0] in GENERATED_PATHS
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    source = json.loads(CONTRACT.read_text())
    with tempfile.TemporaryDirectory(prefix="agentcommons-python-") as temporary:
        root = Path(temporary)
        contract = root / "openapi.json"
        contract.write_text(json.dumps(prepare_contract(source)))
        templates(root / "templates")
        output = root / "generated"
        errors = generate(
            config=Config.from_sources(
                config_file=ConfigFile(package_name_override="agentcommons", literal_enums=True),
                meta_type=MetaType.NONE,
                document_source=contract,
                file_encoding="utf-8",
                overwrite=False,
                output_path=output,
            ),
            custom_template_path=root / "templates",
        )
        if errors:
            raise RuntimeError(
                f"Python SDK generation must have no warnings or omissions: {errors}"
            )
        # Assert every OpenAPI operation has a generated module, including optional
        # feature groups. Never silently ship a partial client.
        expected = sum(
            "responses" in operation
            for path in source["paths"].values()
            for operation in path.values()
        )
        actual = len(list((output / "api").glob("*/*.py"))) - len(
            list((output / "api").glob("*/__init__.py"))
        )
        if actual != expected:
            raise RuntimeError(f"Generated {actual} operations, expected {expected}")
        generated = files(output)
        if args.check:
            existing = files(TARGET)
            changed = sorted(
                key
                for key in generated.keys() | existing.keys()
                if generated.get(key) != existing.get(key)
            )
            if changed:
                raise SystemExit(
                    "Python SDK is stale. Run pnpm sdk:generate.\n" + "\n".join(changed)
                )
        else:
            for name in GENERATED_PATHS:
                path = TARGET / name
                if path.is_dir():
                    shutil.rmtree(path)
                elif path.exists():
                    path.unlink()
            TARGET.mkdir(parents=True, exist_ok=True)
            for name, content in generated.items():
                path = TARGET / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(content)


if __name__ == "__main__":
    main()

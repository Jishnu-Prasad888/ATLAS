import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandParser

from apps.ai_agents.graph import run_graph


class Command(BaseCommand):
    help = "Run the incident AI graph once with fetch + code inputs"

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("--fetch-url", required=True, help="Endpoint URL to fetch")
        parser.add_argument("--fetch-params", help="JSON string of fetch params", default="{}")
        parser.add_argument("--code-file", required=True, help="Path to python code file")
        parser.add_argument("--input-json", help="Optional JSON input file for code")

    def handle(self, *args, **options):
        fetch_params = json.loads(options["fetch_params"] or "{}")
        fetch_spec = {"url": options["fetch_url"], "params": fetch_params}

        code_path = Path(options["code_file"])
        code = code_path.read_text()

        input_data = None
        if options.get("input_json"):
            input_data = json.loads(Path(options["input_json"]).read_text())

        result = run_graph(fetch_spec, code, input_data)
        self.stdout.write(json.dumps(result, indent=2, default=str))

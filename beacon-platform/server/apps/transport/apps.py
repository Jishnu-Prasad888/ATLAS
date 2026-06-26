import logging
import os
import sys

from django.apps import AppConfig
from django.conf import settings


logger = logging.getLogger("beacon.transport")


def _is_management_command() -> bool:
    argv = sys.argv
    if len(argv) <= 1:
        return False
    cmd = argv[1]
    management_cmds = {
        "makemigrations",
        "migrate",
        "collectstatic",
        "shell",
        "test",
        "createsuperuser",
        "loaddata",
        "dumpdata",
        "check",
    }
    return cmd in management_cmds


class TransportConfig(AppConfig):
    name = "apps.transport"
    verbose_name = "Beacon Transport"

    def ready(self):
        if os.environ.get("RUN_MAIN") not in {"true", "True", "1", None}:
            return

        if _is_management_command():
            logger.debug("Skipping NATS worker during management command")
            return

        if not getattr(settings, "BEACON_ENABLE_NATS_WORKER", True):
            logger.info("NATS worker disabled via settings")
            return

        try:
            from . import nats_worker

            nats_worker.start()
        except Exception:  # pragma: no cover
            logger.exception("Failed to start NATS worker")

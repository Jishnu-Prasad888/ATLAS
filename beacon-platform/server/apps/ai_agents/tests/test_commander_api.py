import json
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase


class CommanderApiTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user(username="commander", email="commander@example.com", password="Secret123!")

    def _post(self, payload):
        self.client.force_login(self.user)
        response = self.client.post(
            "/api/v1/ai/commander/",
            json.dumps(payload),
            content_type="application/json",
        )
        self.client.logout()
        return response

    def test_invalid_provider_rejected(self):
        response = self._post({"provider": "unsupported", "question": "hello"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("Invalid provider", response.json()["detail"])

    def test_local_provider_requires_base_url(self):
        response = self._post({"provider": "local", "question": "hello"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("base_url", response.json()["detail"])

    @mock.patch("apps.ai_agents.views_commander.run_commander_for_messages")
    def test_passes_provider_and_model(self, run_commander_mock):
        run_commander_mock.return_value = [{"role": "assistant", "content": "done"}]

        payload = {
            "provider": "local",
            "base_url": "https://llama.local/v1",
            "model": "llama-3",
            "messages": [{"role": "user", "content": "ping"}],
        }

        response = self._post(payload)

        self.assertEqual(response.status_code, 200)
        run_commander_mock.assert_called_once()
        kwargs = run_commander_mock.call_args.kwargs
        self.assertEqual(kwargs["provider"], "local")
        self.assertEqual(kwargs["model"], "llama-3")
        self.assertEqual(kwargs["base_url"], "https://llama.local/v1")

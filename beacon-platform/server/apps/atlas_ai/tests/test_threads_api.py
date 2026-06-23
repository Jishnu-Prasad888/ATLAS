import json

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse

from apps.atlas_ai.models import AtlasAiThread


class AtlasAiThreadApiTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user(username="analyst", email="analyst@example.com", password="Secret123!")
        self.other_user = user_model.objects.create_user(username="observer", email="observer@example.com", password="Secret123!")

    def test_authentication_required(self):
        url = reverse("atlas-ai-thread-list")
        response = self.client.get(url)
        self.assertEqual(response.status_code, 403)

    def test_create_and_list_threads(self):
        list_url = reverse("atlas-ai-thread-list")
        self.client.force_login(self.user)
        create_resp = self.client.post(list_url, json.dumps({"title": "Investigations"}), content_type="application/json")
        self.assertEqual(create_resp.status_code, 201)
        data = create_resp.json()
        self.assertIn("id", data)
        self.assertEqual(data["message_count"], 0)
        thread_id = data["id"]

        list_resp = self.client.get(list_url)
        self.assertEqual(list_resp.status_code, 200)
        threads = list_resp.json()
        self.assertEqual(len(threads), 1)
        self.assertEqual(threads[0]["id"], thread_id)
        self.assertEqual(threads[0]["message_count"], 0)

    def test_patch_renames_thread(self):
        # Create thread via API
        list_url = reverse("atlas-ai-thread-list")
        self.client.force_login(self.user)
        create_resp = self.client.post(list_url, json.dumps({"title": "Untitled"}), content_type="application/json")
        thread_id = create_resp.json()["id"]
        detail_url = reverse("atlas-ai-thread-detail", args=[thread_id])

        patch_payload = {"title": "Critical incident review"}
        patch_resp = self.client.patch(detail_url, json.dumps(patch_payload), content_type="application/json")
        self.assertEqual(patch_resp.status_code, 200)
        body = patch_resp.json()
        self.assertEqual(body["title"], patch_payload["title"])
        self.assertEqual(body["message_count"], 0)

        thread = AtlasAiThread.objects.get(id=thread_id)
        self.assertEqual(thread.title, patch_payload["title"])

    def test_cannot_rename_thread_of_another_user(self):
        thread = AtlasAiThread.objects.create(user=self.other_user, title="Their Thread")
        detail_url = reverse("atlas-ai-thread-detail", args=[thread.id])

        self.client.force_login(self.user)
        resp = self.client.patch(detail_url, json.dumps({"title": "Hacked"}), content_type="application/json")
        self.assertEqual(resp.status_code, 404)

    def test_first_user_message_sets_title(self):
        thread = AtlasAiThread.objects.create(user=self.user, title="")
        messages_url = reverse("atlas-ai-thread-messages", args=[thread.id])

        self.client.force_login(self.user)
        post_resp = self.client.post(
            messages_url,
            json.dumps({"messages": [{"role": "user", "content": "Investigate CPU spikes"}]}),
            content_type="application/json",
        )
        self.assertEqual(post_resp.status_code, 201)
        thread.refresh_from_db()
        self.assertTrue(thread.title.startswith("Investigate CPU"))

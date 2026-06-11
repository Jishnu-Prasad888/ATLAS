"""
Custom Argon2id password hasher for Beacon.
Enforces Argon2id algorithm; plaintext storage is prohibited.
"""
from django.contrib.auth.hashers import BasePasswordHasher, mask_hash
from django.utils.translation import gettext_lazy as _
import hashlib
import os
import base64


class Argon2idHasher(BasePasswordHasher):
    """
    Argon2id password hasher.
    Uses argon2-cffi under the hood.
    """
    algorithm = "argon2id"
    library   = ("argon2",)

    # Argon2id parameters (OWASP recommended minimums)
    time_cost   = 3       # iterations
    memory_cost = 65536   # 64 MB
    parallelism = 4

    def salt(self):
        return base64.b64encode(os.urandom(16)).decode("ascii")

    def encode(self, password, salt, time_cost=None, memory_cost=None, parallelism=None):
        try:
            import argon2
            from argon2 import PasswordHasher
            ph = PasswordHasher(
                time_cost   = time_cost   or self.time_cost,
                memory_cost = memory_cost or self.memory_cost,
                parallelism = parallelism or self.parallelism,
                hash_len    = 32,
                salt_len    = 16,
            )
            hash_val = ph.hash(password)
            return f"{self.algorithm}${hash_val}"
        except ImportError:
            raise ImportError("argon2-cffi is required. Install it with: pip install argon2-cffi")

    def verify(self, password, encoded):
        try:
            from argon2 import PasswordHasher
            from argon2.exceptions import VerifyMismatchError, VerificationError
            algorithm, hash_val = encoded.split("$", 1)
            assert algorithm == self.algorithm
            ph = PasswordHasher(
                time_cost   = self.time_cost,
                memory_cost = self.memory_cost,
                parallelism = self.parallelism,
            )
            try:
                return ph.verify(hash_val, password)
            except (VerifyMismatchError, VerificationError):
                return False
        except Exception:
            return False

    def safe_summary(self, encoded):
        algorithm, hash_val = encoded.split("$", 1)
        return {
            _("algorithm"): algorithm,
            _("hash"): mask_hash(hash_val),
        }

    def must_update(self, encoded):
        return False

    def harden_runtime(self, password, encoded):
        pass

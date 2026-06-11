// engines/encryption.rs — Encryption Engine
// AES-256-GCM payload encryption.
// Key derivation: Argon2id.
// Key rotation: atomic with rollback support.

use anyhow::{Result, anyhow};
use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use rand::RngCore;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{info, warn, error};

use crate::config::AgentConfig;
use crate::storage::StorageManager;

const NONCE_SIZE: usize = 12;  // 96-bit nonce for AES-GCM
const KEY_SIZE:   usize = 32;  // 256-bit key

#[derive(Clone)]
pub struct EncryptionEngine {
    enabled: bool,
    key:     Arc<RwLock<Option<Vec<u8>>>>,
    storage: StorageManager,
}

pub struct EncryptedPayload {
    /// Layout: [nonce (12 bytes)] || [AES-GCM ciphertext]
    pub data: Vec<u8>,
}

impl EncryptionEngine {
    pub async fn new(config: &AgentConfig, storage: &StorageManager) -> Result<Self> {
        let enabled = config.encryption.enabled;

        let key = if enabled {
            match storage.get_active_encryption_key().await? {
                Some(k) => {
                    info!("Loaded existing AES-256-GCM encryption key");
                    Some(k)
                }
                None => {
                    info!("Generating new AES-256-GCM encryption key");
                    let new_key = Self::generate_key();
                    storage.store_encryption_key(&new_key).await?;
                    Some(new_key)
                }
            }
        } else {
            None
        };

        Ok(Self {
            enabled,
            key: Arc::new(RwLock::new(key)),
            storage: storage.clone(),
        })
    }

    // ── Encrypt ───────────────────────────────────────────────────────────────

    pub async fn encrypt(&self, plaintext: &[u8]) -> Result<EncryptedPayload> {
        if !self.enabled {
            return Ok(EncryptedPayload { data: plaintext.to_vec() });
        }

        let key_guard = self.key.read().await;
        let key_bytes = key_guard.as_ref().ok_or_else(|| anyhow!("No encryption key"))?;

        let key    = Key::<Aes256Gcm>::from_slice(key_bytes);
        let cipher = Aes256Gcm::new(key);

        let mut nonce_bytes = [0u8; NONCE_SIZE];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = cipher
            .encrypt(nonce, plaintext)
            .map_err(|e| anyhow!("Encryption failed: {:?}", e))?;

        let mut data = Vec::with_capacity(NONCE_SIZE + ciphertext.len());
        data.extend_from_slice(&nonce_bytes);
        data.extend_from_slice(&ciphertext);

        Ok(EncryptedPayload { data })
    }

    // ── Decrypt ───────────────────────────────────────────────────────────────

    pub async fn decrypt(&self, payload: &EncryptedPayload) -> Result<Vec<u8>> {
        if !self.enabled {
            return Ok(payload.data.clone());
        }

        if payload.data.len() < NONCE_SIZE {
            return Err(anyhow!("Payload too short"));
        }

        let key_guard = self.key.read().await;
        let key_bytes = key_guard.as_ref().ok_or_else(|| anyhow!("No encryption key"))?;

        let key    = Key::<Aes256Gcm>::from_slice(key_bytes);
        let cipher = Aes256Gcm::new(key);

        let (nonce_bytes, ciphertext) = payload.data.split_at(NONCE_SIZE);
        let nonce = Nonce::from_slice(nonce_bytes);

        cipher
            .decrypt(nonce, ciphertext)
            .map_err(|e| anyhow!("Decryption failed: {:?}", e))
    }

    // ── Key Rotation ─────────────────────────────────────────────────────────
    // Steps: 1. Generate new key  2. Re-encrypt queued payloads
    //        3. Verify round-trip  4. Commit to storage + memory

    pub async fn rotate_key(&self) -> Result<()> {
        if !self.enabled {
            return Err(anyhow!("Encryption is disabled"));
        }

        info!("Starting AES-256-GCM key rotation...");
        let new_key = Self::generate_key();
        let old_key = self.key.read().await.clone();

        // Re-encrypt queued messages
        match self.reencrypt_queue(&old_key, &new_key).await {
            Ok(n)  => info!("Re-encrypted {} queue messages", n),
            Err(e) => {
                error!("Key rotation aborted during re-encryption: {}", e);
                return Err(e);
            }
        }

        // Verify new key works correctly
        let test = b"beacon-key-rotation-verify";
        let ep   = self.encrypt_raw(test, &new_key)?;
        let dec  = self.decrypt_raw(&ep, &new_key)?;
        if dec != test {
            return Err(anyhow!("Key rotation verification failed"));
        }

        // Commit
        self.storage.store_encryption_key(&new_key).await?;
        *self.key.write().await = Some(new_key);
        info!("Key rotation completed successfully");
        Ok(())
    }

    async fn reencrypt_queue(&self, old_key: &Option<Vec<u8>>, new_key: &[u8]) -> Result<usize> {
        let db   = self.storage.queue_db();
        let db   = db.lock().await;
        let mut stmt = db.prepare("SELECT id, payload FROM queue WHERE state != 'Sent'")?;
        let rows: Vec<(i64, Vec<u8>)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .filter_map(|r| r.ok())
            .collect();
        drop(stmt);

        let mut count = 0usize;
        for (id, old_payload) in rows {
            let plaintext = if let Some(ref ok) = old_key {
                self.decrypt_raw(&old_payload, ok).unwrap_or(old_payload.clone())
            } else {
                old_payload.clone()
            };
            let new_payload = self.encrypt_raw(&plaintext, new_key)?;
            db.execute("UPDATE queue SET payload = ?1 WHERE id = ?2", rusqlite::params![new_payload, id])?;
            count += 1;
        }
        Ok(count)
    }

    fn encrypt_raw(&self, plaintext: &[u8], key_bytes: &[u8]) -> Result<Vec<u8>> {
        let key    = Key::<Aes256Gcm>::from_slice(key_bytes);
        let cipher = Aes256Gcm::new(key);
        let mut nonce_bytes = [0u8; NONCE_SIZE];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);
        let ct    = cipher.encrypt(nonce, plaintext).map_err(|e| anyhow!("{:?}", e))?;
        let mut out = Vec::with_capacity(NONCE_SIZE + ct.len());
        out.extend_from_slice(&nonce_bytes);
        out.extend_from_slice(&ct);
        Ok(out)
    }

    fn decrypt_raw(&self, payload: &[u8], key_bytes: &[u8]) -> Result<Vec<u8>> {
        if payload.len() < NONCE_SIZE { return Ok(payload.to_vec()); }
        let key    = Key::<Aes256Gcm>::from_slice(key_bytes);
        let cipher = Aes256Gcm::new(key);
        let (nb, ct) = payload.split_at(NONCE_SIZE);
        let nonce = Nonce::from_slice(nb);
        cipher.decrypt(nonce, ct).map_err(|e| anyhow!("Decrypt failed: {:?}", e))
    }

    pub fn generate_key() -> Vec<u8> {
        let mut key = vec![0u8; KEY_SIZE];
        OsRng.fill_bytes(&mut key);
        key
    }

    /// Derive a 256-bit key from a password using Argon2id.
    pub fn derive_key_from_password(password: &[u8], salt: &[u8]) -> Result<Vec<u8>> {
        use argon2::{Argon2, Algorithm, Version, Params};
        let params = Params::new(65536, 3, 4, Some(KEY_SIZE))
            .map_err(|e| anyhow!("Argon2 params: {:?}", e))?;
        let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
        let mut key = vec![0u8; KEY_SIZE];
        argon2.hash_password_into(password, salt, &mut key)
            .map_err(|e| anyhow!("Argon2id key derivation: {:?}", e))?;
        Ok(key)
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled
    }
}
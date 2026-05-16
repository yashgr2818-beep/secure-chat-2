// Generate RSA-OAEP key pair  
export async function generateKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: "SHA-256" },
    true, ["encrypt", "decrypt"]
  );
}

// Export public key as JWK string (send to server on signup)
export async function exportPublicKey(key: CryptoKey): Promise<string> {
  const jwk = await crypto.subtle.exportKey("jwk", key);
  return JSON.stringify(jwk);
}

// Import public key from JWK string (received from server for recipient)
export async function importPublicKey(jwkStr: string): Promise<CryptoKey> {
  const jwk = JSON.parse(jwkStr);
  return crypto.subtle.importKey("jwk", jwk, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
}

// Store private key in IndexedDB under username  
export async function storePrivateKey(username: string, key: CryptoKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("securechat", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("keys");
    req.onsuccess = () => {
      const tx = req.result.transaction("keys", "readwrite");
      tx.objectStore("keys").put(key, username);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

// Load private key from IndexedDB
export async function loadPrivateKey(username: string): Promise<CryptoKey | null> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("securechat", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("keys");
    req.onsuccess = () => {
      const tx = req.result.transaction("keys", "readonly");
      const getReq = tx.objectStore("keys").get(username);
      getReq.onsuccess = () => resolve(getReq.result ?? null);
      getReq.onerror = () => reject(getReq.error);
    };
    req.onerror = () => reject(req.error);
  });
}

// Encrypt a plaintext string for a recipient (hybrid RSA+AES-GCM)
export async function encryptMessage(plaintext: string, recipientPublicKey: CryptoKey): Promise<{ encryptedContent: string; encryptedKey: string; iv: string }> {
  const aesKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, enc.encode(plaintext));
  const rawAes = await crypto.subtle.exportKey("raw", aesKey);
  const encryptedKey = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, recipientPublicKey, rawAes);
  const toB64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  return {
    encryptedContent: toB64(ciphertext),
    encryptedKey: toB64(encryptedKey),
    iv: toB64(iv.buffer),
  };
}

// Decrypt a message using the local private key
export async function decryptMessage(encryptedContent: string, encryptedKey: string, iv: string, privateKey: CryptoKey): Promise<string> {
  const fromB64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0)).buffer;
  const rawAes = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, privateKey, fromB64(encryptedKey));
  const aesKey = await crypto.subtle.importKey("raw", rawAes, "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(fromB64(iv)) }, aesKey, fromB64(encryptedContent));
  return new TextDecoder().decode(plain);
}
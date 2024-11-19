// noinspection JSUnusedGlobalSymbols
import { arrayBufferToBase64, base64ToArrayBuffer } from "obsidian";

export interface EncryptedString {
  ciphertext: string[];
  key: string;
}

async function _generateKey(seed: ArrayBuffer) {
  const keyMaterial = await window.crypto.subtle.importKey("raw", seed, { name: "PBKDF2" }, false, ["deriveBits"]);

  const masterKey = await window.crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: new Uint8Array(16),
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );

  return new Uint8Array(masterKey);
}

export function masterKeyToString(masterKey: ArrayBuffer): string {
  return arrayBufferToBase64(masterKey);
}

function _getAesGcmKey(secret: ArrayBuffer): Promise<CryptoKey> {
  return window.crypto.subtle.importKey("raw", secret, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/**
 * Encrypt a plaintext string with AES 256
 *
 * @param {string} plaintext
 * @param {string} [existingKey] - Optional
 * @return {EncryptedString}
 */
export async function encryptString(plaintext: string, existingKey?: string): Promise<EncryptedString> {
  let key;
  if (existingKey) {
    key = base64ToArrayBuffer(existingKey);
  } else {
    key = await _generateKey(window.crypto.getRandomValues(new Uint8Array(64)));
  }
  const iv = new Uint8Array(1);
  const aesKey = await _getAesGcmKey(key);

  const ciphertext = [];
  const length = plaintext.length;
  const chunkSize = 2000;
  let index = 0;
  while (index * chunkSize < length) {
    const plaintextChunk = plaintext.slice(index * chunkSize, (index + 1) * chunkSize);
    const encodedText = new TextEncoder().encode(plaintextChunk);
    iv[0] = index & 0xff;
    const bufCiphertext: ArrayBuffer = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, encodedText);
    ciphertext.push(arrayBufferToBase64(bufCiphertext));
    index++;
  }

  return {
    ciphertext,
    key: masterKeyToString(key).slice(0, 43),
  };
}

export async function decryptString(encryptedData: EncryptedString) {
  const aesKey = await window.crypto.subtle.importKey(
    "raw",
    base64ToArrayBuffer(encryptedData.key),
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["decrypt"]
  );
  const iv = new Uint8Array(1);

  const plaintext = [];

  for (let index = 0; index < encryptedData.ciphertext.length; index++) {
    const ciphertextChunk = encryptedData.ciphertext[index];
    iv[0] = index & 0xff;
    const ciphertextBuf = base64ToArrayBuffer(ciphertextChunk);
    const plaintextChunk = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, ciphertextBuf);
    plaintext.push(new TextDecoder().decode(plaintextChunk));
  }
  return plaintext.join("");
}

async function sha(algorithm: string, data: string | ArrayBuffer) {
  let uint8Array;
  if (typeof data === "string") {
    const encoder = new TextEncoder();
    uint8Array = encoder.encode(data);
  } else {
    uint8Array = data;
  }
  const hash = await crypto.subtle.digest(algorithm, uint8Array);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256(data: string | ArrayBuffer) {
  return sha("SHA-256", data);
}

export async function sha1(data: string | ArrayBuffer) {
  return sha("SHA-1", data);
}

export async function shortHash(text: string) {
  return (await sha256(text)).slice(0, 32);
}

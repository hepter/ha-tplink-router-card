from __future__ import annotations

from base64 import b64decode, b64encode
from dataclasses import dataclass
from urllib.parse import parse_qs

from Crypto.Cipher import AES, PKCS1_v1_5
from Crypto.PublicKey import RSA


@dataclass
class RsaKeyPair:
    private_key: RSA.RsaKey

    @classmethod
    def generate(cls, bits: int = 2048) -> "RsaKeyPair":
        return cls(private_key=RSA.generate(bits))

    @property
    def n_hex(self) -> str:
        return format(self.private_key.n, "x")

    @property
    def e_hex(self) -> str:
        return format(self.private_key.e, "x")

    @property
    def block_size_bytes(self) -> int:
        return (self.private_key.size_in_bits() + 7) // 8

    def decrypt_sign_chunks(self, sign_hex: str) -> str:
        """Decrypt concatenated RSA-PKCS1-v1_5 chunks used in TP-Link sign payload."""
        cipher = PKCS1_v1_5.new(self.private_key)
        block_hex_len = self.block_size_bytes * 2
        parts: list[str] = []
        for i in range(0, len(sign_hex), block_hex_len):
            chunk_hex = sign_hex[i : i + block_hex_len]
            if not chunk_hex:
                continue
            decrypted = cipher.decrypt(bytes.fromhex(chunk_hex), b"")
            parts.append(decrypted.decode("utf-8", errors="ignore"))
        return "".join(parts).rstrip("\x00")


@dataclass
class AesCbcContext:
    key: bytes
    iv: bytes

    @classmethod
    def from_ascii(cls, key: str, iv: str) -> "AesCbcContext":
        return cls(key=key.encode("utf-8"), iv=iv.encode("utf-8"))

    def decrypt_b64(self, encrypted_b64: str) -> str:
        raw = b64decode(encrypted_b64)
        cipher = AES.new(self.key, AES.MODE_CBC, self.iv)
        decrypted = cipher.decrypt(raw)
        pad_len = decrypted[-1]
        if pad_len < 1 or pad_len > AES.block_size:
            raise ValueError("Invalid PKCS7 padding")
        return decrypted[:-pad_len].decode("utf-8")

    def encrypt_b64(self, plaintext: str) -> str:
        data = plaintext.encode("utf-8")
        pad_len = AES.block_size - (len(data) % AES.block_size)
        padded = data + bytes([pad_len]) * pad_len
        cipher = AES.new(self.key, AES.MODE_CBC, self.iv)
        return b64encode(cipher.encrypt(padded)).decode("utf-8")


def parse_form_body(raw: bytes) -> dict[str, str]:
    parsed = parse_qs(raw.decode("utf-8", errors="ignore"), keep_blank_values=True)
    return {key: values[-1] if values else "" for key, values in parsed.items()}


def parse_sign_payload(raw: bytes) -> tuple[str | None, str | None]:
    fields = parse_form_body(raw)
    sign = fields.get("sign")
    data = fields.get("data")
    return sign, data

"""Encrypted pg_dump/pg_restore pipeline. Provision PG* connection variables and BACKUP_KEY externally."""
import argparse
import base64
import os
import struct
import subprocess
import sys

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

MAGIC = b"DXBIHB1\x00"
CHUNK = 1024 * 1024


def encrypt(source, target, key):
    cipher = AESGCM(key)
    target.write(MAGIC)
    counter = 0
    while True:
        block = source.read(CHUNK)
        nonce = os.urandom(12)
        payload = cipher.encrypt(nonce, block, MAGIC + counter.to_bytes(8, "big"))
        target.write(struct.pack(">I", len(payload)) + nonce + payload)
        counter += 1
        if not block:
            break


def decrypt(source, target, key):
    cipher = AESGCM(key)
    if source.read(len(MAGIC)) != MAGIC:
        raise ValueError("invalid_backup_format")
    counter = 0
    while True:
        size_bytes = source.read(4)
        if len(size_bytes) != 4:
            raise ValueError("truncated_backup")
        size = struct.unpack(">I", size_bytes)[0]
        if not 16 <= size <= CHUNK + 16:
            raise ValueError("invalid_backup_record")
        nonce, payload = source.read(12), source.read(size)
        if len(nonce) != 12 or len(payload) != size:
            raise ValueError("truncated_backup")
        block = cipher.decrypt(nonce, payload, MAGIC + counter.to_bytes(8, "big"))
        counter += 1
        if not block:
            if source.read(1):
                raise ValueError("unexpected_backup_trailer")
            return
        if target:
            target.write(block)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["backup", "verify", "restore"])
    parser.add_argument("file")
    args = parser.parse_args()
    key = base64.b64decode(os.environ["BACKUP_KEY"], validate=True)
    if len(key) != 32:
        raise ValueError("BACKUP_KEY_must_encode_32_random_bytes")
    if args.action == "backup":
        # Exclusive creation prevents overwriting a prior backup. No plaintext intermediate file.
        with open(args.file, "xb") as target:
            process = subprocess.Popen(["pg_dump", "--format=custom", "--no-owner"], stdout=subprocess.PIPE)
            try:
                encrypt(process.stdout, target, key)
                if process.wait() != 0:
                    raise RuntimeError("pg_dump_failed")
            finally:
                if process.poll() is None:
                    process.terminate()
    else:
        with open(args.file, "rb") as source:
            # Authenticate the complete archive before allowing any database writes.
            decrypt(source, None, key)
            if args.action == "restore":
                source.seek(0)
                process = subprocess.Popen(["pg_restore", "--dbname", os.environ["PGDATABASE"], "--single-transaction", "--exit-on-error", "--no-owner"], stdin=subprocess.PIPE)
                try:
                    decrypt(source, process.stdin, key)
                    process.stdin.close()
                    if process.wait() != 0:
                        raise RuntimeError("pg_restore_failed")
                finally:
                    if process.poll() is None:
                        process.terminate()
    print("backup_operation_verified")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("backup_operation_failed", file=sys.stderr)
        sys.exit(1)

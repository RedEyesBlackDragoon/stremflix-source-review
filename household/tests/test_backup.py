import importlib.util
import io
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location("backup", Path(__file__).parents[2] / "tools/household/backup.py")
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


def test_backup_cipher_roundtrip_and_tamper_rejection():
    key = bytes(range(32))
    original = b"Synthetic fixture data only" * 60000
    encrypted = io.BytesIO()
    backup.encrypt(io.BytesIO(original), encrypted, key)
    result = io.BytesIO()
    backup.decrypt(io.BytesIO(encrypted.getvalue()), result, key)
    assert result.getvalue() == original
    altered = bytearray(encrypted.getvalue())
    altered[100] ^= 1
    with pytest.raises(Exception):
        backup.decrypt(io.BytesIO(altered), None, key)
    with pytest.raises(ValueError):
        backup.decrypt(io.BytesIO(encrypted.getvalue()[:-4]), None, key)

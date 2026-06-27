import zstandard

from apps.transport.nats_worker import (
    ENCODING_NONE,
    ENCODING_ZSTD,
    FRAME_VERSION,
    ZSTD_LEVEL,
    decode_frame,
    encode_frame,
)


def test_decode_frame_handles_uncompressed_payload():
    payload = b""
    frame = encode_frame(payload)
    assert frame == bytes([FRAME_VERSION, ENCODING_NONE])
    assert decode_frame(frame) == payload


def test_decode_frame_handles_zstd_without_content_size():
    payload = b"{\"value\": 42}"
    compressor = zstandard.ZstdCompressor(level=ZSTD_LEVEL, write_content_size=False)
    frame = bytes([FRAME_VERSION, ENCODING_ZSTD]) + compressor.compress(payload)
    assert decode_frame(frame) == payload


def test_decode_frame_handles_standard_zstd_frame():
    payload = b"standard frame"
    frame = encode_frame(payload)
    assert frame[0] == FRAME_VERSION
    assert frame[1] == ENCODING_ZSTD
    assert decode_frame(frame) == payload

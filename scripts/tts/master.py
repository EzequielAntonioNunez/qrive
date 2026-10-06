"""Masterizado de locuciones para Unity: deja todas las voces con el mismo nivel y acabado de estudio.

Cadena (en este orden):
  1. mono y remuestreo a 48 kHz
  2. paso alto de 70 Hz (quita retumbe y continua)
  3. de-esser suave por bandas (sibilantes por encima de ~6,5 kHz, como máximo -6 dB)
  4. compresión ligera (2:1, ataque 8 ms, relajación 150 ms)
  5. recorte de silencios inicial y final dejando ~120 ms
  6. sonoridad a -16 LUFS integrados (pyloudnorm, MIT) con pico verdadero <= -1 dBTP (limitador con
     sobremuestreo x4)
  7. fundidos de 10 ms y WAV PCM de 16 bits

Solo usa numpy, scipy, soundfile y pyloudnorm, así que funciona en cualquiera de los entornos de
.local-state/tts. Se puede importar (master_array / master_file) o usar como orden:
  python scripts/tts/master.py entrada.wav [más.wav ...] --out carpeta/   (o --in-place)
"""

from __future__ import annotations

import argparse
import math
import pathlib

import numpy as np
import pyloudnorm as pyln
import soundfile as sf
from scipy import signal

SR = 48000
TARGET_LUFS = -16.0
CEILING_DBTP = -1.0


def _db(x: np.ndarray | float) -> np.ndarray | float:
    return 20 * np.log10(np.maximum(np.abs(x), 1e-12))


def _envelope(x: np.ndarray, sr: int, attack_ms: float, release_ms: float) -> np.ndarray:
    """Seguidor de envolvente de pico con ataque y relajación distintos."""
    a = math.exp(-1.0 / (sr * attack_ms / 1000))
    r = math.exp(-1.0 / (sr * release_ms / 1000))
    out = np.empty_like(x)
    level = 0.0
    for i, value in enumerate(np.abs(x)):
        coef = a if value > level else r
        level = coef * level + (1 - coef) * value
        out[i] = level
    return out


def to_mono_48k(audio: np.ndarray, sr: int) -> np.ndarray:
    if audio.ndim == 2:
        audio = audio.mean(axis=1)
    audio = audio.astype(np.float64)
    if sr != SR:
        g = math.gcd(sr, SR)
        audio = signal.resample_poly(audio, SR // g, sr // g)
    return audio


def highpass(x: np.ndarray, cutoff: float = 70.0) -> np.ndarray:
    sos = signal.butter(4, cutoff, "highpass", fs=SR, output="sos")
    return signal.sosfiltfilt(sos, x)


def deess(x: np.ndarray, split_hz: float = 6500.0, max_cut_db: float = 6.0, ratio: float = 3.0) -> np.ndarray:
    """De-esser por bandas: solo atenúa la banda alta cuando domina sobre la voz (las «s» y «z»)."""
    sos = signal.butter(4, split_hz, "highpass", fs=SR, output="sos")
    high = signal.sosfiltfilt(sos, x)
    low = x - high  # complementaria y en fase (filtro de fase cero)
    env_high = _envelope(high, SR, 1.0, 40.0)
    env_full = _envelope(x, SR, 1.0, 40.0)
    # Umbral relativo: la banda alta no debería pasar de ~-12 dB respecto a la señal completa.
    excess = _db(env_high) - (_db(env_full) - 12.0)
    cut = np.clip(excess * (1 - 1 / ratio), 0, max_cut_db)
    return low + high * 10 ** (-cut / 20)


def compress(x: np.ndarray, threshold_db: float = -24.0, ratio: float = 2.0, knee_db: float = 6.0) -> np.ndarray:
    """Compresión ligera; se espera la señal prenormalizada a ~-20 LUFS."""
    env = _db(_envelope(x, SR, 8.0, 150.0))
    over = env - threshold_db
    gain = np.where(
        over <= -knee_db / 2,
        0.0,
        np.where(
            over >= knee_db / 2,
            over * (1 / ratio - 1),
            (1 / ratio - 1) * (over + knee_db / 2) ** 2 / (2 * knee_db),
        ),
    )
    return x * 10 ** (gain / 20)


def trim(x: np.ndarray, pad_ms: float = 120.0, threshold_db: float = -45.0) -> np.ndarray:
    """Recorta silencio inicial y final (ventanas de 10 ms por debajo de -45 dB respecto al pico)."""
    hop = SR // 100
    frames = len(x) // hop
    if frames == 0:
        return x
    rms = np.sqrt(np.mean(x[: frames * hop].reshape(frames, hop) ** 2, axis=1))
    active = np.nonzero(_db(rms) > _db(np.max(np.abs(x))) + threshold_db)[0]
    if len(active) == 0:
        return x
    pad = int(SR * pad_ms / 1000)
    start = max(0, active[0] * hop - pad)
    end = min(len(x), (active[-1] + 1) * hop + pad)
    return x[start:end]


def true_peak(x: np.ndarray) -> float:
    return float(_db(np.max(np.abs(signal.resample_poly(x, 4, 1)))))


def limit(x: np.ndarray, ceiling_db: float = CEILING_DBTP, lookahead_ms: float = 5.0, release_ms: float = 60.0) -> np.ndarray:
    """Limitador con anticipación sobre el pico verdadero (sobremuestreo x4)."""
    ceiling = 10 ** ((ceiling_db - 0.1) / 20)
    over = np.abs(signal.resample_poly(x, 4, 1)).reshape(-1, 4).max(axis=1)[: len(x)]
    over = np.pad(over, (0, len(x) - len(over)))
    need = np.minimum(1.0, ceiling / np.maximum(over, 1e-12))
    if need.min() >= 1.0:
        return x
    look = max(1, int(SR * lookahead_ms / 1000))
    # Mínimo en una ventana que mira hacia delante: la ganancia baja antes de que llegue el pico.
    padded = np.pad(need, (0, look - 1), constant_values=1.0)
    held = np.lib.stride_tricks.sliding_window_view(padded, look).min(axis=1)
    r = math.exp(-1.0 / (SR * release_ms / 1000))
    gain = np.empty_like(held)
    level = 1.0
    for i, target in enumerate(held):
        level = target if target < level else r * level + (1 - r) * target
        gain[i] = level
    # Suaviza el ataque con una media móvil de la misma longitud que la anticipación.
    gain = np.minimum(gain, np.convolve(held, np.ones(look) / look, mode="same"))
    return x * gain


def loudness(x: np.ndarray) -> float:
    return float(pyln.Meter(SR).integrated_loudness(x))


def fade(x: np.ndarray, ms: float = 10.0) -> np.ndarray:
    n = min(len(x) // 2, int(SR * ms / 1000))
    if n > 0:
        ramp = np.linspace(0.0, 1.0, n)
        x = x.copy()
        x[:n] *= ramp
        x[-n:] *= ramp[::-1]
    return x


def master_array(audio: np.ndarray, sr: int, target_lufs: float = TARGET_LUFS) -> np.ndarray:
    x = to_mono_48k(audio, sr)
    x = highpass(x)
    x = x * 10 ** ((-20.0 - loudness(x)) / 20)  # nivel de trabajo conocido para de-esser y compresor
    x = deess(x)
    x = compress(x)
    x = trim(x)
    for _ in range(4):  # el limitador baja un poco la sonoridad: se reajusta hasta converger
        x = x * 10 ** ((target_lufs - loudness(x)) / 20)
        x = limit(x)
        if abs(loudness(x) - target_lufs) < 0.1 and true_peak(x) <= CEILING_DBTP:
            break
    return np.clip(fade(x), -1.0, 1.0)


def master_file(src: str | pathlib.Path, dst: str | pathlib.Path, target_lufs: float = TARGET_LUFS) -> dict:
    audio, sr = sf.read(str(src), always_2d=False)
    x = master_array(audio, sr, target_lufs)
    pathlib.Path(dst).parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(dst), x, SR, subtype="PCM_16")
    x16, _ = sf.read(str(dst))
    return {"file": str(dst), "seconds": round(len(x16) / SR, 2), "lufs": round(loudness(x16), 2), "dbtp": round(true_peak(x16), 2)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("inputs", nargs="+")
    parser.add_argument("--out", help="carpeta de salida (mismo nombre de archivo)")
    parser.add_argument("--in-place", action="store_true")
    parser.add_argument("--lufs", type=float, default=TARGET_LUFS)
    args = parser.parse_args()
    if not args.out and not args.in_place:
        parser.error("indica --out o --in-place")
    for src in map(pathlib.Path, args.inputs):
        dst = src if args.in_place else pathlib.Path(args.out) / src.name
        info = master_file(src, dst, args.lufs)
        print(f"{info['file']}  {info['seconds']} s  {info['lufs']} LUFS  {info['dbtp']} dBTP")


if __name__ == "__main__":
    main()

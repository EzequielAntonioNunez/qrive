"""Crea la voz de referencia femenina de Elena con Kokoro-82M (Apache 2.0, voz sintética ef_dora).

Chatterbox clona el timbre de una grabación de referencia. Usar una voz sintética evita clonar a una
persona real; cuando haya una locutora contratada con consentimiento, su grabación sustituye a este archivo.

Uso: python scripts/tts/make_reference.py --out .local-state/tts/elena-reference.wav
"""

import argparse

try:
    import truststore

    truststore.inject_into_ssl()
except ImportError:
    pass

import numpy as np
import soundfile as sf
from kokoro import KPipeline

TEXT = (
    "Buenos días. Antes de empezar, quiero agradeceros que hayáis venido. "
    "Vamos a revisar juntos las condiciones del contrato con calma, "
    "y estoy segura de que encontraremos una solución razonable para ambas partes."
)
TEXT_EN = (
    "Good morning, and thank you for coming. Before we start, I would like us to review "
    "the conditions calmly, and I am sure we will find a reasonable solution together."
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--voice", default="ef_dora")
    parser.add_argument("--speed", type=float, default=0.95)
    parser.add_argument("--semitones", type=float, default=0.0, help="sube el tono de la referencia (voz más aguda)")
    args = parser.parse_args()

    # Las voces af_/bf_ son inglesas: leen un texto en inglés y Chatterbox solo toma su timbre
    # (con --cfg bajo en generate_voice.py para no heredar el acento).
    english = args.voice[:1] in ("a", "b")
    pipeline = KPipeline(lang_code="a" if english else "e", repo_id="hexgrad/Kokoro-82M")
    text = TEXT_EN if english else TEXT
    chunks = [audio for _, _, audio in pipeline(text, voice=args.voice, speed=args.speed)]
    audio = np.concatenate([np.asarray(chunk) for chunk in chunks])
    if args.semitones:
        # Solo se transforma la referencia: Chatterbox resintetiza la voz y evita el timbre metálico
        # que tendría subir el tono del audio final.
        import torch
        import torchaudio.functional as F

        shifted = F.pitch_shift(torch.from_numpy(audio).float().unsqueeze(0), 24000, n_steps=args.semitones)
        audio = shifted.squeeze(0).numpy()
    sf.write(args.out, audio, 24000)
    print(f"{args.out}  ({len(audio) / 24000:.1f} s)")


if __name__ == "__main__":
    main()

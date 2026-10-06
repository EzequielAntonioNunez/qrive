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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--voice", default="ef_dora")
    parser.add_argument("--speed", type=float, default=0.95)
    args = parser.parse_args()

    pipeline = KPipeline(lang_code="e", repo_id="hexgrad/Kokoro-82M")
    chunks = [audio for _, _, audio in pipeline(TEXT, voice=args.voice, speed=args.speed)]
    audio = np.concatenate([np.asarray(chunk) for chunk in chunks])
    sf.write(args.out, audio, 24000)
    print(f"{args.out}  ({len(audio) / 24000:.1f} s)")


if __name__ == "__main__":
    main()

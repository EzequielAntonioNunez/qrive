"""Genera las locuciones de Elena con Chatterbox Multilingual (Resemble AI, MIT) en local.

Las voces se generan una vez y se incluyen como WAV en Unity: en tiempo de ejecución no hay
ningún servicio ni clave de IA. Chatterbox añade una marca de agua inaudible (Perth) que permite
identificar el audio como sintético.

Uso (entorno en .local-state/tts, ver README):
  python scripts/tts/generate_voice.py --out .local-state/tts/samples --variants
  python scripts/tts/generate_voice.py --out unity/AXYRO.Simulation/Assets/AXYRO/Audio --exaggeration 0.4 --cfg 0.4
"""

import argparse
import pathlib

try:  # Usa el almacén de certificados de Windows (redes con inspección TLS).
    import truststore

    truststore.inject_into_ssl()
except ImportError:
    pass

import torch
import torchaudio as ta
from chatterbox.mtl_tts import ChatterboxMultilingualTTS

# Mismo texto que characterLine del escenario de catálogo (shared/simulation.ts).
LINES = {
    "prepare": "Gracias por venir. Nuestros costes han subido y necesitamos revisar el precio. "
    "Si encontramos una propuesta equilibrada, podremos seguir trabajando juntos.",
    "counteroffer": "Podría reducir la subida si acordamos tres años de colaboración. "
    "Necesito saber qué garantías y compromisos estaríais dispuestos a aceptar.",
    "close": "Estamos cerca de un acuerdo. Para cerrarlo hoy, necesito una decisión final "
    "y una forma clara de comprobar que cumplimos los compromisos.",
}

# Combinaciones para escuchar y elegir: exageración (expresividad) y cfg (ritmo/adherencia).
VARIANTS = {
    "a-sobria": (0.35, 0.4),
    "b-natural": (0.5, 0.5),
    "c-expresiva": (0.7, 0.3),
}


def normalize(wav: torch.Tensor, peak: float = 0.89) -> torch.Tensor:
    """Ajusta el pico a -1 dBFS para que las tres frases suenen al mismo nivel."""
    top = wav.abs().max()
    return wav if top == 0 else wav * (peak / top)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--voice", help="WAV de referencia (5-15 s) con consentimiento de la persona")
    parser.add_argument("--exaggeration", type=float, default=0.4)
    parser.add_argument("--cfg", type=float, default=0.4)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--variants", action="store_true", help="genera las variantes de VARIANTS")
    args = parser.parse_args()

    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = ChatterboxMultilingualTTS.from_pretrained(device=device)

    settings = VARIANTS if args.variants else {"": (args.exaggeration, args.cfg)}
    for label, (exaggeration, cfg) in settings.items():
        for key, text in LINES.items():
            torch.manual_seed(args.seed)
            wav = model.generate(
                text,
                language_id="es",
                audio_prompt_path=args.voice,
                exaggeration=exaggeration,
                cfg_weight=cfg,
            )
            name = f"{label}-{key}.wav" if label else f"{key}.wav"
            ta.save(str(out / name), normalize(wav.cpu()), model.sr)
            print(f"{out / name}  ({wav.shape[-1] / model.sr:.1f} s)")


if __name__ == "__main__":
    main()

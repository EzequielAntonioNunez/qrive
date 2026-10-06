"""Genera locuciones con Parler-TTS Mini Multilingual v1.1 (Hugging Face, Apache 2.0) en local.

Parler no clona a nadie: la voz se describe con texto (en inglés) y el modelo crea una voz sintética
que encaja con la descripción. No se usan los nombres de locutores del conjunto de entrenamiento.
Una misma descripción con otra semilla puede dar otra voz, por eso Parler se usa sobre todo para
crear la referencia que luego clona Chatterbox (generate_voice.py --voice), que sí mantiene el timbre
estable entre frases.

Necesita su propio entorno (.local-state/tts/.venv-parler: parler-tts fija transformers 4.46 y
Chatterbox usa la 5.x). Ver README de scripts/tts en el informe de voz.

Uso:
  # referencia neutra (frase distinta a las de los escenarios) para Chatterbox
  python scripts/tts/generate_parler.py --reference --description warm --seed 3 \
      --out .local-state/tts/parler --master
  # frases de los escenarios
  python scripts/tts/generate_parler.py --lines .local-state/tts/lines.json --only datos-personales \
      --description warm calm --seed 1 2 3 --out .local-state/tts/parler --master
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

try:  # Usa el almacén de certificados de Windows (redes con inspección TLS).
    import truststore

    truststore.inject_into_ssl()
except ImportError:
    pass

import soundfile as sf
import torch
from parler_tts import ParlerTTSForConditionalGeneration
from transformers import AutoTokenizer

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from master import master_array  # noqa: E402

MODEL = "parler-tts/parler-tts-mini-multilingual-v1.1"

# Descripciones probadas (sin nombres de locutores reales).
DESCRIPTIONS = {
    "warm": (
        "A professional female Spanish speaker with a warm, clear and confident voice delivers her words "
        "at a calm, moderate pace in a very close-sounding studio recording with very clear audio and no background noise."
    ),
    "calm": (
        "A female speaker with a warm, slightly low-pitched and gentle voice speaks Spanish slowly and clearly, "
        "with a natural and friendly intonation. The recording is very clean and close-sounding, with no background noise."
    ),
    "narrator": (
        "A confident female narrator speaks Spanish with a clear, friendly and expressive voice at a moderate, "
        "unhurried pace. The recording is of very high quality, with her voice sounding clear and very close up."
    ),
}

# Frase neutra de 10-15 s para usar como referencia de timbre (no aparece en ningún escenario).
REFERENCE_TEXT = (
    "Bienvenidos a esta sesión de formación. Durante los próximos minutos vamos a repasar, paso a paso, "
    "algunas situaciones habituales del trabajo diario. Tomaos el tiempo que necesitéis para pensar cada respuesta."
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--lines", help="JSON {idDeFase: frase} de scripts/tts/export-lines.mjs")
    parser.add_argument("--only", nargs="*", help="genera solo estos ids de fase")
    parser.add_argument("--reference", action="store_true", help="genera la frase neutra de referencia")
    parser.add_argument("--description", nargs="+", default=["warm"], help=f"claves de {list(DESCRIPTIONS)} o texto libre")
    parser.add_argument("--seed", nargs="+", type=int, default=[1])
    parser.add_argument("--master", action="store_true", help="aplica master.py (48 kHz, -16 LUFS)")
    parser.add_argument("--flat", action="store_true", help="nombra los archivos <idDeFase>.wav (una descripción y semilla)")
    args = parser.parse_args()

    if args.reference:
        lines = {"referencia": REFERENCE_TEXT}
    elif args.lines:
        lines = json.loads(pathlib.Path(args.lines).read_text(encoding="utf-8"))
        if args.only:
            lines = {key: value for key, value in lines.items() if key in args.only}
    else:
        parser.error("indica --lines o --reference")
    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = ParlerTTSForConditionalGeneration.from_pretrained(MODEL).to(device)
    tokenizer = AutoTokenizer.from_pretrained(MODEL)
    description_tokenizer = AutoTokenizer.from_pretrained(model.config.text_encoder._name_or_path)
    sr = model.config.sampling_rate

    for desc_key in args.description:
        description = DESCRIPTIONS.get(desc_key, desc_key)
        label = desc_key if desc_key in DESCRIPTIONS else "custom"
        desc_ids = description_tokenizer(description, return_tensors="pt").to(device)
        for seed in args.seed:
            for key, text in lines.items():
                torch.manual_seed(seed)
                prompt = tokenizer(text, return_tensors="pt").to(device)
                with torch.inference_mode():
                    audio = model.generate(
                        input_ids=desc_ids.input_ids,
                        attention_mask=desc_ids.attention_mask,
                        prompt_input_ids=prompt.input_ids,
                        prompt_attention_mask=prompt.attention_mask,
                        do_sample=True,
                        temperature=1.0,
                    )
                wav = audio.cpu().float().numpy().squeeze()
                if args.master:
                    wav, rate = master_array(wav, sr), 48000
                else:
                    rate = sr
                name = f"{key}.wav" if args.flat else f"parler-{label}-s{seed}-{key}.wav"
                sf.write(str(out / name), wav, rate, subtype="PCM_16")
                print(f"{out / name}  ({len(wav) / rate:.1f} s)", flush=True)


if __name__ == "__main__":
    main()

using System;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using UnityEngine;

namespace Axyro
{
    /// <summary>Puente de la escena WebGL con el micrófono y Soniox del navegador.</summary>
    [DisallowMultipleComponent]
    public sealed class AxyroWebVoice : MonoBehaviour
    {
        [SerializeField] private AxyroSessionClient session;
        [SerializeField] private AxyroAvatarDemo avatar;

#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")] private static extern void AxyroVoiceSetState(int speaking, int canDecide, int optionCount);

        private int lastSpeaking = -1;
        private int lastCanDecide = -1;
        private int lastOptionCount = -1;

        private void Update()
        {
            var speaking = avatar != null && avatar.IsSpeaking ? 1 : 0;
            var canDecide = session != null && session.CanDecide ? 1 : 0;
            var count = session != null ? session.VisibleOptionCount : 0;
            if (speaking == lastSpeaking && canDecide == lastCanDecide && count == lastOptionCount) return;
            lastSpeaking = speaking;
            lastCanDecide = canDecide;
            lastOptionCount = count;
            AxyroVoiceSetState(speaking, canDecide, count);
        }

        // Los tres métodos son invocados por SendMessage desde voice.js en el hilo principal del navegador.
        public void OnWebVoiceState(string value) => avatar?.SetListening(value == "1");

        public void OnWebVoiceInterrupt(string unused) => avatar?.InterruptVoice();

        public void OnWebVoiceTranscript(string phrase)
        {
            var normalized = Normalize(phrase);
            if (string.IsNullOrEmpty(normalized)) return;
            if (normalized == "repetir" || normalized == "repite" || normalized == "escuchar" ||
                normalized == "otra vez" || normalized == "vuelve a repetir")
            {
                avatar?.ToggleVoice();
                return;
            }
            if (session == null || !session.CanDecide || session.VisibleOptionCount == 0) return;
            var words = normalized.Split(' ');
            var option = -1;
            foreach (var word in words)
            {
                var next = word == "1" || word == "uno" || word == "primera" || word == "primero" ? 0 :
                    word == "2" || word == "dos" || word == "segunda" || word == "segundo" ? 1 :
                    word == "3" || word == "tres" || word == "tercera" || word == "tercero" ? 2 :
                    word == "4" || word == "cuatro" || word == "cuarta" || word == "cuarto" ? 3 : -1;
                if (next < 0) continue;
                if (option >= 0 && option != next) return; // Ambigua: nunca decidir por una frase con dos números.
                option = next;
            }
            if (option >= 0 && option < session.VisibleOptionCount) session.SelectOption(option);
        }

        private static string Normalize(string value)
        {
            if (string.IsNullOrWhiteSpace(value)) return "";
            var decomposed = value.ToLowerInvariant().Normalize(NormalizationForm.FormD);
            var output = new StringBuilder(decomposed.Length);
            foreach (var ch in decomposed)
            {
                if (CharUnicodeInfo.GetUnicodeCategory(ch) == UnicodeCategory.NonSpacingMark) continue;
                output.Append(char.IsLetterOrDigit(ch) ? ch : ' ');
            }
            return string.Join(" ", output.ToString().Split((char[])null, StringSplitOptions.RemoveEmptyEntries));
        }
#endif
    }
}

using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using UnityEngine.UI;
#if UNITY_STANDALONE_WIN || UNITY_EDITOR_WIN
using UnityEngine.Windows.Speech;
#endif

namespace Axyro
{
    /// <summary>
    /// Respuesta por voz del participante con el reconocedor local de Windows (palabras clave).
    /// El reconocimiento se hace en el propio equipo: no se graba ni se envía audio a ningún sitio.
    /// Ratón y teclado siguen siendo la alternativa cuando la voz no está disponible.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class AxyroVoiceCommands : MonoBehaviour
    {
        private const string UnavailableText = "Voz no disponible · elige con el ratón";

        [SerializeField] private AxyroSessionClient session;
        [SerializeField] private AxyroAvatarDemo avatar;
        [SerializeField] private Text status;

#if UNITY_STANDALONE_WIN || UNITY_EDITOR_WIN
        private const string OptionsText = "Te escucho · di «uno», «dos» o «tres»";
        private const string ListenOnlyText = "Te escucho · di «repetir» para oírla otra vez";
        private const float HeardSeconds = 2f;
        private const int ListenCommand = -1;

        // Frase reconocida → índice de opción (0..3) o ListenCommand para escuchar la intervención.
        private static readonly Dictionary<string, int> Commands = new Dictionary<string, int>
        {
            { "uno", 0 }, { "opción uno", 0 }, { "primera", 0 }, { "la primera", 0 },
            { "dos", 1 }, { "opción dos", 1 }, { "segunda", 1 }, { "la segunda", 1 },
            { "tres", 2 }, { "opción tres", 2 }, { "tercera", 2 }, { "la tercera", 2 },
            { "cuatro", 3 }, { "opción cuatro", 3 }, { "cuarta", 3 }, { "la cuarta", 3 },
            { "escuchar", ListenCommand }, { "repetir", ListenCommand }, { "repite", ListenCommand }
        };

        private KeywordRecognizer recognizer;
        private bool unavailable;
        private bool listening;
        private bool hasFocus = true;
        private string heardText;
        private float heardUntil;
        // Los errores del sistema de voz se anotan aquí y se atienden en Update.
        private string pendingError;

        private void Start()
        {
            hasFocus = Application.isFocused;
            try
            {
                if (!PhraseRecognitionSystem.isSupported)
                {
                    MarkUnavailable("el reconocimiento de voz de Windows no está disponible en este equipo");
                    return;
                }
                recognizer = new KeywordRecognizer(Commands.Keys.ToArray(), ConfidenceLevel.Medium);
                recognizer.OnPhraseRecognized += OnPhraseRecognized;
                PhraseRecognitionSystem.OnError += OnSpeechError;
            }
            catch (Exception exception)
            {
                // Sin micrófono, con la privacidad de voz desactivada o sin el idioma instalado.
                MarkUnavailable(exception.Message);
            }
        }

        private void OnApplicationFocus(bool focus) => hasFocus = focus;

        private void Update()
        {
            if (unavailable) return;
            if (pendingError != null)
            {
                MarkUnavailable(pendingError);
                return;
            }
            if (PhraseRecognitionSystem.Status == SpeechSystemStatus.Failed)
            {
                MarkUnavailable("el sistema de reconocimiento de voz ha fallado");
                return;
            }

            // El tutor no debe oírse a sí mismo: mientras habla, el micrófono queda cerrado.
            var speaking = avatar != null && avatar.IsSpeaking;
            var shouldListen = recognizer != null && hasFocus && !speaking;
            if (shouldListen != listening && !SetRecognizer(shouldListen)) return;

            var canDecide = session != null && session.CanDecide;
            string text;
            if (Time.unscaledTime < heardUntil) text = heardText;
            else if (listening) text = canDecide ? OptionsText : ListenOnlyText;
            else text = "";
            SetStatus(text);
        }

        private void OnDisable()
        {
            if (listening) SetRecognizer(false);
            if (!unavailable) SetStatus("");
        }

        private void OnDestroy()
        {
            PhraseRecognitionSystem.OnError -= OnSpeechError;
            if (recognizer == null) return;
            recognizer.OnPhraseRecognized -= OnPhraseRecognized;
            try
            {
                if (recognizer.IsRunning) recognizer.Stop();
                recognizer.Dispose();
            }
            catch (Exception exception)
            {
                Debug.LogWarning($"Voz: no se pudo liberar el reconocedor ({exception.Message}).");
            }
            recognizer = null;
        }

        /// <summary>Arranca o para el reconocedor; devuelve false si falla y la voz queda desactivada.</summary>
        private bool SetRecognizer(bool on)
        {
            try
            {
                if (on) recognizer.Start();
                else recognizer.Stop();
            }
            catch (Exception exception)
            {
                MarkUnavailable(exception.Message);
                return false;
            }
            listening = on;
            if (avatar != null) avatar.SetListening(on);
            return true;
        }

        private void OnPhraseRecognized(PhraseRecognizedEventArgs args)
        {
            if (unavailable || !listening || string.IsNullOrEmpty(args.text)) return;
            if (!Commands.TryGetValue(args.text, out var command)) return;

            if (command == ListenCommand)
            {
                if (avatar == null) return;
                avatar.ToggleVoice();
            }
            else
            {
                // Las opciones solo cuentan cuando hay tarjetas a la vista y aún no se ha decidido.
                if (session == null || !session.CanDecide) return;
                session.SelectOption(command);
            }

            heardText = $"Entendido: «{args.text}»";
            heardUntil = Time.unscaledTime + HeardSeconds;
            SetStatus(heardText);
        }

        private void OnSpeechError(SpeechError errorCode)
        {
            if (pendingError == null) pendingError = $"error del sistema de voz ({errorCode})";
        }

        /// <summary>Desactiva la voz de forma definitiva para esta ejecución; no se reintenta en cada frame.</summary>
        private void MarkUnavailable(string reason)
        {
            if (unavailable) return;
            unavailable = true;
            Debug.LogWarning($"Voz desactivada: {reason}");
            if (recognizer != null)
            {
                try { if (recognizer.IsRunning) recognizer.Stop(); }
                catch (Exception) { /* El reconocedor ya no responde; se libera en OnDestroy. */ }
            }
            if (listening && avatar != null) avatar.SetListening(false);
            listening = false;
            SetStatus(UnavailableText);
        }
#else
        // Fuera de Windows no hay reconocedor local: el componente queda inactivo.
        private void Start()
        {
            if (avatar != null) avatar.SetListening(false);
            _ = session;
            SetStatus(UnavailableText);
            enabled = false;
        }
#endif

        private void SetStatus(string text)
        {
            if (status != null && status.text != text) status.text = text;
        }
    }
}

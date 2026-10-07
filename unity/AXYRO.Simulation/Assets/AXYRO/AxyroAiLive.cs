using System;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.UI;

namespace Axyro
{
    /// <summary>
    /// Modo IA en vivo en 3D (<c>/simulador/?ia=&lt;runId&gt;</c>, solo WebGL): VictorIA conversa sobre situaciones
    /// generadas a partir de los documentos del docente. Toda la lógica de red y de voz vive en el navegador
    /// (plantilla UFV, <c>ai-live.js</c>): API del Modo IA, voz en tiempo real de Soniox (TTS) y escucha (STT).
    /// Unity no guarda ninguna clave ni llama a la IA: solo pinta lo que le llega por SendMessage y devuelve las
    /// órdenes del participante (tarjetas, teclas) con <c>AxyroAiCommand</c>.
    ///
    /// La boca no la mueve uLipSync (el audio suena en WebAudio, fuera de Unity): el navegador manda el nivel de la voz
    /// y un visema aproximado (<see cref="AxyroTutor3D.SetExternalLip"/>). La cámara (AxyroCinematics) reacciona sola
    /// porque observa el mismo estado público que en el flujo con sesión: fase, habla, reacción y opciones visibles.
    ///
    /// Sin <c>?ia=</c> (y siempre en Windows y en el editor) <see cref="Active"/> es false y el componente no hace
    /// nada: el flujo determinista con sesión queda intacto.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class AxyroAiLive : MonoBehaviour
    {
        [SerializeField] private AxyroAvatarDemo avatar;
        [SerializeField] private AxyroSessionClient session;
        [SerializeField] private AxyroTutor3D tutor;
        [SerializeField] private AxyroSceneScreen screen;
        [SerializeField] private AxyroDecisionFeedback feedback;

        private static bool? active;

        /// <summary>Instancia activa (solo en modo IA); las tarjetas de opciones le pasan los clics.</summary>
        public static AxyroAiLive Instance { get; private set; }

        /// <summary>Id de la partida de IA del enlace (<c>?ia=</c>); null fuera del modo IA.</summary>
        public static string RunId { get; private set; }

        /// <summary>True solo en WebGL con un <c>?ia=&lt;runId&gt;</c> válido en la URL.</summary>
        public static bool Active
        {
            get
            {
                if (!active.HasValue) active = Resolve();
                return active.Value;
            }
        }

        private static bool Resolve()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            if (!Uri.TryCreate(Application.absoluteURL, UriKind.Absolute, out var page)) return false;
            var id = AxyroSessionClient.QueryValue(page.Query, "ia");
            if (string.IsNullOrEmpty(id) || id.Length > 80 || !AxyroSessionClient.IsSafeId(id)) return false;
            RunId = id;
            return true;
#else
            return false;
#endif
        }

        private string[] options = Array.Empty<string>();
        private string phase = "loading";
        private int pending = -1;

        private void Awake()
        {
            if (!Active)
            {
                enabled = false;
                return;
            }
            Instance = this;
            if (avatar == null) avatar = FindAnyObjectByType<AxyroAvatarDemo>(FindObjectsInactive.Include);
            if (session == null) session = FindAnyObjectByType<AxyroSessionClient>(FindObjectsInactive.Include);
            if (tutor == null) tutor = FindAnyObjectByType<AxyroTutor3D>(FindObjectsInactive.Include);
            if (screen == null) screen = FindAnyObjectByType<AxyroSceneScreen>(FindObjectsInactive.Include);
            if (feedback == null) feedback = FindAnyObjectByType<AxyroDecisionFeedback>(FindObjectsInactive.Include);
            // Antes de cualquier Start: la escena arranca ya en modo IA (sin locución de la demo ni consulta de sesión).
            avatar?.EnterExternalMode();
            session?.EnterAiMode();
            tutor?.UseExternalLip(true);
        }

        // La pantalla construye su contenido con lo que prepara en su propio Awake: se espera a Start.
        private void Start()
        {
            screen?.ShowAiWaiting();
            // Transparencia (AI Act): el distintivo vive también en Unity para seguir visible con el lienzo a pantalla completa.
            var notice = session != null ? session.transform.Find("Aviso IA")?.GetComponent<Text>() : null;
            if (notice != null)
            {
                notice.text = "Generado con IA a partir de tus documentos · puede contener errores  ·  VictorIA es un personaje virtual con voz sintética";
                notice.horizontalOverflow = HorizontalWrapMode.Overflow;
            }
        }

        private void OnDestroy()
        {
            if (Instance == this) Instance = null;
        }

        private void Update()
        {
            // Teclado: alternativa accesible a la voz y al ratón. El navegador valida que la orden tenga sentido ahora.
            var keyboard = Keyboard.current;
            if (keyboard == null) return;
            if (keyboard.digit1Key.wasPressedThisFrame || keyboard.numpad1Key.wasPressedThisFrame) Choose(0);
            if (keyboard.digit2Key.wasPressedThisFrame || keyboard.numpad2Key.wasPressedThisFrame) Choose(1);
            if (keyboard.digit3Key.wasPressedThisFrame || keyboard.numpad3Key.wasPressedThisFrame) Choose(2);
            if (keyboard.digit4Key.wasPressedThisFrame || keyboard.numpad4Key.wasPressedThisFrame) Choose(3);
            if (phase == "confirm" && keyboard.sKey.wasPressedThisFrame) Command("confirm:1");
            if (phase == "confirm" && keyboard.nKey.wasPressedThisFrame) Command("confirm:0");
            if (keyboard.rKey.wasPressedThisFrame) Command("repeat");
        }

        /// <summary>Clic en una tarjeta o tecla 1-4.</summary>
        public void Choose(int index)
        {
            if (index < 0 || index >= options.Length) return;
            Command("choose:" + index.ToString(CultureInfo.InvariantCulture));
        }

        // ---------- Mensajes del navegador (SendMessage desde ai-live.js) ----------

        /// <summary>Situación nueva: {index,total,title,narration,options[],sources[]}.</summary>
        public void AiSituation(string json)
        {
            var data = Parse<SituationMessage>(json);
            if (data == null) return;
            options = data.options ?? Array.Empty<string>();
            pending = -1;
            var title = Clean(data.title);
            avatar?.SetExternalPhase(data.index, data.total, title);
            avatar?.SetSubtitle("");
            screen?.ShowAiSituation(title, Sanitize(data.sources), data.index, data.total);
            session?.ShowAiPanel(null);
            session?.ShowAiOptions(null, -1);
        }

        /// <summary>Momento de la conversación: {phase,pending,heard,status}.</summary>
        public void AiState(string json)
        {
            var data = Parse<StateMessage>(json);
            if (data == null) return;
            phase = data.phase ?? "";
            pending = data.pending;
            session?.SetAiStatus(Clean(data.status));
            switch (phase)
            {
                case "listening":
                case "confirm":
                    // Primero se escucha la situación; después, las opciones (como en el flujo con sesión).
                    session?.ShowAiOptions(Sanitize(options), phase == "confirm" ? pending : -1);
                    break;
                case "speaking":
                case "thinking":
                    // Las opciones ya visibles se mantienen mientras VictorIA responde a una pregunta o piensa.
                    break;
                default:
                    session?.ShowAiOptions(null, -1);
                    break;
            }
        }

        /// <summary>"0" en silencio, "1" hablando, "2" reaccionando a una decisión.</summary>
        public void AiSpeaking(string value)
        {
            var speaking = value == "1" || value == "2";
            avatar?.SetExternalSpeaking(speaking, value == "2");
            if (!speaking) tutor?.SetExternalLip(0f, AxyroTutor3D.VisemeRest);
        }

        /// <summary>Nivel de la voz (0-1) y visema aproximado: "0.42,3".</summary>
        public void AiLip(string value)
        {
            if (string.IsNullOrEmpty(value) || tutor == null) return;
            var separator = value.IndexOf(',');
            var levelText = separator < 0 ? value : value.Substring(0, separator);
            if (!float.TryParse(levelText, NumberStyles.Float, CultureInfo.InvariantCulture, out var level)) return;
            var viseme = AxyroTutor3D.VisemeA;
            if (separator >= 0) int.TryParse(value.Substring(separator + 1), NumberStyles.Integer, CultureInfo.InvariantCulture, out viseme);
            tutor.SetExternalLip(level, viseme);
        }

        /// <summary>
        /// Subtítulo sincronizado con el audio: "n|frase" (frase en curso; las n primeras palabras ya se han dicho y
        /// el resto se atenúa). Sin prefijo, texto tal cual.
        /// </summary>
        public void AiSubtitle(string value)
        {
            if (avatar == null) return;
            var separator = string.IsNullOrEmpty(value) ? -1 : value.IndexOf('|');
            if (separator <= 0 || !int.TryParse(value.Substring(0, separator), NumberStyles.Integer, CultureInfo.InvariantCulture, out var shown))
            {
                avatar.SetSubtitle(Clean(value));
                return;
            }
            var words = Clean(value.Substring(separator + 1)).Split((char[])null, StringSplitOptions.RemoveEmptyEntries);
            shown = Mathf.Clamp(shown, 0, words.Length);
            var said = string.Join(" ", words, 0, shown);
            var rest = string.Join(" ", words, shown, words.Length - shown);
            avatar.SetSubtitle(rest.Length == 0 ? said : $"{said} <color=#FFFFFF59>{rest}</color>");
        }

        /// <summary>Decisión registrada: {optionIndex,quality,label,consequence}.</summary>
        public void AiReaction(string json)
        {
            var data = Parse<ReactionMessage>(json);
            if (data == null) return;
            session?.ShowAiOptions(null, -1);
            // La valoración es de la decisión, nunca de la persona (AI Act).
            feedback?.Show(data.quality);
            tutor?.React(data.quality, 2f);
            var label = Clean(data.label);
            var consequence = Clean(data.consequence);
            var text = string.IsNullOrEmpty(label) ? consequence : $"<b>{label}</b>" + (string.IsNullOrEmpty(consequence) ? "" : "\n\n" + consequence);
            session?.ShowAiPanel(text);
        }

        /// <summary>Fin: {optimalCount,total,takeaways[]}.</summary>
        public void AiSummary(string json)
        {
            var data = Parse<SummaryMessage>(json);
            if (data == null) return;
            options = Array.Empty<string>();
            session?.ShowAiOptions(null, -1);
            avatar?.SetExternalHeading("RESUMEN");
            screen?.ShowAiSummary(data.optimalCount, data.total);
            var text = new StringBuilder();
            text.Append($"<b>{data.optimalCount} de {data.total} decisiones óptimas</b>");
            if (data.takeaways != null && data.takeaways.Length > 0)
            {
                text.Append("\n\n<color=#9CC2FF>Ideas clave</color>");
                foreach (var item in data.takeaways)
                    if (!string.IsNullOrWhiteSpace(item)) text.Append("\n• ").Append(Clean(item));
            }
            session?.ShowAiPanel(text.ToString());
        }

        /// <summary>Error que impide seguir (partida no encontrada, IA no disponible…).</summary>
        public void AiError(string message)
        {
            options = Array.Empty<string>();
            session?.ShowAiOptions(null, -1);
            session?.ShowAiPanel(string.IsNullOrEmpty(message) ? null : Clean(message));
        }

        // ---------- Utilidades ----------

        private static T Parse<T>(string json) where T : class
        {
            if (string.IsNullOrEmpty(json)) return null;
            try { return JsonUtility.FromJson<T>(json); }
            catch (ArgumentException) { return null; }
        }

        /// <summary>El texto generado no puede abrir etiquetas de texto enriquecido de Unity.</summary>
        private static string Clean(string value) => string.IsNullOrEmpty(value) ? "" : value.Replace('<', '‹').Replace('>', '›');

        private static string[] Sanitize(string[] values)
        {
            if (values == null) return Array.Empty<string>();
            var output = new string[values.Length];
            for (var i = 0; i < values.Length; i++) output[i] = Clean(values[i]);
            return output;
        }

#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")] private static extern void AxyroAiCommand(string command);
        private static void Command(string command) => AxyroAiCommand(command);
#else
        private static void Command(string command) => Debug.Log($"AXYRO_AI_COMMAND {command}");
#endif

        [Serializable] private sealed class SituationMessage { public int index; public int total; public string title; public string narration; public string[] options; public string[] sources; }
        [Serializable] private sealed class StateMessage { public string phase; public int pending = -1; public string status; }
        [Serializable] private sealed class ReactionMessage { public int optionIndex; public string quality; public string label; public string consequence; }
        [Serializable] private sealed class SummaryMessage { public int optimalCount; public int total; public string[] takeaways; }
    }
}

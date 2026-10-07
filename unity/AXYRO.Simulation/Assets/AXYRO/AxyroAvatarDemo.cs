using System;
using System.Collections;
using Rive;
using Rive.Components;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.UI;

namespace Axyro
{
    public sealed class AxyroAvatarDemo : MonoBehaviour
    {
        [SerializeField] private AxyroTutor3D tutor;
        [SerializeField] private RiveWidget hud;
        [SerializeField] private AudioSource voice;
        [SerializeField] private AudioClip[] lines;
        [SerializeField] private Text characterName;
        [SerializeField] private Text phaseTitle;
        [SerializeField] private Text dialogue;
        [SerializeField] private Text playLabel;
        [SerializeField] private Button playButton;
        [SerializeField] private Text inputHint;

        // Demo autónoma (sin sesión): escenario por defecto «Uso responsable de la IA en la universidad».
        private string[] titles = { "Datos personales", "Verificación", "Evaluación justa" };
        private string[] phaseIds = { "datos-personales", "verificacion", "evaluacion" };
        private string[] scripts = {
            "Tengo las notas y los comentarios de todos los alumnos en una hoja de cálculo. Si la pego en un chat de inteligencia artificial, nos redacta los informes en un momento. ¿Lo hacemos así?",
            "La inteligencia artificial me ha preparado un resumen de la nueva normativa con tres referencias legales. Suena muy convincente. ¿Lo enviamos tal cual al claustro?",
            "Un detector dice que este trabajo tiene un ochenta por ciento de probabilidad de estar hecho con inteligencia artificial. ¿Lo suspendemos directamente?"
        };

        private SMIBool hudSpeaking;
        private SMIBool hudListening;
        private bool listening;
        private int phase;
        private bool speaking;
        private bool linkedSession;
        private int phaseCount = 3;
        private string sessionStatus = "active";
        private Coroutine autoSpeak;
        private float speechStartedAt;
        // Reacción hablada a la decisión: corrutina de carga pendiente, si suena ahora y su subtítulo.
        private Coroutine pendingReaction;
        private bool reacting;
        private string reactionText;

        public bool IsSpeaking => speaking;

        /// <summary>True mientras suena la reacción de VictorIA a la decisión (no la situación).</summary>
        public bool IsReacting => reacting;

        /// <summary>Id de la fase que se muestra ahora (la demo sin sesión elige sus opciones con él).</summary>
        public string CurrentPhaseId => !external && phase >= 0 && phase < phaseIds.Length ? phaseIds[phase] : null;

        /// <summary>Índice de la fase visible (la pantalla de la sala y la cámara lo siguen).</summary>
        public int CurrentPhaseIndex => phase;

        /// <summary>Título de la fase visible.</summary>
        public string CurrentPhaseTitle => phase >= 0 && phase < titles.Length ? titles[phase] : null;

        /// <summary>Número de fases del escenario (tres en la demo sin sesión).</summary>
        public int PhaseCount => phaseCount;

        // Plazo máximo para que la situación quede planteada: aunque el audio no cargue, no suene, el dispositivo
        // de salida falle o el navegador lo bloquee, las opciones aparecen. LineFinished nunca se queda en false.
        private float lineDeadline = float.MaxValue;
        private const float NoClipSeconds = 3f;
        private const float ClipMarginSeconds = 2f;
        private const float AutoSpeakDelay = 1.2f;
#if UNITY_WEBGL && !UNITY_EDITOR
        // El navegador solo deja sonar audio tras un gesto del usuario: hasta entonces no hay locución automática.
        private bool userGesture;
        private const float GestureWaitSeconds = 6f;
#endif

        /// <summary>Aumenta en cada SetPhase, también al repetir la misma fase en la demo.</summary>
        public int PhaseVersion { get; private set; }

        /// <summary>
        /// True cuando el personaje ya ha planteado la situación actual (terminó o se detuvo la locución, o no hay audio).
        /// Las opciones se muestran a partir de ese momento: primero se escucha, después se decide.
        /// </summary>
        public bool LineFinished { get; private set; } = true;

        /// <summary>Ids de fase del escenario de la sesión: la locución se busca como Audio/&lt;id&gt;.wav.</summary>
        public void SetPhaseIds(string[] ids)
        {
            if (ids == null || ids.Length == 0) return;
            phaseIds = (string[])ids.Clone();
            if (titles.Length < ids.Length) Array.Resize(ref titles, ids.Length);
            if (scripts.Length < ids.Length) Array.Resize(ref scripts, ids.Length);
            RefreshPlayButton();
        }

        /// <summary>Nombre del personaje según el escenario de la sesión.</summary>
        public void SetCharacterName(string value)
        {
            if (characterName != null && !string.IsNullOrEmpty(value) && characterName.text != value) characterName.text = value;
        }

        /// <summary>Indicador de micrófono del HUD Rive (lo controla AxyroVoiceCommands).</summary>
        public void SetListening(bool value)
        {
            listening = value;
            if (hudListening != null) hudListening.Value = value;
        }

        private AudioClip CurrentClip()
        {
            if (lines == null || phase >= phaseIds.Length) return null;
            return Array.Find(lines, clip => clip != null && clip.name == phaseIds[phase]);
        }

        private void RefreshPlayButton()
        {
            var available = !external && CurrentClip() != null;
            if (playButton != null) playButton.interactable = available && sessionStatus == "active";
            if (playButton != null) playButton.gameObject.SetActive(available);
            if (playLabel != null && !speaking) playLabel.text = LineFinished ? "↻  Repetir voz" : "▶  Escuchar";
        }

        /// <summary>Número de fases del escenario de la sesión; por defecto, las tres de la demo autónoma.</summary>
        public void SetPhaseCount(int count)
        {
            if (count > 0) phaseCount = count;
        }

        private void OnEnable()
        {
            if (hud != null) hud.OnWidgetStatusChanged += BindHud;
        }

        private void OnDisable()
        {
            if (hud != null) hud.OnWidgetStatusChanged -= BindHud;
            if (playButton != null) playButton.onClick.RemoveListener(ToggleVoice);
            pendingReaction = null;
            // Al cerrar, la fuente de voz puede estar ya destruida («?.» no respeta el null de Unity).
            if (voice != null) voice.Stop();
        }

        private void Start()
        {
            if (playButton != null) playButton.onClick.AddListener(ToggleVoice);
            // Modo IA en vivo: la voz llega del navegador; ni locuciones de la demo ni fase inicial.
            if (AxyroAiLive.Active)
            {
                EnterExternalMode();
                BindHud();
                return;
            }
            SetPhase(0);
            BindHud();
            var arguments = Environment.GetCommandLineArgs();
#if !UNITY_EDITOR && !UNITY_WEBGL
            // Unity recuerda el último modo de pantalla; se abre siempre en ventana salvo que se pida lo contrario.
            // En el navegador el lienzo ocupa la página y no se toca su resolución.
            SetFullScreen(Array.IndexOf(arguments, "--axyro-fullscreen") >= 0);
#endif
            // Captura de QA desde dentro del simulador: --axyro-capture=<png> [--axyro-capture-delay=<segundos>].
            var captureDelay = Array.IndexOf(arguments, "--axyro-autoplay") >= 0 ? 2.5f : 3.0f;
            foreach (var argument in arguments)
                if (argument.StartsWith("--axyro-capture-delay=", StringComparison.Ordinal) &&
                    float.TryParse(argument.Substring("--axyro-capture-delay=".Length), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var seconds))
                    captureDelay = Mathf.Clamp(seconds, 0f, 120f);
            foreach (var argument in arguments)
            {
                if (argument == "--axyro-autoplay") ToggleVoice();
                if (argument.StartsWith("--axyro-capture=", StringComparison.Ordinal))
                    StartCoroutine(CaptureAfterFrames(argument.Substring("--axyro-capture=".Length), captureDelay));
            }
        }

        private IEnumerator CaptureAfterFrames(string path, float delay)
        {
            yield return new WaitForEndOfFrame();
            yield return new WaitForEndOfFrame();
            yield return new WaitForSeconds(delay);
            ScreenCapture.CaptureScreenshot(path);
            Debug.Log($"AXYRO_CAPTURE_READY {path}");
        }

        private void Update()
        {
            var keyboard = Keyboard.current;
            if (external)
            {
                // Las teclas de opción y «R» las atiende AxyroAiLive; aquí solo la pantalla completa.
                if (keyboard != null && (keyboard.f11Key.wasPressedThisFrame || (keyboard.altKey.isPressed && keyboard.enterKey.wasPressedThisFrame))) ToggleFullScreen();
                return;
            }
            if (!linkedSession && keyboard != null && keyboard.digit1Key.wasPressedThisFrame) SetPhase(0);
            if (!linkedSession && keyboard != null && keyboard.digit2Key.wasPressedThisFrame) SetPhase(1);
            if (!linkedSession && keyboard != null && keyboard.digit3Key.wasPressedThisFrame) SetPhase(2);
            if (keyboard != null && keyboard.spaceKey.wasPressedThisFrame) ToggleVoice();
#if !UNITY_WEBGL || UNITY_EDITOR
            // En el navegador Esc solo sale de pantalla completa: no hay aplicación que cerrar.
            if (keyboard != null && keyboard.escapeKey.wasPressedThisFrame) Quit();
#endif
            if (keyboard != null && (keyboard.f11Key.wasPressedThisFrame || (keyboard.altKey.isPressed && keyboard.enterKey.wasPressedThisFrame))) ToggleFullScreen();
            // Algunos navegadores mantienen isPlaying=true si el audio WebGL se queda bloqueado, y sin dispositivo
            // de salida el clip puede no avanzar. La interacción continúa al acabar la duración real del clip.
            if (speaking && (voice == null || !voice.isPlaying || voice.clip == null ||
                Time.realtimeSinceStartup - speechStartedAt > voice.clip.length + ClipMarginSeconds))
            {
                voice?.Stop();
                SetSpeaking(false);
            }
#if UNITY_WEBGL && !UNITY_EDITOR
            if (!userGesture && (Mouse.current?.leftButton.wasPressedThisFrame == true ||
                Touchscreen.current?.primaryTouch.press.wasPressedThisFrame == true ||
                keyboard?.anyKey.wasPressedThisFrame == true))
            {
                userGesture = true;
                // Primer gesto mientras se espera la locución: se plantea la situación ahora que el audio puede sonar.
                if (!LineFinished && !speaking && autoSpeak == null && linkedSession && sessionStatus == "active" && CurrentClip() != null)
                    autoSpeak = StartCoroutine(SpeakAfter(0.25f));
            }
#endif
            EnsureLineFinishes();
        }

        /// <summary>
        /// Red de seguridad de «primero se escucha, después se decide»: si la situación no está sonando ni va a sonar,
        /// o se ha superado el plazo (duración del clip + margen, o unos segundos sin clip), las opciones se muestran.
        /// </summary>
        private void EnsureLineFinishes()
        {
            if (LineFinished) return;
            var waiting = speaking || autoSpeak != null;
#if UNITY_WEBGL && !UNITY_EDITOR
            waiting |= !userGesture;
#endif
            if (!waiting || Time.realtimeSinceStartup > lineDeadline)
            {
                if (waiting) Debug.LogWarning("AXYRO: la locución no terminó a tiempo; se muestran las opciones.");
                LineFinished = true;
                RefreshPlayButton();
            }
        }

        private float LineBudget(AudioClip clip) => clip != null && clip.length > 0.1f ? clip.length + ClipMarginSeconds : NoClipSeconds;

        private void Quit()
        {
            voice?.Stop();
#if UNITY_EDITOR
            UnityEditor.EditorApplication.isPlaying = false;
#else
            Application.Quit();
#endif
        }

        /// <summary>Alterna entre ventana y pantalla completa sin bordes, conservando la resolución del escritorio.</summary>
#if UNITY_WEBGL && !UNITY_EDITOR
        private static void ToggleFullScreen() => Screen.fullScreen = !Screen.fullScreen;
#else
        private static void ToggleFullScreen() => SetFullScreen(Screen.fullScreenMode == FullScreenMode.Windowed);
#endif

        private static void SetFullScreen(bool fullScreen)
        {
            if (fullScreen)
            {
                var display = Screen.currentResolution;
                Screen.SetResolution(display.width, display.height, FullScreenMode.FullScreenWindow);
            }
            else
            {
                Screen.SetResolution(1600, 900, FullScreenMode.Windowed);
            }
        }

        private void BindHud()
        {
            if (hud != null && hud.Status == WidgetStatus.Loaded)
            {
                hudSpeaking = hud.StateMachine?.GetBool("speaking");
                if (hudSpeaking != null) hudSpeaking.Value = speaking;
                hudListening = hud.StateMachine?.GetBool("listening");
                if (hudListening != null) hudListening.Value = listening;
            }
        }

        /// <summary>Sustituye título y texto de una fase con los datos del escenario que llegan de la API.</summary>
        public void ApplyPhaseText(int index, string title, string line)
        {
            if (index < 0 || index > 15) return;
            if (index >= scripts.Length)
            {
                Array.Resize(ref titles, index + 1);
                Array.Resize(ref scripts, index + 1);
            }
            if (!string.IsNullOrEmpty(title)) titles[index] = title;
            if (!string.IsNullOrEmpty(line)) scripts[index] = line;
            if (index == phase)
            {
                if (phaseTitle != null) phaseTitle.text = PhaseHeading();
                // Tras decidir, el subtítulo es la reacción hasta que cambie la fase o se repita la situación.
                if (dialogue != null) dialogue.text = reactionText ?? scripts[phase];
            }
        }

        private string PhaseHeading() => $"{phase + 1} / {phaseCount}   {titles[phase]?.ToUpperInvariant()}";

        public void SetPhase(int next)
        {
            if (external || next < 0 || next >= scripts.Length) return;
            // Una fase nueva corta la reacción a la decisión anterior sin bloquear la siguiente situación.
            CancelPendingReaction();
            reactionText = null;
            voice?.Stop();
            SetSpeaking(false);
            phase = next;
            PhaseVersion++;
            if (phaseTitle != null) phaseTitle.text = PhaseHeading();
            if (dialogue != null) dialogue.text = scripts[phase];
            // La locución empieza sola; en WebGL, solo cuando el navegador ya ha recibido un gesto del usuario
            // (si no, empieza con el primer clic). En cualquier caso hay un plazo tras el que se muestran las opciones.
            if (autoSpeak != null) { StopCoroutine(autoSpeak); autoSpeak = null; }
            var clip = CurrentClip();
            var willSpeak = linkedSession && sessionStatus == "active" && clip != null;
            LineFinished = !willSpeak;
            lineDeadline = Time.realtimeSinceStartup + AutoSpeakDelay + LineBudget(clip);
#if UNITY_WEBGL && !UNITY_EDITOR
            if (willSpeak && !userGesture) lineDeadline = Time.realtimeSinceStartup + GestureWaitSeconds;
            else if (willSpeak) autoSpeak = StartCoroutine(SpeakAfter(AutoSpeakDelay));
#else
            if (willSpeak) autoSpeak = StartCoroutine(SpeakAfter(AutoSpeakDelay));
#endif
            RefreshPlayButton();
        }

        private IEnumerator SpeakAfter(float seconds)
        {
            yield return new WaitForSecondsRealtime(seconds);
            autoSpeak = null;
            if (!speaking && sessionStatus == "active") ToggleVoice();
            if (!speaking) LineFinished = true;
        }

        /// <summary>
        /// Escuchar / detener la situación. Durante la reacción a una decisión, «Repetir» corta la reacción
        /// y vuelve a plantear la situación (con su texto como subtítulo).
        /// </summary>
        public void ToggleVoice()
        {
            if (external) return;
            var clip = CurrentClip();
            if (voice == null || clip == null) return;
            if (speaking && !reacting) { voice.Stop(); SetSpeaking(false); return; }
            CancelPendingReaction();
            if (speaking) { voice.Stop(); SetSpeaking(false); }
            reactionText = null;
            if (dialogue != null && phase < scripts.Length) dialogue.text = scripts[phase];
            voice.clip = clip;
            voice.Play();
            speechStartedAt = Time.realtimeSinceStartup;
            if (!LineFinished) lineDeadline = speechStartedAt + LineBudget(clip);
            SetSpeaking(true);
        }

        /// <summary>El participante toma la palabra: detener audio y lip sync sin volver a reproducirlo.</summary>
        public void InterruptVoice()
        {
            if (external) return;
            CancelPendingReaction();
            if (!speaking) return;
            voice?.Stop();
            SetSpeaking(false);
        }

        /// <summary>
        /// VictorIA responde a la decisión confirmada: gesto según la valoración de la DECISIÓN (nunca de la persona),
        /// subtítulo con el guion de la reacción y locución Carmen por la misma fuente de voz, de modo que uLipSync
        /// mueve la boca igual que en la situación. Sin clip grabado, solo gesto y subtítulo.
        /// </summary>
        public void PlayReaction(string phaseId, string optionId, string quality, string fallbackText)
        {
            if (external) return;
            CancelPendingReaction();
            if (speaking) { voice?.Stop(); SetSpeaking(false); }
            if (autoSpeak != null) { StopCoroutine(autoSpeak); autoSpeak = null; }
            LineFinished = true;

            var entry = AxyroReactions.Find(phaseId, optionId);
            var text = entry != null && !string.IsNullOrEmpty(entry.text) ? entry.text : fallbackText;
            if (!string.IsNullOrEmpty(text))
            {
                reactionText = text;
                if (dialogue != null) dialogue.text = text;
            }

            var clip = ReactionClip(phaseId, optionId);
            // En una decisión arriesgada el gesto de preocupación acompaña la primera mitad de la respuesta.
            if (tutor != null) tutor.React(quality, clip != null ? Mathf.Min(clip.length * 0.5f, 4f) : 0f);
            if (clip != null && voice != null) pendingReaction = StartCoroutine(PlayReactionClip(clip));
        }

        private AudioClip ReactionClip(string phaseId, string optionId)
        {
            var name = AxyroReactions.FileName(phaseId, optionId);
            var serialized = lines == null ? null : Array.Find(lines, clip => clip != null && clip.name == name);
            return serialized != null ? serialized : AxyroReactions.LoadClip(phaseId, optionId);
        }

        private IEnumerator PlayReactionClip(AudioClip clip)
        {
            // Con Decompress On Load (WebGL) uLipSync lee las muestras del clip: se espera a que esté cargado.
            if (clip.loadState != AudioDataLoadState.Loaded) clip.LoadAudioData();
            var giveUpAt = Time.realtimeSinceStartup + 4f;
            while (clip.loadState != AudioDataLoadState.Loaded && clip.loadState != AudioDataLoadState.Failed &&
                   Time.realtimeSinceStartup < giveUpAt)
                yield return null;
            // Breve pausa para que el feedback de la decisión aparezca antes de la voz.
            yield return new WaitForSeconds(0.35f);
            pendingReaction = null;
            if (clip.loadState != AudioDataLoadState.Loaded || voice == null || (linkedSession && sessionStatus != "active")) yield break;
            if (speaking) { voice.Stop(); SetSpeaking(false); }
            voice.clip = clip;
            voice.Play();
            speechStartedAt = Time.realtimeSinceStartup;
            reacting = true;
            SetSpeaking(true);
        }

        private void CancelPendingReaction()
        {
            if (pendingReaction == null) return;
            StopCoroutine(pendingReaction);
            pendingReaction = null;
        }

        public void SetLinkedSession(bool linked)
        {
            if (external) return;
            linkedSession = linked;
#if UNITY_WEBGL && !UNITY_EDITOR
            if (inputHint != null) inputHint.text = linked
                ? "Elige con voz, ratón o número  ·  Espacio: repetir  ·  F11: pantalla completa"
                : "1, 2 y 3: cambiar de situación  ·  Espacio: escuchar  ·  F11: pantalla completa";
#else
            if (inputHint != null) inputHint.text = linked
                ? "Elige con el ratón o en voz alta  ·  Espacio: repetir  ·  F11: pantalla completa  ·  Esc: salir"
                : "1, 2 y 3: cambiar de situación  ·  Espacio: escuchar  ·  F11: pantalla completa  ·  Esc: salir";
#endif
        }

        public void SetSessionStatus(string status)
        {
            if (external) return;
            sessionStatus = status;
            RefreshPlayButton();
            if (status != "active") CancelPendingReaction();
            if (status != "active" && speaking)
            {
                voice?.Stop();
                SetSpeaking(false);
            }
        }

        // ---------- Modo IA en vivo: la voz, el título y los subtítulos llegan del navegador (AxyroAiLive) ----------

        private bool external;

        /// <summary>True en el modo IA en vivo: este componente ya no reproduce locuciones propias.</summary>
        public bool IsExternal => external;

        public void EnterExternalMode()
        {
            if (external) return;
            CancelPendingReaction();
            if (autoSpeak != null) { StopCoroutine(autoSpeak); autoSpeak = null; }
            if (voice != null) voice.Stop();
            if (speaking) SetSpeaking(false);
            external = true;
            linkedSession = true;
            sessionStatus = "ia";
            reactionText = null;
            LineFinished = true;
            lineDeadline = float.MaxValue;
            phase = 0;
            phaseCount = 1;
            if (playButton != null) playButton.gameObject.SetActive(false);
            if (phaseTitle != null) phaseTitle.text = "MODO IA EN VIVO";
            if (dialogue != null) dialogue.text = "";
            if (inputHint != null) inputHint.text = "Habla con VictorIA, o elige con el ratón o las teclas 1 a 4  ·  R: repetir  ·  F11: pantalla completa";
        }

        /// <summary>Situación generada número <paramref name="index"/> (0..) de <paramref name="total"/>.</summary>
        public void SetExternalPhase(int index, int total, string title)
        {
            if (!external) return;
            index = Mathf.Clamp(index, 0, 99);
            if (titles.Length <= index) Array.Resize(ref titles, index + 1);
            if (scripts.Length <= index) Array.Resize(ref scripts, index + 1);
            titles[index] = title;
            phase = index;
            phaseCount = Mathf.Max(total, index + 1);
            PhaseVersion++;
            LineFinished = true;
            if (phaseTitle != null) phaseTitle.text = PhaseHeading();
        }

        public void SetExternalHeading(string text)
        {
            if (external && phaseTitle != null) phaseTitle.text = text ?? "";
        }

        public void SetSubtitle(string text)
        {
            if (external && dialogue != null) dialogue.text = text ?? "";
        }

        /// <summary>VictorIA habla (o reacciona a una decisión) con la voz del navegador.</summary>
        public void SetExternalSpeaking(bool value, bool reaction)
        {
            if (!external) return;
            if (value == speaking && (reaction && value) == reacting) return;
            if (value)
            {
                reacting = reaction;
                SetSpeaking(true);
            }
            else SetSpeaking(false);
        }

        private void SetSpeaking(bool value)
        {
            // Al terminar (o detener) la locución, la situación queda planteada y se muestran las opciones.
            if (speaking && !value) LineFinished = true;
            if (!value) reacting = false;
            speaking = value;
            if (tutor != null) tutor.SetSpeaking(value);
            if (hudSpeaking != null) hudSpeaking.Value = value;
            // Durante la reacción, el botón vuelve a plantear la situación en lugar de solo detener.
            if (playLabel != null) playLabel.text = value ? (reacting ? "↻  Repetir situación" : "■  Detener") : "↻  Repetir voz";
        }
    }
}

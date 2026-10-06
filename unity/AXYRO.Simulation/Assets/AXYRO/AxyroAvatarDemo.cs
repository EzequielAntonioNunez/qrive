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

        public bool IsSpeaking => speaking;

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
            var available = CurrentClip() != null;
            if (playButton != null) playButton.interactable = available && sessionStatus == "active";
            if (playLabel != null && !speaking) playLabel.text = available ? "▶  Escuchar de nuevo" : "Sin audio";
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
            voice?.Stop();
        }

        private void Start()
        {
            if (playButton != null) playButton.onClick.AddListener(ToggleVoice);
            SetPhase(0);
            BindHud();
            var arguments = Environment.GetCommandLineArgs();
#if !UNITY_EDITOR
            // Unity recuerda el último modo de pantalla; se abre siempre en ventana salvo que se pida lo contrario.
            SetFullScreen(Array.IndexOf(arguments, "--axyro-fullscreen") >= 0);
#endif
            foreach (var argument in arguments)
            {
                if (argument == "--axyro-autoplay") ToggleVoice();
                if (argument.StartsWith("--axyro-capture=", StringComparison.Ordinal))
                    StartCoroutine(CaptureAfterFrames(argument.Substring("--axyro-capture=".Length), Array.IndexOf(arguments, "--axyro-autoplay") >= 0));
            }
        }

        private IEnumerator CaptureAfterFrames(string path, bool autoplay)
        {
            yield return new WaitForEndOfFrame();
            yield return new WaitForEndOfFrame();
            yield return new WaitForSeconds(autoplay ? 2.5f : 3.0f);
            ScreenCapture.CaptureScreenshot(path);
            Debug.Log($"AXYRO_CAPTURE_READY {path}");
        }

        private void Update()
        {
            var keyboard = Keyboard.current;
            if (!linkedSession && keyboard != null && keyboard.digit1Key.wasPressedThisFrame) SetPhase(0);
            if (!linkedSession && keyboard != null && keyboard.digit2Key.wasPressedThisFrame) SetPhase(1);
            if (!linkedSession && keyboard != null && keyboard.digit3Key.wasPressedThisFrame) SetPhase(2);
            if (keyboard != null && keyboard.spaceKey.wasPressedThisFrame) ToggleVoice();
            if (keyboard != null && keyboard.escapeKey.wasPressedThisFrame) Quit();
            if (keyboard != null && (keyboard.f11Key.wasPressedThisFrame || (keyboard.altKey.isPressed && keyboard.enterKey.wasPressedThisFrame))) ToggleFullScreen();
            if (speaking && voice != null && !voice.isPlaying) SetSpeaking(false);
        }

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
        private static void ToggleFullScreen() => SetFullScreen(Screen.fullScreenMode == FullScreenMode.Windowed);

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
                if (dialogue != null) dialogue.text = $"“{scripts[phase]}”";
            }
        }

        private string PhaseHeading() => $"SITUACIÓN {phase + 1} DE {phaseCount}  ·  {titles[phase]?.ToUpperInvariant()}";

        public void SetPhase(int next)
        {
            if (next < 0 || next >= scripts.Length) return;
            voice?.Stop();
            SetSpeaking(false);
            phase = next;
            if (phaseTitle != null) phaseTitle.text = PhaseHeading();
            if (dialogue != null) dialogue.text = $"“{scripts[phase]}”";
            RefreshPlayButton();
            // En una sesión, el personaje plantea cada situación nada más empezar: no hace falta pulsar nada.
            if (autoSpeak != null) StopCoroutine(autoSpeak);
            if (linkedSession && sessionStatus == "active") autoSpeak = StartCoroutine(SpeakAfter(1.2f));
        }

        private IEnumerator SpeakAfter(float seconds)
        {
            yield return new WaitForSeconds(seconds);
            autoSpeak = null;
            if (!speaking && sessionStatus == "active") ToggleVoice();
        }

        public void ToggleVoice()
        {
            var clip = CurrentClip();
            if (voice == null || clip == null) return;
            if (speaking) { voice.Stop(); SetSpeaking(false); return; }
            voice.clip = clip;
            voice.Play();
            SetSpeaking(true);
        }

        public void SetLinkedSession(bool linked)
        {
            linkedSession = linked;
            if (inputHint != null) inputHint.text = linked
                ? "Elige con el ratón o en voz alta  ·  Espacio: repetir  ·  F11: pantalla completa  ·  Esc: salir"
                : "1, 2 y 3: cambiar de situación  ·  Espacio: escuchar  ·  F11: pantalla completa  ·  Esc: salir";
        }

        public void SetSessionStatus(string status)
        {
            sessionStatus = status;
            RefreshPlayButton();
            if (status != "active" && speaking)
            {
                voice?.Stop();
                SetSpeaking(false);
            }
        }

        private void SetSpeaking(bool value)
        {
            speaking = value;
            if (tutor != null) tutor.SetSpeaking(value);
            if (hudSpeaking != null) hudSpeaking.Value = value;
            if (playLabel != null) playLabel.text = value ? "■  Detener" : "▶  Escuchar de nuevo";
        }
    }
}

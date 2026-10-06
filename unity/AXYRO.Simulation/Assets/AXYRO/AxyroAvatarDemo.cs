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
        [SerializeField] private Text phaseTitle;
        [SerializeField] private Text dialogue;
        [SerializeField] private Text playLabel;
        [SerializeField] private Button playButton;
        [SerializeField] private Text inputHint;

        private string[] titles = { "Preparación", "Contraoferta", "Cierre" };
        private string[] scripts = {
            "Gracias por venir. Nuestros costes han subido y necesitamos revisar el precio. Si encontramos una propuesta equilibrada, podremos seguir trabajando juntos.",
            "Podría reducir la subida si acordamos tres años de colaboración. Necesito saber qué garantías y compromisos estaríais dispuestos a aceptar.",
            "Estamos cerca de un acuerdo. Para cerrarlo hoy, necesito una decisión final y una forma clara de comprobar que cumplimos los compromisos."
        };

        private SMIBool hudSpeaking;
        private int phase;
        private bool speaking;
        private bool linkedSession;
        private int phaseCount = 3;
        private bool voiceAvailable = true;
        private string sessionStatus = "active";

        /// <summary>Los WAV incluidos solo corresponden al escenario de catálogo; en otros escenarios no se locuta.</summary>
        public void SetVoiceAvailable(bool available)
        {
            voiceAvailable = available;
            if (!available && speaking) { voice?.Stop(); SetSpeaking(false); }
            if (playButton != null) playButton.interactable = available && sessionStatus == "active";
            if (playLabel != null && !speaking) playLabel.text = available ? "▶  ESCUCHAR INTERVENCIÓN" : "SIN LOCUCIÓN EN ESTE ESCENARIO";
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
                if (phaseTitle != null) phaseTitle.text = $"FASE {phase + 1} / {phaseCount}  ·  {titles[phase]}";
                if (dialogue != null) dialogue.text = $"“{scripts[phase]}”";
            }
        }

        public void SetPhase(int next)
        {
            if (next < 0 || next >= scripts.Length) return;
            voice?.Stop();
            SetSpeaking(false);
            phase = next;
            if (phaseTitle != null) phaseTitle.text = $"FASE {phase + 1} / {phaseCount}  ·  {titles[phase]}";
            if (dialogue != null) dialogue.text = $"“{scripts[phase]}”";
        }

        public void ToggleVoice()
        {
            if (!voiceAvailable || voice == null || lines == null || phase >= lines.Length || lines[phase] == null) return;
            if (speaking) { voice.Stop(); SetSpeaking(false); return; }
            voice.clip = lines[phase];
            voice.Play();
            SetSpeaking(true);
        }

        public void SetLinkedSession(bool linked)
        {
            linkedSession = linked;
            if (inputHint != null) inputHint.text = linked
                ? "J UNIRSE   ·   1 / 2 / 3 DECIDIR   ·   ESPACIO ESCUCHAR   ·   F11 PANTALLA   ·   ESC SALIR"
                : "1 · 2 · 3 CAMBIAN LA FASE   ·   ESPACIO VOZ   ·   F11 PANTALLA   ·   ESC SALIR";
        }

        public void SetSessionStatus(string status)
        {
            sessionStatus = status;
            if (playButton != null) playButton.interactable = voiceAvailable && status == "active";
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
            if (playLabel != null) playLabel.text = value ? "■  DETENER VOZ" : "▶  ESCUCHAR INTERVENCIÓN";
        }
    }
}

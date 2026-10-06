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
        [SerializeField] private UnityEngine.Renderer portrait;
        [SerializeField] private Transform portraitRig;
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

        private readonly float[] samples = new float[256];
        private Material portraitMaterial;
        private SMIBool hudSpeaking;
        private Vector3 initialPosition;
        private int phase;
        private bool speaking;
        private float speechAmount;
        private float blinkTimer = 2.7f;
        private float blinkProgress = -1f;
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
            if (portrait != null) portraitMaterial = portrait.material;
            if (portraitRig != null) initialPosition = portraitRig.localPosition;
            if (playButton != null) playButton.onClick.AddListener(ToggleVoice);
            SetPhase(0);
            BindHud();
            var arguments = Environment.GetCommandLineArgs();
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
            yield return new WaitForSeconds(autoplay ? 0.8f : 2.0f);
            ScreenCapture.CaptureScreenshot(path);
            Debug.Log($"AXYRO_CAPTURE_READY {path}");
        }

        private void OnDestroy()
        {
            if (portraitMaterial != null) Destroy(portraitMaterial);
        }

        private void Update()
        {
            var keyboard = Keyboard.current;
            if (!linkedSession && keyboard != null && keyboard.digit1Key.wasPressedThisFrame) SetPhase(0);
            if (!linkedSession && keyboard != null && keyboard.digit2Key.wasPressedThisFrame) SetPhase(1);
            if (!linkedSession && keyboard != null && keyboard.digit3Key.wasPressedThisFrame) SetPhase(2);
            if (keyboard != null && keyboard.spaceKey.wasPressedThisFrame) ToggleVoice();
            if (speaking && voice != null && !voice.isPlaying) SetSpeaking(false);
            AnimatePortrait();
        }

        private void AnimatePortrait()
        {
            if (portraitRig != null)
            {
                var t = Time.time;
                portraitRig.localPosition = initialPosition + new Vector3(0f, Mathf.Sin(t * 1.35f) * 0.025f, 0f);
                portraitRig.localRotation = Quaternion.Euler(0f, 0f, Mathf.Sin(t * 0.73f) * 0.24f);
            }

            float target = 0f;
            if (speaking && voice != null && voice.isPlaying)
            {
                voice.GetOutputData(samples, 0);
                float sum = 0f;
                for (int i = 0; i < samples.Length; i++) sum += samples[i] * samples[i];
                target = Mathf.Clamp01((Mathf.Sqrt(sum / samples.Length) - 0.008f) * 27f);
            }
            speechAmount = Mathf.MoveTowards(speechAmount, target, Time.deltaTime * 12f);

            blinkTimer -= Time.deltaTime;
            if (blinkTimer <= 0f && blinkProgress < 0f) blinkProgress = 0f;
            float blink = 0f;
            if (blinkProgress >= 0f)
            {
                blink = Mathf.Sin(Mathf.PI * blinkProgress / 0.18f);
                blinkProgress += Time.deltaTime;
                if (blinkProgress >= 0.18f)
                {
                    blinkProgress = -1f;
                    blinkTimer = UnityEngine.Random.Range(2.4f, 4.8f);
                }
            }
            if (portraitMaterial != null)
            {
                portraitMaterial.SetFloat("_SpeechAmount", speechAmount);
                portraitMaterial.SetFloat("_BlinkAmount", Mathf.Clamp01(blink));
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
                ? "J UNIRSE   ·   1 / 2 / 3 DECIDIR   ·   ESPACIO ESCUCHAR"
                : "1 · 2 · 3 CAMBIAN LA FASE     ESPACIO REPRODUCE LA VOZ";
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
            if (hudSpeaking != null) hudSpeaking.Value = value;
            if (playLabel != null) playLabel.text = value ? "■  DETENER VOZ" : "▶  ESCUCHAR INTERVENCIÓN";
        }
    }
}

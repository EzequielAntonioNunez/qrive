using Rive;
using Rive.Components;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.UI;

namespace Axyro
{
    public sealed class AxyroAvatarDemo : MonoBehaviour
    {
        [SerializeField] private RiveWidget avatar;
        [SerializeField] private AudioSource voice;
        [SerializeField] private AudioClip[] lines;
        [SerializeField] private Text phaseTitle;
        [SerializeField] private Text dialogue;
        [SerializeField] private Text playLabel;
        [SerializeField] private Button playButton;

        private readonly string[] titles = { "Preparación", "Contraoferta", "Cierre" };
        private readonly string[] scripts = {
            "Gracias por venir. Nuestros costes han subido y necesitamos revisar el precio. Si encontramos una propuesta equilibrada, podremos seguir trabajando juntos.",
            "Podría reducir la subida si acordamos tres años de colaboración. Necesito saber qué garantías y compromisos estaríais dispuestos a aceptar.",
            "Estamos cerca de un acuerdo. Para cerrarlo hoy, necesito una decisión final y una forma clara de comprobar que cumplimos los compromisos."
        };
        private SMIBool speakingInput;
        private int phase;
        private bool speaking;

        private void OnEnable()
        {
            if (avatar != null) avatar.OnWidgetStatusChanged += BindRive;
        }

        private void OnDisable()
        {
            if (avatar != null) avatar.OnWidgetStatusChanged -= BindRive;
        }

        private void Start()
        {
            if (playButton != null) playButton.onClick.AddListener(ToggleVoice);
            SetPhase(0);
            BindRive();
        }

        private void Update()
        {
            var keyboard = Keyboard.current;
            if (keyboard != null && keyboard.digit1Key.wasPressedThisFrame) SetPhase(0);
            if (keyboard != null && keyboard.digit2Key.wasPressedThisFrame) SetPhase(1);
            if (keyboard != null && keyboard.digit3Key.wasPressedThisFrame) SetPhase(2);
            if (keyboard != null && keyboard.spaceKey.wasPressedThisFrame) ToggleVoice();
            if (speaking && voice != null && !voice.isPlaying) SetSpeaking(false);
        }

        private void BindRive()
        {
            if (avatar != null && avatar.Status == WidgetStatus.Loaded)
            {
                speakingInput = avatar.StateMachine?.GetBool("speaking");
                if (speakingInput != null) speakingInput.Value = speaking;
            }
        }

        public void SetPhase(int next)
        {
            if (next < 0 || next >= scripts.Length) return;
            voice?.Stop();
            SetSpeaking(false);
            phase = next;
            if (phaseTitle != null) phaseTitle.text = $"FASE {phase + 1} / 3  ·  {titles[phase]}";
            if (dialogue != null) dialogue.text = $"“{scripts[phase]}”";
        }

        public void ToggleVoice()
        {
            if (voice == null || lines == null || phase >= lines.Length || lines[phase] == null) return;
            if (speaking) { voice.Stop(); SetSpeaking(false); return; }
            voice.clip = lines[phase];
            voice.Play();
            SetSpeaking(true);
        }

        private void SetSpeaking(bool value)
        {
            speaking = value;
            if (speakingInput != null) speakingInput.Value = value;
            if (playLabel != null) playLabel.text = value ? "■  DETENER VOZ" : "▶  ESCUCHAR INTERVENCIÓN";
        }
    }
}

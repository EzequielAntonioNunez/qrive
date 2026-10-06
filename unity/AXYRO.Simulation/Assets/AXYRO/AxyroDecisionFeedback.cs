using Rive.Components;
using UnityEngine;

namespace Axyro
{
    /// <summary>
    /// Feedback visual de la decisión (feedback.riv) que se superpone a la escena cuando el participante elige una opción.
    /// Contrato con el archivo Rive: artboard "Feedback", máquina de estados "Feedback" y triggers
    /// "best", "acceptable" y "poor" (los valores de <c>quality</c> del escenario).
    /// La valoración es de la decisión, no de la persona.
    /// </summary>
    public sealed class AxyroDecisionFeedback : MonoBehaviour
    {
        [SerializeField] private Rive.Components.RiveWidget widget;

        [Tooltip("Duración de la animación en segundos (1,9 s en feedback.riv) más un pequeño margen.")]
        [SerializeField] private float duration = 2f;

        // Valoración pedida que aún no se ha podido disparar (widget sin cargar o la misma ya en pantalla).
        private string pending;
        // Valoración que se está mostrando; vuelve a null cuando la animación termina.
        private string current;
        private float visibleUntil;

        /// <summary>Indica si hay un feedback en pantalla.</summary>
        public bool IsShowing => current != null;

        /// <summary>
        /// Muestra el feedback de una decisión: "best", "acceptable" o "poor".
        /// Si el widget aún no ha cargado, la petición queda en cola y se aplica al cargar.
        /// Una valoración vacía (opción sin <c>quality</c>) no muestra nada.
        /// </summary>
        public void Show(string quality)
        {
            if (string.IsNullOrWhiteSpace(quality)) return;
            var input = quality.Trim().ToLowerInvariant();
            if (input != "best" && input != "acceptable" && input != "poor")
            {
                Debug.LogWarning($"AXYRO: valoración de decisión desconocida «{quality}»; se ignora.");
                return;
            }

            // Solo se guarda la última petición: si llegan varias antes de cargar, se muestra la más reciente.
            pending = input;
            Debug.Log($"AXYRO_FEEDBACK_REQUESTED {input} widget={(widget != null ? widget.Status.ToString() : "null")}");
            Apply();
        }

        private void OnEnable()
        {
            if (widget != null) widget.OnWidgetStatusChanged += OnWidgetStatusChanged;
        }

        private void OnDisable()
        {
            if (widget != null) widget.OnWidgetStatusChanged -= OnWidgetStatusChanged;
        }

        private void Update()
        {
            // Rive vuelve solo al estado "Oculto" al acabar la animación; aquí se libera el estado local.
            if (current != null && Time.time >= visibleUntil) current = null;
            Apply();
        }

        private void OnWidgetStatusChanged()
        {
            // Una recarga crea una máquina de estados nueva, que arranca en "Oculto".
            if (widget == null || widget.Status != WidgetStatus.Loaded) current = null;
            Apply();
        }

        private System.Collections.IEnumerator CaptureSoon(string path)
        {
            yield return new WaitForSeconds(0.6f);
            ScreenCapture.CaptureScreenshot(path);
            Debug.Log($"AXYRO_FEEDBACK_CAPTURE {path}");
        }

        private void Apply()
        {
            if (pending == null) return;
            // Rive no reinicia un estado que ya está activo: la misma valoración se repite cuando termine la actual.
            // Una valoración distinta interrumpe la actual (transición desde Any State).
            if (pending == current) return;
            if (widget == null || widget.Status != WidgetStatus.Loaded) return;
            var machine = widget.StateMachine;
            if (machine == null) return;

            var input = pending;
            pending = null;
            var trigger = machine.GetTrigger(input);
            if (trigger == null)
            {
                Debug.LogWarning($"AXYRO: la máquina de estados del feedback no tiene el trigger «{input}».");
                return;
            }

            trigger.Fire();
            Debug.Log($"AXYRO_FEEDBACK_SHOWN {input}");
            // QA: --axyro-capture-feedback=<png> guarda una captura en plena animación (0,6 s después de dispararla).
            foreach (var argument in System.Environment.GetCommandLineArgs())
                if (argument.StartsWith("--axyro-capture-feedback=", System.StringComparison.Ordinal))
                    StartCoroutine(CaptureSoon(argument.Substring("--axyro-capture-feedback=".Length)));
            current = input;
            // El widget avanza con Time.deltaTime, así que se mide con Time.time.
            visibleUntil = Time.time + duration;
        }
    }
}

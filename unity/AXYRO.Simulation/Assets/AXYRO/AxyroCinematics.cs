using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace Axyro
{
    /// <summary>
    /// Dirección de cámara: acercamiento lento mientras VictorIA plantea la situación, deriva suave en reposo,
    /// encuadre más abierto con el personaje a la izquierda cuando aparecen las opciones y un plano algo más cercano
    /// tras la decisión. Cada plano se define por la distancia a la cabeza y la posición de la cabeza en pantalla,
    /// así la interfaz (subtítulos abajo a la izquierda, opciones y resultado a la derecha) nunca tapa la cara.
    /// Observa el estado público de AxyroAvatarDemo, AxyroSessionClient y AxyroDecisionFeedback; no los modifica.
    /// </summary>
    [RequireComponent(typeof(Camera))]
    public sealed class AxyroCinematics : MonoBehaviour
    {
        /// <summary>Última instancia activa: atajo para otros componentes (p. ej. reacciones por voz).</summary>
        public static AxyroCinematics Instance { get; private set; }

        [SerializeField] private AxyroTutor3D tutor;
        [SerializeField] private AxyroAvatarDemo avatar;
        [SerializeField] private AxyroSessionClient session;
        [SerializeField] private AxyroDecisionFeedback feedback;
        [SerializeField] private AxyroSceneScreen screen;
        [SerializeField] private Volume volume;

        [Header("Ritmo")]
        [Tooltip("Duración del acercamiento al plantear una situación (s).")]
        [SerializeField] private float pushInSeconds = 14f;
        [SerializeField] private float reactionSeconds = 5.5f;
        [Tooltip("Amplitud de la deriva de cámara en metros.")]
        [SerializeField] private float driftMeters = 0.012f;
        [SerializeField] private float driftDegrees = 0.16f;

        [Serializable]
        public struct Shot
        {
            [Tooltip("Distancia de la cámara a la cabeza (m).")] public float distance;
            [Tooltip("Posición horizontal de la cabeza en pantalla (0 izquierda, 1 derecha).")] public float headU;
            [Tooltip("Posición vertical de la cabeza en pantalla (0 abajo, 1 arriba).")] public float headV;
            [Tooltip("Desplazamiento lateral de la cámara respecto a la distancia (ángulo de tres cuartos).")] public float side;
            [Tooltip("Altura de la cámara respecto a la cabeza (m).")] public float elevation;

            public Shot(float distance, float headU, float headV, float side = 0.17f, float elevation = -0.14f)
            {
                this.distance = distance;
                this.headU = headU;
                this.headV = headV;
                this.side = side;
                this.elevation = elevation;
            }

            public static Shot Lerp(Shot a, Shot b, float t) => new Shot(
                Mathf.Lerp(a.distance, b.distance, t), Mathf.Lerp(a.headU, b.headU, t), Mathf.Lerp(a.headV, b.headV, t),
                Mathf.Lerp(a.side, b.side, t), Mathf.Lerp(a.elevation, b.elevation, t));
        }

        [Header("Planos")]
        [SerializeField] private Shot wide = new Shot(2.95f, 0.30f, 0.70f);
        [SerializeField] private Shot close = new Shot(2.2f, 0.31f, 0.70f);
        [SerializeField] private Shot options = new Shot(2.75f, 0.215f, 0.70f, 0.2f);
        [SerializeField] private Shot reaction = new Shot(1.95f, 0.275f, 0.69f, 0.15f, -0.1f);
        [SerializeField] private Shot rest = new Shot(2.4f, 0.29f, 0.70f);

        private enum Mode { Situation, Options, Reaction, Rest }

        private Camera view;
        private Transform head;
        private Vector3 headAnchor, headVelocity;
        private Mode mode = Mode.Rest;
        private float modeStarted;
        private Shot from, to;
        private float transition = 2f;
        private Vector3 positionVelocity;
        private float smoothTime = 1.4f;
        private float noiseSeed;
        private DepthOfField depthOfField;
        private int lastPhase = int.MinValue;
        private bool wasSpeaking, wasReacting, hadOptions, wasShowingFeedback;

        // QA: capturas automáticas por plano y ciclo de fases en modo demostración.
        private string capturePrefix;
        private float cycleSeconds;
        private float nextCycle = float.MaxValue;
        private readonly HashSet<string> captured = new HashSet<string>();

        /// <summary>Empieza una situación: pequeño plano general y acercamiento lento mientras se plantea.</summary>
        public void OnSituationStart()
        {
            Enter(Mode.Situation, wide, close, 1.6f);
            Capture("situacion", 4.5f);
        }

        /// <summary>Opciones a la vista: encuadre algo más abierto con el personaje a la izquierda.</summary>
        public void OnOptionsShown()
        {
            Enter(Mode.Options, Current(), options, 1.8f);
            Capture("opciones", 2.8f);
        }

        /// <summary>Reacción a la decisión (o a una respuesta hablada): plano algo más cercano durante unos segundos.</summary>
        public void OnReaction()
        {
            Enter(Mode.Reaction, Current(), reaction, 1.1f);
            Capture("reaccion", 1.7f);
        }

        /// <summary>Vuelve al plano de reposo con deriva suave.</summary>
        public void OnRest() => Enter(Mode.Rest, Current(), rest, 2.4f);

        private void Awake()
        {
            Instance = this;
            view = GetComponent<Camera>();
            noiseSeed = UnityEngine.Random.Range(0f, 100f);
            if (tutor != null)
            {
                var animator = tutor.GetComponent<Animator>();
                if (animator != null && animator.isHuman) head = animator.GetBoneTransform(HumanBodyBones.Head);
            }
            foreach (var argument in Environment.GetCommandLineArgs())
            {
                if (argument.StartsWith("--axyro-capture-shots=", StringComparison.Ordinal)) capturePrefix = argument.Substring("--axyro-capture-shots=".Length);
                if (argument.StartsWith("--axyro-qa-cycle=", StringComparison.Ordinal) &&
                    float.TryParse(argument.Substring("--axyro-qa-cycle=".Length), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var seconds))
                    cycleSeconds = Mathf.Clamp(seconds, 3f, 120f);
            }
        }

        private int PhaseIndex => avatar != null ? avatar.CurrentPhaseIndex : -1;
        private int PhaseTotal => avatar != null ? avatar.PhaseCount : 0;
        private string PhaseId => avatar != null ? avatar.CurrentPhaseId : null;

        private void OnDestroy()
        {
            if (Instance == this) Instance = null;
        }

        private void Start()
        {
            if (volume == null) volume = FindAnyObjectByType<Volume>();
            // Copia del perfil en tiempo de ejecución: el foco sigue a la cabeza sin tocar el asset.
            if (volume != null && volume.profile != null) volume.profile.TryGet(out depthOfField);
            if (head == null) return;
            headAnchor = HeadCenter;
            from = to = wide;
            Apply(Pose(wide), true);
            if (cycleSeconds > 0f) nextCycle = Time.time + cycleSeconds;
        }

        private void LateUpdate()
        {
            if (head == null) return;
            Observe();

            // La cabeza se sigue con mucha inercia: la cámara no acompaña cada cabeceo.
            headAnchor = Vector3.SmoothDamp(headAnchor, HeadCenter, ref headVelocity, 1.2f);
            Apply(Pose(Current()), false);
            UpdateFocus();

            if (Time.time >= nextCycle && avatar != null && PhaseTotal > 0)
            {
                nextCycle = Time.time + cycleSeconds;
                avatar.SetPhase((PhaseIndex + 1) % PhaseTotal);
            }
        }

        /// <summary>Deduce el momento de la sesión a partir del estado público de los demás componentes.</summary>
        private void Observe()
        {
            var phase = PhaseIndex;
            if (phase != lastPhase)
            {
                var first = lastPhase == int.MinValue;
                lastPhase = phase;
                if (first) Enter(Mode.Situation, wide, close, 0.01f);
                else OnSituationStart();
                if (first) Capture("situacion", 4.5f);
            }

            // La reacción hablada tras decidir (AxyroAvatarDemo.PlayReaction) también pone IsSpeaking a true:
            // es un plano de reacción, no una situación nueva.
            var reacting = avatar != null && avatar.IsReacting;
            if (reacting && !wasReacting && mode != Mode.Reaction) OnReaction();
            if (reacting) modeStarted = Mathf.Max(modeStarted, Time.time - reactionSeconds + 2f);
            wasReacting = reacting;
            var speaking = avatar != null && avatar.IsSpeaking && !reacting;
            if (speaking && !wasSpeaking && mode != Mode.Situation && mode != Mode.Reaction) OnSituationStart();
            wasSpeaking = speaking;

            var hasOptions = session != null && session.VisibleOptionCount > 0;
            if (hasOptions && !hadOptions) OnOptionsShown();
            hadOptions = hasOptions;

            var showing = feedback != null && feedback.IsShowing;
            if (showing && !wasShowingFeedback) OnReaction();
            wasShowingFeedback = showing;

            var elapsed = Time.time - modeStarted;
            if (mode == Mode.Reaction && elapsed > reactionSeconds) OnRest();
            if (mode == Mode.Options && !hasOptions && elapsed > 0.5f) OnRest();
        }

        private void Enter(Mode next, Shot start, Shot end, float ease)
        {
            mode = next;
            modeStarted = Time.time;
            from = start;
            to = end;
            transition = next == Mode.Situation ? pushInSeconds : ease;
            smoothTime = ease;
        }

        /// <summary>Plano actual: en una situación, interpolación lenta del general al cercano; si no, transición suave.</summary>
        private Shot Current()
        {
            var t = Mathf.Clamp01((Time.time - modeStarted) / Mathf.Max(0.01f, transition));
            // Suavizado seno: arranca y termina sin tirones.
            var k = 0.5f - 0.5f * Mathf.Cos(Mathf.PI * t);
            return Shot.Lerp(from, to, k);
        }

        private (Vector3 position, Quaternion rotation) Pose(Shot shot)
        {
            var side = shot.side * shot.distance;
            var depth = Mathf.Sqrt(Mathf.Max(0.01f, shot.distance * shot.distance - side * side - shot.elevation * shot.elevation));
            // El tutor mira hacia -Z: la cámara queda delante, algo a su izquierda (derecha de la imagen).
            var position = headAnchor + new Vector3(side, shot.elevation, -depth);
            var look = Quaternion.LookRotation(headAnchor - position, Vector3.up);
            var tanV = Mathf.Tan(view.fieldOfView * 0.5f * Mathf.Deg2Rad);
            var tanH = tanV * Mathf.Max(0.5f, view.aspect);
            var yaw = Mathf.Atan((0.5f - shot.headU) * 2f * tanH) * Mathf.Rad2Deg;
            var pitch = Mathf.Atan((shot.headV - 0.5f) * 2f * tanV) * Mathf.Rad2Deg;
            return (position, look * Quaternion.Euler(pitch, yaw, 0f));
        }

        private void Apply((Vector3 position, Quaternion rotation) pose, bool snap)
        {
            var t = Time.time;
            var drift = new Vector3(Noise(t * 0.11f, noiseSeed), Noise(noiseSeed + 7f, t * 0.09f), Noise(t * 0.07f, noiseSeed + 3f) * 0.5f) * driftMeters;
            var sway = Quaternion.Euler(Noise(t * 0.13f, noiseSeed + 5f) * driftDegrees, Noise(noiseSeed + 9f, t * 0.1f) * driftDegrees, 0f);
            if (snap)
            {
                positionVelocity = Vector3.zero;
                transform.SetPositionAndRotation(pose.position + drift, pose.rotation * sway);
                return;
            }
            var dt = Time.deltaTime;
            var position = Vector3.SmoothDamp(transform.position, pose.position + drift, ref positionVelocity, Mathf.Max(0.2f, smoothTime * 0.45f), Mathf.Infinity, dt);
            var rotation = Quaternion.Slerp(transform.rotation, pose.rotation * sway, 1f - Mathf.Exp(-dt / Mathf.Max(0.15f, smoothTime * 0.35f)));
            transform.SetPositionAndRotation(position, rotation);
        }

        /// <summary>Foco en la cabeza: el fondo se desenfoca a partir de un poco por detrás del personaje.</summary>
        private void UpdateFocus()
        {
            if (depthOfField == null) return;
            var distance = Vector3.Distance(transform.position, headAnchor);
            if (depthOfField.mode.value == DepthOfFieldMode.Bokeh) depthOfField.focusDistance.value = distance;
            else
            {
                depthOfField.gaussianStart.value = distance + 1.8f;
                depthOfField.gaussianEnd.value = distance + 8f;
            }
        }

        private void Capture(string moment, float delay)
        {
            if (string.IsNullOrEmpty(capturePrefix)) return;
            var key = $"{moment}-{PhaseId ?? "fase"}";
            if (!captured.Add(key)) return;
            StartCoroutine(CaptureLater($"{capturePrefix}-{key}.png", delay));
        }

        private static IEnumerator CaptureLater(string path, float delay)
        {
            yield return new WaitForSeconds(delay);
            ScreenCapture.CaptureScreenshot(path);
            Debug.Log($"AXYRO_SHOT_CAPTURE {path}");
        }

        // El hueso de la cabeza está en la base del cráneo: el centro de la cara queda unos centímetros más arriba.
        private Vector3 HeadCenter => head.position + Vector3.up * 0.09f;

        private static float Noise(float x, float y) => Mathf.PerlinNoise(x, y) * 2f - 1f;
    }
}

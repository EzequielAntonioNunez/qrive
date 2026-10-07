using UnityEngine;

namespace Axyro
{
    /// <summary>
    /// Tutor 3D: alterna animación de escucha y de habla, parpadea, mira a cámara y deja la boca a uLipSync.
    /// Sobre la animación suma microexpresiones discretas (cejas de énfasis, cabeceo suave, respiración,
    /// microsacadas y una sonrisa al terminar de hablar) y reacciones breves tras cada decisión.
    /// Las expresiones son del personaje; no se infiere nada del participante.
    /// </summary>
    [RequireComponent(typeof(Animator))]
    public sealed class AxyroTutor3D : MonoBehaviour
    {
        private static readonly int SpeakingId = Animator.StringToHash("speaking");

        [SerializeField] private SkinnedMeshRenderer face;
        [SerializeField] private Transform lookTarget;
        [SerializeField] private string blinkLeft = "blendShape1.AK_09_EyeBlinkLeft";
        [SerializeField] private string blinkRight = "blendShape1.AK_10_EyeBlinkRight";
        [SerializeField] private string smileLeft = "blendShape1.AK_44_MouthSmileLeft";
        [SerializeField] private string smileRight = "blendShape1.AK_45_MouthSmileRight";
        [SerializeField, Range(0f, 40f)] private float restingSmile = 12f;
        [SerializeField, Range(0f, 1f)] private float lookWeight = 0.75f;

        [Header("Microexpresiones al hablar")]
        [Tooltip("Voz del personaje; su amplitud marca los momentos de énfasis. Si está vacío se busca un AudioSource en los hijos.")]
        [SerializeField] private AudioSource voice;
        [SerializeField] private string browInnerUp = "blendShape1.AK_03_BrowInnerUp";
        [SerializeField] private string browOuterUpLeft = "blendShape1.AK_04_BrowOuterUpLeft";
        [SerializeField] private string browOuterUpRight = "blendShape1.AK_05_BrowOuterUpRight";
        [Tooltip("Peso máximo de cualquier expresión añadida por este componente (los visemas no se tocan).")]
        [SerializeField, Range(0f, 35f)] private float maxExpressionWeight = 35f;
        [SerializeField, Range(0f, 35f)] private float emphasisBrow = 16f;
        [Tooltip("Cuántas veces por encima del nivel medio de la voz debe estar un pico para contar como énfasis.")]
        [SerializeField, Range(1.1f, 3f)] private float emphasisThreshold = 1.5f;
        [Tooltip("Grados de cabeceo suave (ruido Perlin) mientras habla.")]
        [SerializeField, Range(0f, 6f)] private float speakingHeadMotion = 2.2f;
        [Tooltip("Grados de cabeceo suave mientras escucha.")]
        [SerializeField, Range(0f, 3f)] private float listeningHeadMotion = 0.7f;
        [Tooltip("Sonrisa adicional al terminar de hablar; decae en unos segundos.")]
        [SerializeField, Range(0f, 25f)] private float afterSpeechSmile = 8f;
        [SerializeField, Range(0.5f, 6f)] private float afterSpeechSmileDecay = 2.5f;

        [Header("Escucha: ojos y respiración")]
        [SerializeField] private string eyeLookDownLeft = "blendShape1.AK_11_EyeLookDownLeft";
        [SerializeField] private string eyeLookDownRight = "blendShape1.AK_12_EyeLookDownRight";
        [SerializeField] private string eyeLookInLeft = "blendShape1.AK_13_EyeLookInLeft";
        [SerializeField] private string eyeLookInRight = "blendShape1.AK_14_EyeLookInRight";
        [SerializeField] private string eyeLookOutLeft = "blendShape1.AK_15_EyeLookOutLeft";
        [SerializeField] private string eyeLookOutRight = "blendShape1.AK_16_EyeLookOutRight";
        [SerializeField] private string eyeLookUpLeft = "blendShape1.AK_17_EyeLookUpLeft";
        [SerializeField] private string eyeLookUpRight = "blendShape1.AK_18_EyeLookUpRight";
        [Tooltip("Amplitud de las microsacadas en grados (si el avatar tiene huesos de ojos).")]
        [SerializeField, Range(0f, 3f)] private float microsaccadeDegrees = 0.8f;
        [Tooltip("Peso de blendshape EyeLook para la amplitud máxima (si no hay huesos de ojos).")]
        [SerializeField, Range(0f, 15f)] private float microsaccadeWeight = 8f;
        [Tooltip("Probabilidad de parpadear justo después de un cambio de mirada.")]
        [SerializeField, Range(0f, 1f)] private float blinkAfterGazeShift = 0.45f;
        [Tooltip("Grados de elevación del pecho en cada inspiración.")]
        [SerializeField, Range(0f, 2f)] private float breathingDegrees = 0.6f;
        [SerializeField, Range(6f, 24f)] private float breathsPerMinute = 14f;

        [Header("Reacciones tras una decisión")]
        [SerializeField, Range(0f, 8f)] private float reactionNodDegrees = 4f;
        [SerializeField, Range(0f, 8f)] private float reactionTiltDegrees = 3f;
        [SerializeField, Range(0f, 25f)] private float reactionSmile = 10f;
        [SerializeField, Range(0f, 35f)] private float concernBrow = 22f;
        [SerializeField, Range(0.5f, 4f)] private float concernSeconds = 1.5f;

        private Animator animator;
        private int blinkL = -1, blinkR = -1, smileL = -1, smileR = -1;
        private int browInner = -1, browOuterL = -1, browOuterR = -1;
        private int lookDownL = -1, lookDownR = -1, lookInL = -1, lookInR = -1, lookOutL = -1, lookOutR = -1, lookUpL = -1, lookUpR = -1;
        private float blinkTimer = 2.2f;
        private float blinkProgress = -1f;
        private Vector3 gazeOffset;
        private float gazeTimer;

        // Huesos del humanoide (cualquiera puede faltar) y ejes del personaje en espacio local de la raíz.
        private AdditiveBone chest, neck, head, leftShoulder, rightShoulder, leftEye, rightEye;
        private Vector3 localRight = Vector3.right, localUp = Vector3.up, localForward = Vector3.forward;

        private bool speaking;
        private float speakBlend;
        private float noiseSeed;
        private float breathPhase;

        // Énfasis por amplitud de la voz.
        private readonly float[] samples = new float[256];
        private float fastLevel, slowLevel;
        private float emphasisCooldown, emphasisHold, speakingTime;
        private float nodAccent, nodAccentVelocity;

        // Cejas y sonrisa suavizadas.
        private float browInnerWeight, browInnerVelocity, browOuterWeight, browOuterVelocity;
        private float smileWeight, smileVelocity;
        private float smileBoost, smileBoostHold;
        private float smileSuppress, smileSuppressVelocity;
        private float concernTimer;

        // Microsacadas.
        private Vector2 saccadeTarget, saccade, saccadeVelocity;
        private float saccadeTimer = 0.8f;

        // Reacción en curso: 0 ninguna, 1 asentimiento, 2 inclinación neutra.
        private int reactionKind;
        private float reactionTime;

        public void SetSpeaking(bool value)
        {
            if (animator != null) animator.SetBool(SpeakingId, value);
            // Al terminar de hablar, una sonrisa algo mayor que se desvanece.
            if (speaking && !value) BoostSmile(afterSpeechSmile, 0.4f);
            speaking = value;
        }

        /// <summary>
        /// Gesto breve del personaje tras una decisión: "best" asiente y sonríe, "acceptable" inclina la cabeza
        /// de forma neutra y "poor" frunce ligeramente las cejas internas sin sonreír durante un momento.
        /// Es una expresión del personaje sobre la decisión tomada; no se infieren emociones ni estados
        /// psicológicos de la persona (AI Act).
        /// </summary>
        /// <param name="holdSeconds">En "poor", mantiene el gesto de preocupación al menos este tiempo
        /// (p. ej. mientras VictorIA explica la consecuencia).</param>
        public void React(string quality, float holdSeconds = 0f)
        {
            switch (quality?.Trim().ToLowerInvariant())
            {
                case "best":
                    reactionKind = 1;
                    reactionTime = 0f;
                    concernTimer = 0f;
                    BoostSmile(reactionSmile, 1.2f);
                    break;
                case "acceptable":
                    reactionKind = 2;
                    reactionTime = 0f;
                    concernTimer = 0f;
                    break;
                case "poor":
                    reactionKind = 0;
                    concernTimer = Mathf.Max(concernSeconds, holdSeconds);
                    smileBoost = 0f;
                    smileBoostHold = 0f;
                    break;
            }
        }

        private void Awake()
        {
            animator = GetComponent<Animator>();
            noiseSeed = Random.Range(0f, 100f);
            breathPhase = Random.Range(0f, Mathf.PI * 2f);
            smileWeight = restingSmile;
            if (voice == null) voice = GetComponentInChildren<AudioSource>(true);
            if (face == null) return;
            var mesh = face.sharedMesh;
            blinkL = mesh.GetBlendShapeIndex(blinkLeft);
            blinkR = mesh.GetBlendShapeIndex(blinkRight);
            smileL = mesh.GetBlendShapeIndex(smileLeft);
            smileR = mesh.GetBlendShapeIndex(smileRight);
            browInner = mesh.GetBlendShapeIndex(browInnerUp);
            browOuterL = mesh.GetBlendShapeIndex(browOuterUpLeft);
            browOuterR = mesh.GetBlendShapeIndex(browOuterUpRight);
            lookDownL = mesh.GetBlendShapeIndex(eyeLookDownLeft);
            lookDownR = mesh.GetBlendShapeIndex(eyeLookDownRight);
            lookInL = mesh.GetBlendShapeIndex(eyeLookInLeft);
            lookInR = mesh.GetBlendShapeIndex(eyeLookInRight);
            lookOutL = mesh.GetBlendShapeIndex(eyeLookOutLeft);
            lookOutR = mesh.GetBlendShapeIndex(eyeLookOutRight);
            lookUpL = mesh.GetBlendShapeIndex(eyeLookUpLeft);
            lookUpR = mesh.GetBlendShapeIndex(eyeLookUpRight);
        }

        private void Start()
        {
            if (animator == null || !animator.isHuman) return;
            chest = Bone(HumanBodyBones.UpperChest) ?? Bone(HumanBodyBones.Chest) ?? Bone(HumanBodyBones.Spine);
            neck = Bone(HumanBodyBones.Neck);
            head = Bone(HumanBodyBones.Head);
            leftShoulder = Bone(HumanBodyBones.LeftShoulder);
            rightShoulder = Bone(HumanBodyBones.RightShoulder);
            leftEye = Bone(HumanBodyBones.LeftEye);
            rightEye = Bone(HumanBodyBones.RightEye);

            // Ejes del personaje a partir de los hombros (como hace el generador de escena), en espacio de la raíz.
            var leftArm = animator.GetBoneTransform(HumanBodyBones.LeftUpperArm);
            var rightArm = animator.GetBoneTransform(HumanBodyBones.RightUpperArm);
            if (leftArm == null || rightArm == null) return;
            var up = Vector3.up;
            var right = Vector3.ProjectOnPlane(rightArm.position - leftArm.position, up);
            if (right.sqrMagnitude < 1e-6f) return;
            right.Normalize();
            localRight = transform.InverseTransformDirection(right);
            localUp = transform.InverseTransformDirection(up);
            localForward = transform.InverseTransformDirection(Vector3.Cross(right, up));
        }

        private AdditiveBone Bone(HumanBodyBones id)
        {
            var bone = animator.GetBoneTransform(id);
            return bone != null ? new AdditiveBone(bone) : null;
        }

        private void LateUpdate()
        {
            var dt = Time.deltaTime;
            if (face != null && Time.frameCount == 60)
            {
                var headBone = animator.GetBoneTransform(HumanBodyBones.Head);
                Debug.Log($"AXYRO_TUTOR_READY bounds={face.bounds} head={(headBone != null ? headBone.position : Vector3.zero)} root={transform.position} visible={face.isVisible}");
            }

            speakBlend = Mathf.MoveTowards(speakBlend, speaking ? 1f : 0f, dt / 0.4f);
            UpdateEmphasis(dt);
            UpdateSaccades(dt);
            ApplyBody(dt);
            if (face == null) return;

            // Parpadeo natural: cierre rápido y apertura algo más lenta, a intervalos irregulares.
            blinkTimer -= dt;
            if (blinkTimer <= 0f && blinkProgress < 0f) blinkProgress = 0f;
            var blink = 0f;
            if (blinkProgress >= 0f)
            {
                const float close = 0.07f, open = 0.13f;
                blink = blinkProgress < close ? blinkProgress / close : 1f - (blinkProgress - close) / open;
                blinkProgress += dt;
                if (blinkProgress >= close + open)
                {
                    blinkProgress = -1f;
                    blinkTimer = Random.value < 0.15f ? 0.25f : Random.Range(2.2f, 5.5f);
                }
            }
            SetWeight(blinkL, Mathf.Clamp01(blink) * 100f);
            SetWeight(blinkR, Mathf.Clamp01(blink) * 100f);

            ApplyFace(dt);
        }

        private void Update()
        {
            // Pequeños desplazamientos de mirada alrededor de la cámara para que no resulte fija.
            gazeTimer -= Time.deltaTime;
            if (gazeTimer <= 0f)
            {
                gazeOffset = new Vector3(Random.Range(-0.06f, 0.06f), Random.Range(-0.03f, 0.04f), 0f);
                gazeTimer = Random.Range(1.2f, 3.5f);
                NudgeBlink(blinkAfterGazeShift);
            }
        }

        private void OnAnimatorIK(int layerIndex)
        {
            if (lookTarget == null) return;
            animator.SetLookAtWeight(lookWeight, 0.12f, 0.55f, 1f, 0.6f);
            animator.SetLookAtPosition(lookTarget.position + lookTarget.TransformVector(gazeOffset));
        }

        /// <summary>Detecta picos de la voz respecto a su nivel medio y lanza un breve alzamiento de cejas.</summary>
        private void UpdateEmphasis(float dt)
        {
            var level = 0f;
            if (speaking && voice != null && voice.isPlaying)
            {
                voice.GetOutputData(samples, 0);
                var sum = 0f;
                for (var i = 0; i < samples.Length; i++) sum += samples[i] * samples[i];
                level = Mathf.Sqrt(sum / samples.Length);
            }
            fastLevel = Mathf.Lerp(fastLevel, level, 1f - Mathf.Exp(-dt / 0.05f));
            // El nivel medio solo se adapta mientras hay voz, para no partir de cero en cada frase.
            if (level > 0.002f) slowLevel = Mathf.Lerp(slowLevel, level, 1f - Mathf.Exp(-dt / 1.5f));

            speakingTime = speaking ? speakingTime + dt : 0f;
            emphasisCooldown -= dt;
            emphasisHold -= dt;
            // Se espera un poco al empezar cada locución para que el nivel medio sea representativo.
            if (speaking && speakingTime > 0.6f && emphasisCooldown <= 0f && fastLevel > 0.01f && fastLevel > slowLevel * emphasisThreshold)
            {
                emphasisHold = Random.Range(0.3f, 0.5f);
                emphasisCooldown = Random.Range(1.2f, 2.6f);
            }
            if (!speaking) emphasisHold = 0f;
            // Acompaña el énfasis con un leve cabeceo hacia abajo (grados).
            nodAccent = Mathf.SmoothDamp(nodAccent, emphasisHold > 0f ? 1.2f : 0f, ref nodAccentVelocity, 0.15f, Mathf.Infinity, dt);
        }

        /// <summary>Microsacadas pequeñas y rápidas mientras escucha; algunos cambios van seguidos de parpadeo.</summary>
        private void UpdateSaccades(float dt)
        {
            saccadeTimer -= dt;
            if (saccadeTimer <= 0f)
            {
                var previous = saccadeTarget;
                saccadeTarget = Random.value < 0.35f ? Vector2.zero : Random.insideUnitCircle * microsaccadeDegrees;
                saccadeTimer = Random.Range(0.4f, 1.5f);
                if ((saccadeTarget - previous).magnitude > microsaccadeDegrees * 0.6f) NudgeBlink(blinkAfterGazeShift * 0.5f * (1f - speakBlend));
            }
            saccade = Vector2.SmoothDamp(saccade, saccadeTarget * (1f - speakBlend), ref saccadeVelocity, 0.03f, Mathf.Infinity, dt);
        }

        /// <summary>Respiración, cabeceo procedural, reacciones y microsacadas sumados sobre la pose animada.</summary>
        private void ApplyBody(float dt)
        {
            if (head == null && neck == null && chest == null) return;
            var right = transform.TransformDirection(localRight);
            var up = transform.TransformDirection(localUp);
            var forward = transform.TransformDirection(localForward);

            // Respiración: el pecho se eleva un poco y los hombros suben apenas; el cuello compensa para no mover la mirada.
            var rate = breathsPerMinute / 60f * (speaking ? 0.85f : 1f);
            breathPhase = Mathf.Repeat(breathPhase + dt * rate * Mathf.PI * 2f, Mathf.PI * 2f);
            var breath = (1f - Mathf.Cos(breathPhase)) * 0.5f * Mathf.Lerp(1f, 0.6f, speakBlend);
            var chestPitch = -breathingDegrees * breath;
            chest?.Apply(Quaternion.AngleAxis(chestPitch, right));
            var shoulderLift = breathingDegrees * 0.8f * breath;
            leftShoulder?.Apply(Quaternion.AngleAxis(-shoulderLift, forward));
            rightShoulder?.Apply(Quaternion.AngleAxis(shoulderLift, forward));

            // Cabeceo suave con ruido Perlin: más amplio al hablar, casi imperceptible al escuchar.
            var t = Time.time;
            var amplitude = Mathf.Lerp(listeningHeadMotion, speakingHeadMotion, speakBlend);
            var pitch = Noise(t * 0.45f, noiseSeed) * amplitude + nodAccent;
            var yaw = Noise(noiseSeed + 11f, t * 0.3f) * amplitude * 0.8f;
            var roll = Noise(t * 0.25f, noiseSeed + 23f) * amplitude * 0.6f;

            // Reacciones (positivo en pitch = bajar la cabeza).
            if (reactionKind != 0)
            {
                reactionTime += dt;
                if (reactionKind == 1)
                {
                    // Asentimiento afirmativo: dos cabeceos cortos, el segundo más leve.
                    const float duration = 1.0f, period = 0.5f;
                    var envelope = Mathf.Pow(Mathf.Clamp01(1f - reactionTime / duration), 0.7f);
                    pitch += reactionNodDegrees * (0.5f - 0.5f * Mathf.Cos(Mathf.PI * 2f * reactionTime / period)) * envelope;
                    if (reactionTime >= duration) reactionKind = 0;
                }
                else
                {
                    // Inclinación neutra de cabeza, entrada y salida suaves.
                    const float duration = 1.6f;
                    var bell = Mathf.Sin(Mathf.PI * Mathf.Clamp01(reactionTime / duration));
                    bell *= bell;
                    roll += reactionTiltDegrees * bell;
                    pitch += reactionTiltDegrees * 0.3f * bell;
                    if (reactionTime >= duration) reactionKind = 0;
                }
            }

            neck?.Apply(Quaternion.AngleAxis(yaw * 0.4f, up) * Quaternion.AngleAxis(pitch * 0.4f - chestPitch * 0.7f, right) * Quaternion.AngleAxis(roll * 0.4f, forward));
            var headShare = neck != null ? 0.6f : 1f;
            head?.Apply(Quaternion.AngleAxis(yaw * headShare, up) * Quaternion.AngleAxis(pitch * headShare, right) * Quaternion.AngleAxis(roll * headShare, forward));

            // Microsacadas con los huesos de los ojos si existen (x: hacia su derecha; y: hacia arriba).
            if (leftEye != null || rightEye != null)
            {
                var eyes = Quaternion.AngleAxis(saccade.x, up) * Quaternion.AngleAxis(-saccade.y, right);
                leftEye?.Apply(eyes);
                rightEye?.Apply(eyes);
            }
        }

        /// <summary>Cejas, sonrisa y microsacadas por blendshape. No toca visemas ni parpadeo.</summary>
        private void ApplyFace(float dt)
        {
            var cap = maxExpressionWeight;

            // Cejas: énfasis al hablar (internas y externas) o preocupación contenida (solo internas).
            concernTimer -= dt;
            var concern = concernTimer > 0f;
            var emphasis = emphasisHold > 0f ? emphasisBrow : 0f;
            var innerTarget = Mathf.Max(emphasis * 0.6f, concern ? concernBrow : 0f);
            var outerTarget = concern ? 0f : emphasis;
            browInnerWeight = Mathf.SmoothDamp(browInnerWeight, Mathf.Min(innerTarget, cap), ref browInnerVelocity, emphasisHold > 0f ? 0.08f : 0.2f, Mathf.Infinity, dt);
            browOuterWeight = Mathf.SmoothDamp(browOuterWeight, Mathf.Min(outerTarget, cap), ref browOuterVelocity, emphasisHold > 0f ? 0.08f : 0.2f, Mathf.Infinity, dt);
            SetWeight(browInner, Mathf.Clamp(browInnerWeight, 0f, cap));
            SetWeight(browOuterL, Mathf.Clamp(browOuterWeight, 0f, cap));
            SetWeight(browOuterR, Mathf.Clamp(browOuterWeight, 0f, cap));

            // Sonrisa: reposo + refuerzo que se mantiene un instante y decae; se retira durante la preocupación.
            smileBoostHold -= dt;
            if (smileBoostHold <= 0f) smileBoost = Mathf.MoveTowards(smileBoost, 0f, Mathf.Max(afterSpeechSmile, reactionSmile, 1f) / afterSpeechSmileDecay * dt);
            smileSuppress = Mathf.SmoothDamp(smileSuppress, concern ? 1f : 0f, ref smileSuppressVelocity, 0.25f, Mathf.Infinity, dt);
            var smileCap = Mathf.Max(cap, restingSmile);
            var smileTarget = Mathf.Min((restingSmile + smileBoost) * (1f - smileSuppress), smileCap);
            smileWeight = Mathf.SmoothDamp(smileWeight, smileTarget, ref smileVelocity, 0.3f, Mathf.Infinity, dt);
            SetWeight(smileL, Mathf.Clamp(smileWeight, 0f, smileCap));
            SetWeight(smileR, Mathf.Clamp(smileWeight, 0f, smileCap));

            // Microsacadas por blendshape solo si el avatar no tiene huesos de ojos.
            if (leftEye == null && rightEye == null && microsaccadeDegrees > 0f)
            {
                var gain = microsaccadeWeight / microsaccadeDegrees;
                var x = Mathf.Min(Mathf.Abs(saccade.x) * gain, Mathf.Min(microsaccadeWeight, cap));
                var y = Mathf.Min(Mathf.Abs(saccade.y) * gain, Mathf.Min(microsaccadeWeight, cap));
                var toRight = saccade.x > 0f;
                var upward = saccade.y > 0f;
                // Mirar a su derecha: ojo derecho hacia fuera, ojo izquierdo hacia la nariz; y al revés.
                SetWeight(lookOutR, toRight ? x : 0f);
                SetWeight(lookInL, toRight ? x : 0f);
                SetWeight(lookOutL, toRight ? 0f : x);
                SetWeight(lookInR, toRight ? 0f : x);
                SetWeight(lookUpL, upward ? y : 0f);
                SetWeight(lookUpR, upward ? y : 0f);
                SetWeight(lookDownL, upward ? 0f : y);
                SetWeight(lookDownR, upward ? 0f : y);
            }
        }

        private void BoostSmile(float amount, float hold)
        {
            smileBoost = Mathf.Max(smileBoost, amount);
            smileBoostHold = Mathf.Max(smileBoostHold, hold);
        }

        /// <summary>Adelanta el siguiente parpadeo con cierta probabilidad (tras un cambio de mirada).</summary>
        private void NudgeBlink(float probability)
        {
            if (blinkProgress < 0f && Random.value < probability) blinkTimer = Mathf.Min(blinkTimer, Random.Range(0.05f, 0.2f));
        }

        /// <summary>Ruido Perlin centrado en cero, en [-1, 1].</summary>
        private static float Noise(float x, float y) => Mathf.Clamp(Mathf.PerlinNoise(x, y) * 2f - 1f, -1f, 1f);

        private void SetWeight(int index, float weight)
        {
            if (index >= 0) face.SetBlendShapeWeight(index, weight);
        }

        /// <summary>
        /// Hueso al que se suma una rotación sobre la pose de la animación en cada fotograma. Si el Animator no
        /// reescribe el hueso (p. ej. un hueso sin curvas), parte de la pose anterior en lugar de acumular.
        /// </summary>
        private sealed class AdditiveBone
        {
            private readonly Transform bone;
            private Quaternion lastBase, lastWritten;
            private bool written;

            public AdditiveBone(Transform bone) => this.bone = bone;

            public void Apply(Quaternion worldDelta)
            {
                var current = bone.localRotation;
                if (written && current == lastWritten) current = lastBase;
                lastBase = current;
                bone.localRotation = current;
                bone.rotation = worldDelta * bone.rotation;
                lastWritten = bone.localRotation;
                written = true;
            }
        }
    }
}

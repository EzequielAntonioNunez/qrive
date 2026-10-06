using UnityEngine;

namespace Axyro
{
    /// <summary>
    /// Tutor 3D: alterna animación de escucha y de habla, parpadea, mira a cámara y deja la boca a uLipSync.
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

        private Animator animator;
        private int blinkL = -1, blinkR = -1, smileL = -1, smileR = -1;
        private float blinkTimer = 2.2f;
        private float blinkProgress = -1f;
        private Vector3 gazeOffset;
        private float gazeTimer;

        public void SetSpeaking(bool speaking)
        {
            if (animator != null) animator.SetBool(SpeakingId, speaking);
        }

        private void Awake()
        {
            animator = GetComponent<Animator>();
            if (face == null) return;
            var mesh = face.sharedMesh;
            blinkL = mesh.GetBlendShapeIndex(blinkLeft);
            blinkR = mesh.GetBlendShapeIndex(blinkRight);
            smileL = mesh.GetBlendShapeIndex(smileLeft);
            smileR = mesh.GetBlendShapeIndex(smileRight);
        }

        private void LateUpdate()
        {
            if (face == null) return;
            if (Time.frameCount == 60)
            {
                var head = animator.GetBoneTransform(HumanBodyBones.Head);
                Debug.Log($"AXYRO_TUTOR_READY bounds={face.bounds} head={(head != null ? head.position : Vector3.zero)} root={transform.position} visible={face.isVisible}");
            }

            // Parpadeo natural: cierre rápido y apertura algo más lenta, a intervalos irregulares.
            blinkTimer -= Time.deltaTime;
            if (blinkTimer <= 0f && blinkProgress < 0f) blinkProgress = 0f;
            var blink = 0f;
            if (blinkProgress >= 0f)
            {
                const float close = 0.07f, open = 0.13f;
                blink = blinkProgress < close ? blinkProgress / close : 1f - (blinkProgress - close) / open;
                blinkProgress += Time.deltaTime;
                if (blinkProgress >= close + open)
                {
                    blinkProgress = -1f;
                    blinkTimer = Random.value < 0.15f ? 0.25f : Random.Range(2.2f, 5.5f);
                }
            }
            SetWeight(blinkL, Mathf.Clamp01(blink) * 100f);
            SetWeight(blinkR, Mathf.Clamp01(blink) * 100f);
            SetWeight(smileL, restingSmile);
            SetWeight(smileR, restingSmile);
        }

        private void Update()
        {
            // Pequeños desplazamientos de mirada alrededor de la cámara para que no resulte fija.
            gazeTimer -= Time.deltaTime;
            if (gazeTimer <= 0f)
            {
                gazeOffset = new Vector3(Random.Range(-0.06f, 0.06f), Random.Range(-0.03f, 0.04f), 0f);
                gazeTimer = Random.Range(1.2f, 3.5f);
            }
        }

        private void OnAnimatorIK(int layerIndex)
        {
            if (lookTarget == null) return;
            animator.SetLookAtWeight(lookWeight, 0.12f, 0.55f, 1f, 0.6f);
            animator.SetLookAtPosition(lookTarget.position + lookTarget.TransformVector(gazeOffset));
        }

        private void SetWeight(int index, float weight)
        {
            if (index >= 0) face.SetBlendShapeWeight(index, weight);
        }
    }
}

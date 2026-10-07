using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

namespace Axyro
{
    /// <summary>
    /// Pantalla de la pared (diegética): muestra el objeto de la situación actual —la hoja de notas, el chat del asistente,
    /// el detector, el ranking de becas…— según el id de fase. Todo el contenido es ficticio y los nombres aparecen
    /// tachados o desenfocados: nunca hay datos personales reales. Las fases desconocidas muestran un rótulo genérico
    /// con el título de la situación. Al cambiar de fase el contenido sale y entra con un fundido y un desplazamiento.
    /// </summary>
    public sealed class AxyroSceneScreen : MonoBehaviour
    {
        public const float CanvasWidth = 960f;
        public const float CanvasHeight = 540f;

        [SerializeField] private AxyroAvatarDemo avatar;
        [Tooltip("Luz suave delante de la pantalla: toma el color de acento del contenido.")]
        [SerializeField] private Light glow;
        [SerializeField] private float glowIntensity = 1.2f;

        private static readonly Color Bg = Hex(0x10243F);
        private static readonly Color Panel = Hex(0x183453);
        private static readonly Color Panel2 = Hex(0x21426A);
        private static readonly Color Line = Hex(0x2D5283);
        private static readonly Color Ink = Hex(0xF4F7FB);
        private static readonly Color Muted = Hex(0xA9BDD6);
        private static readonly Color Accent = Hex(0x649EFF);
        private static readonly Color Warn = Hex(0xF2B14A);
        private static readonly Color Danger = Hex(0xE5675F);
        private static readonly Color Ok = Hex(0x4FC08D);

        private RectTransform root;
        private Font font;
        private Sprite rounded;
        private string shownKey;
        private Content current;
        private readonly List<Content> leaving = new List<Content>();
        private Color glowTarget = Accent;
        private float nextPoll;

        /// <summary>Se dispara cuando la pantalla cambia de contenido (id de fase o null en reposo).</summary>
        public event Action<string> PhaseChanged;

        public string CurrentPhaseId { get; private set; }

        private sealed class Content
        {
            public RectTransform rect;
            public CanvasGroup group;
            public float shownAt;
            public float leftAt = -1f;
            public readonly List<Action<float>> animations = new List<Action<float>>();
        }

        private void Awake()
        {
            root = (RectTransform)transform;
            font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            rounded = BuildRoundedSprite();
        }

        private int PhaseIndex => avatar != null ? avatar.CurrentPhaseIndex : -1;
        private int PhaseTotal => avatar != null ? avatar.PhaseCount : 0;
        private string PhaseId => avatar != null ? avatar.CurrentPhaseId : null;
        private string PhaseTitle => avatar != null ? avatar.CurrentPhaseTitle : null;

        private void Start()
        {
            if (AxyroAiLive.Active) external = true;
            if (shownKey == null && !external) Show(null, null);
        }

        // ---------- Modo IA en vivo: contenido que manda AxyroAiLive (no se deduce de la fase del avatar) ----------

        private bool external;

        /// <summary>Reposo del modo IA mientras se prepara la primera situación.</summary>
        public void ShowAiWaiting()
        {
            external = true;
            ShowCustom("ia|espera", c => AiFrame(c, "MODO IA EN VIVO · UFV", "Conversa con VictorIA", "Situaciones generadas a partir de tus documentos", null));
        }

        /// <summary>Situación generada: documento genérico con el título y los nombres de los documentos fuente.</summary>
        public void ShowAiSituation(string title, string[] sources, int index, int total)
        {
            external = true;
            var key = $"ia|{index}|{title}";
            if (key == shownKey) return;
            ShowCustom(key, c => AiDocument(c, title, sources ?? Array.Empty<string>(), index, total));
        }

        /// <summary>Resumen final de la conversación.</summary>
        public void ShowAiSummary(int optimal, int total)
        {
            external = true;
            ShowCustom("ia|resumen", c => AiFrame(c, "FIN DE LA SIMULACIÓN", "Resumen", $"{optimal} de {total} decisiones óptimas", Ok));
        }

        private void ShowCustom(string key, Action<Content> build)
        {
            shownKey = key;
            CurrentPhaseId = null;
            if (current != null)
            {
                current.leftAt = Time.time;
                leaving.Add(current);
            }
            current = NewContent(key);
            glowTarget = Accent;
            build(current);
            current.group.alpha = 0f;
            PhaseChanged?.Invoke(null);
        }

        private void AiDocument(Content c, string title, string[] sources, int index, int total)
        {
            var file = sources.Length > 0 && !string.IsNullOrEmpty(sources[0]) ? sources[0] : "Documentos del docente";
            Window(c, file, "Documento", false);
            var page = Box(c.rect, 24, 92, 600, 404, Panel);
            Label(page, string.IsNullOrEmpty(title) ? "Situación" : title, 28, 18, 400, 64, 22, Ink, FontStyle.Bold);
            var badge = Box(page, 434, 26, 146, 24, new Color(0.39f, 0.62f, 1f, 0.2f));
            Label(badge, "Generado con IA", 0, 0, 146, 24, 12, Accent, FontStyle.Bold, TextAnchor.MiddleCenter);
            for (var i = 0; i < 9; i++) Redacted(page, 28, 104 + i * 26, 540 - (i % 3) * 80, 9, 0.26f);
            var highlight = Box(page, 20, 176, 560, 60, new Color(0.39f, 0.62f, 1f, 0.10f));
            Pulse(c, highlight.GetComponent<Image>(), new Color(0.39f, 0.62f, 1f, 0.05f), new Color(0.39f, 0.62f, 1f, 0.18f), 2f);
            Label(page, "Puede contener errores: contrasta con el documento original.", 28, 356, 540, 30, 12, Muted, FontStyle.Italic);

            var side = Box(c.rect, 648, 92, 288, 404, Panel);
            Label(side, "Fuentes", 20, 16, 250, 30, 16, Ink, FontStyle.Bold);
            var shown = 0;
            foreach (var source in sources)
            {
                if (string.IsNullOrEmpty(source) || shown >= 5) continue;
                var row = Box(side, 20, 58 + shown * 54, 248, 46, Panel2);
                Box(row, 12, 13, 14, 20, Accent);
                Label(row, source, 36, 0, 204, 46, 13, Ink, FontStyle.Normal);
                shown++;
            }
            if (shown == 0) Label(side, "Sin fuentes citadas en esta situación.", 20, 58, 250, 46, 13, Muted, FontStyle.Italic);
            if (total > 0) Tag(c.rect, $"Situación {Mathf.Min(index + 1, total)} de {total}", 24, 506, Accent);
            glowTarget = Hex(0x7FA9F0);
        }

        private void AiFrame(Content c, string eyebrow, string heading, string detail, Color? tone)
        {
            var frame = Box(c.rect, 0, 0, CanvasWidth, CanvasHeight, Bg);
            Box(frame, 0, 0, 10, CanvasHeight, Accent);
            Label(frame, eyebrow, 70, 150, 820, 30, 16, Accent, FontStyle.Bold);
            Label(frame, heading, 70, 190, 820, 120, 54, Ink, FontStyle.Bold);
            Label(frame, detail, 70, 330, 820, 50, 26, tone ?? Muted, FontStyle.Normal);
            var line = Box(frame, 70, 400, 0, 3, Accent);
            c.animations.Add(t => line.sizeDelta = new Vector2(220f * Ease(Mathf.Clamp01((t - 0.4f) / 1.2f)), 3f));
            Label(frame, "Generado con IA a partir de tus documentos · puede contener errores", 70, 470, 820, 30, 14, Muted, FontStyle.Italic);
        }

        /// <summary>
        /// Muestra el objeto de una situación. Lo llama la propia pantalla al detectar el cambio de fase;
        /// también puede llamarse desde fuera (p. ej. con el id que llega de la API).
        /// </summary>
        public void ShowPhase(string phaseId, string situationTitle)
        {
            var key = (phaseId ?? "") + "|" + (situationTitle ?? "");
            if (key == shownKey) return;
            Show(phaseId, situationTitle);
        }

        private void Update()
        {
            if (!external && Time.unscaledTime >= nextPoll)
            {
                nextPoll = Time.unscaledTime + 0.2f;
                var id = PhaseId;
                var title = PhaseTitle;
                if (!string.IsNullOrEmpty(id) || !string.IsNullOrEmpty(title)) ShowPhase(id, title);
            }

            var now = Time.time;
            if (current != null)
            {
                var t = now - current.shownAt;
                var k = Ease(Mathf.Clamp01((t - 0.18f) / 0.75f));
                current.group.alpha = k;
                current.rect.anchoredPosition = new Vector2(Mathf.Lerp(46f, 0f, k), 0f);
                foreach (var animation in current.animations) animation(t);
            }
            for (var i = leaving.Count - 1; i >= 0; i--)
            {
                var item = leaving[i];
                var k = Ease(Mathf.Clamp01((now - item.leftAt) / 0.35f));
                item.group.alpha = 1f - k;
                item.rect.anchoredPosition = new Vector2(Mathf.Lerp(0f, -36f, k), 0f);
                if (k >= 1f)
                {
                    Destroy(item.rect.gameObject);
                    leaving.RemoveAt(i);
                }
            }
            if (glow != null)
            {
                glow.color = Color.Lerp(glow.color, glowTarget, 1f - Mathf.Exp(-Time.deltaTime * 2f));
                glow.intensity = glowIntensity;
            }
        }

        private void Show(string phaseId, string title)
        {
            shownKey = (phaseId ?? "") + "|" + (title ?? "");
            CurrentPhaseId = phaseId;
            if (current != null)
            {
                current.leftAt = Time.time;
                leaving.Add(current);
            }
            current = NewContent(phaseId ?? "reposo");
            glowTarget = Accent;
            var index = PhaseIndex;
            var count = PhaseTotal;
            switch (phaseId)
            {
                case "datos-personales": PersonalData(current); break;
                case "verificacion": Verification(current); break;
                case "evaluacion": Detector(current); break;
                case "actividad-evaluable": Activity(current); break;
                case "feedback-asistido": FeedbackQueue(current); break;
                case "materiales-fuentes": Materials(current); break;
                case "chatbot-plazos": ChatbotDeadline(current); break;
                case "sesgo-becas": Scholarships(current); break;
                case "transparencia-ia": Transparency(current); break;
                case "prepare": Negotiation(current, "Propuesta del proveedor", "+12 %", "Revisión de precio solicitada", Warn); break;
                case "counteroffer": Negotiation(current, "Contraoferta", "3 años", "Compromiso a cambio de reducir la subida", Accent); break;
                case "close": Negotiation(current, "Cierre del acuerdo", "Hitos", "Decisión final y verificación de compromisos", Ok); break;
                default: Generic(current, title, index, count); break;
            }
            current.group.alpha = 0f;
            PhaseChanged?.Invoke(phaseId);
        }

        // ---------- Contenidos por fase (todo ficticio) ----------

        private void PersonalData(Content c)
        {
            Window(c, "Notas_y_comentarios_2026.xlsx", "Hoja de cálculo");
            var table = Box(c.rect, 24, 92, 560, 404, Panel);
            string[] headers = { "Alumno", "DNI", "Nota", "Comentario del tutor" };
            float[] widths = { 150, 96, 60, 254 };
            var x = 0f;
            for (var i = 0; i < headers.Length; i++)
            {
                Box(table, x, 0, widths[i] - 2, 30, Panel2);
                Label(table, headers[i], x + 10, 0, widths[i] - 12, 30, 13, Muted, FontStyle.Bold);
                x += widths[i];
            }
            var random = new System.Random(7);
            string[] grades = { "7,5", "9,0", "5,5", "6,8", "8,2", "4,9", "7,1", "6,0", "8,8", "5,9" };
            for (var row = 0; row < 10; row++)
            {
                var y = 34 + row * 36;
                if (row % 2 == 1) Box(table, 0, y - 2, 560, 36, new Color(1f, 1f, 1f, 0.025f));
                Redacted(table, 10, y + 10, 70 + random.Next(0, 60), 12, 0.55f);
                Label(table, "●●●●●●●" + (char)('A' + random.Next(0, 26)), 160, y, 90, 32, 12, Muted, FontStyle.Normal);
                Label(table, grades[row], 256, y, 50, 32, 14, Ink, FontStyle.Bold);
                Redacted(table, 316, y + 10, 140 + random.Next(0, 90), 10, 0.35f);
            }
            Tag(c.rect, "Datos personales · 120 alumnos", 24, 506, Danger);

            // Al lado, el chat público al que se quiere pegar la hoja.
            var chat = Box(c.rect, 600, 92, 336, 404, Panel);
            Box(chat, 0, 0, 336, 40, Panel2);
            Dot(chat, 18, 14, 12, Warn);
            Label(chat, "Chat de IA público", 40, 0, 280, 40, 15, Ink, FontStyle.Bold);
            Bubble(chat, "Redacta un informe para cada alumno con estas notas y comentarios:", 18, 60, 300, 72, Panel2, Ink, false);
            var paste = Box(chat, 18, 146, 300, 120, new Color(0.39f, 0.62f, 1f, 0.12f));
            for (var i = 0; i < 6; i++) Redacted(paste, 12, 14 + i * 17, 120 + (i * 37) % 140, 8, 0.4f);
            var input = Box(chat, 18, 340, 300, 44, Bg);
            var caret = Box(input, 14, 12, 2, 20, Accent);
            Label(input, "Pegar aquí…", 24, 0, 260, 44, 13, Muted, FontStyle.Italic);
            c.animations.Add(t => caret.gameObject.SetActive(Mathf.Repeat(t, 1.06f) < 0.6f));
            Pulse(c, paste.GetComponent<Image>(), new Color(0.39f, 0.62f, 1f, 0.08f), new Color(0.39f, 0.62f, 1f, 0.2f), 1.6f);
            glowTarget = Hex(0x7FA9F0);
        }

        private void Verification(Content c)
        {
            Window(c, "Resumen_normativa_evaluacion.docx", "Documento");
            var page = Box(c.rect, 150, 92, 660, 404, Panel);
            Label(page, "Resumen: nueva normativa de evaluación", 36, 22, 520, 36, 22, Ink, FontStyle.Bold);
            var badge = Box(page, 484, 30, 150, 24, new Color(0.39f, 0.62f, 1f, 0.2f));
            Label(badge, "Generado con IA", 0, 0, 150, 24, 12, Accent, FontStyle.Bold, TextAnchor.MiddleCenter);
            for (var i = 0; i < 6; i++) Redacted(page, 36, 82 + i * 22, 560 - (i % 3) * 70, 9, 0.28f);
            Label(page, "Referencias", 36, 222, 300, 30, 15, Muted, FontStyle.Bold);
            string[] refs = { "[1]  Normativa de evaluación · art. 12", "[2]  Reglamento académico · art. 4.3", "[3]  Resolución 17/2025 · disposición 2.ª" };
            for (var i = 0; i < refs.Length; i++)
            {
                var row = Box(page, 36, 256 + i * 40, 588, 34, i == 2 ? new Color(0.95f, 0.69f, 0.29f, 0.12f) : Panel2);
                Label(row, refs[i], 14, 0, 480, 34, 14, Ink, FontStyle.Normal);
                if (i == 2)
                {
                    var mark = Label(row, "¿?", 540, 0, 40, 34, 16, Warn, FontStyle.Bold, TextAnchor.MiddleCenter);
                    c.animations.Add(t => mark.color = new Color(Warn.r, Warn.g, Warn.b, 0.55f + 0.45f * Mathf.Abs(Mathf.Sin(t * 1.8f))));
                }
            }
            Tag(c.rect, "Para: claustro · envío programado 17:00", 150, 506, Warn);
            glowTarget = Hex(0x8FB2EE);
        }

        private void Detector(Content c)
        {
            Window(c, "Detector de texto generado", "Informe");
            var doc = Box(c.rect, 24, 92, 470, 404, Panel);
            Label(doc, "Trabajo de fin de grado", 28, 20, 420, 34, 20, Ink, FontStyle.Bold);
            Label(doc, "Autor/a:", 28, 56, 70, 24, 13, Muted, FontStyle.Normal);
            Redacted(doc, 98, 64, 150, 10, 0.5f);
            for (var i = 0; i < 12; i++)
            {
                var marked = i == 2 || i == 3 || i == 7 || i == 8 || i == 9;
                var bar = Redacted(doc, 28, 104 + i * 23, 400 - (i % 4) * 34, 9, 0.28f);
                if (marked) bar.color = new Color(Warn.r, Warn.g, Warn.b, 0.45f);
            }
            var gauge = Box(c.rect, 520, 92, 416, 404, Panel);
            Label(gauge, "Probabilidad estimada de texto generado con IA", 28, 22, 360, 50, 15, Muted, FontStyle.Bold);
            var value = Label(gauge, "0 %", 28, 90, 360, 120, 92, Ink, FontStyle.Bold, TextAnchor.MiddleCenter);
            var track = Box(gauge, 40, 236, 336, 14, Panel2);
            var fill = Box(track, 0, 0, 0, 14, Warn);
            Label(gauge, "Herramienta automática · resultado sin revisar", 28, 270, 360, 30, 13, Muted, FontStyle.Italic, TextAnchor.MiddleCenter);
            var guide = Box(gauge, 40, 320, 336, 54, Panel2);
            Label(guide, "Guía docente: uso de IA permitido si se declara", 14, 0, 310, 54, 13, Ink, FontStyle.Normal);
            c.animations.Add(t =>
            {
                var k = Ease(Mathf.Clamp01((t - 0.6f) / 1.8f));
                value.text = Mathf.RoundToInt(80f * k) + " %";
                fill.sizeDelta = new Vector2(336f * 0.8f * k, 14f);
            });
            glowTarget = Hex(0xE9B46A);
        }

        private void Activity(Content c)
        {
            Window(c, "Aula virtual · Análisis de casos (1.º)", "Actividad");
            var main = Box(c.rect, 24, 92, 600, 404, Panel);
            Label(main, "Práctica 2 · Análisis de casos", 28, 20, 540, 36, 22, Ink, FontStyle.Bold);
            Label(main, "Actividad evaluable · 30 % de la nota", 28, 58, 540, 26, 14, Muted, FontStyle.Normal);
            for (var i = 0; i < 5; i++) Redacted(main, 28, 104 + i * 22, 520 - (i % 2) * 90, 9, 0.28f);
            string[] fields = { "Entrega", "Rúbrica", "Uso de IA", "Declaración de uso" };
            string[] values = { "Semana 6", "Publicada", "Sin definir", "Sin definir" };
            for (var i = 0; i < fields.Length; i++)
            {
                var pending = i >= 2;
                var row = Box(main, 28, 230 + i * 40, 540, 34, pending ? new Color(0.95f, 0.69f, 0.29f, 0.10f) : Panel2);
                Label(row, fields[i], 14, 0, 240, 34, 14, Muted, FontStyle.Bold);
                Label(row, values[i], 260, 0, 260, 34, 14, pending ? Warn : Ink, FontStyle.Bold);
            }
            var side = Box(c.rect, 648, 92, 288, 404, Panel);
            Label(side, "Guía docente", 22, 18, 240, 30, 16, Ink, FontStyle.Bold);
            for (var i = 0; i < 4; i++) Redacted(side, 22, 64 + i * 22, 220 - (i % 2) * 50, 9, 0.28f);
            var empty = Box(side, 22, 170, 244, 120, new Color(0.95f, 0.69f, 0.29f, 0.08f));
            Label(empty, "Inteligencia artificial:\nno se indica cómo se usa\nni cómo se declara.", 14, 10, 220, 100, 14, Warn, FontStyle.Normal);
            Tag(c.rect, "Publicación en el aula virtual: la semana que viene", 24, 506, Accent);
            glowTarget = Hex(0x7FA9F0);
        }

        private void FeedbackQueue(Content c)
        {
            Window(c, "Herramienta de IA de la universidad · Corrección", "Entregas");
            var list = Box(c.rect, 24, 92, 560, 404, Panel);
            Box(list, 0, 0, 560, 34, Panel2);
            Label(list, "Entrega", 14, 0, 200, 34, 13, Muted, FontStyle.Bold);
            Label(list, "Rúbrica", 260, 0, 120, 34, 13, Muted, FontStyle.Bold);
            Label(list, "Borrador IA", 400, 0, 140, 34, 13, Muted, FontStyle.Bold);
            var random = new System.Random(11);
            var states = new List<Image>();
            for (var row = 0; row < 9; row++)
            {
                var y = 40 + row * 40;
                Redacted(list, 14, y + 14, 90 + random.Next(0, 80), 11, 0.5f);
                for (var k = 0; k < 4; k++) Box(list, 260 + k * 26, y + 12, 20, 14, k <= random.Next(1, 4) ? Accent : Line);
                var pill = Box(list, 400, y + 8, 120, 24, Panel2);
                states.Add(pill.GetComponent<Image>());
                Label(pill, "Pendiente", 0, 0, 120, 24, 12, Muted, FontStyle.Normal, TextAnchor.MiddleCenter);
            }
            var stats = Box(c.rect, 608, 92, 328, 404, Panel);
            Label(stats, "Entregas pendientes", 24, 20, 280, 30, 15, Muted, FontStyle.Bold);
            Label(stats, "90", 24, 54, 280, 100, 84, Ink, FontStyle.Bold);
            Label(stats, "Plazo de devolución", 24, 186, 280, 30, 15, Muted, FontStyle.Bold);
            Label(stats, "5 días", 24, 216, 280, 60, 40, Warn, FontStyle.Bold);
            var spinner = Box(stats, 24, 318, 280, 50, Panel2);
            var dots = Label(spinner, "Generando borradores", 16, 0, 250, 50, 14, Accent, FontStyle.Normal);
            c.animations.Add(t =>
            {
                dots.text = "Generando borradores" + new string('.', 1 + (int)(t * 2.5f) % 3);
                var lit = (int)(t * 1.5f) % (states.Count + 3);
                for (var i = 0; i < states.Count; i++) states[i].color = i == lit ? new Color(0.39f, 0.62f, 1f, 0.35f) : Panel2;
            });
            glowTarget = Hex(0x7FA9F0);
        }

        private void Materials(Content c)
        {
            Window(c, "Apuntes · Tema 7 (borrador generado con IA)", "Documento");
            var page = Box(c.rect, 24, 92, 600, 404, Panel);
            Label(page, "Tema 7 · Apuntes", 28, 18, 540, 36, 22, Ink, FontStyle.Bold);
            for (var i = 0; i < 4; i++) Redacted(page, 28, 70 + i * 22, 540 - (i % 2) * 80, 9, 0.28f);
            var copied = Box(page, 20, 160, 560, 82, new Color(0.95f, 0.69f, 0.29f, 0.12f));
            for (var i = 0; i < 3; i++) Redacted(copied, 10, 14 + i * 22, 520 - i * 60, 9, 0.35f);
            Label(page, "Coincidencia alta con un manual con derechos reservados", 28, 246, 540, 24, 12, Warn, FontStyle.Italic);
            for (var i = 0; i < 3; i++) Redacted(page, 28, 290 + i * 22, 520 - (i % 2) * 70, 9, 0.28f);
            var gallery = Box(c.rect, 648, 92, 288, 404, Panel);
            Label(gallery, "Imágenes generadas", 20, 16, 250, 30, 15, Ink, FontStyle.Bold);
            for (var i = 0; i < 2; i++)
            {
                var image = Box(gallery, 20, 60 + i * 160, 248, 120, Panel2);
                Box(image, 30, 70, 70, 36, new Color(0.39f, 0.62f, 1f, 0.35f));
                Box(image, 110, 46, 100, 60, new Color(0.39f, 0.62f, 1f, 0.22f));
                Dot(image, 190, 16, 22, new Color(0.95f, 0.69f, 0.29f, 0.6f));
                Label(gallery, "Origen y licencia: desconocidos", 20, 184 + i * 160, 250, 24, 12, Muted, FontStyle.Italic);
            }
            Pulse(c, copied.GetComponent<Image>(), new Color(0.95f, 0.69f, 0.29f, 0.07f), new Color(0.95f, 0.69f, 0.29f, 0.2f), 1.8f);
            Tag(c.rect, "Destino: aula virtual", 24, 506, Accent);
            glowTarget = Hex(0xE0B47A);
        }

        private void ChatbotDeadline(Content c)
        {
            Window(c, "Asistente virtual · Secretaría académica", "Chat web");
            var chat = Box(c.rect, 24, 92, 560, 404, Panel);
            Bubble(chat, "Hola, ¿hasta cuándo puedo solicitar la convalidación de asignaturas?", 220, 24, 320, 70, Accent * new Color(1f, 1f, 1f, 0.35f), Ink, true);
            Bubble(chat, "El plazo para solicitar convalidaciones termina el 30 de octubre.", 20, 112, 330, 70, Panel2, Ink, false);
            Bubble(chat, "¡Perfecto, gracias! Lo presento la semana que viene.", 250, 200, 290, 56, Accent * new Color(1f, 1f, 1f, 0.35f), Ink, true);
            var typing = Label(chat, "", 20, 280, 200, 30, 20, Muted, FontStyle.Bold);
            c.animations.Add(t => typing.text = new string('•', 1 + (int)(t * 3f) % 3));
            var notice = Box(c.rect, 608, 92, 328, 404, Panel);
            Label(notice, "Calendario oficial", 22, 18, 280, 30, 16, Ink, FontStyle.Bold);
            var day = Box(notice, 22, 64, 284, 150, Panel2);
            Label(day, "OCTUBRE", 0, 10, 284, 26, 14, Muted, FontStyle.Bold, TextAnchor.MiddleCenter);
            var big = Label(day, "15", 0, 36, 284, 90, 72, Danger, FontStyle.Bold, TextAnchor.MiddleCenter);
            Label(notice, "Fin del plazo de convalidaciones", 22, 226, 284, 30, 14, Ink, FontStyle.Normal);
            Label(notice, "Quedan 3 días", 22, 258, 284, 30, 16, Danger, FontStyle.Bold);
            var claim = Box(notice, 22, 316, 284, 56, new Color(0.9f, 0.4f, 0.37f, 0.12f));
            Label(claim, "1 reclamación recibida", 14, 0, 260, 56, 14, Ink, FontStyle.Normal);
            c.animations.Add(t => big.color = Color.Lerp(Danger, Ink, 0.25f * (0.5f + 0.5f * Mathf.Sin(t * 2.2f))));
            glowTarget = Hex(0x86A8E8);
        }

        private void Scholarships(Content c)
        {
            Window(c, "Priorización automática de solicitudes de beca", "Modelo");
            var table = Box(c.rect, 24, 92, 640, 404, Panel);
            string[] headers = { "#", "Solicitante", "Edad", "Trabaja", "Prioridad" };
            float[] xs = { 12, 56, 250, 330, 430 };
            Box(table, 0, 0, 640, 32, Panel2);
            for (var i = 0; i < headers.Length; i++) Label(table, headers[i], xs[i], 0, 120, 32, 13, Muted, FontStyle.Bold);
            int[] ages = { 19, 20, 21, 19, 22, 20, 27, 31, 29, 34 };
            float[] scores = { 0.94f, 0.91f, 0.88f, 0.86f, 0.83f, 0.81f, 0.42f, 0.38f, 0.35f, 0.31f };
            var random = new System.Random(5);
            var flagged = new List<Image>();
            for (var row = 0; row < 10; row++)
            {
                var y = 36 + row * 36;
                var biased = row >= 6;
                if (biased) flagged.Add(Box(table, 0, y - 2, 640, 34, new Color(0.9f, 0.4f, 0.37f, 0.1f)).GetComponent<Image>());
                Label(table, (row + 1).ToString(), xs[0], y, 40, 32, 13, Muted, FontStyle.Normal);
                Redacted(table, xs[1], y + 11, 90 + random.Next(0, 70), 10, 0.5f);
                Label(table, ages[row].ToString(), xs[2], y, 60, 32, 14, biased ? Danger : Ink, FontStyle.Bold);
                Label(table, biased ? "Sí" : "No", xs[3], y, 60, 32, 14, biased ? Danger : Ink, FontStyle.Bold);
                Box(table, xs[4], y + 11, 180, 10, Line);
                Box(table, xs[4], y + 11, 180 * scores[row], 10, biased ? Danger : Accent);
            }
            var side = Box(c.rect, 688, 92, 248, 404, Panel);
            Label(side, "Análisis interno", 20, 18, 210, 30, 16, Ink, FontStyle.Bold);
            Label(side, "Mayores de 25 y estudiantes que trabajan quedan siempre al final.", 20, 56, 210, 90, 14, Muted, FontStyle.Normal);
            Label(side, "Resolución", 20, 190, 210, 26, 14, Muted, FontStyle.Bold);
            Label(side, "en 2 semanas", 20, 216, 210, 40, 26, Warn, FontStyle.Bold);
            Pulse(c, flagged, new Color(0.9f, 0.4f, 0.37f, 0.06f), new Color(0.9f, 0.4f, 0.37f, 0.2f), 1.4f);
            glowTarget = Hex(0xD9908A);
        }

        private void Transparency(Content c)
        {
            Window(c, "Propuesta del proveedor · Chat de orientación", "Web");
            var mock = Box(c.rect, 200, 92, 400, 404, Panel);
            Box(mock, 0, 0, 400, 72, Panel2);
            var avatarBox = Box(mock, 18, 12, 48, 48, new Color(0.55f, 0.6f, 0.68f, 1f));
            Dot(avatarBox, 14, 6, 20, new Color(0.8f, 0.83f, 0.88f, 1f));
            Box(avatarBox, 8, 28, 32, 20, new Color(0.8f, 0.83f, 0.88f, 1f));
            Label(mock, "«Lucía» · Orientadora", 78, 12, 300, 26, 16, Ink, FontStyle.Bold);
            var online = Label(mock, "● En línea", 78, 38, 300, 22, 12, Ok, FontStyle.Normal);
            Bubble(mock, "¡Hola! Soy Lucía. Cuéntame lo que necesites, estoy aquí para ayudarte.", 18, 96, 300, 70, Panel2, Ink, false);
            Bubble(mock, "Tengo dificultades económicas y no sé si puedo pedir una ayuda…", 100, 186, 280, 70, Accent * new Color(1f, 1f, 1f, 0.35f), Ink, true);
            Box(mock, 18, 344, 364, 42, Bg);
            Label(mock, "Escribe tu mensaje…", 32, 344, 300, 42, 13, Muted, FontStyle.Italic);
            c.animations.Add(t => online.color = new Color(Ok.r, Ok.g, Ok.b, 0.6f + 0.4f * Mathf.Abs(Mathf.Sin(t * 1.5f))));
            var note = Box(c.rect, 624, 92, 312, 404, Panel);
            Label(note, "Configuración propuesta", 20, 18, 270, 30, 16, Ink, FontStyle.Bold);
            string[] items = { "Nombre y foto de persona", "Aviso de IA: no indicado", "Derivación a una persona: no indicada" };
            for (var i = 0; i < items.Length; i++)
            {
                var row = Box(note, 20, 66 + i * 54, 272, 46, i == 0 ? Panel2 : new Color(0.95f, 0.69f, 0.29f, 0.1f));
                Label(row, items[i], 12, 0, 252, 46, 13, i == 0 ? Ink : Warn, FontStyle.Normal);
            }
            Label(note, "Temas sensibles: ayudas, adaptaciones por discapacidad", 20, 250, 270, 60, 13, Muted, FontStyle.Italic);
            glowTarget = Hex(0x8FB2EE);
        }

        private void Negotiation(Content c, string heading, string figure, string detail, Color tone)
        {
            Window(c, "Renegociación · Proveedor estratégico", "Contrato");
            var card = Box(c.rect, 150, 110, 660, 360, Panel);
            Label(card, heading, 40, 30, 580, 40, 24, Muted, FontStyle.Bold);
            var big = Label(card, figure, 40, 90, 580, 140, 110, tone, FontStyle.Bold);
            Label(card, detail, 40, 250, 580, 40, 18, Ink, FontStyle.Normal);
            for (var i = 0; i < 2; i++) Redacted(card, 40, 306 + i * 20, 460 - i * 120, 8, 0.25f);
            c.animations.Add(t => big.color = Color.Lerp(tone, Ink, 0.15f * (0.5f + 0.5f * Mathf.Sin(t * 1.6f))));
            glowTarget = Hex(0x8FB2EE);
        }

        private void Generic(Content c, string title, int index, int count)
        {
            var frame = Box(c.rect, 0, 0, CanvasWidth, CanvasHeight, Bg);
            var band = Box(frame, 0, 0, 10, CanvasHeight, Accent);
            Label(frame, "SIMULADOR DE DECISIONES · UFV", 70, 150, 820, 30, 16, Accent, FontStyle.Bold);
            var heading = string.IsNullOrEmpty(title) ? "Uso responsable de la IA en la universidad" : title;
            Label(frame, heading, 70, 190, 820, 140, 54, Ink, FontStyle.Bold);
            var situation = index >= 0 && count > 0 ? $"Situación {index + 1} de {count}" : "Escucha la situación y decide";
            Label(frame, situation, 70, 340, 820, 40, 22, Muted, FontStyle.Normal);
            var line = Box(frame, 70, 400, 0, 3, Accent);
            c.animations.Add(t => line.sizeDelta = new Vector2(220f * Ease(Mathf.Clamp01((t - 0.4f) / 1.2f)), 3f));
            band.GetComponent<Image>().raycastTarget = false;
        }

        // ---------- Piezas ----------

        private Content NewContent(string name)
        {
            var item = new GameObject("Contenido " + name, typeof(RectTransform), typeof(CanvasGroup));
            var rect = (RectTransform)item.transform;
            rect.SetParent(root, false);
            rect.anchorMin = Vector2.zero;
            rect.anchorMax = Vector2.one;
            rect.offsetMin = Vector2.zero;
            rect.offsetMax = Vector2.zero;
            var group = item.GetComponent<CanvasGroup>();
            group.interactable = false;
            group.blocksRaycasts = false;
            return new Content { rect = rect, group = group, shownAt = Time.time };
        }

        /// <summary>Marco de aplicación: barra superior con icono, nombre del archivo y aviso de contenido ficticio.</summary>
        private void Window(Content c, string fileName, string app, bool fictional = true)
        {
            Box(c.rect, 0, 0, CanvasWidth, CanvasHeight, Bg);
            var bar = Box(c.rect, 0, 0, CanvasWidth, 64, Panel);
            Box(bar, 24, 20, 24, 24, Accent);
            Label(bar, app.ToUpperInvariant(), 60, 8, 300, 22, 11, Muted, FontStyle.Bold);
            Label(bar, fileName, 60, 26, 620, 30, 17, Ink, FontStyle.Bold);
            Dot(bar, 880, 26, 12, Line);
            Dot(bar, 900, 26, 12, Line);
            Dot(bar, 920, 26, 12, Line);
            if (!fictional) return;
            var fiction = Box(c.rect, 760, 506, 176, 22, new Color(1f, 1f, 1f, 0.05f));
            Label(fiction, "Contenido ficticio", 0, 0, 176, 22, 11, Muted, FontStyle.Italic, TextAnchor.MiddleCenter);
        }

        private RectTransform Box(RectTransform parent, float x, float y, float w, float h, Color color)
        {
            var item = new GameObject("Bloque", typeof(RectTransform), typeof(Image));
            var rect = Place(item, parent, x, y, w, h);
            var image = item.GetComponent<Image>();
            image.sprite = rounded;
            image.type = Image.Type.Sliced;
            image.pixelsPerUnitMultiplier = 2.5f;
            image.color = color;
            image.raycastTarget = false;
            return rect;
        }

        /// <summary>Barra gris redondeada en lugar de un nombre o un texto: nada identificable.</summary>
        private Image Redacted(RectTransform parent, float x, float y, float w, float h, float alpha)
        {
            var bar = Box(parent, x, y, w, h, new Color(Muted.r, Muted.g, Muted.b, alpha));
            var image = bar.GetComponent<Image>();
            image.pixelsPerUnitMultiplier = 1f;
            return image;
        }

        private void Dot(RectTransform parent, float x, float y, float size, Color color)
        {
            var dot = Box(parent, x, y, size, size, color);
            dot.GetComponent<Image>().pixelsPerUnitMultiplier = 24f / size;
        }

        private void Tag(RectTransform parent, string text, float x, float y, Color color)
        {
            var width = 18f + text.Length * 7.4f;
            var tag = Box(parent, x, y, width, 24, new Color(color.r, color.g, color.b, 0.16f));
            Label(tag, text, 10, 0, width - 12, 24, 12, color, FontStyle.Bold);
        }

        private void Bubble(RectTransform parent, string text, float x, float y, float w, float h, Color color, Color ink, bool mine)
        {
            var bubble = Box(parent, x, y, w, h, color);
            Label(bubble, text, 14, 6, w - 28, h - 12, 14, ink, FontStyle.Normal, mine ? TextAnchor.MiddleRight : TextAnchor.MiddleLeft);
        }

        private Text Label(RectTransform parent, string content, float x, float y, float w, float h, int size, Color color, FontStyle style, TextAnchor anchor = TextAnchor.MiddleLeft)
        {
            var item = new GameObject("Texto", typeof(RectTransform), typeof(Text));
            Place(item, parent, x, y, w, h);
            var text = item.GetComponent<Text>();
            text.font = font;
            text.text = content;
            text.fontSize = size;
            text.fontStyle = style;
            text.color = color;
            text.alignment = anchor;
            text.horizontalOverflow = HorizontalWrapMode.Wrap;
            text.verticalOverflow = VerticalWrapMode.Truncate;
            text.resizeTextForBestFit = true;
            text.resizeTextMaxSize = size;
            text.resizeTextMinSize = Mathf.Max(8, size / 2);
            text.raycastTarget = false;
            return text;
        }

        private static RectTransform Place(GameObject item, RectTransform parent, float x, float y, float w, float h)
        {
            var rect = (RectTransform)item.transform;
            rect.SetParent(parent, false);
            rect.anchorMin = rect.anchorMax = new Vector2(0f, 1f);
            rect.pivot = new Vector2(0f, 1f);
            rect.anchoredPosition = new Vector2(x, -y);
            rect.sizeDelta = new Vector2(w, h);
            return rect;
        }

        private static void Pulse(Content c, Image image, Color from, Color to, float period) =>
            c.animations.Add(t => image.color = Color.Lerp(from, to, 0.5f + 0.5f * Mathf.Sin(t * Mathf.PI * 2f / period)));

        private static void Pulse(Content c, List<Image> images, Color from, Color to, float period) =>
            c.animations.Add(t =>
            {
                var color = Color.Lerp(from, to, 0.5f + 0.5f * Mathf.Sin(t * Mathf.PI * 2f / period));
                foreach (var image in images) image.color = color;
            });

        private static float Ease(float t) => 1f - Mathf.Pow(1f - t, 3f);

        /// <summary>Rectángulo redondeado (radio 12 px) para 9-slice, generado en memoria.</summary>
        private static Sprite BuildRoundedSprite()
        {
            const int size = 32, radius = 12;
            var texture = new Texture2D(size, size, TextureFormat.RGBA32, false) { wrapMode = TextureWrapMode.Clamp, filterMode = FilterMode.Bilinear, name = "Esquinas" };
            var pixels = new Color32[size * size];
            for (var y = 0; y < size; y++)
            for (var x = 0; x < size; x++)
            {
                var dx = Mathf.Max(0f, Mathf.Max(radius - x - 0.5f, x + 0.5f - (size - radius)));
                var dy = Mathf.Max(0f, Mathf.Max(radius - y - 0.5f, y + 0.5f - (size - radius)));
                var distance = Mathf.Sqrt(dx * dx + dy * dy);
                var alpha = Mathf.Clamp01(radius - distance + 0.5f);
                pixels[y * size + x] = new Color32(255, 255, 255, (byte)(alpha * 255f));
            }
            texture.SetPixels32(pixels);
            texture.Apply(false, true);
            return Sprite.Create(texture, new Rect(0, 0, size, size), new Vector2(0.5f, 0.5f), 100f, 0, SpriteMeshType.FullRect, new Vector4(radius, radius, radius, radius));
        }

        private static Color Hex(int rgb) => new Color(((rgb >> 16) & 255) / 255f, ((rgb >> 8) & 255) / 255f, (rgb & 255) / 255f, 1f);
    }
}

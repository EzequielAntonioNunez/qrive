using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

namespace Axyro
{
    /// <summary>
    /// Pantalla de la pared (diegética): muestra el objeto de la situación actual —el expediente, el borrador del recurso,
    /// el contrato del proveedor, el correo del cliente…— según el id de fase. Todo el contenido es ficticio y los nombres aparecen
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
            if (shownKey == null) Show(null, null);
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
            if (Time.unscaledTime >= nextPoll)
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
                case "secreto-profesional": ProfessionalSecrecy(current); break;
                case "jurisprudencia-inventada": InventedCaseLaw(current); break;
                case "proveedor-ia": AiVendor(current); break;
                case "transparencia-cliente": ClientTransparency(current); break;
                default: Generic(current, title, index, count); break;
            }
            current.group.alpha = 0f;
            PhaseChanged?.Invoke(phaseId);
        }

        // ---------- Contenidos por fase (todo ficticio) ----------

        private void ProfessionalSecrecy(Content c)
        {
            Window(c, "Expediente_2026-0147 · Demanda por negligencia médica.docx", "Expediente");
            var page = Box(c.rect, 24, 92, 560, 404, Panel);
            Label(page, "ESCRITO DE DEMANDA", 28, 16, 380, 34, 20, Ink, FontStyle.Bold);
            var badge = Box(page, 404, 22, 132, 24, new Color(Danger.r, Danger.g, Danger.b, 0.18f));
            Label(badge, "Confidencial", 0, 0, 132, 24, 12, Danger, FontStyle.Bold, TextAnchor.MiddleCenter);
            string[] fields = { "Cliente", "DNI", "Domicilio", "Historia clínica", "Informe pericial" };
            float[] widths = { 170, 0, 230, 260, 200 };
            var sensitive = new List<Image>();
            for (var i = 0; i < fields.Length; i++)
            {
                var y = 62 + i * 34;
                var health = i >= 3;
                var row = Box(page, 28, y, 504, 30, health ? new Color(Danger.r, Danger.g, Danger.b, 0.10f) : Panel2);
                if (health || i == 4) sensitive.Add(row.GetComponent<Image>());
                Label(row, fields[i], 12, 0, 150, 30, 13, Muted, FontStyle.Bold);
                if (i == 1) Label(row, "●●●●●●●●K", 170, 0, 160, 30, 13, Muted, FontStyle.Normal);
                else Redacted(row, 170, 10, widths[i], 10, health ? 0.6f : 0.5f);
            }
            Label(page, "HECHOS", 28, 240, 300, 26, 14, Muted, FontStyle.Bold);
            for (var i = 0; i < 5; i++) Redacted(page, 28, 274 + i * 22, 500 - (i % 3) * 64, 9, 0.28f);
            Tag(c.rect, "Datos personales y de salud · cliente identificable", 24, 506, Danger);

            // Al lado, el chat público y gratuito al que se quiere pegar el expediente.
            var chat = Box(c.rect, 600, 92, 336, 404, Panel);
            Box(chat, 0, 0, 336, 40, Panel2);
            Dot(chat, 18, 14, 12, Warn);
            Label(chat, "Chat de IA público · cuenta gratuita", 40, 0, 286, 40, 14, Ink, FontStyle.Bold);
            Bubble(chat, "Redáctame la demanda con este expediente:", 18, 56, 300, 64, Panel2, Ink, false);
            var paste = Box(chat, 18, 132, 300, 120, new Color(0.39f, 0.62f, 1f, 0.12f));
            for (var i = 0; i < 6; i++) Redacted(paste, 12, 14 + i * 17, 120 + (i * 37) % 140, 8, 0.4f);
            Label(chat, "Las conversaciones pueden usarse para entrenar el modelo.", 18, 262, 300, 40, 12, Warn, FontStyle.Italic);
            var input = Box(chat, 18, 340, 300, 44, Bg);
            var caret = Box(input, 14, 12, 2, 20, Accent);
            Label(input, "Pegar aquí…", 24, 0, 260, 44, 13, Muted, FontStyle.Italic);
            c.animations.Add(t => caret.gameObject.SetActive(Mathf.Repeat(t, 1.06f) < 0.6f));
            Pulse(c, paste.GetComponent<Image>(), new Color(0.39f, 0.62f, 1f, 0.08f), new Color(0.39f, 0.62f, 1f, 0.2f), 1.6f);
            Pulse(c, sensitive, new Color(Danger.r, Danger.g, Danger.b, 0.06f), new Color(Danger.r, Danger.g, Danger.b, 0.2f), 1.4f);
            glowTarget = Hex(0x7FA9F0);
        }

        private void InventedCaseLaw(Content c)
        {
            Window(c, "Escrito_de_oposicion_borrador.docx", "Borrador");
            var page = Box(c.rect, 24, 92, 600, 404, Panel);
            Label(page, "ESCRITO DE OPOSICIÓN", 28, 16, 380, 34, 20, Ink, FontStyle.Bold);
            var badge = Box(page, 430, 22, 142, 24, new Color(0.39f, 0.62f, 1f, 0.2f));
            Label(badge, "Generado con IA", 0, 0, 142, 24, 12, Accent, FontStyle.Bold, TextAnchor.MiddleCenter);
            Label(page, "FUNDAMENTOS DE DERECHO", 28, 58, 400, 24, 13, Muted, FontStyle.Bold);
            for (var i = 0; i < 4; i++) Redacted(page, 28, 90 + i * 22, 540 - (i % 2) * 90, 9, 0.28f);
            string[] citations = { "STS …/2019, de 14 de marzo (Sala 1.ª)", "STS …/2021, de 3 de junio (Sala 3.ª)", "STS …/2022, de 9 de febrero (Sala 1.ª)" };
            string[] states = { "¿verificada?", "¿verificada?", "No aparece" };
            for (var i = 0; i < citations.Length; i++)
            {
                var tone = i == 2 ? Danger : Warn;
                var row = Box(page, 28, 190 + i * 44, 544, 36, new Color(tone.r, tone.g, tone.b, 0.12f));
                Label(row, citations[i], 14, 0, 380, 36, 14, Ink, FontStyle.Normal);
                var mark = Label(row, states[i], 400, 0, 132, 36, 13, tone, FontStyle.Bold, TextAnchor.MiddleRight);
                var phase = i * 0.7f;
                c.animations.Add(t => mark.color = new Color(tone.r, tone.g, tone.b, 0.55f + 0.45f * Mathf.Abs(Mathf.Sin(t * 1.8f + phase))));
            }
            Label(page, "Búsqueda rápida en CENDOJ: una de las sentencias no aparece.", 28, 330, 544, 26, 12, Muted, FontStyle.Italic);
            for (var i = 0; i < 2; i++) Redacted(page, 28, 362 + i * 20, 420 - i * 120, 8, 0.25f);

            var deadline = Box(c.rect, 648, 92, 288, 404, Panel);
            Label(deadline, "Plazo de presentación", 22, 18, 250, 30, 16, Ink, FontStyle.Bold);
            var due = Box(deadline, 22, 62, 244, 120, new Color(Danger.r, Danger.g, Danger.b, 0.16f));
            var dueLabel = Label(due, "Vence hoy", 0, 10, 244, 70, 38, Danger, FontStyle.Bold, TextAnchor.MiddleCenter);
            var clock = Label(due, "", 0, 76, 244, 34, 18, Ink, FontStyle.Bold, TextAnchor.MiddleCenter);
            Label(deadline, "Presentación telemática antes de las 15:00", 22, 196, 250, 44, 13, Muted, FontStyle.Normal);
            var check = Box(deadline, 22, 256, 244, 110, Panel2);
            Label(check, "Citas verificadas", 14, 8, 220, 26, 13, Muted, FontStyle.Bold);
            Label(check, "0 de 3", 14, 36, 220, 60, 40, Warn, FontStyle.Bold);
            c.animations.Add(t =>
            {
                var left = Mathf.Max(0, 9727 - (int)t);
                clock.text = $"Quedan {left / 3600:00}:{left / 60 % 60:00}:{left % 60:00}";
                dueLabel.color = Color.Lerp(Danger, Ink, 0.25f * (0.5f + 0.5f * Mathf.Sin(t * 2.2f)));
            });
            Tag(c.rect, "Borrador listo para firmar · sin revisión", 24, 506, Warn);
            glowTarget = Hex(0xE9B46A);
        }

        private void AiVendor(Content c)
        {
            Window(c, "Condiciones generales · Servicio de IA para despachos", "Contrato");
            var page = Box(c.rect, 24, 92, 560, 404, Panel);
            Label(page, "CONDICIONES GENERALES DEL SERVICIO DE IA", 28, 16, 504, 34, 17, Ink, FontStyle.Bold);
            Label(page, "Proveedor:", 28, 52, 90, 24, 13, Muted, FontStyle.Normal);
            Redacted(page, 112, 60, 170, 10, 0.5f);
            for (var i = 0; i < 3; i++) Redacted(page, 28, 92 + i * 20, 500 - (i % 2) * 80, 8, 0.25f);
            string[] clauses = { "Cl. 7 · Encargado del tratamiento (art. 28 RGPD)", "Cl. 9 · Ubicación de los datos", "Cl. 11 · Entrenamiento con datos del cliente", "Cl. 12 · Confidencialidad y secreto profesional" };
            string[] values = { "Sin anexo firmado", "«Cualquier país»", "Permitido por defecto", "Cláusula genérica" };
            Color[] tones = { Warn, Warn, Danger, Warn };
            var risky = new List<Image>();
            for (var i = 0; i < clauses.Length; i++)
            {
                var row = Box(page, 28, 170 + i * 52, 504, 44, new Color(tones[i].r, tones[i].g, tones[i].b, 0.10f));
                if (i == 2) risky.Add(row.GetComponent<Image>());
                Label(row, clauses[i], 14, 2, 330, 40, 13, Ink, FontStyle.Normal);
                Label(row, values[i], 340, 2, 152, 40, 12, tones[i], FontStyle.Bold, TextAnchor.MiddleRight);
            }
            Tag(c.rect, "Disponible hoy mismo si se aceptan las condiciones", 24, 506, Accent);

            var review = Box(c.rect, 608, 92, 328, 404, Panel);
            Label(review, "Antes de firmar", 22, 18, 280, 30, 16, Ink, FontStyle.Bold);
            string[] checks = { "Encargado del tratamiento", "Ubicación de datos", "Sin entrenamiento con datos del cliente", "Secreto profesional" };
            var ticks = new List<Text>();
            for (var i = 0; i < checks.Length; i++)
            {
                var y = 64 + i * 58;
                var box = Box(review, 22, y + 10, 26, 26, Panel2);
                Box(box, 3, 3, 20, 20, Bg);
                ticks.Add(Label(box, "", 0, 0, 26, 26, 18, Ok, FontStyle.Bold, TextAnchor.MiddleCenter));
                Label(review, checks[i], 62, y, 246, 46, 14, Ink, FontStyle.Normal);
            }
            Label(review, "Ninguna garantía confirmada todavía", 22, 310, 284, 40, 13, Warn, FontStyle.Italic);
            // El cursor recorre las casillas sin marcar ninguna: la decisión es del participante.
            var cursor = Box(review, 16, 68, 296, 38, new Color(0.39f, 0.62f, 1f, 0.0f));
            var cursorImage = cursor.GetComponent<Image>();
            c.animations.Add(t =>
            {
                var step = (int)(t * 0.8f) % checks.Length;
                cursor.anchoredPosition = new Vector2(16f, -(68f + step * 58f));
                cursorImage.color = new Color(0.39f, 0.62f, 1f, 0.12f + 0.06f * Mathf.Sin(t * 4f));
            });
            Pulse(c, risky, new Color(Danger.r, Danger.g, Danger.b, 0.06f), new Color(Danger.r, Danger.g, Danger.b, 0.2f), 1.5f);
            glowTarget = Hex(0x8FB2EE);
        }

        private void ClientTransparency(Content c)
        {
            Window(c, "Bandeja de entrada · Consulta del cliente", "Correo");
            var mail = Box(c.rect, 24, 92, 520, 404, Panel);
            Box(mail, 0, 0, 520, 96, Panel2);
            Label(mail, "De:", 20, 10, 50, 24, 13, Muted, FontStyle.Bold);
            Redacted(mail, 70, 18, 180, 10, 0.5f);
            Label(mail, "Asunto:", 20, 38, 70, 24, 13, Muted, FontStyle.Bold);
            Label(mail, "Minuta del recurso: ¿han usado IA?", 90, 38, 400, 24, 14, Ink, FontStyle.Bold);
            Label(mail, "Hoy, 9:42", 20, 64, 200, 24, 12, Muted, FontStyle.Normal);
            Label(mail, "Buenos días:\n\nHe leído que muchos despachos ya trabajan con inteligencia artificial. ¿La han utilizado para preparar mi recurso? Y, si es así, ¿por qué se me facturan esas horas en la minuta?\n\nGracias.", 22, 112, 476, 210, 15, Ink, FontStyle.Normal);
            Redacted(mail, 22, 340, 120, 10, 0.45f);
            var reply = Box(mail, 300, 352, 200, 36, new Color(0.39f, 0.62f, 1f, 0.2f));
            Label(reply, "Responder", 0, 0, 200, 36, 14, Accent, FontStyle.Bold, TextAnchor.MiddleCenter);

            var invoice = Box(c.rect, 568, 92, 368, 404, Panel);
            Label(invoice, "Minuta de honorarios", 22, 16, 320, 30, 16, Ink, FontStyle.Bold);
            Label(invoice, "N.º 2026/0318 · ficticia", 22, 44, 320, 22, 12, Muted, FontStyle.Normal);
            string[] concepts = { "Estudio del asunto", "Redacción del recurso", "Revisión y firma" };
            string[] hours = { "6,0 h", "8,0 h", "1,5 h" };
            string[] amounts = { "900 €", "1.200 €", "225 €" };
            Image flagged = null;
            for (var i = 0; i < concepts.Length; i++)
            {
                var drafting = i == 1;
                var row = Box(invoice, 16, 80 + i * 50, 336, 42, drafting ? new Color(Warn.r, Warn.g, Warn.b, 0.12f) : Panel2);
                if (drafting) flagged = row.GetComponent<Image>();
                Label(row, concepts[i], 12, 0, 170, 42, 13, Ink, FontStyle.Normal);
                Label(row, hours[i], 180, 0, 60, 42, 13, drafting ? Warn : Muted, FontStyle.Bold);
                Label(row, amounts[i], 240, 0, 84, 42, 13, Ink, FontStyle.Bold, TextAnchor.MiddleRight);
            }
            Label(invoice, "Borrador generado con IA en 20 minutos", 22, 232, 324, 26, 12, Warn, FontStyle.Italic);
            Box(invoice, 16, 274, 336, 2, Line);
            Label(invoice, "Total (sin IVA)", 22, 286, 200, 34, 15, Muted, FontStyle.Bold);
            Label(invoice, "2.325 €", 200, 286, 140, 34, 20, Ink, FontStyle.Bold, TextAnchor.MiddleRight);
            Label(invoice, "Hoja de encargo: honorarios por horas · no menciona la IA", 22, 334, 324, 40, 13, Warn, FontStyle.Normal);
            if (flagged != null) Pulse(c, flagged, new Color(Warn.r, Warn.g, Warn.b, 0.07f), new Color(Warn.r, Warn.g, Warn.b, 0.22f), 1.7f);
            Tag(c.rect, "Cliente · pendiente de respuesta", 24, 506, Accent);
            glowTarget = Hex(0x8FB2EE);
        }

        private void Generic(Content c, string title, int index, int count)
        {
            var frame = Box(c.rect, 0, 0, CanvasWidth, CanvasHeight, Bg);
            var band = Box(frame, 0, 0, 10, CanvasHeight, Accent);
            Label(frame, "AXYRO · SIMULADOR DE DECISIONES", 70, 150, 820, 30, 16, Accent, FontStyle.Bold);
            var heading = string.IsNullOrEmpty(title) ? "Uso responsable de la IA en el despacho" : title;
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
        private void Window(Content c, string fileName, string app)
        {
            Box(c.rect, 0, 0, CanvasWidth, CanvasHeight, Bg);
            var bar = Box(c.rect, 0, 0, CanvasWidth, 64, Panel);
            Box(bar, 24, 20, 24, 24, Accent);
            Label(bar, app.ToUpperInvariant(), 60, 8, 300, 22, 11, Muted, FontStyle.Bold);
            Label(bar, fileName, 60, 26, 620, 30, 17, Ink, FontStyle.Bold);
            Dot(bar, 880, 26, 12, Line);
            Dot(bar, 900, 26, 12, Line);
            Dot(bar, 920, 26, 12, Line);
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

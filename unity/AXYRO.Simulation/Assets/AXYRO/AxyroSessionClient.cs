using System;
using System.Collections;
using System.Globalization;
using System.Text;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.Networking;
using UnityEngine.UI;

namespace Axyro
{
    // Dos modos, sin ningún token en la build:
    // - WebGL (servido en /simulador/ del mismo dominio): la API es <origen>/api y la identidad la pone
    //   Cloudflare Access con su cookie, que el navegador envía solo en las peticiones al mismo origen.
    //   La sesión llega en el parámetro ?sesion=<id> del enlace que comparte el docente.
    // - Windows y editor: API local de desarrollo con la identidad demo «participante».
    public sealed class AxyroSessionClient : MonoBehaviour
    {
        private const string LocalApi = "http://127.0.0.1:8787/api";
        private const string DemoUserId = "demo-participant";
        private const string NoLinkText = "Abre el simulador desde el enlace que te comparta tu docente.";
        private const string NoAccessText = "No tienes acceso a esta sesión. Pide a tu docente que te dé de alta.";
        private const string NotFoundText = "No encuentro esta sesión. Comprueba el enlace que te ha compartido tu docente o pídele que te dé de alta.";
        private const string ObserverText = "Estás viendo la sesión como docente.\n\nSolo los participantes pueden elegir opciones.";

#if UNITY_WEBGL && !UNITY_EDITOR
        private static readonly bool WebClient = true;
#else
        private static readonly bool WebClient = false;
#endif

        [SerializeField] private AxyroAvatarDemo avatar;
        [SerializeField] private Text connectionLabel;
        [SerializeField] private Text choiceList;
        [SerializeField] private Button[] cards;
        [SerializeField] private Text[] cardLabels;
        [SerializeField] private AxyroDecisionFeedback feedback;
        [SerializeField] private AxyroTutor3D tutor;

        // Fase en la que este puesto acaba de enviar una decisión: la reacción (Rive + gesto de VictorIA)
        // solo se muestra al confirmarse esa decisión, no al reabrir una sesión ya decidida.
        private string awaitingDecisionPhase;

        private string api;
        // Cabecera x-demo-user: solo con la API local de desarrollo (en la nube el servidor la ignora).
        private string demoUser;
        // Id del usuario en la API: en WebGL sale de GET /api/me; en local es el participante demo.
        private string userId;
        private bool observer;
        // Error definitivo (sin enlace, sin acceso, sesión inexistente): se deja de consultar la API.
        private bool stopped;

        private string sessionId;
        private SessionStateData state;
        private int shownPhase = -1;
        private bool commandBusy;
        private bool joinRequested;
        // Rechazo del servidor al unirse (p. ej. la sesión ya está en marcha): no se reintenta en bucle.
        private string joinError;
        private string baseLabel;
        private DateTime? deadlineUtc;
        private int shownSeconds = -1;
        private int lastAlertSeq = -1;
        private string alertText;
        private float alertUntil;
        // Con --axyro-session (o ?sesion= en WebGL) la sesión queda fijada; sin él, Unity sigue la sesión más reciente.
        private bool pinned;

        /// <summary>True cuando hay opciones a la vista y el participante aún no ha decidido en esta fase.</summary>
        public bool CanDecide { get; private set; }

        /// <summary>Selección desde el ratón o la voz (índice 0..3).</summary>
        public void SelectOption(int index)
        {
            if (CanDecide && !commandBusy) Decide(index);
        }

        private void Start()
        {
            for (var i = 0; cards != null && i < cards.Length; i++)
            {
                var index = i;
                cards[i].onClick.AddListener(() => SelectOption(index));
            }
            ShowCards(null);

            if (WebClient) ConfigureWeb();
            else ConfigureLocal();
            if (!stopped) StartCoroutine(Poll());
        }

        private void ConfigureLocal()
        {
            api = LocalApi;
            demoUser = "participant";
            userId = DemoUserId;
            var arguments = Environment.GetCommandLineArgs();
            for (var i = 0; i < arguments.Length; i++)
            {
                string value = null;
                if (arguments[i].StartsWith("--axyro-session=", StringComparison.Ordinal)) value = arguments[i].Substring("--axyro-session=".Length);
                else if (arguments[i] == "--axyro-session" && i + 1 < arguments.Length) value = arguments[i + 1];
                if (!string.IsNullOrWhiteSpace(value))
                {
                    sessionId = value.Trim();
                    pinned = true;
                }
                // Prueba automática (QA sin ratón ni teclado): --axyro-autodecide=<1-4> elige esa opción en cada fase.
                if (arguments[i].StartsWith("--axyro-autodecide=", StringComparison.Ordinal) &&
                    int.TryParse(arguments[i].Substring("--axyro-autodecide=".Length), out var option) && option >= 1 && option <= 4)
                    autoDecide = option - 1;
            }
        }

        private int autoDecide = -1;
        private float autoDecideAt = -1f;

        private void AutoDecide()
        {
            if (autoDecide < 0) return;
            if (!CanDecide) { autoDecideAt = -1f; return; }
            if (autoDecideAt < 0f) autoDecideAt = Time.time + 3f;
            else if (Time.time >= autoDecideAt && !commandBusy)
            {
                autoDecideAt = -1f;
                SelectOption(autoDecide);
            }
        }

        private void ConfigureWeb()
        {
            var url = Application.absoluteURL;
            if (!Uri.TryCreate(url, UriKind.Absolute, out var page))
            {
                Stop(NoLinkText);
                return;
            }
            api = page.GetLeftPart(UriPartial.Authority) + "/api";
            sessionId = QueryValue(page.Query, "sesion");
            pinned = true;
            if (string.IsNullOrEmpty(sessionId) || sessionId.Length > 80 || !IsSafeId(sessionId)) Stop(NoLinkText);
            else if (connectionLabel != null) connectionLabel.text = "Conectando…";
        }

        private static string QueryValue(string query, string name)
        {
            if (string.IsNullOrEmpty(query)) return null;
            foreach (var pair in query.TrimStart('?').Split('&'))
            {
                var separator = pair.IndexOf('=');
                var key = separator < 0 ? pair : pair.Substring(0, separator);
                if (Uri.UnescapeDataString(key.Replace('+', ' ')) != name) continue;
                return separator < 0 ? "" : Uri.UnescapeDataString(pair.Substring(separator + 1).Replace('+', ' ')).Trim();
            }
            return null;
        }

        private static bool IsSafeId(string value)
        {
            foreach (var character in value)
                if (!(char.IsLetterOrDigit(character) || character == '-' || character == '_')) return false;
            return true;
        }

        /// <summary>Error definitivo: lo muestra en lugar de las opciones y deja de consultar la API.</summary>
        private void Stop(string message)
        {
            stopped = true;
            CanDecide = false;
            baseLabel = null;
            state = null;
            ShowCards(null);
            if (connectionLabel != null) connectionLabel.text = message == NoLinkText ? "Sin sesión" : "Sin acceso a la sesión";
            if (choiceList != null) choiceList.text = message;
        }

        private void Update()
        {
            RefreshTimer();
            AutoDecide();
            // El teclado se mantiene como alternativa accesible al ratón y la voz.
            var keyboard = Keyboard.current;
            if (keyboard == null || !CanDecide) return;
            if (keyboard.digit1Key.wasPressedThisFrame) SelectOption(0);
            if (keyboard.digit2Key.wasPressedThisFrame) SelectOption(1);
            if (keyboard.digit3Key.wasPressedThisFrame) SelectOption(2);
            if (keyboard.digit4Key.wasPressedThisFrame) SelectOption(3);
        }

        private void Decide(int index)
        {
            if (state?.scenario?.phases == null || state.phaseIndex >= state.scenario.phases.Length) return;
            var choices = state.scenario.phases[state.phaseIndex].options;
            if (choices == null || index >= choices.Length) return;
            awaitingDecisionPhase = state.scenario.phases[state.phaseIndex].id;
            StartCoroutine(SendCommand("decide", choices[index].id));
        }

        private void AddHeaders(UnityWebRequest request)
        {
            if (demoUser != null) request.SetRequestHeader("x-demo-user", demoUser);
            request.SetRequestHeader("x-axyro-client", "unity");
        }

        /// <summary>En WebGL, 401/403 y 404 son definitivos: el participante no está dado de alta o el enlace no vale.</summary>
        private bool HandleFatal(UnityWebRequest request)
        {
            if (!WebClient) return false;
            var code = request.responseCode;
            if (code == 401 || code == 403) Stop(NoAccessText);
            else if (code == 404) Stop(NotFoundText);
            return stopped;
        }

        private void ShowOffline()
        {
            if (connectionLabel == null) return;
            baseLabel = null;
            connectionLabel.text = WebClient
                ? "Sin conexión con la sesión · reintentando… (si persiste, recarga la página)"
                : "Sin conexión con la sesión · reintentando…";
        }

        // GET /api/me → { identity: { id, name, role, ... }, demo }. Con la API local (demo) se repite como participante.
        private IEnumerator LoadIdentity()
        {
            using (var request = UnityWebRequest.Get(api + "/me"))
            {
                AddHeaders(request);
                yield return request.SendWebRequest();
                if (request.result != UnityWebRequest.Result.Success)
                {
                    if (!HandleFatal(request)) ShowOffline();
                    yield break;
                }
                var me = ParseJson<MeEnvelope>(request.downloadHandler.text);
                if (me?.identity == null || string.IsNullOrEmpty(me.identity.id))
                {
                    ShowOffline();
                    yield break;
                }
                if (me.demo && demoUser == null)
                {
                    // API local de desarrollo (pnpm dev:web): sin cabecera sería el instructor demo.
                    demoUser = "participant";
                    yield return LoadIdentity();
                    yield break;
                }
                userId = me.identity.id;
                observer = me.identity.role != "participant";
            }
        }

        private IEnumerator Poll()
        {
            while (!stopped)
            {
                if (userId == null) yield return LoadIdentity();

                if (!stopped && userId != null && (!pinned || string.IsNullOrEmpty(sessionId)))
                {
                    using (var request = UnityWebRequest.Get(api + "/sessions"))
                    {
                        AddHeaders(request);
                        yield return request.SendWebRequest();
                        if (request.result == UnityWebRequest.Result.Success)
                        {
                            var listing = ParseJson<SessionList>(request.downloadHandler.text);
                            if (listing?.sessions != null && listing.sessions.Length > 0 && listing.sessions[0].id != sessionId)
                                SwitchSession(listing.sessions[0].id);
                        }
                    }
                }

                if (!stopped && userId != null && !string.IsNullOrEmpty(sessionId) && !commandBusy)
                {
                    using (var request = UnityWebRequest.Get(api + "/sessions/" + UnityWebRequest.EscapeURL(sessionId)))
                    {
                        AddHeaders(request);
                        yield return request.SendWebRequest();
                        if (request.result == UnityWebRequest.Result.Success)
                        {
                            var envelope = ParseJson<SessionEnvelope>(request.downloadHandler.text);
                            if (envelope?.state != null) Show(envelope.state);
                        }
                        else if (!HandleFatal(request)) ShowOffline();
                    }
                }
                else if (!stopped && !WebClient && connectionLabel != null && state == null)
                    connectionLabel.text = "Modo demostración · sin sesión activa";

                if (!stopped) yield return new WaitForSeconds(1.5f);
            }
        }

        private void SwitchSession(string next)
        {
            sessionId = next;
            state = null;
            shownPhase = -1;
            lastAlertSeq = -1;
            alertText = null;
            baseLabel = null;
            deadlineUtc = null;
            joinRequested = false;
            joinError = null;
        }

        private IEnumerator SendCommand(string type, string optionId)
        {
            if (string.IsNullOrEmpty(sessionId) || stopped) yield break;
            commandBusy = true;
            var json = optionId == null
                ? $"{{\"id\":\"{Guid.NewGuid()}\",\"type\":\"{type}\"}}"
                : $"{{\"id\":\"{Guid.NewGuid()}\",\"type\":\"{type}\",\"optionId\":\"{optionId}\"}}";
            using (var request = new UnityWebRequest(api + "/sessions/" + UnityWebRequest.EscapeURL(sessionId) + "/commands", "POST"))
            {
                request.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(json));
                request.downloadHandler = new DownloadHandlerBuffer();
                request.SetRequestHeader("content-type", "application/json");
                AddHeaders(request);
                yield return request.SendWebRequest();
                if (request.result == UnityWebRequest.Result.Success)
                {
                    var envelope = ParseJson<SessionEnvelope>(request.downloadHandler.text);
                    if (envelope?.state != null) Show(envelope.state);
                }
                else if (!HandleFatal(request) && connectionLabel != null)
                {
                    baseLabel = null;
                    var error = ParseJson<ApiError>(request.downloadHandler?.text);
                    connectionLabel.text = error != null && !string.IsNullOrEmpty(error.error) ? error.error : "No se ha podido enviar tu decisión. Inténtalo de nuevo.";
                    if (type == "join" && request.responseCode == 400 && !string.IsNullOrEmpty(error?.error)) joinError = error.error;
                    else if (type == "join") joinRequested = false;
                }
            }
            commandBusy = false;
        }

        // Una respuesta que no es JSON (p. ej. la página de inicio de sesión de Access) no debe romper el bucle.
        private static T ParseJson<T>(string text) where T : class
        {
            if (string.IsNullOrEmpty(text)) return null;
            try { return JsonUtility.FromJson<T>(text); }
            catch (ArgumentException) { return null; }
        }

        private void Show(SessionStateData next)
        {
            state = next;
            avatar?.SetLinkedSession(true);
            avatar?.SetCharacterName(next.scenario?.character?.name);
            if (next.scenario?.phases != null)
            {
                avatar?.SetPhaseCount(next.scenario.phases.Length);
                var ids = new string[next.scenario.phases.Length];
                for (int i = 0; i < ids.Length; i++)
                {
                    ids[i] = next.scenario.phases[i].id;
                    avatar?.ApplyPhaseText(i, next.scenario.phases[i].title, next.scenario.phases[i].characterLine);
                }
                avatar?.SetPhaseIds(ids);
            }
            TrackAlerts(next);
            if (next.phaseIndex != shownPhase)
            {
                avatar?.SetPhase(next.phaseIndex);
                shownPhase = next.phaseIndex;
            }
            avatar?.SetSessionStatus(next.status);
            baseLabel = $"Sesión {StatusLabel(next.status)}";
            deadlineUtc = null;
            if (!string.IsNullOrEmpty(next.phaseDeadline) &&
                DateTime.TryParse(next.phaseDeadline, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var parsed))
                deadlineUtc = parsed;
            shownSeconds = -1;
            RefreshTimer();

            CanDecide = false;
            if (choiceList == null || next.scenario?.phases == null || next.phaseIndex >= next.scenario.phases.Length) { ShowCards(null); return; }
            var phase = next.scenario.phases[next.phaseIndex];
            bool joined = Array.Exists(next.participants ?? Array.Empty<ParticipantData>(), person => person.userId == userId);
            bool decided = Array.Exists(next.decisions ?? Array.Empty<DecisionData>(), decision => decision.userId == userId && decision.phaseId == phase.id);
            // Este cliente es el puesto del participante: se une solo en cuanto encuentra una sesión activa.
            if (!observer && !joined && next.status == "active" && !joinRequested && !commandBusy)
            {
                joinRequested = true;
                StartCoroutine(SendCommand("join", null));
            }

            string message;
            if (next.status == "complete") message = "Simulación completada.\n\nGracias por participar. Tu docente comentará contigo las decisiones y sus consecuencias.";
            else if (next.status == "paused") message = "Sesión en pausa.\n\nTu docente la reanudará en unos instantes.";
            else if (observer) message = ObserverText;
            else if (!joined && joinError != null) message = $"No puedes unirte a esta sesión: {joinError}\n\nPide a tu docente que abra una sesión nueva y te comparta el enlace.";
            else if (!joined) message = "Conectando con la sesión…";
            else if (decided)
            {
                var mine = Array.Find(next.decisions, decision => decision.userId == userId && decision.phaseId == phase.id);
                var chosen = mine == null || phase.options == null ? null : Array.Find(phase.options, option => option.id == mine.optionId);
                var why = chosen != null && !string.IsNullOrEmpty(chosen.rationale) ? $"\n\nPor qué: {chosen.rationale}" : "";
                message = chosen != null
                    ? $"Has elegido: {chosen.label}\n\n{chosen.consequence}{why}\n\nTu docente abrirá la siguiente situación en breve."
                    : "Decisión registrada.\n\nTu docente abrirá la siguiente situación en breve.";
                if (chosen != null && awaitingDecisionPhase == phase.id)
                {
                    awaitingDecisionPhase = null;
                    // La valoración es de la decisión según el escenario, no de la persona (AI Act).
                    feedback?.Show(chosen.quality);
                    tutor?.React(chosen.quality);
                }
            }
            else
            {
                message = "";
                CanDecide = true;
            }
            if (alertText != null && Time.time < alertUntil) message = alertText + (message.Length > 0 ? "\n\n" + message : "");
            choiceList.text = message;
            ShowCards(CanDecide ? phase.options : null);
        }

        private void ShowCards(ChoiceData[] options)
        {
            if (cards == null) return;
            for (int i = 0; i < cards.Length; i++)
            {
                var visible = options != null && i < options.Length;
                cards[i].gameObject.SetActive(visible);
                if (visible && cardLabels != null && i < cardLabels.Length) cardLabels[i].text = options[i].label;
            }
        }

        private static string StatusLabel(string status) => status switch
        {
            "active" => "en curso",
            "paused" => "en pausa",
            "complete" => "completada",
            _ => status
        };

        // Avisa durante unos segundos de incidentes del instructor y de tiempos agotados.
        // En la primera lectura solo fija la referencia para no repetir avisos antiguos.
        private void TrackAlerts(SessionStateData next)
        {
            if (next.events == null) return;
            if (lastAlertSeq < 0)
            {
                foreach (var item in next.events) lastAlertSeq = Math.Max(lastAlertSeq, item.seq);
                return;
            }
            foreach (var item in next.events)
            {
                if (item.seq <= lastAlertSeq) continue;
                lastAlertSeq = item.seq;
                if (item.type == "incident")
                {
                    alertText = $"Novedad: {item.detail?.note}";
                    alertUntil = Time.time + 10f;
                }
                else if (item.type == "timer_expired")
                {
                    alertText = "Se ha agotado el tiempo de esta situación. No decidir también tiene consecuencias.";
                    alertUntil = Time.time + 10f;
                }
            }
        }

        // Muestra la cuenta atrás de la fase junto al estado de la sesión; solo reescribe el texto cuando cambia el segundo.
        private void RefreshTimer()
        {
            if (connectionLabel == null || baseLabel == null || state == null) return;
            int seconds;
            string suffix;
            if (deadlineUtc.HasValue)
            {
                seconds = Math.Max(0, (int)Math.Ceiling((deadlineUtc.Value - DateTime.UtcNow).TotalSeconds));
                suffix = $" · quedan {seconds / 60}:{seconds % 60:00}";
            }
            else if (state.status == "paused" && state.phaseRemainingMs > 0)
            {
                seconds = (int)Math.Ceiling(state.phaseRemainingMs / 1000.0);
                suffix = $" · {seconds / 60}:{seconds % 60:00} restantes";
            }
            else
            {
                seconds = -2;
                suffix = "";
            }
            if (seconds == shownSeconds) return;
            shownSeconds = seconds;
            connectionLabel.text = baseLabel + suffix;
        }

        [Serializable] private sealed class MeEnvelope { public IdentityData identity; public bool demo; }
        // Solo id y rol: el cliente no necesita (ni guarda) el nombre ni el correo.
        [Serializable] private sealed class IdentityData { public string id; public string role; }
        [Serializable] private sealed class SessionList { public SessionSummary[] sessions; }
        [Serializable] private sealed class SessionSummary { public string id; }
        [Serializable] private sealed class SessionEnvelope { public SessionStateData state; }
        [Serializable] private sealed class SessionStateData
        {
            public string id;
            public string status;
            public int phaseIndex;
            public string phaseDeadline;
            public long phaseRemainingMs;
            public ScenarioData scenario;
            public ParticipantData[] participants;
            public DecisionData[] decisions;
            public EventData[] events;
        }
        [Serializable] private sealed class ScenarioData { public string id; public CharacterData character; public PhaseData[] phases; }
        [Serializable] private sealed class CharacterData { public string name; }
        [Serializable] private sealed class PhaseData { public string id; public string title; public string characterLine; public ChoiceData[] options; }
        // quality y rationale solo llegan al participante una vez ha decidido en esa fase (vista filtrada por rol).
        [Serializable] private sealed class ChoiceData { public string id; public string label; public string consequence; public string quality; public string rationale; }
        [Serializable] private sealed class EventData { public int seq; public string type; public EventDetail detail; }
        [Serializable] private sealed class EventDetail { public string note; }
        [Serializable] private sealed class ParticipantData { public string userId; }
        [Serializable] private sealed class DecisionData { public string userId; public string phaseId; public string optionId; }
        [Serializable] private sealed class ApiError { public string error; }
    }
}

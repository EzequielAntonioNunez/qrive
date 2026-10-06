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
    // El puente del MVP usa solo la API demo de bucle local. Un cliente remoto necesitará su propio
    // flujo de autenticación con Cloudflare Access, nunca un token incluido en la build.
    public sealed class AxyroSessionClient : MonoBehaviour
    {
        private const string Api = "http://127.0.0.1:8787/api";
        private const string DemoUserId = "demo-participant";

        [SerializeField] private AxyroAvatarDemo avatar;
        [SerializeField] private Text connectionLabel;
        [SerializeField] private Text choiceList;
        [SerializeField] private Button[] cards;
        [SerializeField] private Text[] cardLabels;

        private string sessionId;
        private SessionStateData state;
        private int shownPhase = -1;
        private bool commandBusy;
        private bool joinRequested;
        private string baseLabel;
        private DateTime? deadlineUtc;
        private int shownSeconds = -1;
        private int lastAlertSeq = -1;
        private string alertText;
        private float alertUntil;
        // Con --axyro-session la sesión queda fijada; sin él, Unity sigue siempre la sesión más reciente.
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
            foreach (var argument in Environment.GetCommandLineArgs())
                if (argument.StartsWith("--axyro-session=", StringComparison.Ordinal))
                {
                    sessionId = argument.Substring("--axyro-session=".Length);
                    pinned = true;
                }
            for (var i = 0; cards != null && i < cards.Length; i++)
            {
                var index = i;
                cards[i].onClick.AddListener(() => SelectOption(index));
            }
            ShowCards(null);
            StartCoroutine(Poll());
        }

        private void Update()
        {
            RefreshTimer();
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
            StartCoroutine(SendCommand("decide", choices[index].id));
        }

        private IEnumerator Poll()
        {
            while (true)
            {
                if (!pinned || string.IsNullOrEmpty(sessionId))
                {
                    using (var request = UnityWebRequest.Get(Api + "/sessions"))
                    {
                        request.SetRequestHeader("x-demo-user", "participant");
                        yield return request.SendWebRequest();
                        if (request.result == UnityWebRequest.Result.Success)
                        {
                            var listing = JsonUtility.FromJson<SessionList>(request.downloadHandler.text);
                            if (listing?.sessions != null && listing.sessions.Length > 0 && listing.sessions[0].id != sessionId)
                                SwitchSession(listing.sessions[0].id);
                        }
                    }
                }

                if (!string.IsNullOrEmpty(sessionId) && !commandBusy)
                {
                    using (var request = UnityWebRequest.Get(Api + "/sessions/" + UnityWebRequest.EscapeURL(sessionId)))
                    {
                        request.SetRequestHeader("x-demo-user", "participant");
                        request.SetRequestHeader("x-axyro-client", "unity");
                        yield return request.SendWebRequest();
                        if (request.result == UnityWebRequest.Result.Success)
                        {
                            var envelope = JsonUtility.FromJson<SessionEnvelope>(request.downloadHandler.text);
                            if (envelope?.state != null) Show(envelope.state);
                        }
                        else if (connectionLabel != null)
                        {
                            baseLabel = null;
                            connectionLabel.text = "Sin conexión con la sesión · reintentando…";
                        }
                    }
                }
                else if (connectionLabel != null && state == null)
                    connectionLabel.text = "Modo demostración · sin sesión activa";

                yield return new WaitForSeconds(1.5f);
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
        }

        private IEnumerator SendCommand(string type, string optionId)
        {
            if (string.IsNullOrEmpty(sessionId)) yield break;
            commandBusy = true;
            var json = optionId == null
                ? $"{{\"id\":\"{Guid.NewGuid()}\",\"type\":\"{type}\"}}"
                : $"{{\"id\":\"{Guid.NewGuid()}\",\"type\":\"{type}\",\"optionId\":\"{optionId}\"}}";
            using (var request = new UnityWebRequest(Api + "/sessions/" + UnityWebRequest.EscapeURL(sessionId) + "/commands", "POST"))
            {
                request.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(json));
                request.downloadHandler = new DownloadHandlerBuffer();
                request.SetRequestHeader("content-type", "application/json");
                request.SetRequestHeader("x-demo-user", "participant");
                request.SetRequestHeader("x-axyro-client", "unity");
                yield return request.SendWebRequest();
                if (request.result == UnityWebRequest.Result.Success)
                {
                    var envelope = JsonUtility.FromJson<SessionEnvelope>(request.downloadHandler.text);
                    if (envelope?.state != null) Show(envelope.state);
                }
                else if (connectionLabel != null)
                {
                    baseLabel = null;
                    var error = JsonUtility.FromJson<ApiError>(request.downloadHandler.text);
                    connectionLabel.text = error != null && !string.IsNullOrEmpty(error.error) ? error.error : "No se ha podido enviar tu decisión. Inténtalo de nuevo.";
                    if (type == "join") joinRequested = false;
                }
            }
            commandBusy = false;
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
            bool joined = Array.Exists(next.participants ?? Array.Empty<ParticipantData>(), person => person.userId == DemoUserId);
            bool decided = Array.Exists(next.decisions ?? Array.Empty<DecisionData>(), decision => decision.userId == DemoUserId && decision.phaseId == phase.id);
            // Este cliente es el puesto del participante: se une solo en cuanto encuentra una sesión activa.
            if (!joined && next.status == "active" && !joinRequested && !commandBusy)
            {
                joinRequested = true;
                StartCoroutine(SendCommand("join", null));
            }

            string message;
            if (next.status == "complete") message = "Simulación completada.\n\nGracias por participar. Tu docente comentará contigo las decisiones y sus consecuencias.";
            else if (next.status == "paused") message = "Sesión en pausa.\n\nTu docente la reanudará en unos instantes.";
            else if (!joined) message = "Conectando con la sesión…";
            else if (decided)
            {
                var mine = Array.Find(next.decisions, decision => decision.userId == DemoUserId && decision.phaseId == phase.id);
                var chosen = mine == null || phase.options == null ? null : Array.Find(phase.options, option => option.id == mine.optionId);
                message = chosen != null
                    ? $"Has elegido: {chosen.label}\n\n{chosen.consequence}\n\nTu docente abrirá la siguiente situación en breve."
                    : "Decisión registrada.\n\nTu docente abrirá la siguiente situación en breve.";
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
        [Serializable] private sealed class ChoiceData { public string id; public string label; public string consequence; }
        [Serializable] private sealed class EventData { public int seq; public string type; public EventDetail detail; }
        [Serializable] private sealed class EventDetail { public string note; }
        [Serializable] private sealed class ParticipantData { public string userId; }
        [Serializable] private sealed class DecisionData { public string userId; public string phaseId; public string optionId; }
        [Serializable] private sealed class ApiError { public string error; }
    }
}

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
    // The MVP bridge deliberately uses only the loopback demo API. A remote Unity
    // client will need its own Access authentication flow, never a shipped token.
    public sealed class AxyroSessionClient : MonoBehaviour
    {
        private const string Api = "http://127.0.0.1:8787/api";
        private const string DemoUserId = "demo-participant";
        private const string RecordedScenarioId = "supplier-negotiation";

        [SerializeField] private AxyroAvatarDemo avatar;
        [SerializeField] private Text connectionLabel;
        [SerializeField] private Text choiceList;

        private string sessionId;
        private SessionStateData state;
        private int shownPhase = -1;
        private bool commandBusy;
        private string baseLabel;
        private DateTime? deadlineUtc;
        private int shownSeconds = -1;
        private int lastAlertSeq = -1;
        private string alertText;
        private float alertUntil;
        // Con --axyro-session la sesión queda fijada; sin él, Unity sigue siempre la sesión más reciente.
        private bool pinned;

        private void Start()
        {
            foreach (var argument in Environment.GetCommandLineArgs())
                if (argument.StartsWith("--axyro-session=", StringComparison.Ordinal))
                {
                    sessionId = argument.Substring("--axyro-session=".Length);
                    pinned = true;
                }
            StartCoroutine(Poll());
        }

        private void Update()
        {
            RefreshTimer();
            if (state == null || commandBusy || state.status != "active") return;
            var keyboard = Keyboard.current;
            if (keyboard == null) return;
            if (keyboard.jKey.wasPressedThisFrame) StartCoroutine(SendCommand("join", null));
            if (keyboard.digit1Key.wasPressedThisFrame) Decide(0);
            if (keyboard.digit2Key.wasPressedThisFrame) Decide(1);
            if (keyboard.digit3Key.wasPressedThisFrame) Decide(2);
            if (keyboard.digit4Key.wasPressedThisFrame) Decide(3);
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
                            connectionLabel.text = "SIN CONEXIÓN CON LA SESIÓN LOCAL";
                        }
                    }
                }
                else if (connectionLabel != null && state == null)
                    connectionLabel.text = "DEMO AUTÓNOMA · CREA UNA SESIÓN LOCAL PARA CONECTAR";

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
                    connectionLabel.text = error != null && !string.IsNullOrEmpty(error.error) ? error.error : "NO SE PUDO ENVIAR LA DECISIÓN";
                }
            }
            commandBusy = false;
        }

        private void Show(SessionStateData next)
        {
            state = next;
            avatar?.SetLinkedSession(true);
            if (next.scenario?.phases != null)
            {
                avatar?.SetPhaseCount(next.scenario.phases.Length);
                avatar?.SetVoiceAvailable(next.scenario.id == RecordedScenarioId && next.scenario.phases.Length == 3);
            }
            if (next.scenario?.phases != null)
                for (int i = 0; i < next.scenario.phases.Length; i++)
                    avatar?.ApplyPhaseText(i, next.scenario.phases[i].title, next.scenario.phases[i].characterLine);
            TrackAlerts(next);
            if (next.phaseIndex != shownPhase)
            {
                avatar?.SetPhase(next.phaseIndex);
                shownPhase = next.phaseIndex;
            }
            avatar?.SetSessionStatus(next.status);
            baseLabel = $"SESIÓN LOCAL {next.id.Substring(0, Math.Min(8, next.id.Length)).ToUpperInvariant()} · {next.status.ToUpperInvariant()}";
            deadlineUtc = null;
            if (!string.IsNullOrEmpty(next.phaseDeadline) &&
                DateTime.TryParse(next.phaseDeadline, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var parsed))
                deadlineUtc = parsed;
            shownSeconds = -1;
            RefreshTimer();

            if (choiceList == null || next.scenario?.phases == null || next.phaseIndex >= next.scenario.phases.Length) return;
            var phase = next.scenario.phases[next.phaseIndex];
            bool joined = Array.Exists(next.participants ?? Array.Empty<ParticipantData>(), person => person.userId == DemoUserId);
            bool decided = Array.Exists(next.decisions ?? Array.Empty<DecisionData>(), decision => decision.userId == DemoUserId && decision.phaseId == phase.id);
            if (next.status == "complete") choiceList.text = "SIMULACIÓN FINALIZADA · REVISA EL INFORME";
            else if (next.status == "paused") choiceList.text = "LA SESIÓN ESTÁ PAUSADA POR EL INSTRUCTOR";
            else if (!joined) choiceList.text = "PULSA J PARA UNIRTE A LA SESIÓN";
            else if (decided)
            {
                var mine = Array.Find(next.decisions, decision => decision.userId == DemoUserId && decision.phaseId == phase.id);
                var chosen = mine == null || phase.options == null ? null : Array.Find(phase.options, option => option.id == mine.optionId);
                choiceList.text = chosen != null && !string.IsNullOrEmpty(chosen.consequence)
                    ? $"DECISIÓN REGISTRADA · {chosen.consequence}\nESPERA LA SIGUIENTE FASE"
                    : "DECISIÓN REGISTRADA · ESPERA LA SIGUIENTE FASE";
            }
            else
            {
                var builder = new StringBuilder();
                for (int i = 0; i < phase.options.Length; i++)
                    builder.Append(i + 1).Append("  ").Append(phase.options[i].label).Append('\n');
                choiceList.text = builder.ToString();
            }
            if (alertText != null && Time.time < alertUntil) choiceList.text = alertText + "\n" + choiceList.text;
        }

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
                    alertText = $"INCIDENTE · {item.detail?.note}";
                    alertUntil = Time.time + 10f;
                }
                else if (item.type == "timer_expired")
                {
                    alertText = "TIEMPO AGOTADO · EL RIESGO AUMENTA";
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
                suffix = $" · {seconds / 60:00}:{seconds % 60:00}";
            }
            else if (state.status == "paused" && state.phaseRemainingMs > 0)
            {
                seconds = (int)Math.Ceiling(state.phaseRemainingMs / 1000.0);
                suffix = $" · {seconds / 60:00}:{seconds % 60:00} EN PAUSA";
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
        [Serializable] private sealed class ScenarioData { public string id; public PhaseData[] phases; }
        [Serializable] private sealed class PhaseData { public string id; public string title; public string characterLine; public ChoiceData[] options; }
        [Serializable] private sealed class ChoiceData { public string id; public string label; public string consequence; }
        [Serializable] private sealed class EventData { public int seq; public string type; public EventDetail detail; }
        [Serializable] private sealed class EventDetail { public string note; }
        [Serializable] private sealed class ParticipantData { public string userId; }
        [Serializable] private sealed class DecisionData { public string userId; public string phaseId; public string optionId; }
        [Serializable] private sealed class ApiError { public string error; }
    }
}

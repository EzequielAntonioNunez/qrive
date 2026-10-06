using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Threading;
using UnityEngine;
using UnityEngine.UI;

namespace Axyro
{
    /// <summary>
    /// Respuesta por voz del participante con Vosk (Apache 2.0, modelo small es 0.42) en el propio equipo.
    /// El audio del micrófono se reconoce en memoria contra una gramática cerrada de órdenes: no se graba
    /// ni se envía a ningún sitio. Ratón y teclado siguen siendo la alternativa cuando la voz no está disponible.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class AxyroVoiceCommands : MonoBehaviour
    {
        private const string UnavailableText = "Voz no disponible · elige con el ratón";

        [SerializeField] private AxyroSessionClient session;
        [SerializeField] private AxyroAvatarDemo avatar;
        [SerializeField] private Text status;

#if UNITY_STANDALONE_WIN || UNITY_EDITOR_WIN
        private const string OptionsText = "Te escucho · di «uno», «dos» o «tres»";
        private const string ListenOnlyText = "Te escucho · di «repetir» para oírla otra vez";
        private const float HeardSeconds = 2f;
        private const int ListenCommand = -1;

        private const string ModelFolder = "vosk-model-es";
        private const int PreferredSampleRate = 16000;
        private const int NativeSampleRate = 48000;
        private const int ClipSeconds = 2;
        // El micrófono se lee en bloques de 100 ms; si el reconocedor se retrasa se descarta lo más antiguo.
        private const int BlocksPerSecond = 10;
        private const int MaxPendingBlocks = 30;

        // Frase reconocida → índice de opción (0..3) o ListenCommand para escuchar la intervención.
        private static readonly Dictionary<string, int> Commands = new Dictionary<string, int>
        {
            { "uno", 0 }, { "opción uno", 0 }, { "primera", 0 }, { "la primera", 0 },
            { "dos", 1 }, { "opción dos", 1 }, { "segunda", 1 }, { "la segunda", 1 },
            { "tres", 2 }, { "opción tres", 2 }, { "tercera", 2 }, { "la tercera", 2 },
            { "cuatro", 3 }, { "opción cuatro", 3 }, { "cuarta", 3 }, { "la cuarta", 3 },
            { "escuchar", ListenCommand }, { "repetir", ListenCommand }, { "repite", ListenCommand }
        };

        // Muletillas admitidas delante de una orden: «el uno», «pues la dos», «vale, repite».
        private static readonly HashSet<string> Fillers = new HashSet<string>
        {
            "y", "pues", "vale", "bueno", "eh", "em", "mm", "el", "la", "a", "ver",
            "digo", "elijo", "escojo", "prefiero", "quiero"
        };

        // Palabras frecuentes que entran en la gramática solo para absorber lo que no es una orden.
        // Sin ellas, frases como «espera un momento» o «no sé qué decir» se confunden con «uno» o «dos».
        // No incluye «un», «una» ni «unos», que se comerían el «uno».
        private const string Distractors =
            "sí no vale bueno pues a ver eh em mm hola qué que tal sé lo la el los las de del en y pero porque " +
            "es eso esto esta este está estoy son ser hay muy más menos bien mal creo pienso digo decir hacer " +
            "hacerlo hacemos elijo escojo prefiero tengo tiene tienes puede puedo podemos quiero mejor peor espera " +
            "momento acuerdo verdad claro vamos depende situación opinas tú yo me te se nos ya también nada algo " +
            "todo así entonces cómo cuál cuando donde porqué consulto mismo otra otro vez seguro idea dime sabes " +
            "mira oye perdón gracias venga";

        private struct AudioBlock
        {
            public float[] Samples;
            public int Generation;
        }

        private struct HeardResult
        {
            public string Json;
            public int Generation;
        }

        [Serializable]
        private sealed class VoskResult
        {
            public string text = "";
        }

        // Estado del hilo principal.
        private bool unavailable;
        private bool listening;
        private bool hasFocus = true;
        private string heardText;
        private float heardUntil;
        private string microphone; // null: micrófono predeterminado de Windows; si no abre, se prueba cada dispositivo.
        private int sampleRate;
        private int blockSamples;
        private int clipSamples;
        private int readPosition;
        private AudioClip clip;
        // Cada vez que se abre el micrófono cambia la generación: el reconocedor se reinicia y se ignora lo anterior.
        private int generation;
        private readonly List<HeardResult> drained = new List<HeardResult>();

        // Compartido con el hilo de reconocimiento; todo protegido por «gate».
        private readonly object gate = new object();
        private readonly Queue<AudioBlock> pendingAudio = new Queue<AudioBlock>();
        private readonly Stack<float[]> freeBuffers = new Stack<float[]>();
        private readonly Queue<HeardResult> heardQueue = new Queue<HeardResult>();
        private bool stopping;
        private Thread worker;
        private volatile bool engineReady;
        // Los errores del hilo de reconocimiento se anotan aquí y se atienden en Update.
        private volatile string workerError;

        private void Start()
        {
            hasFocus = Application.isFocused;
            try
            {
                var modelPath = Path.Combine(Application.streamingAssetsPath, ModelFolder);
                if (!File.Exists(Path.Combine(modelPath, "am", "final.mdl")))
                {
                    MarkUnavailable($"no se encuentra el modelo de voz en {modelPath}");
                    return;
                }
                if (Microphone.devices.Length == 0)
                {
                    MarkUnavailable("no hay ningún micrófono conectado");
                    return;
                }

                if (!ProbeMicrophone(out var rate))
                {
                    MarkUnavailable($"ningún micrófono se pudo abrir ({string.Join(", ", Microphone.devices)})");
                    return;
                }
                sampleRate = rate;
                blockSamples = rate / BlocksPerSecond;
                clipSamples = blockSamples * BlocksPerSecond * ClipSeconds;

                // libvosk.dll y sus dependencias: Assets/Plugins/x86_64 en el editor, <Datos>/Plugins/x86_64 en la build.
                var plugins = Path.Combine(Application.dataPath, "Plugins");
                var folders = new[] { Path.Combine(plugins, "x86_64"), plugins };
                // Cargar el modelo lleva uno o dos segundos: se hace en el hilo de reconocimiento, no en el principal.
                worker = new Thread(() => RunRecognizer(modelPath, folders, rate))
                {
                    IsBackground = true,
                    Name = "Reconocimiento de voz"
                };
                worker.Start();
            }
            catch (Exception exception)
            {
                MarkUnavailable(exception.Message);
            }
        }

        private void OnApplicationFocus(bool focus) => hasFocus = focus;

        private void Update()
        {
            if (unavailable) return;
            var error = workerError;
            if (error != null)
            {
                MarkUnavailable(error);
                return;
            }

            // El tutor no debe oírse a sí mismo: mientras habla, el micrófono queda cerrado.
            var speaking = avatar != null && avatar.IsSpeaking;
            var shouldListen = engineReady && hasFocus && !speaking;
            if (shouldListen != listening && !SetMicrophone(shouldListen)) return;
            if (listening)
            {
                if (!PumpMicrophone()) return;
                HandleHeard();
            }

            var canDecide = session != null && session.CanDecide;
            string text;
            if (Time.unscaledTime < heardUntil) text = heardText;
            else if (listening) text = canDecide ? OptionsText : ListenOnlyText;
            else text = "";
            SetStatus(text);
        }

        private void OnDisable()
        {
            if (listening) SetMicrophone(false);
            if (!unavailable) SetStatus("");
        }

        private void OnDestroy()
        {
            StopMicrophone();
            if (listening && avatar != null) avatar.SetListening(false);
            listening = false;
            StopWorker(true);
        }

        /// <summary>
        /// Busca un micrófono y una frecuencia que abran de verdad: el predeterminado y después cada dispositivo,
        /// con su frecuencia nativa, 48 kHz, 44,1 kHz y 16 kHz. Vosk recibe la frecuencia elegida y remuestrea.
        /// </summary>
        private bool ProbeMicrophone(out int rate)
        {
            var devices = new List<string> { null };
            devices.AddRange(Microphone.devices);
            foreach (var device in devices)
            {
                microphone = device;
                var candidates = new List<int> { ChooseSampleRate(), NativeSampleRate, 44100, PreferredSampleRate };
                foreach (var candidate in candidates)
                {
                    if (candidate <= 0) continue;
                    AudioClip probe = null;
                    try
                    {
                        probe = Microphone.Start(device, true, ClipSeconds, candidate);
                        if (probe != null && probe.frequency == candidate && probe.channels == 1)
                        {
                            Debug.Log($"AXYRO_MIC {(device ?? "predeterminado")} {candidate} Hz");
                            rate = candidate;
                            return true;
                        }
                    }
                    catch (Exception exception)
                    {
                        Debug.LogWarning($"Voz: «{device ?? "predeterminado"}» a {candidate} Hz: {exception.Message}");
                    }
                    finally
                    {
                        if (Microphone.IsRecording(device)) Microphone.End(device);
                        if (probe != null) Destroy(probe);
                    }
                }
            }
            microphone = null;
            rate = PreferredSampleRate;
            return false;
        }

        private int ChooseSampleRate()
        {
            try
            {
                // Se graba a la frecuencia nativa del dispositivo y Vosk recibe esa frecuencia (remuestrea él):
                // muchos micrófonos de portátil (p. ej. matrices Intel Smart Sound) no abren a 16 kHz y FMOD
                // falla con «Error initializing output device». 0 y 0 significa «cualquiera»: se usa 48 kHz.
                Microphone.GetDeviceCaps(microphone, out var min, out var max);
                if (min == 0 && max == 0) return NativeSampleRate;
                return max > 0 ? max : Mathf.Max(min, PreferredSampleRate);
            }
            catch (Exception)
            {
                return NativeSampleRate;
            }
        }

        /// <summary>Abre o cierra el micrófono; devuelve false si falla y la voz queda desactivada.</summary>
        private bool SetMicrophone(bool on)
        {
            try
            {
                if (on)
                {
                    clip = Microphone.Start(microphone, true, ClipSeconds, sampleRate);
                    if (clip == null) throw new InvalidOperationException("no se pudo abrir el micrófono");
                    if (clip.frequency != sampleRate || clip.samples != clipSamples || clip.channels != 1)
                        throw new InvalidOperationException($"el micrófono graba a {clip.frequency} Hz y {clip.channels} canales, no a {sampleRate} Hz mono");
                    readPosition = 0;
                    generation++;
                }
                else
                {
                    StopMicrophone();
                }
            }
            catch (Exception exception)
            {
                MarkUnavailable(exception.Message);
                return false;
            }
            listening = on;
            if (avatar != null) avatar.SetListening(on);
            return true;
        }

        private void StopMicrophone()
        {
            if (clip == null) return;
            try
            {
                if (Microphone.IsRecording(microphone)) Microphone.End(microphone);
            }
            catch (Exception exception)
            {
                Debug.LogWarning($"Voz: no se pudo cerrar el micrófono ({exception.Message}).");
            }
            Destroy(clip);
            clip = null;
            // El audio pendiente ya no interesa: se devuelve al grupo de búferes.
            lock (gate)
            {
                while (pendingAudio.Count > 0) freeBuffers.Push(pendingAudio.Dequeue().Samples);
                heardQueue.Clear();
            }
        }

        /// <summary>Copia del clip circular del micrófono los bloques completos y los pasa al hilo de reconocimiento.</summary>
        private bool PumpMicrophone()
        {
            if (clip == null || !Microphone.IsRecording(microphone))
            {
                MarkUnavailable("el micrófono ha dejado de grabar");
                return false;
            }
            var position = Microphone.GetPosition(microphone);
            if (position < 0 || position >= clipSamples) return true;

            if (Time.unscaledDeltaTime > ClipSeconds * 0.5f)
            {
                // Tras una pausa larga el búfer circular se ha sobrescrito: se salta al audio actual.
                readPosition = position - position % blockSamples;
                generation++;
                return true;
            }

            // clipSamples es múltiplo de blockSamples y readPosition siempre cae en un bloque: GetData nunca da la vuelta.
            var available = (position - readPosition + clipSamples) % clipSamples;
            while (available >= blockSamples)
            {
                float[] buffer;
                lock (gate) buffer = freeBuffers.Count > 0 ? freeBuffers.Pop() : new float[blockSamples];
                clip.GetData(buffer, readPosition);
                readPosition = (readPosition + blockSamples) % clipSamples;
                available -= blockSamples;
                lock (gate)
                {
                    if (pendingAudio.Count >= MaxPendingBlocks) freeBuffers.Push(pendingAudio.Dequeue().Samples);
                    pendingAudio.Enqueue(new AudioBlock { Samples = buffer, Generation = generation });
                    Monitor.Pulse(gate);
                }
            }
            return true;
        }

        private void HandleHeard()
        {
            lock (gate)
            {
                while (heardQueue.Count > 0) drained.Add(heardQueue.Dequeue());
            }
            try
            {
                foreach (var heard in drained)
                {
                    if (heard.Generation != generation) continue;
                    var phrase = MatchCommand(ParseText(heard.Json), out var command);
                    // Una orden por tanda: tras actuar, lo que quede en cola ya no corresponde.
                    if (phrase != null && OnPhraseRecognized(phrase, command)) break;
                }
            }
            finally
            {
                drained.Clear();
            }
        }

        private bool OnPhraseRecognized(string phrase, int command)
        {
            if (unavailable || !listening) return false;

            if (command == ListenCommand)
            {
                if (avatar == null) return false;
                avatar.ToggleVoice();
            }
            else
            {
                // Las opciones solo cuentan cuando hay tarjetas a la vista y aún no se ha decidido.
                if (session == null || !session.CanDecide) return false;
                session.SelectOption(command);
            }

            heardText = $"Entendido: «{phrase}»";
            heardUntil = Time.unscaledTime + HeardSeconds;
            SetStatus(heardText);
            return true;
        }

        private static string ParseText(string json)
        {
            if (string.IsNullOrEmpty(json)) return "";
            try
            {
                var result = JsonUtility.FromJson<VoskResult>(json);
                return result != null && result.text != null ? result.text : "";
            }
            catch (Exception)
            {
                return "";
            }
        }

        /// <summary>Devuelve la orden si la frase es exactamente una orden, como mucho precedida de muletillas.</summary>
        private static string MatchCommand(string text, out int command)
        {
            command = 0;
            if (string.IsNullOrWhiteSpace(text)) return null;
            var words = text.ToLowerInvariant().Split((char[])null, StringSplitOptions.RemoveEmptyEntries);
            for (var skip = 0; skip < words.Length; skip++)
            {
                if (skip > 0 && !Fillers.Contains(words[skip - 1])) break;
                var phrase = string.Join(" ", words, skip, words.Length - skip);
                if (Commands.TryGetValue(phrase, out command)) return phrase;
            }
            return null;
        }

        // ---------- Hilo de reconocimiento (no toca la API de Unity) ----------

        private void RunRecognizer(string modelPath, string[] pluginFolders, int rate)
        {
            var model = IntPtr.Zero;
            var recognizer = IntPtr.Zero;
            try
            {
                VoskNative.Preload(pluginFolders);
                VoskNative.SetLogLevel(-1);
                model = VoskNative.ModelNew(modelPath);
                if (model == IntPtr.Zero)
                {
                    workerError = $"no se pudo cargar el modelo de voz de {modelPath}";
                    return;
                }
                recognizer = VoskNative.RecognizerNewGrammar(model, rate, BuildGrammar(model));
                if (recognizer == IntPtr.Zero)
                {
                    workerError = "no se pudo crear el reconocedor de voz";
                    return;
                }
                engineReady = true;

                var scaled = new float[0];
                var current = 0;
                while (true)
                {
                    AudioBlock block;
                    lock (gate)
                    {
                        while (!stopping && pendingAudio.Count == 0) Monitor.Wait(gate);
                        if (stopping) return;
                        block = pendingAudio.Dequeue();
                    }

                    if (block.Generation != current)
                    {
                        VoskNative.RecognizerReset(recognizer);
                        current = block.Generation;
                    }
                    var samples = block.Samples;
                    if (scaled.Length != samples.Length) scaled = new float[samples.Length];
                    // Vosk espera las muestras float en escala de 16 bits, no entre −1 y 1.
                    for (var i = 0; i < samples.Length; i++) scaled[i] = samples[i] * 32767f;
                    lock (gate) freeBuffers.Push(samples);

                    var state = VoskNative.AcceptWaveform(recognizer, scaled, scaled.Length);
                    if (state < 0)
                    {
                        workerError = "el reconocedor de voz ha fallado";
                        return;
                    }
                    if (state == 0) continue;
                    var json = VoskNative.Result(recognizer);
                    lock (gate) heardQueue.Enqueue(new HeardResult { Json = json, Generation = current });
                }
            }
            catch (Exception exception)
            {
                // DllNotFoundException, EntryPointNotFoundException, BadImageFormatException…
                workerError = $"{exception.GetType().Name}: {exception.Message}";
            }
            finally
            {
                engineReady = false;
                try
                {
                    if (recognizer != IntPtr.Zero) VoskNative.RecognizerFree(recognizer);
                    if (model != IntPtr.Zero) VoskNative.ModelFree(model);
                }
                catch (Exception)
                {
                    // Si la librería no llegó a cargarse no hay nada que liberar.
                }
            }
        }

        /// <summary>Gramática JSON: las órdenes, las palabras de distracción que conoce el modelo y "[unk]".</summary>
        private static string BuildGrammar(IntPtr model)
        {
            var grammar = new StringBuilder("[");
            foreach (var phrase in Commands.Keys) grammar.Append('"').Append(phrase).Append("\",");
            foreach (var word in Distractors.Split(' '))
            {
                if (word.Length == 0 || Commands.ContainsKey(word) || !VoskNative.ModelHasWord(model, word)) continue;
                grammar.Append('"').Append(word).Append("\",");
            }
            grammar.Append("\"[unk]\"]");
            return grammar.ToString();
        }

        private void StopWorker(bool wait)
        {
            lock (gate)
            {
                stopping = true;
                Monitor.PulseAll(gate);
            }
            if (wait && worker != null && worker.IsAlive && !worker.Join(2000))
                Debug.LogWarning("Voz: el reconocedor tarda en cerrarse; se liberará en segundo plano.");
            if (wait) worker = null;
        }

        /// <summary>Desactiva la voz de forma definitiva para esta ejecución; no se reintenta en cada frame.</summary>
        private void MarkUnavailable(string reason)
        {
            if (unavailable) return;
            unavailable = true;
            Debug.LogWarning($"Voz desactivada: {reason}");
            StopMicrophone();
            if (listening && avatar != null) avatar.SetListening(false);
            listening = false;
            StopWorker(false);
            SetStatus(UnavailableText);
        }
#else
        // Fuera de Windows no hay reconocedor local: el componente queda inactivo.
        private void Start()
        {
            if (avatar != null) avatar.SetListening(false);
            _ = session;
            SetStatus(UnavailableText);
            enabled = false;
        }
#endif

        private void SetStatus(string text)
        {
            if (status != null && status.text != text) status.text = text;
        }
    }
}

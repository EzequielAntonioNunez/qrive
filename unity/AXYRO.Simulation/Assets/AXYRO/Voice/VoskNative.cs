#if UNITY_STANDALONE_WIN || UNITY_EDITOR_WIN
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace Axyro
{
    /// <summary>
    /// Enlace mínimo con libvosk.dll (Vosk 0.3.45, Apache 2.0) para reconocer voz en el propio equipo.
    /// Las cadenas viajan como bytes UTF-8 terminados en cero (hay tildes: «opción»), nunca con CharSet ANSI.
    /// Un reconocedor no es seguro entre hilos: se usa siempre desde el mismo hilo.
    /// </summary>
    internal static class VoskNative
    {
        private const string Library = "libvosk";

        // Dependencias de libvosk.dll (MinGW). Se cargan antes por ruta completa porque Windows no busca
        // dependencias en la carpeta del plugin, sino en la del ejecutable.
        private static readonly string[] Dependencies = { "libwinpthread-1.dll", "libgcc_s_seh-1.dll", "libstdc++-6.dll", "libvosk.dll" };

        [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
        private static extern void vosk_set_log_level(int level);

        [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
        private static extern IntPtr vosk_model_new(byte[] modelPath);

        [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
        private static extern void vosk_model_free(IntPtr model);

        [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
        private static extern int vosk_model_find_word(IntPtr model, byte[] word);

        [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
        private static extern IntPtr vosk_recognizer_new_grm(IntPtr model, float sampleRate, byte[] grammar);

        [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
        private static extern int vosk_recognizer_accept_waveform_f(IntPtr recognizer, float[] data, int length);

        [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
        private static extern IntPtr vosk_recognizer_result(IntPtr recognizer);

        [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
        private static extern IntPtr vosk_recognizer_partial_result(IntPtr recognizer);

        [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
        private static extern IntPtr vosk_recognizer_final_result(IntPtr recognizer);

        [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
        private static extern void vosk_recognizer_reset(IntPtr recognizer);

        [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
        private static extern void vosk_recognizer_free(IntPtr recognizer);

        [DllImport("kernel32", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr LoadLibraryW(string path);

        [DllImport("kernel32", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern int GetShortPathNameW(string longPath, StringBuilder shortPath, int bufferLength);

        /// <summary>Carga libvosk.dll y sus dependencias desde la primera carpeta candidata que las contenga.</summary>
        public static void Preload(params string[] folders)
        {
            foreach (var folder in folders)
            {
                if (string.IsNullOrEmpty(folder) || !File.Exists(Path.Combine(folder, "libvosk.dll"))) continue;
                foreach (var dll in Dependencies)
                {
                    var path = Path.Combine(folder, dll);
                    if (File.Exists(path)) LoadLibraryW(path);
                }
                return;
            }
        }

        /// <summary>-1 silencia los registros de Kaldi; 0 deja los normales.</summary>
        public static void SetLogLevel(int level) => vosk_set_log_level(level);

        /// <summary>Carga el modelo; devuelve IntPtr.Zero si la carpeta no es un modelo válido.</summary>
        public static IntPtr ModelNew(string path) => vosk_model_new(ToNative(NativePath(path)));

        public static void ModelFree(IntPtr model) => vosk_model_free(model);

        /// <summary>True si la palabra está en el vocabulario del modelo (una gramática no puede usar otras).</summary>
        public static bool ModelHasWord(IntPtr model, string word) => vosk_model_find_word(model, ToNative(word)) >= 0;

        /// <summary>Reconocedor restringido a una gramática JSON (lista de frases, admite "[unk]").</summary>
        public static IntPtr RecognizerNewGrammar(IntPtr model, float sampleRate, string grammarJson) =>
            vosk_recognizer_new_grm(model, sampleRate, ToNative(grammarJson));

        /// <summary>
        /// Pasa muestras float en escala de 16 bits (−32768…32767, no −1…1). Devuelve 1 si hay una frase
        /// terminada (leer con Result), 0 si sigue escuchando y −1 si hay un error.
        /// </summary>
        public static int AcceptWaveform(IntPtr recognizer, float[] samples, int count) =>
            vosk_recognizer_accept_waveform_f(recognizer, samples, count);

        public static string Result(IntPtr recognizer) => FromNative(vosk_recognizer_result(recognizer));

        public static string PartialResult(IntPtr recognizer) => FromNative(vosk_recognizer_partial_result(recognizer));

        public static string FinalResult(IntPtr recognizer) => FromNative(vosk_recognizer_final_result(recognizer));

        /// <summary>Descarta el audio pendiente y empieza una frase nueva.</summary>
        public static void RecognizerReset(IntPtr recognizer) => vosk_recognizer_reset(recognizer);

        public static void RecognizerFree(IntPtr recognizer) => vosk_recognizer_free(recognizer);

        private static byte[] ToNative(string value)
        {
            var length = Encoding.UTF8.GetByteCount(value);
            var bytes = new byte[length + 1];
            Encoding.UTF8.GetBytes(value, 0, value.Length, bytes, 0);
            return bytes;
        }

        /// <summary>Copia una cadena UTF-8 terminada en cero que pertenece al reconocedor (no se libera aquí).</summary>
        private static string FromNative(IntPtr pointer)
        {
            if (pointer == IntPtr.Zero) return "";
            var length = 0;
            while (Marshal.ReadByte(pointer, length) != 0) length++;
            var bytes = new byte[length];
            Marshal.Copy(pointer, bytes, 0, length);
            return Encoding.UTF8.GetString(bytes);
        }

        /// <summary>
        /// Kaldi abre los ficheros del modelo con la página de códigos ANSI de Windows: si la ruta lleva
        /// caracteres no ASCII (p. ej. C:\Users\José\…) se usa su nombre corto 8.3, que siempre es ASCII.
        /// </summary>
        private static string NativePath(string path)
        {
            var ascii = true;
            foreach (var character in path)
            {
                if (character > 127) { ascii = false; break; }
            }
            if (ascii) return path;
            var buffer = new StringBuilder(1024);
            var length = GetShortPathNameW(path, buffer, buffer.Capacity);
            return length > 0 && length < buffer.Capacity ? buffer.ToString() : path;
        }
    }
}
#endif

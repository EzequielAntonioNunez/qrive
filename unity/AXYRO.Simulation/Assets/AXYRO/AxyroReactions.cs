using System;
using System.Collections.Generic;
using UnityEngine;

namespace Axyro
{
    /// <summary>
    /// Reacciones habladas de VictorIA tras una decisión. Los WAV y su guion se generan offline con
    /// scripts/tts (voz Carmen de Soniox) y viven en Audio/Reacciones/Resources/Reacciones:
    /// &lt;idFase&gt;__&lt;idOpcion&gt;.wav y reacciones.json (subtítulo, valoración y datos de la opción para la demo).
    /// Resources funciona igual en el editor, en Windows y en WebGL sin tocar la escena.
    /// La valoración es de la decisión según el escenario, nunca de la persona (AI Act).
    /// </summary>
    public static class AxyroReactions
    {
        private const string Folder = "Reacciones/";

        [Serializable]
        public sealed class Entry
        {
            public string file;
            public string phaseId;
            public string phaseTitle;
            public string optionId;
            public string label;
            public string consequence;
            public string rationale;
            public string quality;
            public string text;
        }

        [Serializable] private sealed class Catalog { public Entry[] items; }

        private static Entry[] items;

        private static Entry[] Items
        {
            get
            {
                if (items != null) return items;
                items = Array.Empty<Entry>();
                var asset = Resources.Load<TextAsset>(Folder + "reacciones");
                if (asset == null) return items;
                try { items = JsonUtility.FromJson<Catalog>(asset.text)?.items ?? Array.Empty<Entry>(); }
                catch (ArgumentException) { Debug.LogWarning("AXYRO: reacciones.json no es válido."); }
                return items;
            }
        }

        public static string FileName(string phaseId, string optionId) => phaseId + "__" + optionId;

        /// <summary>Guion de la reacción a una opción; null si el escenario no tiene reacciones grabadas.</summary>
        public static Entry Find(string phaseId, string optionId)
        {
            if (string.IsNullOrEmpty(phaseId) || string.IsNullOrEmpty(optionId)) return null;
            return Array.Find(Items, item => item.phaseId == phaseId && item.optionId == optionId);
        }

        /// <summary>Opciones de una fase en el orden del escenario (demo sin sesión).</summary>
        public static Entry[] OptionsFor(string phaseId)
        {
            if (string.IsNullOrEmpty(phaseId)) return Array.Empty<Entry>();
            var list = new List<Entry>();
            foreach (var item in Items) if (item.phaseId == phaseId) list.Add(item);
            return list.ToArray();
        }

        /// <summary>Clip de la reacción (Resources/Reacciones/&lt;idFase&gt;__&lt;idOpcion&gt;); null si no existe.</summary>
        public static AudioClip LoadClip(string phaseId, string optionId)
        {
            if (string.IsNullOrEmpty(phaseId) || string.IsNullOrEmpty(optionId)) return null;
            return Resources.Load<AudioClip>(Folder + FileName(phaseId, optionId));
        }
    }
}

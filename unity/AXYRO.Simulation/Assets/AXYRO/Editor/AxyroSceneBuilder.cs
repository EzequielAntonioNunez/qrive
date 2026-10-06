using System;
using Axyro;
using Rive.Components;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.InputSystem.UI;
using UnityEngine.UI;

public static class AxyroSceneBuilder
{
    private static readonly Color Background = Hex("#0B1020");
    private static readonly Color White = Hex("#F4F3F8");
    private static readonly Color Muted = Hex("#A9B7D2");
    private static readonly Color Mint = Hex("#A4F4D5");

    [MenuItem("AXYRO/Crear escena de avatar")]
    public static void Build()
    {
        EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

        var cameraObject = new GameObject("Camera", typeof(Camera), typeof(AudioListener));
        var camera = cameraObject.GetComponent<Camera>();
        camera.clearFlags = CameraClearFlags.SolidColor;
        camera.backgroundColor = Background;

        var canvasObject = new GameObject("AXYRO Demo", typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
        var canvas = canvasObject.GetComponent<Canvas>();
        canvas.renderMode = RenderMode.ScreenSpaceOverlay;
        var scaler = canvasObject.GetComponent<CanvasScaler>();
        scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
        scaler.referenceResolution = new Vector2(1280, 720);
        scaler.screenMatchMode = CanvasScaler.ScreenMatchMode.MatchWidthOrHeight;
        scaler.matchWidthOrHeight = 0.5f;

        var background = Image("Background", canvasObject.transform, Background, Vector2.zero, Vector2.one);
        background.raycastTarget = false;
        Image("Accent line", canvasObject.transform, Mint, new Vector2(.55f, .86f), new Vector2(.9f, .864f));

        var panelObject = new GameObject("Elena · Rive Panel", typeof(RectTransform));
        panelObject.transform.SetParent(canvasObject.transform, false);
        Stretch(panelObject.GetComponent<RectTransform>(), new Vector2(.02f, .02f), new Vector2(.52f, .98f));
        panelObject.SetActive(false);
        var panel = panelObject.AddComponent<RivePanel>();
        var renderer = panelObject.AddComponent<RiveCanvasRenderer>();
        var rendererData = new SerializedObject(renderer);
        rendererData.FindProperty("m_initialRivePanel").objectReferenceValue = panel;
        rendererData.ApplyModifiedPropertiesWithoutUndo();

        var widgetObject = new GameObject("Elena Vega · Avatar", typeof(RectTransform));
        widgetObject.transform.SetParent(panelObject.transform, false);
        Stretch(widgetObject.GetComponent<RectTransform>(), Vector2.zero, Vector2.one);
        var widget = widgetObject.AddComponent<RiveWidget>();
        var asset = AssetDatabase.LoadAssetAtPath<Rive.Asset>("Assets/AXYRO/avatar.riv");
        if (asset == null) throw new InvalidOperationException("No se pudo importar avatar.riv");
        var widgetData = new SerializedObject(widget);
        widgetData.FindProperty("m_asset").objectReferenceValue = asset;
        widgetData.FindProperty("m_artboardName").stringValue = "AXYRO Guide";
        widgetData.FindProperty("m_stateMachineName").stringValue = "Avatar";
        widgetData.ApplyModifiedPropertiesWithoutUndo();
        panelObject.SetActive(true);

        Text("Brand", canvasObject.transform, "AXYRO  /  SIM LAB", 22, Mint, new Vector2(.55f, .9f), new Vector2(.94f, .96f));
        Text("Name", canvasObject.transform, "Elena Vega", 52, White, new Vector2(.55f, .77f), new Vector2(.95f, .86f));
        var phase = Text("Phase", canvasObject.transform, "FASE 1 / 3  ·  Preparación", 17, Mint, new Vector2(.55f, .69f), new Vector2(.95f, .75f));
        var dialogue = Text("Dialogue", canvasObject.transform, "", 27, White, new Vector2(.55f, .39f), new Vector2(.95f, .67f));
        var buttonObject = new GameObject("Escuchar", typeof(RectTransform), typeof(Image), typeof(Button));
        buttonObject.transform.SetParent(canvasObject.transform, false);
        Stretch(buttonObject.GetComponent<RectTransform>(), new Vector2(.55f, .27f), new Vector2(.85f, .35f));
        buttonObject.GetComponent<Image>().color = Mint;
        var label = Text("Label", buttonObject.transform, "▶  ESCUCHAR INTERVENCIÓN", 18, Background, Vector2.zero, Vector2.one);
        label.alignment = TextAnchor.MiddleCenter;
        Text("Hint", canvasObject.transform, "1 · 2 · 3 CAMBIAN LA FASE     ESPACIO REPRODUCE LA VOZ", 14, Muted, new Vector2(.55f, .16f), new Vector2(.96f, .22f));

        var voice = canvasObject.AddComponent<AudioSource>();
        voice.playOnAwake = false;
        var demo = canvasObject.AddComponent<AxyroAvatarDemo>();
        var demoData = new SerializedObject(demo);
        demoData.FindProperty("avatar").objectReferenceValue = widget;
        demoData.FindProperty("voice").objectReferenceValue = voice;
        demoData.FindProperty("phaseTitle").objectReferenceValue = phase;
        demoData.FindProperty("dialogue").objectReferenceValue = dialogue;
        demoData.FindProperty("playLabel").objectReferenceValue = label;
        demoData.FindProperty("playButton").objectReferenceValue = buttonObject.GetComponent<Button>();
        var clips = demoData.FindProperty("lines");
        clips.arraySize = 3;
        string[] clipNames = { "prepare", "counteroffer", "close" };
        for (var i = 0; i < clipNames.Length; i++)
            clips.GetArrayElementAtIndex(i).objectReferenceValue = AssetDatabase.LoadAssetAtPath<AudioClip>($"Assets/AXYRO/Audio/{clipNames[i]}.wav");
        demoData.ApplyModifiedPropertiesWithoutUndo();

        new GameObject("EventSystem", typeof(EventSystem), typeof(InputSystemUIInputModule));
        const string scenePath = "Assets/Scenes/AXYRO Avatar Demo.unity";
        EditorSceneManager.SaveScene(EditorSceneManager.GetActiveScene(), scenePath);
        EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(scenePath, true) };
        AssetDatabase.SaveAssets();
        Debug.Log($"AXYRO_SCENE_READY {scenePath}");
    }

    private static Image Image(string name, Transform parent, Color color, Vector2 min, Vector2 max)
    {
        var item = new GameObject(name, typeof(RectTransform), typeof(Image));
        item.transform.SetParent(parent, false);
        Stretch(item.GetComponent<RectTransform>(), min, max);
        var image = item.GetComponent<Image>();
        image.color = color;
        return image;
    }

    private static Text Text(string name, Transform parent, string content, int size, Color color, Vector2 min, Vector2 max)
    {
        var item = new GameObject(name, typeof(RectTransform), typeof(Text));
        item.transform.SetParent(parent, false);
        Stretch(item.GetComponent<RectTransform>(), min, max);
        var text = item.GetComponent<Text>();
        text.text = content;
        text.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
        text.fontSize = size;
        text.color = color;
        text.alignment = TextAnchor.MiddleLeft;
        text.horizontalOverflow = HorizontalWrapMode.Wrap;
        text.verticalOverflow = VerticalWrapMode.Overflow;
        return text;
    }

    private static void Stretch(RectTransform rect, Vector2 min, Vector2 max)
    {
        rect.anchorMin = min;
        rect.anchorMax = max;
        rect.offsetMin = Vector2.zero;
        rect.offsetMax = Vector2.zero;
    }

    private static Color Hex(string value)
    {
        ColorUtility.TryParseHtmlString(value, out var color);
        return color;
    }
}

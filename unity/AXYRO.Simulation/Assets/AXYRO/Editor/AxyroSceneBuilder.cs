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
    private static readonly Color Background = Hex("#001A33");
    private static readonly Color White = Hex("#FFFFFF");
    private static readonly Color Muted = Hex("#C9D6E6");
    // Paleta UFV (plantilla UFV_Rockw_25_03): azul tinta #001A33, azul UFV #003865, acento #649EFF.
    private static readonly Color Mint = Hex("#649EFF");

    [MenuItem("AXYRO/Crear escena de avatar")]
    public static void Build()
    {
        EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

        var cameraObject = new GameObject("Camera", typeof(Camera), typeof(AudioListener));
        var camera = cameraObject.GetComponent<Camera>();
        camera.clearFlags = CameraClearFlags.SolidColor;
        camera.backgroundColor = Background;
        camera.orthographic = true;
        camera.orthographicSize = 5f;
        camera.transform.position = new Vector3(0f, 0f, -10f);

        var halo = GameObject.CreatePrimitive(PrimitiveType.Sphere);
        halo.name = "Portrait ambience";
        halo.transform.position = new Vector3(-4.2f, -1.2f, 2f);
        halo.transform.localScale = new Vector3(8.3f, 8.3f, .12f);
        UnityEngine.Object.DestroyImmediate(halo.GetComponent<Collider>());
        var haloMaterial = new Material(Shader.Find("Unlit/Color"));
        haloMaterial.color = Hex("#003865");
        halo.GetComponent<UnityEngine.Renderer>().sharedMaterial = haloMaterial;

        var portrait = GameObject.CreatePrimitive(PrimitiveType.Quad);
        portrait.name = "Elena Vega · Unity portrait";
        portrait.transform.position = new Vector3(-4.2f, -1.15f, 0f);
        portrait.transform.localScale = new Vector3(7.3f, 8.6f, 1f);
        UnityEngine.Object.DestroyImmediate(portrait.GetComponent<Collider>());
        var portraitMaterial = BuildPortraitMaterial();
        portrait.GetComponent<UnityEngine.Renderer>().sharedMaterial = portraitMaterial;

        var canvasObject = new GameObject("AXYRO Demo", typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
        var canvas = canvasObject.GetComponent<Canvas>();
        canvas.renderMode = RenderMode.ScreenSpaceOverlay;
        var scaler = canvasObject.GetComponent<CanvasScaler>();
        scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
        scaler.referenceResolution = new Vector2(1280, 720);
        scaler.screenMatchMode = CanvasScaler.ScreenMatchMode.MatchWidthOrHeight;
        scaler.matchWidthOrHeight = 0.5f;

        Image("Accent line", canvasObject.transform, Mint, new Vector2(.55f, .815f), new Vector2(.94f, .818f));

        var panelObject = new GameObject("AXYRO · Rive HUD", typeof(RectTransform));
        panelObject.transform.SetParent(canvasObject.transform, false);
        Stretch(panelObject.GetComponent<RectTransform>(), new Vector2(.55f, .85f), new Vector2(.95f, .96f));
        panelObject.SetActive(false);
        var panel = panelObject.AddComponent<RivePanel>();
        var renderer = panelObject.AddComponent<RiveCanvasRenderer>();
        var rendererData = new SerializedObject(renderer);
        rendererData.FindProperty("m_initialRivePanel").objectReferenceValue = panel;
        rendererData.ApplyModifiedPropertiesWithoutUndo();

        var widgetObject = new GameObject("AXYRO · Status HUD", typeof(RectTransform));
        widgetObject.transform.SetParent(panelObject.transform, false);
        Stretch(widgetObject.GetComponent<RectTransform>(), Vector2.zero, Vector2.one);
        var widget = widgetObject.AddComponent<RiveWidget>();
        var asset = AssetDatabase.LoadAssetAtPath<Rive.Asset>("Assets/AXYRO/hud.riv");
        if (asset == null) throw new InvalidOperationException("No se pudo importar hud.riv");
        var widgetData = new SerializedObject(widget);
        widgetData.FindProperty("m_asset").objectReferenceValue = asset;
        widgetData.FindProperty("m_artboardName").stringValue = "AXYRO HUD";
        widgetData.FindProperty("m_stateMachineName").stringValue = "HUD";
        widgetData.ApplyModifiedPropertiesWithoutUndo();
        panelObject.SetActive(true);

        Text("Brand", canvasObject.transform, "UFV  ·  AXYRO SIM LAB", 18, Mint, new Vector2(.55f, .79f), new Vector2(.94f, .82f));
        Text("Name", canvasObject.transform, "Elena Vega", 52, White, new Vector2(.55f, .69f), new Vector2(.95f, .79f));
        var phase = Text("Phase", canvasObject.transform, "FASE 1 / 3  ·  Preparación", 17, Mint, new Vector2(.55f, .62f), new Vector2(.95f, .68f));
        var dialogue = Text("Dialogue", canvasObject.transform, "", 27, White, new Vector2(.55f, .34f), new Vector2(.95f, .61f));
        var buttonObject = new GameObject("Escuchar", typeof(RectTransform), typeof(Image), typeof(Button));
        buttonObject.transform.SetParent(canvasObject.transform, false);
        Stretch(buttonObject.GetComponent<RectTransform>(), new Vector2(.55f, .22f), new Vector2(.85f, .30f));
        buttonObject.GetComponent<Image>().color = Mint;
        var label = Text("Label", buttonObject.transform, "▶  ESCUCHAR INTERVENCIÓN", 18, Background, Vector2.zero, Vector2.one);
        label.alignment = TextAnchor.MiddleCenter;
        var hint = Text("Hint", canvasObject.transform, "1 · 2 · 3 CAMBIAN LA FASE     ESPACIO REPRODUCE LA VOZ", 13, Muted, new Vector2(.55f, .01f), new Vector2(.96f, .05f));
        var choices = Text("Choices", canvasObject.transform, "", 15, White, new Vector2(.55f, .05f), new Vector2(.96f, .21f));
        var connection = Text("Connection", canvasObject.transform, "DEMO AUTÓNOMA", 13, Muted, new Vector2(.04f, .92f), new Vector2(.50f, .97f));

        var voice = canvasObject.AddComponent<AudioSource>();
        voice.playOnAwake = false;
        var demo = canvasObject.AddComponent<AxyroAvatarDemo>();
        var demoData = new SerializedObject(demo);
        demoData.FindProperty("portrait").objectReferenceValue = portrait.GetComponent<UnityEngine.Renderer>();
        demoData.FindProperty("portraitRig").objectReferenceValue = portrait.transform;
        demoData.FindProperty("hud").objectReferenceValue = widget;
        demoData.FindProperty("voice").objectReferenceValue = voice;
        demoData.FindProperty("phaseTitle").objectReferenceValue = phase;
        demoData.FindProperty("dialogue").objectReferenceValue = dialogue;
        demoData.FindProperty("playLabel").objectReferenceValue = label;
        demoData.FindProperty("playButton").objectReferenceValue = buttonObject.GetComponent<Button>();
        demoData.FindProperty("inputHint").objectReferenceValue = hint;
        var clips = demoData.FindProperty("lines");
        clips.arraySize = 3;
        string[] clipNames = { "prepare", "counteroffer", "close" };
        for (var i = 0; i < clipNames.Length; i++)
            clips.GetArrayElementAtIndex(i).objectReferenceValue = AssetDatabase.LoadAssetAtPath<AudioClip>($"Assets/AXYRO/Audio/{clipNames[i]}.wav");
        demoData.ApplyModifiedPropertiesWithoutUndo();

        var sessionClient = canvasObject.AddComponent<AxyroSessionClient>();
        var clientData = new SerializedObject(sessionClient);
        clientData.FindProperty("avatar").objectReferenceValue = demo;
        clientData.FindProperty("connectionLabel").objectReferenceValue = connection;
        clientData.FindProperty("choiceList").objectReferenceValue = choices;
        clientData.ApplyModifiedPropertiesWithoutUndo();

        new GameObject("EventSystem", typeof(EventSystem), typeof(InputSystemUIInputModule));
        const string scenePath = "Assets/Scenes/AXYRO Avatar Demo.unity";
        EditorSceneManager.SaveScene(EditorSceneManager.GetActiveScene(), scenePath);
        EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(scenePath, true) };
        AssetDatabase.SaveAssets();
        Debug.Log($"AXYRO_SCENE_READY {scenePath}");
    }

    /// <summary>
    /// Compilación sin interfaz: regenera la escena y crea Build/AXYRO-Demo.exe.
    /// Uso: Unity.exe -batchmode -quit -projectPath unity/AXYRO.Simulation -executeMethod AxyroSceneBuilder.BuildWindows
    /// </summary>
    public static void BuildWindows()
    {
        Build();
        // Ventana redimensionable por defecto: F11 o Alt+Intro pasa a pantalla completa y Esc cierra.
        PlayerSettings.fullScreenMode = FullScreenMode.Windowed;
        PlayerSettings.defaultScreenWidth = 1600;
        PlayerSettings.defaultScreenHeight = 900;
        PlayerSettings.resizableWindow = true;
        PlayerSettings.allowFullscreenSwitch = true;
        var options = new BuildPlayerOptions
        {
            scenes = new[] { "Assets/Scenes/AXYRO Avatar Demo.unity" },
            locationPathName = "Build/AXYRO-Demo.exe",
            target = BuildTarget.StandaloneWindows64,
            options = BuildOptions.None
        };
        var report = BuildPipeline.BuildPlayer(options);
        var summary = report.summary;
        Debug.Log($"AXYRO_BUILD_RESULT {summary.result} errors={summary.totalErrors} size={summary.totalSize}");
        if (summary.result != UnityEditor.Build.Reporting.BuildResult.Succeeded) EditorApplication.Exit(1);
    }

    private static Material BuildPortraitMaterial()
    {
        const string materialPath = "Assets/AXYRO/Characters/Elena/ElenaPortrait.mat";
        var shader = Shader.Find("AXYRO/ElenaPortrait");
        if (shader == null) throw new InvalidOperationException("No se pudo importar ElenaPortrait.shader");
        var material = AssetDatabase.LoadAssetAtPath<Material>(materialPath);
        if (material == null)
        {
            material = new Material(shader);
            AssetDatabase.CreateAsset(material, materialPath);
        }
        material.shader = shader;
        material.SetTexture("_MainTex", AssetDatabase.LoadAssetAtPath<Texture2D>("Assets/AXYRO/Characters/Elena/elena-neutral.png"));
        material.SetTexture("_SpeakTex", AssetDatabase.LoadAssetAtPath<Texture2D>("Assets/AXYRO/Characters/Elena/elena-speaking.png"));
        material.SetTexture("_BlinkTex", AssetDatabase.LoadAssetAtPath<Texture2D>("Assets/AXYRO/Characters/Elena/elena-blink.png"));
        EditorUtility.SetDirty(material);
        return material;
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

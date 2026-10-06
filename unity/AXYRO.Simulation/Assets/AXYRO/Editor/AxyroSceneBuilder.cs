using System;
using System.Linq;
using Axyro;
using Rive.Components;
using UnityEditor;
using UnityEditor.Animations;
using UnityEditor.Events;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.InputSystem.UI;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.UI;
using LipSync = uLipSync.uLipSync;
using LipSyncBlendShape = uLipSync.uLipSyncBlendShape;

/// <summary>
/// Genera la escena de Unity: tutor 3D (URP) con lip sync, iluminación de estudio y fondo de oficina desenfocado,
/// con la consola de la sesión y el HUD Rive superpuestos. Unity se ocupa del personaje; Rive solo del HUD.
/// </summary>
public static class AxyroSceneBuilder
{
    private static readonly Color Background = Hex("#001A33");
    private static readonly Color White = Hex("#FFFFFF");
    private static readonly Color Muted = Hex("#C9D6E6");
    // Paleta UFV (plantilla UFV_Rockw_25_03): azul tinta #001A33, azul UFV #003865, acento #649EFF.
    private static readonly Color Mint = Hex("#649EFF");

    private const string RenderingRoot = "Assets/AXYRO/Rendering";
    private const string ScenePath = "Assets/Scenes/AXYRO Avatar Demo.unity";

    [MenuItem("AXYRO/Crear escena de avatar")]
    public static void Build()
    {
        EnsureFolder(RenderingRoot);
        EnsureUrp();
        AxyroTutorSetup.ConfigureImporters();
        EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

        var camera = BuildCamera();
        BuildEnvironment();
        var tutor = BuildTutor(camera.transform, out var voice);
        BuildLighting(tutor.transform);
        BuildPostProcessing(Vector3.Distance(camera.transform.position, HeadPosition(tutor)));
        BuildInterface(tutor, voice);

        new GameObject("EventSystem", typeof(EventSystem), typeof(InputSystemUIInputModule));
        EditorSceneManager.SaveScene(EditorSceneManager.GetActiveScene(), ScenePath);
        EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
        AssetDatabase.SaveAssets();
        Debug.Log($"AXYRO_SCENE_READY {ScenePath}");
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
        PlayerSettings.colorSpace = ColorSpace.Linear;
        var options = new BuildPlayerOptions
        {
            scenes = new[] { ScenePath },
            locationPathName = "Build/AXYRO-Demo.exe",
            target = BuildTarget.StandaloneWindows64,
            options = BuildOptions.None
        };
        var report = BuildPipeline.BuildPlayer(options);
        var summary = report.summary;
        Debug.Log($"AXYRO_BUILD_RESULT {summary.result} errors={summary.totalErrors} size={summary.totalSize}");
        if (summary.result != UnityEditor.Build.Reporting.BuildResult.Succeeded) EditorApplication.Exit(1);
    }

    // ---------- Render pipeline ----------

    private static void EnsureUrp()
    {
        var rendererPath = $"{RenderingRoot}/AXYRO-Renderer.asset";
        var rendererData = AssetDatabase.LoadAssetAtPath<UniversalRendererData>(rendererPath);
        if (rendererData == null)
        {
            rendererData = ScriptableObject.CreateInstance<UniversalRendererData>();
            AssetDatabase.CreateAsset(rendererData, rendererPath);
        }
        // Un renderer creado por código no trae PostProcessData: sin él URP ignora tonemapping, bloom y desenfoque.
        if (rendererData.postProcessData == null)
        {
            rendererData.postProcessData = AssetDatabase.LoadAssetAtPath<PostProcessData>("Packages/com.unity.render-pipelines.universal/Runtime/Data/PostProcessData.asset");
            if (rendererData.postProcessData == null) throw new InvalidOperationException("No se encontró PostProcessData de URP");
            EditorUtility.SetDirty(rendererData);
        }

        var pipelinePath = $"{RenderingRoot}/AXYRO-URP.asset";
        var pipeline = AssetDatabase.LoadAssetAtPath<UniversalRenderPipelineAsset>(pipelinePath);
        if (pipeline == null)
        {
            pipeline = UniversalRenderPipelineAsset.Create(rendererData);
            AssetDatabase.CreateAsset(pipeline, pipelinePath);
        }

        var data = new SerializedObject(pipeline);
        data.FindProperty("m_MSAA").intValue = 4;
        data.FindProperty("m_SupportsHDR").boolValue = true;
        data.FindProperty("m_RenderScale").floatValue = 1f;
        data.FindProperty("m_MainLightRenderingMode").intValue = 1;
        data.FindProperty("m_MainLightShadowsSupported").boolValue = true;
        data.FindProperty("m_MainLightShadowmapResolution").intValue = 4096;
        data.FindProperty("m_AdditionalLightsRenderingMode").intValue = 1;
        data.FindProperty("m_AdditionalLightShadowsSupported").boolValue = true;
        data.FindProperty("m_AdditionalLightsShadowmapResolution").intValue = 4096;
        data.FindProperty("m_ShadowDistance").floatValue = 8f;
        data.FindProperty("m_SoftShadowsSupported").boolValue = true;
        data.ApplyModifiedPropertiesWithoutUndo();
        EditorUtility.SetDirty(pipeline);

        GraphicsSettings.defaultRenderPipeline = pipeline;
        var current = QualitySettings.GetQualityLevel();
        for (var i = 0; i < QualitySettings.names.Length; i++)
        {
            QualitySettings.SetQualityLevel(i, false);
            QualitySettings.renderPipeline = pipeline;
        }
        QualitySettings.SetQualityLevel(current, false);
        PlayerSettings.colorSpace = ColorSpace.Linear;
    }

    // ---------- Cámara y escenario ----------

    private static Camera BuildCamera()
    {
        var cameraObject = new GameObject("Camera", typeof(Camera), typeof(AudioListener));
        var camera = cameraObject.GetComponent<Camera>();
        camera.clearFlags = CameraClearFlags.SolidColor;
        camera.backgroundColor = Background;
        camera.fieldOfView = 24f;
        camera.nearClipPlane = 0.1f;
        camera.farClipPlane = 40f;
        // Plano medio con el tutor en el tercio izquierdo: la consola ocupa la mitad derecha.
        camera.transform.position = new Vector3(0.40f, 1.47f, -2.35f);
        camera.transform.rotation = Quaternion.LookRotation(new Vector3(0.40f, 1.36f, 0f) - camera.transform.position);
        var urp = camera.GetUniversalAdditionalCameraData();
        urp.renderPostProcessing = true;
        urp.antialiasing = AntialiasingMode.SubpixelMorphologicalAntiAliasing;
        urp.antialiasingQuality = AntialiasingQuality.High;
        return camera;
    }

    private static void BuildEnvironment()
    {
        var root = new GameObject("Oficina").transform;
        var wall = Lit("Pared", Hex("#0E2740"), 0.25f);
        var slat = Lit("Lamas", Hex("#21405F"), 0.35f);
        var floor = Lit("Suelo", Hex("#121A24"), 0.4f);
        var window = new Material(Shader.Find("Universal Render Pipeline/Unlit")) { name = "Ventana" };
        window.SetColor("_BaseColor", new Color(2.4f, 2.8f, 3.4f));
        SaveMaterial(window);
        var desk = Lit("Mesa", Hex("#2B2621"), 0.55f);

        Box("Pared del fondo", root, new Vector3(0f, 2.5f, 3.6f), new Vector3(16f, 6f, 0.1f), wall);
        Box("Suelo", root, new Vector3(0f, -0.05f, 0f), new Vector3(16f, 0.1f, 12f), floor);
        // Lamas acústicas verticales: dan textura al fondo desenfocado.
        for (var x = -6.0f; x <= 6.0f; x += 0.36f)
            Box("Lama", root, new Vector3(x, 2.4f, 3.48f), new Vector3(0.14f, 4.8f, 0.12f), slat);
        // Ventanal detrás del tutor: con el desenfoque y el bloom queda como luz natural suave.
        Box("Ventanal", root, new Vector3(-2.3f, 1.9f, 3.38f), new Vector3(1.7f, 2.6f, 0.02f), window);
        Box("Ventanal 2", root, new Vector3(-4.3f, 1.9f, 3.38f), new Vector3(1.7f, 2.6f, 0.02f), window);
        // Mesa de reuniones en primer plano, al borde inferior del encuadre.
        Box("Mesa", root, new Vector3(0.2f, 0.74f, -0.75f), new Vector3(3.2f, 0.05f, 1.1f), desk);
    }

    private static void BuildLighting(Transform tutor)
    {
        var head = HeadPosition(tutor.gameObject);
        Spot("Luz principal", new Vector3(-1.5f, 2.5f, -1.9f), head, new Color(1f, 0.94f, 0.86f), 6f, 40f, LightShadows.Soft);
        Spot("Luz de relleno", new Vector3(1.9f, 1.6f, -2.1f), head, new Color(0.82f, 0.88f, 1f), 1.6f, 55f, LightShadows.None);
        Spot("Contraluz", new Vector3(1.1f, 2.5f, 1.4f), head + Vector3.down * 0.15f, Hex("#9CC2FF"), 7f, 45f, LightShadows.Soft);
        Spot("Luz de fondo", new Vector3(0.3f, 0.6f, 2.4f), new Vector3(0.3f, 2.6f, 3.6f), Hex("#3F7BD6"), 5f, 80f, LightShadows.None);

        RenderSettings.ambientMode = AmbientMode.Trilight;
        RenderSettings.ambientSkyColor = Hex("#43566E");
        RenderSettings.ambientEquatorColor = Hex("#243447");
        RenderSettings.ambientGroundColor = Hex("#0C131D");
        RenderSettings.fog = false;
    }

    private static void BuildPostProcessing(float focusDistance)
    {
        var profilePath = $"{RenderingRoot}/AXYRO-Volume.asset";
        AssetDatabase.DeleteAsset(profilePath);
        var profile = ScriptableObject.CreateInstance<VolumeProfile>();
        AssetDatabase.CreateAsset(profile, profilePath);

        var tonemapping = profile.Add<Tonemapping>(true);
        tonemapping.mode.Override(TonemappingMode.ACES);
        var color = profile.Add<ColorAdjustments>(true);
        color.postExposure.Override(0.35f);
        color.contrast.Override(6f);
        color.saturation.Override(-4f);
        var bloom = profile.Add<Bloom>(true);
        bloom.threshold.Override(1.1f);
        bloom.intensity.Override(0.55f);
        bloom.scatter.Override(0.75f);
        var dof = profile.Add<DepthOfField>(true);
        dof.mode.Override(DepthOfFieldMode.Bokeh);
        dof.focusDistance.Override(focusDistance);
        dof.focalLength.Override(85f);
        dof.aperture.Override(2.2f);
        var vignette = profile.Add<Vignette>(true);
        vignette.intensity.Override(0.26f);
        vignette.smoothness.Override(0.45f);
        foreach (var component in profile.components) AssetDatabase.AddObjectToAsset(component, profile);
        EditorUtility.SetDirty(profile);

        var volume = new GameObject("Postproceso", typeof(Volume)).GetComponent<Volume>();
        volume.isGlobal = true;
        volume.sharedProfile = profile;
    }

    // ---------- Tutor 3D ----------

    private static AxyroTutor3D BuildTutor(Transform lookTarget, out AudioSource voice)
    {
        var model = AssetDatabase.LoadAssetAtPath<GameObject>(AxyroTutorSetup.ModelPath);
        if (model == null) throw new InvalidOperationException($"No se pudo importar {AxyroTutorSetup.ModelPath}");
        var tutor = (GameObject)PrefabUtility.InstantiatePrefab(model);
        PrefabUtility.UnpackPrefabInstance(tutor, PrefabUnpackMode.OutermostRoot, InteractionMode.AutomatedAction);
        tutor.name = "Elena Vega · tutor 3D";

        var animator = tutor.GetComponent<Animator>();
        animator.runtimeAnimatorController = BuildAnimatorController();
        animator.applyRootMotion = false;
        animator.cullingMode = AnimatorCullingMode.AlwaysAnimate;

        // Orienta al tutor hacia la cámara (-Z) a partir de los hombros del esqueleto humanoide.
        var right = animator.GetBoneTransform(HumanBodyBones.RightUpperArm).position - animator.GetBoneTransform(HumanBodyBones.LeftUpperArm).position;
        var forward = Vector3.Cross(right, Vector3.up);
        forward.y = 0f;
        // Solo giro sobre Y: FromToRotation con vectores opuestos elige un eje arbitrario y puede volcar al personaje.
        var yaw = Vector3.SignedAngle(forward.normalized, Vector3.back, Vector3.up);
        tutor.transform.rotation = Quaternion.AngleAxis(yaw, Vector3.up) * tutor.transform.rotation;
        tutor.transform.position = Vector3.zero;

        var face = tutor.GetComponentsInChildren<SkinnedMeshRenderer>(true).OrderByDescending(r => r.sharedMesh.blendShapeCount).First();
        face.sharedMaterials = BuildTutorMaterials(face.sharedMesh);
        face.updateWhenOffscreen = true;
        foreach (var renderer in tutor.GetComponentsInChildren<SkinnedMeshRenderer>(true))
        {
            renderer.shadowCastingMode = ShadowCastingMode.On;
            renderer.quality = SkinQuality.Bone4;
        }

        var component = tutor.AddComponent<AxyroTutor3D>();
        var gaze = new GameObject("Mirada").transform;
        gaze.SetParent(lookTarget, false);
        var componentData = new SerializedObject(component);
        componentData.FindProperty("face").objectReferenceValue = face;
        componentData.FindProperty("lookTarget").objectReferenceValue = gaze;
        componentData.ApplyModifiedPropertiesWithoutUndo();

        // Lip sync: uLipSync analiza la voz (MFCC) y mueve los visemas. Las vocales japonesas A I U E O
        // coinciden con las españolas; N cubre las nasales.
        var voiceObject = new GameObject("Voz");
        voiceObject.transform.SetParent(tutor.transform, false);
        voice = voiceObject.AddComponent<AudioSource>();
        voice.playOnAwake = false;
        voice.spatialBlend = 0f;
        var lipSync = voiceObject.AddComponent<LipSync>();
        lipSync.profile = AssetDatabase.LoadAssetAtPath<uLipSync.Profile>("Packages/com.hecomi.ulipsync/Assets/Profiles/uLipSync-Profile-Sample-Female.asset");
        if (lipSync.profile == null) throw new InvalidOperationException("No se encontró el perfil femenino de uLipSync");
        var blendShape = tutor.AddComponent<LipSyncBlendShape>();
        blendShape.skinnedMeshRenderer = face;
        blendShape.smoothness = 0.06f;
        blendShape.minVolume = -2.6f;
        blendShape.maxVolume = -1.6f;
        Viseme(blendShape, "A", "AA_VI_10_aa", 0.85f);
        Viseme(blendShape, "I", "AA_VI_12_I", 0.7f);
        Viseme(blendShape, "U", "AA_VI_14_U", 0.75f);
        Viseme(blendShape, "E", "AA_VI_11_E", 0.75f);
        Viseme(blendShape, "O", "AA_VI_13_O", 0.8f);
        Viseme(blendShape, "N", "AA_VI_08_nn", 0.5f);
        UnityEventTools.AddPersistentListener(lipSync.onLipSyncUpdate, blendShape.OnLipSyncUpdate);
        return component;
    }

    private static void Viseme(LipSyncBlendShape target, string phoneme, string shape, float weight)
    {
        var info = target.AddBlendShape(phoneme, $"blendShape1.{shape}");
        info.maxWeight = weight;
    }

    private static AnimatorController BuildAnimatorController()
    {
        var path = $"{AxyroTutorSetup.Root}/Tutor.controller";
        AssetDatabase.DeleteAsset(path);
        var controller = AnimatorController.CreateAnimatorControllerAtPath(path);
        controller.AddParameter("speaking", AnimatorControllerParameterType.Bool);
        var layers = controller.layers;
        layers[0].iKPass = true;
        controller.layers = layers;
        var machine = controller.layers[0].stateMachine;
        var listen = machine.AddState("Escucha");
        listen.motion = Clip(AxyroTutorSetup.AnimationPaths[0]);
        var talk = machine.AddState("Habla");
        talk.motion = Clip(AxyroTutorSetup.AnimationPaths[1]);
        machine.defaultState = listen;
        var toTalk = listen.AddTransition(talk);
        toTalk.hasExitTime = false;
        toTalk.duration = 0.45f;
        toTalk.AddCondition(AnimatorConditionMode.If, 0f, "speaking");
        var toListen = talk.AddTransition(listen);
        toListen.hasExitTime = false;
        toListen.duration = 0.6f;
        toListen.AddCondition(AnimatorConditionMode.IfNot, 0f, "speaking");
        EditorUtility.SetDirty(controller);
        return controller;
    }

    private static AnimationClip Clip(string path) =>
        AssetDatabase.LoadAllAssetsAtPath(path).OfType<AnimationClip>().First(c => !c.name.StartsWith("__preview", StringComparison.Ordinal));

    /// <summary>Materiales URP Lit (flujo especular, como los mapas Rocketbox). Submallas: cuerpo, cabeza y opacidad.</summary>
    private static Material[] BuildTutorMaterials(Mesh mesh)
    {
        var textures = $"{AxyroTutorSetup.Root}/Textures";
        ConfigureTexture($"{textures}/tutor_body_normal.png", normal: true);
        ConfigureTexture($"{textures}/tutor_head_normal.png", normal: true);
        ConfigureTexture($"{textures}/tutor_body_specular.png", linear: true);
        ConfigureTexture($"{textures}/tutor_head_specular.png", linear: true);
        ConfigureTexture($"{textures}/tutor_opacity_color.png", alpha: true);

        var body = Skin("Tutor cuerpo", $"{textures}/tutor_body_color.png", $"{textures}/tutor_body_normal.png", $"{textures}/tutor_body_specular.png", 0.32f);
        var head = Skin("Tutor cabeza", $"{textures}/tutor_head_color.png", $"{textures}/tutor_head_normal.png", $"{textures}/tutor_head_specular.png", 0.42f);
        var opacity = Skin("Tutor pelo y pestañas", $"{textures}/tutor_opacity_color.png", null, null, 0.3f);
        opacity.SetFloat("_AlphaClip", 1f);
        opacity.SetFloat("_Cutoff", 0.35f);
        opacity.SetFloat("_Cull", 0f);
        opacity.EnableKeyword("_ALPHATEST_ON");
        opacity.renderQueue = (int)RenderQueue.AlphaTest;
        EditorUtility.SetDirty(opacity);

        // La submalla con menos vértices es la de opacidad; de las otras dos, la más alta es la cabeza.
        var subMeshes = Enumerable.Range(0, mesh.subMeshCount).Select(i => (index: i, info: mesh.GetSubMesh(i))).ToList();
        var opacityIndex = subMeshes.OrderBy(s => s.info.vertexCount).First().index;
        var headIndex = subMeshes.Where(s => s.index != opacityIndex).OrderByDescending(s => s.info.bounds.center.y).First().index;
        var materials = new Material[mesh.subMeshCount];
        for (var i = 0; i < materials.Length; i++)
            materials[i] = i == opacityIndex ? opacity : i == headIndex ? head : body;
        Debug.Log($"AXYRO_TUTOR_MATERIALS opacity={opacityIndex} head={headIndex} subMeshes={mesh.subMeshCount}");
        return materials;
    }

    private static Material Skin(string name, string color, string normal, string specular, float smoothness)
    {
        var material = Lit(name, Color.white, smoothness);
        material.SetTexture("_BaseMap", AssetDatabase.LoadAssetAtPath<Texture2D>(color));
        material.SetFloat("_WorkflowMode", 0f);
        material.EnableKeyword("_SPECULAR_SETUP");
        if (normal != null)
        {
            material.SetTexture("_BumpMap", AssetDatabase.LoadAssetAtPath<Texture2D>(normal));
            material.SetFloat("_BumpScale", 1f);
            material.EnableKeyword("_NORMALMAP");
        }
        if (specular != null)
        {
            material.SetTexture("_SpecGlossMap", AssetDatabase.LoadAssetAtPath<Texture2D>(specular));
            material.SetColor("_SpecColor", new Color(0.35f, 0.35f, 0.35f));
            material.EnableKeyword("_METALLICSPECGLOSSMAP");
        }
        else
        {
            material.SetColor("_SpecColor", new Color(0.1f, 0.1f, 0.1f));
        }
        EditorUtility.SetDirty(material);
        return material;
    }

    private static void ConfigureTexture(string path, bool normal = false, bool linear = false, bool alpha = false)
    {
        var importer = (TextureImporter)AssetImporter.GetAtPath(path);
        if (importer == null) throw new InvalidOperationException($"Falta la textura {path}");
        var type = normal ? TextureImporterType.NormalMap : TextureImporterType.Default;
        var srgb = !normal && !linear;
        if (importer.textureType == type && importer.sRGBTexture == srgb && importer.alphaIsTransparency == alpha) return;
        importer.textureType = type;
        importer.sRGBTexture = srgb;
        importer.alphaIsTransparency = alpha;
        importer.maxTextureSize = 2048;
        importer.SaveAndReimport();
    }

    private static Vector3 HeadPosition(AxyroTutor3D tutor) => HeadPosition(tutor.gameObject);

    private static Vector3 HeadPosition(GameObject tutor) =>
        tutor.GetComponent<Animator>().GetBoneTransform(HumanBodyBones.Head).position + Vector3.up * 0.08f;

    // ---------- Interfaz (consola de sesión + HUD Rive) ----------

    private static void BuildInterface(AxyroTutor3D tutor, AudioSource voice)
    {
        var canvasObject = new GameObject("AXYRO Demo", typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
        var canvas = canvasObject.GetComponent<Canvas>();
        canvas.renderMode = RenderMode.ScreenSpaceOverlay;
        var scaler = canvasObject.GetComponent<CanvasScaler>();
        scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
        scaler.referenceResolution = new Vector2(1280, 720);
        scaler.screenMatchMode = CanvasScaler.ScreenMatchMode.MatchWidthOrHeight;
        scaler.matchWidthOrHeight = 0.5f;

        // Panel translúcido para que el texto se lea sobre la escena 3D.
        Image("Panel", canvasObject.transform, new Color(0f, 0.10f, 0.20f, 0.78f), new Vector2(.52f, 0f), new Vector2(1f, 1f));
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
        var dialogue = Text("Dialogue", canvasObject.transform, "", 25, White, new Vector2(.55f, .34f), new Vector2(.95f, .61f));
        var buttonObject = new GameObject("Escuchar", typeof(RectTransform), typeof(Image), typeof(Button));
        buttonObject.transform.SetParent(canvasObject.transform, false);
        Stretch(buttonObject.GetComponent<RectTransform>(), new Vector2(.55f, .22f), new Vector2(.85f, .30f));
        buttonObject.GetComponent<Image>().color = Mint;
        var label = Text("Label", buttonObject.transform, "▶  ESCUCHAR INTERVENCIÓN", 18, Background, Vector2.zero, Vector2.one);
        label.alignment = TextAnchor.MiddleCenter;
        var hint = Text("Hint", canvasObject.transform, "1 · 2 · 3 CAMBIAN LA FASE     ESPACIO REPRODUCE LA VOZ", 12, Muted, new Vector2(.55f, .01f), new Vector2(.99f, .05f));
        var choices = Text("Choices", canvasObject.transform, "", 15, White, new Vector2(.55f, .05f), new Vector2(.96f, .21f));
        var connection = Text("Connection", canvasObject.transform, "DEMO AUTÓNOMA", 13, Muted, new Vector2(.04f, .92f), new Vector2(.50f, .97f));

        var demo = canvasObject.AddComponent<AxyroAvatarDemo>();
        var demoData = new SerializedObject(demo);
        demoData.FindProperty("tutor").objectReferenceValue = tutor;
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
    }

    // ---------- Utilidades ----------

    private static Material Lit(string name, Color color, float smoothness)
    {
        var path = $"{RenderingRoot}/{name}.mat";
        var material = AssetDatabase.LoadAssetAtPath<Material>(path);
        var shader = Shader.Find("Universal Render Pipeline/Lit");
        if (material == null)
        {
            material = new Material(shader) { name = name };
            AssetDatabase.CreateAsset(material, path);
        }
        material.shader = shader;
        material.SetColor("_BaseColor", color);
        material.SetFloat("_Smoothness", smoothness);
        EditorUtility.SetDirty(material);
        return material;
    }

    private static void SaveMaterial(Material material)
    {
        var path = $"{RenderingRoot}/{material.name}.mat";
        AssetDatabase.DeleteAsset(path);
        AssetDatabase.CreateAsset(material, path);
    }

    private static void Box(string name, Transform parent, Vector3 position, Vector3 size, Material material)
    {
        var box = GameObject.CreatePrimitive(PrimitiveType.Cube);
        box.name = name;
        box.transform.SetParent(parent, false);
        box.transform.position = position;
        box.transform.localScale = size;
        UnityEngine.Object.DestroyImmediate(box.GetComponent<Collider>());
        box.GetComponent<MeshRenderer>().sharedMaterial = material;
    }

    private static void Spot(string name, Vector3 position, Vector3 target, Color color, float intensity, float angle, LightShadows shadows)
    {
        var light = new GameObject(name, typeof(Light)).GetComponent<Light>();
        light.type = LightType.Spot;
        light.transform.position = position;
        light.transform.rotation = Quaternion.LookRotation(target - position);
        light.color = color;
        light.intensity = intensity;
        light.range = 10f;
        light.spotAngle = angle;
        light.innerSpotAngle = angle * 0.4f;
        light.shadows = shadows;
        light.shadowStrength = 0.85f;
    }

    private static void EnsureFolder(string path)
    {
        if (AssetDatabase.IsValidFolder(path)) return;
        var parent = System.IO.Path.GetDirectoryName(path).Replace('\\', '/');
        AssetDatabase.CreateFolder(parent, System.IO.Path.GetFileName(path));
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

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
        var screen = BuildEnvironment(out var screenGlow);
        var tutor = BuildTutor(camera.transform, out var voice);
        BuildLighting(tutor.transform);
        var volume = BuildPostProcessing(Vector3.Distance(camera.transform.position, HeadPosition(tutor)));
        BuildInterface(tutor, voice);
        WireDirection(camera, tutor, screen, screenGlow, volume);

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
        // La sesión sigue viva (temporizador, voz, sincronización) aunque el participante haga clic fuera de la ventana.
        PlayerSettings.runInBackground = true;
        PlayerSettings.visibleInBackground = true;
        PlayerSettings.colorSpace = ColorSpace.Linear;
        // Lo que ve el participante (título de ventana, ejecutable) es solo de la UFV.
        PlayerSettings.companyName = "Universidad Francisco de Vitoria";
        PlayerSettings.productName = "Simulador UFV";
        var options = new BuildPlayerOptions
        {
            scenes = new[] { ScenePath },
            locationPathName = "Build/Simulador-UFV.exe",
            target = BuildTarget.StandaloneWindows64,
            options = BuildOptions.None
        };
        var report = BuildPipeline.BuildPlayer(options);
        var summary = report.summary;
        Debug.Log($"AXYRO_BUILD_RESULT {summary.result} errors={summary.totalErrors} size={summary.totalSize}");
        if (summary.result != UnityEditor.Build.Reporting.BuildResult.Succeeded) EditorApplication.Exit(1);
    }

    private const string WebScenePath = "Assets/Scenes/AXYRO Avatar Web.unity";
    private const string WebBuildPath = "Build/WebGL";

    /// <summary>
    /// Compilación WebGL para servirla en /simulador/ del mismo dominio que la API (Cloudflare Access).
    /// Uso: Unity.exe -batchmode -quit -projectPath unity/AXYRO.Simulation -buildTarget WebGL -executeMethod AxyroSceneBuilder.BuildWebGL
    /// (lo lanza scripts/unity-webgl.ps1, que además publica el resultado).
    /// </summary>
    [MenuItem("AXYRO/Compilar simulador web (WebGL)")]
    public static void BuildWebGL()
    {
        Build();
        PrepareWebScene();
        ConfigureAudioForWebGL();
        ConfigureWebRendering();

        PlayerSettings.companyName = "Universidad Francisco de Vitoria";
        PlayerSettings.productName = "Simulador UFV";
        PlayerSettings.colorSpace = ColorSpace.Linear;
        PlayerSettings.runInBackground = true;
        // Brotli con descompresión en JavaScript si hace falta: no depende de que el servidor envíe Content-Encoding.
        PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Brotli;
        PlayerSettings.WebGL.decompressionFallback = true;
        // Nombres con hash: el Worker puede cachear Build/ sin caducidad y cada compilación invalida lo anterior.
        PlayerSettings.WebGL.nameFilesAsHashes = true;
        PlayerSettings.WebGL.dataCaching = true;
        PlayerSettings.WebGL.template = "PROJECT:UFV";
        PlayerSettings.WebGL.exceptionSupport = WebGLExceptionSupport.ExplicitlyThrownExceptionsOnly;
        // Sin pantalla de Unity si la licencia lo permite (en Unity 6 también con Personal); si no, Unity la mantiene.
        try
        {
            PlayerSettings.SplashScreen.showUnityLogo = false;
            PlayerSettings.SplashScreen.show = false;
        }
        catch (Exception exception)
        {
            Debug.LogWarning($"No se pudo quitar la pantalla de inicio de Unity: {exception.Message}");
        }

        var succeeded = false;
        try
        {
            var options = new BuildPlayerOptions
            {
                scenes = new[] { WebScenePath },
                locationPathName = WebBuildPath,
                target = BuildTarget.WebGL,
                options = BuildOptions.None
            };
            var report = BuildPipeline.BuildPlayer(options);
            var summary = report.summary;
            succeeded = summary.result == UnityEditor.Build.Reporting.BuildResult.Succeeded;
            if (succeeded) RemoveDesktopOnlyFiles();
            Debug.Log($"AXYRO_WEBGL_RESULT {summary.result} errors={summary.totalErrors} size={summary.totalSize}");
        }
        finally
        {
            // La copia web es temporal: el editor vuelve a la escena y al pipeline de escritorio.
            UsePipeline(AssetDatabase.LoadAssetAtPath<UniversalRenderPipelineAsset>($"{RenderingRoot}/AXYRO-URP.asset"));
            EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
            AssetDatabase.DeleteAsset(WebScenePath);
        }
        if (!succeeded && Application.isBatchMode) EditorApplication.Exit(1);
    }

    /// <summary>
    /// Copia de la escena para el navegador: Vosk es nativo de Windows; WebGL usa Soniox mediante el navegador.
    /// La escena de Windows no se toca.
    /// </summary>
    private static void PrepareWebScene()
    {
        var scene = EditorSceneManager.GetActiveScene();
        foreach (var voiceCommands in UnityEngine.Object.FindObjectsByType<AxyroVoiceCommands>(FindObjectsInactive.Include, FindObjectsSortMode.None))
        {
            var status = new SerializedObject(voiceCommands).FindProperty("status").objectReferenceValue as Text;
            var session = new SerializedObject(voiceCommands).FindProperty("session").objectReferenceValue as AxyroSessionClient;
            var avatar = new SerializedObject(voiceCommands).FindProperty("avatar").objectReferenceValue as AxyroAvatarDemo;
            var webVoice = voiceCommands.gameObject.AddComponent<AxyroWebVoice>();
            var webVoiceData = new SerializedObject(webVoice);
            webVoiceData.FindProperty("session").objectReferenceValue = session;
            webVoiceData.FindProperty("avatar").objectReferenceValue = avatar;
            webVoiceData.ApplyModifiedPropertiesWithoutUndo();
            if (status != null) status.text = "";
            UnityEngine.Object.DestroyImmediate(voiceCommands);
        }
        // Modo IA en vivo (/simulador/?ia=<runId>): solo en la build web; sin ?ia= el componente se desactiva solo.
        var sessionClient = UnityEngine.Object.FindAnyObjectByType<AxyroSessionClient>(FindObjectsInactive.Include);
        if (sessionClient != null)
        {
            var aiLive = sessionClient.gameObject.AddComponent<AxyroAiLive>();
            var aiData = new SerializedObject(aiLive);
            aiData.FindProperty("session").objectReferenceValue = sessionClient;
            aiData.FindProperty("avatar").objectReferenceValue = UnityEngine.Object.FindAnyObjectByType<AxyroAvatarDemo>(FindObjectsInactive.Include);
            aiData.FindProperty("tutor").objectReferenceValue = UnityEngine.Object.FindAnyObjectByType<AxyroTutor3D>(FindObjectsInactive.Include);
            aiData.FindProperty("screen").objectReferenceValue = UnityEngine.Object.FindAnyObjectByType<AxyroSceneScreen>(FindObjectsInactive.Include);
            aiData.FindProperty("feedback").objectReferenceValue = UnityEngine.Object.FindAnyObjectByType<AxyroDecisionFeedback>(FindObjectsInactive.Include);
            aiData.ApplyModifiedPropertiesWithoutUndo();
        }
        EditorSceneManager.SaveScene(scene, WebScenePath, true);
        EditorSceneManager.OpenScene(WebScenePath, OpenSceneMode.Single);
    }

    /// <summary>
    /// uLipSync en WebGL no recibe OnAudioFilterRead: lee las muestras con AudioClip.GetData (autoAudioSyncOnWebGL
    /// sincroniza al desbloquearse el audio con el primer clic). GetData necesita los clips descomprimidos al cargar.
    /// </summary>
    private static void ConfigureAudioForWebGL()
    {
        foreach (var guid in AssetDatabase.FindAssets("t:AudioClip", new[] { "Assets/AXYRO/Audio" }))
        {
            var path = AssetDatabase.GUIDToAssetPath(guid);
            if (!(AssetImporter.GetAtPath(path) is AudioImporter importer)) continue;
            var settings = importer.GetOverrideSampleSettings("WebGL");
            if (importer.ContainsSampleSettingsOverride("WebGL") && settings.loadType == AudioClipLoadType.DecompressOnLoad) continue;
            settings.loadType = AudioClipLoadType.DecompressOnLoad;
            if (!importer.SetOverrideSampleSettings("WebGL", settings))
            {
                Debug.LogWarning($"No se pudo ajustar {path} para WebGL");
                continue;
            }
            importer.SaveAndReimport();
        }
        foreach (var lipSync in UnityEngine.Object.FindObjectsByType<LipSync>(FindObjectsInactive.Include, FindObjectsSortMode.None))
        {
            var data = new SerializedObject(lipSync);
            var autoSync = data.FindProperty("autoAudioSyncOnWebGL");
            if (autoSync == null) continue;
            autoSync.boolValue = true;
            data.ApplyModifiedPropertiesWithoutUndo();
        }
        EditorSceneManager.SaveScene(EditorSceneManager.GetActiveScene());
    }

    /// <summary>
    /// Ruta de calidad del navegador: pipeline web (MSAA 2x, sombras ligeras), sin SMAA, perfil de postproceso con
    /// bloom de baja calidad, sin desenfoque de fondo ni grano; sombras duras.
    /// </summary>
    private static void ConfigureWebRendering()
    {
        UsePipeline(EnsureWebUrp());
        foreach (var camera in UnityEngine.Object.FindObjectsByType<Camera>(FindObjectsSortMode.None))
            camera.GetUniversalAdditionalCameraData().antialiasing = AntialiasingMode.None;
        foreach (var light in UnityEngine.Object.FindObjectsByType<Light>(FindObjectsSortMode.None))
            if (light.shadows == LightShadows.Soft) light.shadows = LightShadows.Hard;

        var webProfilePath = $"{RenderingRoot}/AXYRO-Volume-Web.asset";
        AssetDatabase.DeleteAsset(webProfilePath);
        AssetDatabase.CopyAsset($"{RenderingRoot}/AXYRO-Volume.asset", webProfilePath);
        var profile = AssetDatabase.LoadAssetAtPath<VolumeProfile>(webProfilePath);
        if (profile.TryGet<Bloom>(out var bloom))
        {
            bloom.highQualityFiltering.Override(false);
            bloom.downscale.Override(BloomDownscaleMode.Quarter);
        }
        // El desenfoque de fondo es el efecto más caro en GPUs integradas y móviles: fuera en el navegador.
        if (profile.TryGet<DepthOfField>(out var dof)) dof.active = false;
        if (profile.TryGet<FilmGrain>(out var grain)) grain.active = false;
        EditorUtility.SetDirty(profile);
        foreach (var volume in UnityEngine.Object.FindObjectsByType<Volume>(FindObjectsSortMode.None)) volume.sharedProfile = profile;
        AssetDatabase.SaveAssets();
        EditorSceneManager.SaveScene(EditorSceneManager.GetActiveScene());
    }

    /// <summary>El modelo de voz Vosk (StreamingAssets) es solo para Windows: en la build web sobra y pesa decenas de MB.</summary>
    private static void RemoveDesktopOnlyFiles()
    {
        var streaming = System.IO.Path.Combine(WebBuildPath, "StreamingAssets");
        if (!System.IO.Directory.Exists(streaming)) return;
        foreach (var directory in System.IO.Directory.GetDirectories(streaming, "vosk-model*"))
            System.IO.Directory.Delete(directory, true);
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
        data.FindProperty("m_AdditionalLightsPerObjectLimit").intValue = 8;
        data.FindProperty("m_AdditionalLightShadowsSupported").boolValue = true;
        data.FindProperty("m_AdditionalLightsShadowmapResolution").intValue = 4096;
        data.FindProperty("m_ShadowDistance").floatValue = 10f;
        data.FindProperty("m_SoftShadowsSupported").boolValue = true;
        data.ApplyModifiedPropertiesWithoutUndo();
        EditorUtility.SetDirty(pipeline);
        UsePipeline(pipeline);
    }

    /// <summary>
    /// Calidad para el navegador: misma imagen con menos coste (MSAA 2x, sombras de 1024 solo en la luz principal,
    /// sin sombras suaves). La escena y el perfil web se ajustan en <see cref="ConfigureWebRendering"/>.
    /// </summary>
    private static UniversalRenderPipelineAsset EnsureWebUrp()
    {
        var desktop = AssetDatabase.LoadAssetAtPath<UniversalRenderPipelineAsset>($"{RenderingRoot}/AXYRO-URP.asset");
        var path = $"{RenderingRoot}/AXYRO-URP-Web.asset";
        AssetDatabase.DeleteAsset(path);
        AssetDatabase.CopyAsset($"{RenderingRoot}/AXYRO-URP.asset", path);
        var pipeline = AssetDatabase.LoadAssetAtPath<UniversalRenderPipelineAsset>(path);
        if (pipeline == null || desktop == null) throw new InvalidOperationException("No se pudo crear el pipeline web");
        var data = new SerializedObject(pipeline);
        data.FindProperty("m_MSAA").intValue = 2;
        data.FindProperty("m_MainLightShadowmapResolution").intValue = 1024;
        data.FindProperty("m_AdditionalLightsPerObjectLimit").intValue = 6;
        data.FindProperty("m_AdditionalLightsShadowmapResolution").intValue = 1024;
        data.FindProperty("m_SoftShadowsSupported").boolValue = false;
        data.FindProperty("m_ShadowDistance").floatValue = 6f;
        data.ApplyModifiedPropertiesWithoutUndo();
        EditorUtility.SetDirty(pipeline);
        AssetDatabase.SaveAssets();
        return pipeline;
    }

    private static void UsePipeline(UniversalRenderPipelineAsset pipeline)
    {
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
        // Plano medio con el tutor en el tercio izquierdo; AxyroCinematics mueve la cámara en ejecución.
        camera.transform.position = new Vector3(0.40f, 1.47f, -2.35f);
        camera.transform.rotation = Quaternion.LookRotation(new Vector3(0.40f, 1.36f, 0f) - camera.transform.position);
        camera.farClipPlane = 20f;
        var urp = camera.GetUniversalAdditionalCameraData();
        urp.renderPostProcessing = true;
        urp.antialiasing = AntialiasingMode.SubpixelMorphologicalAntiAliasing;
        urp.antialiasingQuality = AntialiasingQuality.High;
        return camera;
    }

    // Profundidad de la pared del fondo (cara visible): todo el decorado se apoya en ella.
    private const float WallZ = 3.2f;

    /// <summary>
    /// Sala de seminario moderna construida con primitivas: pared de lamas de roble detrás de VictorIA, ventanal con
    /// estores a la izquierda (luz de día suave, sin quemar), paño azul UFV con la pantalla de la situación y el rótulo
    /// de la universidad, estantería y planta. Paleta sobria: azul marino, blanco cálido y madera.
    /// </summary>
    private static AxyroSceneScreen BuildEnvironment(out Light screenGlow)
    {
        var root = new GameObject("Sala").transform;
        var plaster = Lit("Pared", Hex("#A39A90"), 0.12f);
        var wood = Lit("Lamas", Hex("#9C6B45"), 0.32f);
        var woodDark = Lit("Lamas fondo", Hex("#2A1E17"), 0.1f);
        var navy = Lit("Paño azul", Hex("#132A48"), 0.18f);
        var floor = Lit("Suelo", Hex("#3B2F27"), 0.35f);
        var ceiling = Lit("Techo", Hex("#8C8883"), 0.05f);
        var credenza = Lit("Mesa", Hex("#7A5236"), 0.4f);
        var bezel = Lit("Marco pantalla", Hex("#0C0E12"), 0.75f);
        var blind = Lit("Estor", Hex("#D9D2C7"), 0.08f);
        var mullion = Lit("Carpintería", Hex("#26272B"), 0.4f);
        var ceramic = Lit("Maceta", Hex("#D8D2C8"), 0.45f);
        var leaf = Lit("Hojas", Hex("#2E4A2D"), 0.4f);
        var window = BuildWindowMaterial();

        // Caja de la sala.
        Box("Pared del fondo", root, new Vector3(0.5f, 1.4f, WallZ + 0.05f), new Vector3(12f, 2.8f, 0.1f), plaster);
        Box("Suelo", root, new Vector3(0.5f, -0.05f, 0.5f), new Vector3(12f, 0.1f, 9f), floor);
        Box("Techo", root, new Vector3(0.5f, 2.85f, 0.5f), new Vector3(12f, 0.1f, 9f), ceiling);

        // Ventanal a la izquierda con estores a medio bajar: luz de día suave y textura, nunca un rectángulo blanco.
        const float windowLeft = -3.4f, windowRight = -1.5f, windowBottom = 0.75f, windowTop = 2.05f;
        var windowWidth = windowRight - windowLeft;
        Box("Vidrio", root, new Vector3((windowLeft + windowRight) / 2f, (windowBottom + windowTop) / 2f, WallZ - 0.005f), new Vector3(windowWidth, windowTop - windowBottom, 0.01f), window);
        for (var y = windowTop - 0.03f; y > windowBottom + 0.35f; y -= 0.075f)
            Box("Lama del estor", root, new Vector3((windowLeft + windowRight) / 2f, y, WallZ - 0.06f), new Vector3(windowWidth, 0.045f, 0.012f), blind, Quaternion.Euler(-25f, 0f, 0f));
        Box("Dintel", root, new Vector3((windowLeft + windowRight) / 2f, windowTop + 0.03f, WallZ - 0.04f), new Vector3(windowWidth + 0.08f, 0.06f, 0.08f), mullion);
        Box("Alféizar", root, new Vector3((windowLeft + windowRight) / 2f, windowBottom - 0.03f, WallZ - 0.06f), new Vector3(windowWidth + 0.08f, 0.06f, 0.14f), mullion);
        foreach (var x in new[] { windowLeft, -2.3f, windowRight })
            Box("Montante", root, new Vector3(x, (windowBottom + windowTop) / 2f, WallZ - 0.04f), new Vector3(0.05f, windowTop - windowBottom, 0.08f), mullion);

        // Pared de lamas de roble detrás del personaje: calidez y textura vertical en el desenfoque.
        const float slatsLeft = -1.42f, slatsRight = -0.04f;
        Box("Fondo de lamas", root, new Vector3((slatsLeft + slatsRight) / 2f, 1.4f, WallZ - 0.01f), new Vector3(slatsRight - slatsLeft, 2.8f, 0.02f), woodDark);
        for (var x = slatsLeft + 0.03f; x < slatsRight; x += 0.075f)
            Box("Lama", root, new Vector3(x, 1.4f, WallZ - 0.045f), new Vector3(0.045f, 2.8f, 0.05f), wood);

        // Paño azul UFV con la pantalla de la situación y el rótulo de la universidad debajo.
        const float navyLeft = -0.06f, navyRight = 2.05f;
        Box("Paño azul", root, new Vector3((navyLeft + navyRight) / 2f, 1.4f, WallZ - 0.02f), new Vector3(navyRight - navyLeft, 2.8f, 0.04f), navy);
        var screenCenter = new Vector3(0.82f, 1.56f, WallZ - 0.09f);
        const float screenWidth = 1.5f, screenHeight = screenWidth * 9f / 16f;
        Box("Pantalla", root, screenCenter + Vector3.forward * 0.02f, new Vector3(screenWidth + 0.04f, screenHeight + 0.04f, 0.04f), bezel);
        var screen = BuildScreenCanvas(root, screenCenter + Vector3.back * 0.001f, screenWidth);
        // Sin rótulo en la pared: el logo de la interfaz ya firma la escena y uno a medio tapar por los paneles
        // de opciones y resultado quedaba descuidado.
        // Aparador bajo de madera bajo la pantalla.
        Box("Aparador", root, new Vector3(screenCenter.x, 0.21f, WallZ - 0.25f), new Vector3(1.7f, 0.42f, 0.4f), credenza);

        screenGlow = new GameObject("Brillo de la pantalla", typeof(Light)).GetComponent<Light>();
        screenGlow.transform.SetParent(root, false);
        screenGlow.type = LightType.Point;
        screenGlow.transform.position = screenCenter + new Vector3(0f, -0.05f, -0.45f);
        screenGlow.range = 2.4f;
        screenGlow.intensity = 0.9f;
        screenGlow.color = Mint;
        screenGlow.shadows = LightShadows.None;

        BuildShelf(root, new Vector3(2.55f, 0f, WallZ - 0.2f), credenza, mullion);
        BuildPlant(root, new Vector3(-1.8f, 0f, WallZ - 0.5f), ceramic, leaf);
        BuildPlant(root, new Vector3(3.6f, 0f, WallZ - 0.45f), ceramic, leaf);
        return screen;
    }

    /// <summary>Degradado de cielo (azul pálido arriba, blanco cálido abajo) en un material sin iluminación, por debajo del blanco puro.</summary>
    private static Material BuildWindowMaterial()
    {
        var texturePath = $"{RenderingRoot}/Cielo.png";
        var texture = new Texture2D(4, 128, TextureFormat.RGBA32, false);
        var top = new Color(0.62f, 0.74f, 0.92f);
        var horizon = new Color(0.93f, 0.92f, 0.88f);
        var bottom = new Color(0.72f, 0.70f, 0.66f);
        for (var y = 0; y < texture.height; y++)
        {
            var t = y / (texture.height - 1f);
            var color = t > 0.35f ? Color.Lerp(horizon, top, Mathf.SmoothStep(0f, 1f, (t - 0.35f) / 0.65f)) : Color.Lerp(bottom, horizon, Mathf.SmoothStep(0f, 1f, t / 0.35f));
            for (var x = 0; x < texture.width; x++) texture.SetPixel(x, y, color);
        }
        System.IO.File.WriteAllBytes(texturePath, texture.EncodeToPNG());
        UnityEngine.Object.DestroyImmediate(texture);
        AssetDatabase.ImportAsset(texturePath);
        var importer = (TextureImporter)AssetImporter.GetAtPath(texturePath);
        importer.wrapMode = TextureWrapMode.Clamp;
        importer.mipmapEnabled = false;
        importer.SaveAndReimport();

        var material = new Material(Shader.Find("Universal Render Pipeline/Unlit")) { name = "Ventana" };
        material.SetTexture("_BaseMap", AssetDatabase.LoadAssetAtPath<Texture2D>(texturePath));
        material.SetColor("_BaseColor", new Color(1.15f, 1.15f, 1.15f));
        SaveMaterial(material);
        return material;
    }

    /// <summary>Lienzo UGUI en el espacio del mundo sobre la pantalla: el contenido lo genera AxyroSceneScreen por fase.</summary>
    private static AxyroSceneScreen BuildScreenCanvas(Transform parent, Vector3 center, float width)
    {
        var canvasObject = new GameObject("Pantalla de la situación", typeof(RectTransform), typeof(Canvas), typeof(CanvasGroup));
        canvasObject.transform.SetParent(parent, false);
        var canvas = canvasObject.GetComponent<Canvas>();
        canvas.renderMode = RenderMode.WorldSpace;
        var rect = canvasObject.GetComponent<RectTransform>();
        rect.sizeDelta = new Vector2(AxyroSceneScreen.CanvasWidth, AxyroSceneScreen.CanvasHeight);
        rect.position = center;
        rect.rotation = Quaternion.identity;
        rect.localScale = Vector3.one * (width / AxyroSceneScreen.CanvasWidth);
        canvasObject.GetComponent<CanvasGroup>().interactable = false;
        canvasObject.GetComponent<CanvasGroup>().blocksRaycasts = false;
        return canvasObject.AddComponent<AxyroSceneScreen>();
    }

    private static void BuildShelf(Transform parent, Vector3 origin, Material frame, Material dark)
    {
        var shelf = new GameObject("Estantería").transform;
        shelf.SetParent(parent, false);
        const float width = 0.9f, height = 2.1f, depth = 0.32f;
        Box("Lateral", shelf, origin + new Vector3(-width / 2f, height / 2f, 0f), new Vector3(0.03f, height, depth), frame);
        Box("Lateral", shelf, origin + new Vector3(width / 2f, height / 2f, 0f), new Vector3(0.03f, height, depth), frame);
        Box("Trasera", shelf, origin + new Vector3(0f, height / 2f, depth / 2f - 0.01f), new Vector3(width, height, 0.02f), dark);
        var random = new System.Random(4);
        Color[] spines = { Hex("#1E3A5F"), Hex("#E8E2D6"), Hex("#B4553F"), Hex("#2F4F6F"), Hex("#C9A66B"), Hex("#53585F") };
        var materials = spines.Select((c, i) => Lit($"Libro {i + 1}", c, 0.2f)).ToArray();
        for (var level = 0; level < 5; level++)
        {
            var y = 0.1f + level * 0.46f;
            Box("Balda", shelf, origin + new Vector3(0f, y, 0f), new Vector3(width, 0.03f, depth), frame);
            if (level == 4) break;
            var x = -width / 2f + 0.05f;
            var limit = width / 2f - (level % 2 == 0 ? 0.25f : 0.08f);
            while (x < limit)
            {
                var bookWidth = 0.025f + (float)random.NextDouble() * 0.03f;
                var bookHeight = 0.24f + (float)random.NextDouble() * 0.1f;
                var lean = random.NextDouble() < 0.08 ? 8f : 0f;
                Box("Libro", shelf, origin + new Vector3(x + bookWidth / 2f, y + 0.015f + bookHeight / 2f, 0.02f), new Vector3(bookWidth, bookHeight, 0.2f), materials[random.Next(materials.Length)], Quaternion.Euler(0f, 0f, lean));
                x += bookWidth + 0.004f;
            }
        }
    }

    /// <summary>Planta de interior (tipo ficus lira): maceta, tallo y hojas grandes; el desenfoque la convierte en silueta.</summary>
    private static void BuildPlant(Transform parent, Vector3 origin, Material pot, Material leaf)
    {
        var plant = new GameObject("Planta").transform;
        plant.SetParent(parent, false);
        Primitive(PrimitiveType.Cylinder, "Maceta", plant, origin + new Vector3(0f, 0.24f, 0f), new Vector3(0.38f, 0.24f, 0.38f), pot, Quaternion.identity);
        Primitive(PrimitiveType.Cylinder, "Tallo", plant, origin + new Vector3(0f, 0.95f, 0f), new Vector3(0.025f, 0.5f, 0.025f), pot, Quaternion.identity);
        var random = new System.Random(Mathf.RoundToInt(origin.x * 100f) + 3);
        for (var i = 0; i < 34; i++)
        {
            var height = 0.75f + (float)random.NextDouble() * 1.0f;
            var spread = 0.08f + 0.32f * (float)random.NextDouble() * Mathf.Sin(Mathf.PI * (height - 0.6f) / 1.3f);
            var angle = (float)random.NextDouble() * 360f;
            var offset = Quaternion.Euler(0f, angle, 0f) * Vector3.forward * spread;
            var rotation = Quaternion.Euler(-30f + (float)random.NextDouble() * 70f, angle, (float)random.NextDouble() * 40f - 20f);
            Primitive(PrimitiveType.Sphere, "Hoja", plant, origin + offset + Vector3.up * height, new Vector3(0.17f, 0.025f, 0.26f), leaf, rotation);
        }
    }

    /// <summary>
    /// Iluminación de estudio en tres puntos sobre VictorIA (principal cálida y suave, relleno frío tenue, contraluz azul UFV)
    /// más luz de ventana y bañados de pared que separan los planos del fondo. Ninguna luz quema el fondo.
    /// </summary>
    private static void BuildLighting(Transform tutor)
    {
        var head = HeadPosition(tutor.gameObject);
        var root = new GameObject("Iluminación").transform;
        Spot("Luz principal", root, head + new Vector3(-1.2f, 0.7f, -1.55f), head + new Vector3(0f, -0.08f, 0f), new Color(1f, 0.97f, 0.95f), 5.2f, 58f, 0.35f, LightShadows.Soft, 7f);
        Spot("Luz de relleno", root, head + new Vector3(1.5f, -0.1f, -1.6f), head + new Vector3(0f, -0.1f, 0f), new Color(0.88f, 0.93f, 1f), 1.5f, 75f, 0.3f, LightShadows.None, 6f);
        Spot("Contraluz azul", root, head + new Vector3(1.0f, 0.55f, 1.3f), head + new Vector3(0f, -0.15f, 0f), Hex("#7FAAFF"), 7f, 50f, 0.4f, LightShadows.None, 4f);
        Spot("Luz de ventana", root, head + new Vector3(-1.5f, 0.35f, 1.4f), head + new Vector3(0f, -0.1f, 0f), new Color(0.88f, 0.93f, 1f), 3.2f, 55f, 0.4f, LightShadows.None, 4f);
        Spot("Bañado lamas", root, new Vector3(-0.75f, 1.55f, 1.5f), new Vector3(-0.75f, 1.15f, WallZ), new Color(1f, 0.87f, 0.72f), 1.7f, 78f, 0.2f, LightShadows.None, 4f);
        Spot("Bañado paño azul", root, new Vector3(0.95f, 1.45f, 1.6f), new Vector3(0.95f, 1.2f, WallZ), new Color(0.85f, 0.9f, 1f), 1.6f, 85f, 0.2f, LightShadows.None, 4f);
        Spot("Bañado estantería", root, new Vector3(2.6f, 1.6f, 1.6f), new Vector3(2.6f, 1.1f, WallZ), new Color(1f, 0.88f, 0.72f), 1.8f, 70f, 0.2f, LightShadows.None, 4f);

        RenderSettings.ambientMode = AmbientMode.Trilight;
        RenderSettings.ambientSkyColor = new Color(0.30f, 0.32f, 0.36f);
        RenderSettings.ambientEquatorColor = new Color(0.20f, 0.19f, 0.18f);
        RenderSettings.ambientGroundColor = new Color(0.07f, 0.065f, 0.06f);
        RenderSettings.fog = false;
    }

    /// <summary>
    /// Postproceso sobrio: tonemapping neutro (respeta el tono de piel), contraste suave, sombras ligeramente frías y luces
    /// cálidas, bloom contenido, viñeta y desenfoque gaussiano del fondo (AxyroCinematics mueve el foco con la cámara).
    /// </summary>
    private static Volume BuildPostProcessing(float focusDistance)
    {
        var profilePath = $"{RenderingRoot}/AXYRO-Volume.asset";
        AssetDatabase.DeleteAsset(profilePath);
        var profile = ScriptableObject.CreateInstance<VolumeProfile>();
        AssetDatabase.CreateAsset(profile, profilePath);

        var tonemapping = profile.Add<Tonemapping>(true);
        tonemapping.mode.Override(TonemappingMode.Neutral);
        var color = profile.Add<ColorAdjustments>(true);
        color.postExposure.Override(0.25f);
        color.contrast.Override(12f);
        color.saturation.Override(-9f);
        var tones = profile.Add<ShadowsMidtonesHighlights>(true);
        tones.shadows.Override(new Vector4(0.94f, 0.98f, 1.08f, 0f));
        tones.highlights.Override(new Vector4(1.03f, 1.0f, 0.96f, 0f));
        var bloom = profile.Add<Bloom>(true);
        bloom.threshold.Override(0.95f);
        bloom.intensity.Override(0.4f);
        bloom.scatter.Override(0.7f);
        bloom.highQualityFiltering.Override(true);
        var dof = profile.Add<DepthOfField>(true);
        dof.mode.Override(DepthOfFieldMode.Gaussian);
        dof.gaussianStart.Override(focusDistance + 1.8f);
        dof.gaussianEnd.Override(focusDistance + 8f);
        dof.gaussianMaxRadius.Override(1.1f);
        dof.highQualitySampling.Override(true);
        var vignette = profile.Add<Vignette>(true);
        vignette.intensity.Override(0.3f);
        vignette.smoothness.Override(0.42f);
        var grain = profile.Add<FilmGrain>(true);
        grain.type.Override(FilmGrainLookup.Thin1);
        grain.intensity.Override(0.12f);
        grain.response.Override(0.8f);
        foreach (var component in profile.components) AssetDatabase.AddObjectToAsset(component, profile);
        EditorUtility.SetDirty(profile);

        var volume = new GameObject("Postproceso", typeof(Volume)).GetComponent<Volume>();
        volume.isGlobal = true;
        volume.sharedProfile = profile;
        return volume;
    }

    /// <summary>Dirección de cámara y pantalla de la situación: observan el avatar, la sesión y el feedback.</summary>
    private static void WireDirection(Camera camera, AxyroTutor3D tutor, AxyroSceneScreen screen, Light screenGlow, Volume volume)
    {
        var avatar = UnityEngine.Object.FindAnyObjectByType<AxyroAvatarDemo>(FindObjectsInactive.Include);
        var session = UnityEngine.Object.FindAnyObjectByType<AxyroSessionClient>(FindObjectsInactive.Include);
        var feedback = UnityEngine.Object.FindAnyObjectByType<AxyroDecisionFeedback>(FindObjectsInactive.Include);

        var screenData = new SerializedObject(screen);
        screenData.FindProperty("avatar").objectReferenceValue = avatar;
        screenData.FindProperty("glow").objectReferenceValue = screenGlow;
        screenData.ApplyModifiedPropertiesWithoutUndo();

        var cinematics = camera.gameObject.AddComponent<AxyroCinematics>();
        var data = new SerializedObject(cinematics);
        data.FindProperty("tutor").objectReferenceValue = tutor;
        data.FindProperty("avatar").objectReferenceValue = avatar;
        data.FindProperty("session").objectReferenceValue = session;
        data.FindProperty("feedback").objectReferenceValue = feedback;
        data.FindProperty("screen").objectReferenceValue = screen;
        data.FindProperty("volume").objectReferenceValue = volume;
        data.ApplyModifiedPropertiesWithoutUndo();
    }

    // ---------- Tutor 3D ----------

    private static AxyroTutor3D BuildTutor(Transform lookTarget, out AudioSource voice)
    {
        var model = AssetDatabase.LoadAssetAtPath<GameObject>(AxyroTutorSetup.ModelPath);
        if (model == null) throw new InvalidOperationException($"No se pudo importar {AxyroTutorSetup.ModelPath}");
        var tutor = (GameObject)PrefabUtility.InstantiatePrefab(model);
        PrefabUtility.UnpackPrefabInstance(tutor, PrefabUnpackMode.OutermostRoot, InteractionMode.AutomatedAction);
        tutor.name = "VictorIA · tutora 3D";

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
        var head = Skin("Tutor cabeza", $"{textures}/tutor_head_color.png", $"{textures}/tutor_head_normal.png", $"{textures}/tutor_head_specular.png", 0.34f);
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
        // Tinte apenas frío: la textura Rocketbox es muy cálida y con luz de estudio la piel tiraba a naranja.
        var material = Lit(name, new Color(0.94f, 0.955f, 1f), smoothness);
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
            material.SetColor("_SpecColor", new Color(0.16f, 0.16f, 0.16f));
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

        // Diseño minimalista: la escena 3D ocupa toda la pantalla y nada compite con VictorIA. Subtítulos abajo
        // mientras habla; las opciones (con un velo suave detrás) solo aparecen cuando termina de plantear la situación.

        // Marca del cliente: logo UFV discreto arriba a la izquierda.
        var logo = LoadSprite("Assets/AXYRO/Brand/ufv-logo-white.png");
        if (logo != null)
        {
            var logoImage = Image("Logo UFV", canvasObject.transform, Color.white, new Vector2(.025f, .905f), new Vector2(.135f, .965f));
            logoImage.sprite = logo;
            logoImage.preserveAspect = true;
        }
        else
        {
            Text("Logo UFV", canvasObject.transform, "UNIVERSIDAD FRANCISCO DE VITORIA", 16, White, new Vector2(.03f, .90f), new Vector2(.40f, .96f));
        }

        var panelObject = new GameObject("Rive HUD", typeof(RectTransform));
        panelObject.transform.SetParent(canvasObject.transform, false);
        // Indicador Rive (habla / escucha) junto al nombre, encima de los subtítulos.
        Stretch(panelObject.GetComponent<RectTransform>(), new Vector2(.15f, .213f), new Vector2(.30f, .257f));
        panelObject.SetActive(false);
        var panel = panelObject.AddComponent<RivePanel>();
        var renderer = panelObject.AddComponent<RiveCanvasRenderer>();
        var rendererData = new SerializedObject(renderer);
        rendererData.FindProperty("m_initialRivePanel").objectReferenceValue = panel;
        rendererData.ApplyModifiedPropertiesWithoutUndo();

        var widgetObject = new GameObject("Status HUD", typeof(RectTransform));
        widgetObject.transform.SetParent(panelObject.transform, false);
        Stretch(widgetObject.GetComponent<RectTransform>(), Vector2.zero, Vector2.one);
        var widget = widgetObject.AddComponent<RiveWidget>();
        var asset = AssetDatabase.LoadAssetAtPath<Rive.Asset>("Assets/AXYRO/hud.riv");
        if (asset == null) throw new InvalidOperationException("No se pudo importar hud.riv");
        var widgetData = new SerializedObject(widget);
        widgetData.FindProperty("m_asset").objectReferenceValue = asset;
        widgetData.FindProperty("m_artboardName").stringValue = "HUD";
        widgetData.FindProperty("m_stateMachineName").stringValue = "HUD";
        widgetData.ApplyModifiedPropertiesWithoutUndo();
        panelObject.SetActive(true);

        // Estado y fase en una línea discreta arriba; sin paneles.
        var connection = Text("Connection", canvasObject.transform, "Modo demostración", 13, White, new Vector2(.145f, .915f), new Vector2(.45f, .955f));
        var shadow = connection.gameObject.AddComponent<Shadow>();
        shadow.effectColor = new Color(0f, 0f, 0f, 0.75f);
        shadow.effectDistance = new Vector2(1f, -1f);
        var phase = Text("Phase", canvasObject.transform, "1 / 3", 13, Mint, new Vector2(.55f, .915f), new Vector2(.975f, .955f));
        phase.alignment = TextAnchor.MiddleRight;

        // Subtítulos: lo que dice el personaje, abajo y sobre la escena.
        var characterName = Text("Name", canvasObject.transform, "VictorIA", 16, Mint, new Vector2(.04f, .213f), new Vector2(.15f, .257f));
        characterName.fontStyle = FontStyle.Bold;
        Image("Fondo subtítulos", canvasObject.transform, new Color(0f, 0.06f, 0.14f, 0.62f), new Vector2(.03f, .05f), new Vector2(.57f, .205f)).raycastTarget = false;
        var dialogue = Text("Dialogue", canvasObject.transform, "", 19, White, new Vector2(.045f, .062f), new Vector2(.555f, .193f));
        var buttonObject = new GameObject("Repetir", typeof(RectTransform), typeof(Image), typeof(Button));
        buttonObject.transform.SetParent(canvasObject.transform, false);
        Stretch(buttonObject.GetComponent<RectTransform>(), new Vector2(.40f, .211f), new Vector2(.57f, .260f));
        buttonObject.GetComponent<Image>().color = Color.clear;
        var label = Text("Label", buttonObject.transform, "▶  Escuchar", 14, Mint, new Vector2(0f, 0f), new Vector2(.96f, 1f));
        label.fontStyle = FontStyle.Bold;
        label.alignment = TextAnchor.MiddleRight;
        label.raycastTarget = false;

        // Resultado de la decisión (y avisos): una sola tarjeta compacta a la derecha.
        var resultPanel = Image("Resultado", canvasObject.transform, new Color(0.02f, 0.12f, 0.24f, 0.86f), new Vector2(.60f, .26f), new Vector2(.97f, .70f));
        Image("Acento", resultPanel.transform, Mint, new Vector2(0f, 0f), new Vector2(.012f, 1f)).raycastTarget = false;
        var choices = Text("Choices", resultPanel.transform, "", 17, White, new Vector2(.06f, .06f), new Vector2(.95f, .94f));
        choices.alignment = TextAnchor.UpperLeft;
        // Opciones: aparecen cuando el personaje termina de plantear la situación. Ratón, voz («uno», «dos»…) o teclas 1-4.
        var optionsGroup = new GameObject("Opciones", typeof(RectTransform));
        optionsGroup.transform.SetParent(canvasObject.transform, false);
        optionsGroup.transform.SetSiblingIndex(resultPanel.transform.GetSiblingIndex());
        Stretch(optionsGroup.GetComponent<RectTransform>(), Vector2.zero, Vector2.one);
        Image("Velo", optionsGroup.transform, new Color(0f, 0.10f, 0.20f, 0.42f), new Vector2(.58f, 0f), new Vector2(1f, 1f)).raycastTarget = false;
        var voiceStatus = Text("Micrófono", optionsGroup.transform, "", 12, Mint, new Vector2(.60f, .05f), new Vector2(.97f, .09f));
        var prompt = Text("Pregunta", optionsGroup.transform, "¿Qué harías?", 20, White, new Vector2(.60f, .64f), new Vector2(.97f, .70f));
        prompt.fontStyle = FontStyle.Bold;
        var cards = new Button[4];
        var cardLabels = new Text[4];
        for (var i = 0; i < cards.Length; i++)
        {
            var top = .625f - i * .112f;
            var card = Image($"Opción {i + 1}", optionsGroup.transform, Color.white, new Vector2(.60f, top - .098f), new Vector2(.97f, top));
            var button = card.gameObject.AddComponent<Button>();
            button.targetGraphic = card;
            var colors = button.colors;
            colors.normalColor = new Color(0.04f, 0.14f, 0.27f, 0.84f);
            colors.highlightedColor = new Color(0.16f, 0.33f, 0.62f, 0.94f);
            colors.selectedColor = colors.normalColor;
            colors.pressedColor = new Color(0.39f, 0.62f, 1f, 0.96f);
            colors.disabledColor = new Color(0.04f, 0.14f, 0.27f, 0.4f);
            colors.fadeDuration = 0.12f;
            button.colors = colors;
            button.navigation = new Navigation { mode = Navigation.Mode.None };
            // Tecla visible: el atajo se aprende sin leer ninguna ayuda.
            var key = Image("Tecla", card.transform, new Color(0.39f, 0.62f, 1f, 0.22f), new Vector2(.025f, .24f), new Vector2(.085f, .76f));
            key.raycastTarget = false;
            var number = Text("Número", key.transform, (i + 1).ToString(), 18, Mint, Vector2.zero, Vector2.one);
            number.alignment = TextAnchor.MiddleCenter;
            number.fontStyle = FontStyle.Bold;
            number.raycastTarget = false;
            cardLabels[i] = Text("Texto", card.transform, "", 16, White, new Vector2(.11f, .1f), new Vector2(.97f, .9f));
            cardLabels[i].raycastTarget = false;
            cards[i] = button;
        }

        var demo = canvasObject.AddComponent<AxyroAvatarDemo>();
        var demoData = new SerializedObject(demo);
        demoData.FindProperty("tutor").objectReferenceValue = tutor;
        demoData.FindProperty("hud").objectReferenceValue = widget;
        demoData.FindProperty("voice").objectReferenceValue = voice;
        demoData.FindProperty("phaseTitle").objectReferenceValue = phase;
        demoData.FindProperty("characterName").objectReferenceValue = characterName;
        demoData.FindProperty("dialogue").objectReferenceValue = dialogue;
        demoData.FindProperty("playLabel").objectReferenceValue = label;
        demoData.FindProperty("playButton").objectReferenceValue = buttonObject.GetComponent<Button>();
        // Todas las locuciones de Audio/: Unity elige la de cada fase por su nombre (id de fase).
        // Las reacciones (Audio/Reacciones) se cargan aparte con Resources: no son locuciones de fase.
        var audio = AssetDatabase.FindAssets("t:AudioClip", new[] { "Assets/AXYRO/Audio" })
            .Select(AssetDatabase.GUIDToAssetPath)
            .Where(path => !path.Replace('\\', '/').Contains("/Audio/Reacciones/"))
            .Select(path => AssetDatabase.LoadAssetAtPath<AudioClip>(path)).Where(clip => clip != null).ToArray();
        var clips = demoData.FindProperty("lines");
        clips.arraySize = audio.Length;
        for (var i = 0; i < audio.Length; i++) clips.GetArrayElementAtIndex(i).objectReferenceValue = audio[i];
        demoData.ApplyModifiedPropertiesWithoutUndo();
        Debug.Log($"AXYRO_VOICE_LINES {string.Join(", ", audio.Select(clip => clip.name))}");

        // Feedback de la decisión (Rive): check, marca neutra o aviso junto a VictorIA, sobre la escena 3D.
        var feedbackPanel = new GameObject("Rive Feedback", typeof(RectTransform));
        feedbackPanel.transform.SetParent(canvasObject.transform, false);
        Stretch(feedbackPanel.GetComponent<RectTransform>(), new Vector2(.36f, .56f), new Vector2(.50f, .81f));
        feedbackPanel.SetActive(false);
        var feedbackRivePanel = feedbackPanel.AddComponent<RivePanel>();
        var feedbackRenderer = new SerializedObject(feedbackPanel.AddComponent<RiveCanvasRenderer>());
        feedbackRenderer.FindProperty("m_initialRivePanel").objectReferenceValue = feedbackRivePanel;
        feedbackRenderer.ApplyModifiedPropertiesWithoutUndo();
        var feedbackWidgetObject = new GameObject("Decision Feedback", typeof(RectTransform));
        feedbackWidgetObject.transform.SetParent(feedbackPanel.transform, false);
        Stretch(feedbackWidgetObject.GetComponent<RectTransform>(), Vector2.zero, Vector2.one);
        var feedbackWidget = feedbackWidgetObject.AddComponent<RiveWidget>();
        var feedbackAsset = AssetDatabase.LoadAssetAtPath<Rive.Asset>("Assets/AXYRO/feedback.riv");
        if (feedbackAsset == null) throw new InvalidOperationException("No se pudo importar feedback.riv");
        var feedbackWidgetData = new SerializedObject(feedbackWidget);
        feedbackWidgetData.FindProperty("m_asset").objectReferenceValue = feedbackAsset;
        feedbackWidgetData.FindProperty("m_artboardName").stringValue = "Feedback";
        feedbackWidgetData.FindProperty("m_stateMachineName").stringValue = "Feedback";
        feedbackWidgetData.ApplyModifiedPropertiesWithoutUndo();
        feedbackPanel.SetActive(true);
        var decisionFeedback = feedbackPanel.AddComponent<AxyroDecisionFeedback>();
        var decisionFeedbackData = new SerializedObject(decisionFeedback);
        decisionFeedbackData.FindProperty("widget").objectReferenceValue = feedbackWidget;
        decisionFeedbackData.ApplyModifiedPropertiesWithoutUndo();

        // Transparencia (AI Act): el personaje y su voz son sintéticos.
        var notice = Text("Aviso IA", canvasObject.transform, "VictorIA es un personaje virtual: su imagen y su voz son sintéticas.", 11, Muted, new Vector2(.03f, .012f), new Vector2(.50f, .045f));
        var noticeShadow = notice.gameObject.AddComponent<Shadow>();
        noticeShadow.effectColor = new Color(0f, 0f, 0f, 0.7f);
        noticeShadow.effectDistance = new Vector2(1f, -1f);

        var sessionClient = canvasObject.AddComponent<AxyroSessionClient>();
        var clientData = new SerializedObject(sessionClient);
        clientData.FindProperty("feedback").objectReferenceValue = decisionFeedback;
        clientData.FindProperty("choicePanel").objectReferenceValue = resultPanel.gameObject;
        clientData.FindProperty("optionsGroup").objectReferenceValue = optionsGroup;
        clientData.FindProperty("tutor").objectReferenceValue = tutor;
        clientData.FindProperty("avatar").objectReferenceValue = demo;
        clientData.FindProperty("connectionLabel").objectReferenceValue = connection;
        clientData.FindProperty("choiceList").objectReferenceValue = choices;
        var cardList = clientData.FindProperty("cards");
        var labelList = clientData.FindProperty("cardLabels");
        cardList.arraySize = cards.Length;
        labelList.arraySize = cards.Length;
        for (var i = 0; i < cards.Length; i++)
        {
            cardList.GetArrayElementAtIndex(i).objectReferenceValue = cards[i];
            labelList.GetArrayElementAtIndex(i).objectReferenceValue = cardLabels[i];
        }
        clientData.ApplyModifiedPropertiesWithoutUndo();

        var voiceCommands = canvasObject.AddComponent<AxyroVoiceCommands>();
        var voiceData = new SerializedObject(voiceCommands);
        voiceData.FindProperty("session").objectReferenceValue = sessionClient;
        voiceData.FindProperty("avatar").objectReferenceValue = demo;
        voiceData.FindProperty("status").objectReferenceValue = voiceStatus;
        voiceData.ApplyModifiedPropertiesWithoutUndo();
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

    private static Sprite LoadSprite(string path)
    {
        var importer = AssetImporter.GetAtPath(path) as TextureImporter;
        if (importer == null) return null;
        // Una sola imagen: en modo Multiple Unity trocea el logo y solo se ve el emblema.
        if (importer.textureType != TextureImporterType.Sprite || importer.spriteImportMode != SpriteImportMode.Single || !importer.alphaIsTransparency)
        {
            importer.textureType = TextureImporterType.Sprite;
            importer.spriteImportMode = SpriteImportMode.Single;
            importer.alphaIsTransparency = true;
            importer.mipmapEnabled = false;
            importer.SaveAndReimport();
        }
        return AssetDatabase.LoadAssetAtPath<Sprite>(path);
    }

    private static void SaveMaterial(Material material)
    {
        var path = $"{RenderingRoot}/{material.name}.mat";
        AssetDatabase.DeleteAsset(path);
        AssetDatabase.CreateAsset(material, path);
    }

    private static void Box(string name, Transform parent, Vector3 position, Vector3 size, Material material) =>
        Primitive(PrimitiveType.Cube, name, parent, position, size, material, Quaternion.identity);

    private static void Box(string name, Transform parent, Vector3 position, Vector3 size, Material material, Quaternion rotation) =>
        Primitive(PrimitiveType.Cube, name, parent, position, size, material, rotation);

    private static void Primitive(PrimitiveType type, string name, Transform parent, Vector3 position, Vector3 size, Material material, Quaternion rotation)
    {
        var box = GameObject.CreatePrimitive(type);
        box.name = name;
        box.transform.SetParent(parent, false);
        box.transform.SetPositionAndRotation(position, rotation);
        box.transform.localScale = size;
        UnityEngine.Object.DestroyImmediate(box.GetComponent<Collider>());
        var renderer = box.GetComponent<MeshRenderer>();
        renderer.sharedMaterial = material;
        // El decorado es estático: sin sombras propias salvo lo que recibe de la luz principal.
        renderer.shadowCastingMode = ShadowCastingMode.Off;
        box.isStatic = true;
    }

    private static void Spot(string name, Transform parent, Vector3 position, Vector3 target, Color color, float intensity, float angle, float inner, LightShadows shadows, float range)
    {
        var light = new GameObject(name, typeof(Light)).GetComponent<Light>();
        light.transform.SetParent(parent, false);
        light.type = LightType.Spot;
        light.transform.position = position;
        light.transform.rotation = Quaternion.LookRotation(target - position);
        light.color = color;
        light.intensity = intensity;
        light.range = range;
        light.spotAngle = angle;
        light.innerSpotAngle = angle * inner;
        light.shadows = shadows;
        light.shadowStrength = 0.8f;
        light.shadowBias = 0.02f;
        light.shadowNormalBias = 0.3f;
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
        // Ningún texto sale de su caja: si no cabe se reduce hasta un mínimo legible y, como último recurso, se recorta.
        // Así un texto largo nunca invade ni desplaza otros elementos.
        text.verticalOverflow = VerticalWrapMode.Truncate;
        text.resizeTextForBestFit = true;
        text.resizeTextMaxSize = size;
        text.resizeTextMinSize = Mathf.Max(9, Mathf.RoundToInt(size * 0.6f));
        text.lineSpacing = 1.05f;
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

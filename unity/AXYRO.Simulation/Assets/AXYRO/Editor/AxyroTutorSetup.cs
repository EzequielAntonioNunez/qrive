using System.Linq;
using UnityEditor;
using UnityEngine;

/// <summary>
/// Importación del tutor 3D (provisional: Microsoft Rocketbox Business_Female_04, MIT).
/// Humanoid para poder reutilizar las animaciones cuando llegue el personaje definitivo (Character Creator 4).
/// </summary>
public static class AxyroTutorSetup
{
    public const string Root = "Assets/AXYRO/Characters/Tutor";
    public const string ModelPath = Root + "/Tutor.fbx";
    public static readonly string[] AnimationPaths =
    {
        Root + "/Animations/f_gestic_listen_neutral_01.fbx",
        Root + "/Animations/f_gestic_talk_neutral_01.fbx",
        Root + "/Animations/f_gestic_talk_relaxed_01.fbx",
    };

    public static void ConfigureImporters()
    {
        var model = (ModelImporter)AssetImporter.GetAtPath(ModelPath);
        var dirty = false;
        if (model.animationType != ModelImporterAnimationType.Human) { model.animationType = ModelImporterAnimationType.Human; dirty = true; }
        if (!model.importBlendShapes) { model.importBlendShapes = true; dirty = true; }
        if (model.materialImportMode != ModelImporterMaterialImportMode.None) { model.materialImportMode = ModelImporterMaterialImportMode.None; dirty = true; }
        if (model.importAnimation) { model.importAnimation = false; dirty = true; }
        if (dirty) model.SaveAndReimport();

        foreach (var path in AnimationPaths)
        {
            var importer = (ModelImporter)AssetImporter.GetAtPath(path);
            importer.animationType = ModelImporterAnimationType.Human;
            importer.materialImportMode = ModelImporterMaterialImportMode.None;
            importer.importBlendShapes = false;
            var clips = importer.defaultClipAnimations;
            foreach (var clip in clips)
            {
                clip.loopTime = true;
                clip.lockRootRotation = true;
                clip.lockRootHeightY = true;
                clip.lockRootPositionXZ = true;
                clip.keepOriginalOrientation = true;
                clip.keepOriginalPositionY = true;
                clip.keepOriginalPositionXZ = true;
            }
            importer.clipAnimations = clips;
            importer.SaveAndReimport();
        }
    }

    /// <summary>Uso en batch: -executeMethod AxyroTutorSetup.Inspect. Registra mallas, materiales, blendshapes y huesos.</summary>
    public static void Inspect()
    {
        ConfigureImporters();
        var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(ModelPath);
        foreach (var renderer in prefab.GetComponentsInChildren<SkinnedMeshRenderer>(true))
        {
            var mesh = renderer.sharedMesh;
            var shapes = Enumerable.Range(0, mesh.blendShapeCount).Select(mesh.GetBlendShapeName);
            Debug.Log($"AXYRO_MESH {renderer.name} submeshes={mesh.subMeshCount} bounds={renderer.bounds.size} shapes=[{string.Join(", ", shapes)}]");
        }
        var animator = prefab.GetComponent<Animator>();
        Debug.Log($"AXYRO_AVATAR valid={animator?.avatar?.isValid} human={animator?.avatar?.isHuman}");
        foreach (var path in AnimationPaths)
        {
            var clip = AssetDatabase.LoadAllAssetsAtPath(path).OfType<AnimationClip>().FirstOrDefault(c => !c.name.StartsWith("__preview"));
            Debug.Log($"AXYRO_CLIP {path} name={clip?.name} length={clip?.length:F2} human={clip?.humanMotion}");
        }
        var head = prefab.GetComponentsInChildren<Transform>(true).Where(t => t.name.Contains("Head") || t.name.Contains("Eye")).Select(t => t.name);
        Debug.Log($"AXYRO_BONES {string.Join(", ", head)}");
    }
}

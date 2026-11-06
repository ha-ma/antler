"""Blender の中で回す鹿の描画（docs/specs/dataset-synth R3・R5）。

synth.py が子プロセスで呼ぶ。bpy と標準ライブラリだけを使う
（Blender の Python から venv は見えない）。
pytest からは import しない（ruff だけ当てる）。

  blender -b --factory-startup --disable-autoexec --python dataset/synth_render.py \
      -- render|check <payload.json> <out>

render: job ごとに <id>.png（鹿だけの RGBA、透明の背景、straight alpha）、鹿が 2 頭以上なら鹿ごとの
<id>_m<k>.png（ほかの鹿を holdout にした描画。アルファが「見えている」マスク）、<id>.json（鹿ごとの
射影の箱。画面で切らない）を書き、最後に render.json を書く。
check: 4 体の読み込み・動作の姿勢の変化・材質の張り直し・肩の高さ・決めた点の射影を
check.json に書き、横からの並び（肩 1 m にそろえる）を check.png に描く。
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import bpy  # type: ignore[import-not-found]
from bpy_extras.object_utils import world_to_camera_view  # type: ignore[import-not-found]
from mathutils import Euler, Matrix, Vector  # type: ignore[import-not-found]

SKIP_PREFIX = ("Plane", "Icosphere")
SHOULDER_BONES = ("FrontUpperLeg.L", "Frontleg_L")
NOT_BODY = ("Horn", "Head", "Eye")  # 肩の高さを測るときに除く（M03・M04 の分かれたメッシュ）


def fail(msg: str) -> None:
    sys.stderr.write(f"synth_render: {msg}\n")
    raise SystemExit(1)


def engine_name() -> str:
    names = {e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items}
    return "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in names else "BLENDER_EEVEE"


class Deer:
    """読み込んだ 1 体（骨格・メッシュ・最上位の物・元の行列・肩の高さ）。"""

    def __init__(self, mid: str, spec: dict) -> None:
        self.mid = mid
        self.spec = spec
        scene = bpy.context.scene
        before = set(bpy.data.objects)
        actions_before = set(bpy.data.actions)
        materials_before = set(bpy.data.materials)
        images_before = set(bpy.data.images)
        path = spec["path"]
        if spec["kind"] == "glb":
            bpy.ops.import_scene.gltf(filepath=path)
        else:
            with bpy.data.libraries.load(path, link=False) as (src, dst):
                dst.objects = list(src.objects)
                dst.actions = list(src.actions)
                # 古い形式の材質は画像を節点で参照しないので、物と一緒には入らない
                dst.images = list(src.images)
            for obj in dst.objects:
                if obj is not None:
                    scene.collection.objects.link(obj)
        # 4 体で動作・材質・画像の名前がぶつかる（Blender が .001 を付ける）。前のモデルの分は
        # 「<id>/<元の名前>」に改名済みなので、ここでは元の名前のまま入る。改名して元の名前で引く。
        # GLB は同じ動作が「AnimalArmature|<名前>」の接頭辞付きでも入っている。
        # 接頭辞の無いほうを使う
        self.actions: dict = {}
        new_actions = sorted(
            (a for a in bpy.data.actions if a not in actions_before),
            key=lambda a: "|" not in a.name,
        )
        for act in new_actions:
            self.actions[act.name.split("|")[-1]] = act
            act.name = f"{mid}/{act.name}"
        self.material_names: dict = {}
        for mat in [m for m in bpy.data.materials if m not in materials_before]:
            self.material_names[mat] = mat.name
            mat.name = f"{mid}/{mat.name}"
        self.images: dict = {}
        for img in [i for i in bpy.data.images if i not in images_before]:
            self.images[img.name] = img
            img.name = f"{mid}/{img.name}"
        keep = []
        for obj in [o for o in bpy.data.objects if o not in before]:
            if obj.type in {"LIGHT", "CAMERA"} or obj.name.startswith(SKIP_PREFIX):
                bpy.data.objects.remove(obj, do_unlink=True)
            else:
                keep.append(obj)
        arms = [o for o in keep if o.type == "ARMATURE"]
        if len(arms) != 1:
            fail(f"{mid}: 骨格が 1 つでない（{len(arms)}）")
        self.arm = arms[0]
        self.meshes = [o for o in keep if o.type == "MESH"]
        self.objects = keep
        root = self.arm
        while root.parent is not None:
            root = root.parent
        self.root = root
        self.base = root.matrix_world.copy()
        self.materials()
        self.set_pose(spec["rest_action"], 0)
        self.shoulder_units = self.measure_shoulder()

    # ------------------------------------------------------------ 材質
    def materials(self) -> None:
        """M03・M04 の古い形式の材質を、UVMap の UV で毛皮の画像を張った Principled BSDF にする。"""
        textures = self.spec.get("textures") or {}
        if not textures:
            return
        mats = {s.material for o in self.meshes for s in o.material_slots if s.material}
        for mat in mats:
            name = self.material_names.get(mat, mat.name)
            color = tuple(mat.diffuse_color)
            mat.use_nodes = True
            tree = mat.node_tree
            tree.nodes.clear()
            out = tree.nodes.new("ShaderNodeOutputMaterial")
            bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
            bsdf.inputs["Roughness"].default_value = 0.85
            tree.links.new(bsdf.outputs[0], out.inputs[0])
            image = textures.get(name)
            if image is not None:
                if image not in self.images:
                    fail(f"{self.mid}: 画像 {image!r} が無い")
                tex = tree.nodes.new("ShaderNodeTexImage")
                tex.image = self.images[image]
                uv = tree.nodes.new("ShaderNodeUVMap")
                uv.uv_map = "UVMap"
                tree.links.new(uv.outputs[0], tex.inputs[0])
                tree.links.new(tex.outputs[0], bsdf.inputs["Base Color"])
            elif "Eye" in name:
                # 元の目は白。目の反射は今回描かない（仕様の範囲外）ので、濡れた黒目にする
                bsdf.inputs["Base Color"].default_value = (0.03, 0.03, 0.03, 1.0)
                bsdf.inputs["Roughness"].default_value = 0.15
            else:
                bsdf.inputs["Base Color"].default_value = color

    def textured(self) -> list[str]:
        """画像が張られた材質の元の名前。"""
        return sorted(
            {
                self.material_names.get(s.material, s.material.name)
                for o in self.meshes
                for s in o.material_slots
                if s.material
                and s.material.use_nodes
                and any(n.type == "TEX_IMAGE" and n.image for n in s.material.node_tree.nodes)
            }
        )

    # ------------------------------------------------------------ 姿勢と大きさ
    def set_pose(self, action: str, frame: int) -> None:
        act = self.actions.get(action)
        if act is None:
            fail(f"{self.mid}: 動作 {action!r} が無い")
        if self.arm.animation_data is None:
            self.arm.animation_data_create()
        # glTF の読み込みは全動作を NLA の帯に積み、後の GLB（骨格の名前が同じ）も前の骨格に積む。
        # 選んだ動作に混ざって姿勢が崩れるので、毎回消す
        for track in list(self.arm.animation_data.nla_tracks):
            self.arm.animation_data.nla_tracks.remove(track)
        # 動作はすべての骨にキーを持たない。前の動作の姿勢が残らないように、骨を静止の姿勢に戻す
        for pb in self.arm.pose.bones:
            pb.location = (0.0, 0.0, 0.0)
            pb.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
            pb.rotation_euler = (0.0, 0.0, 0.0)
            pb.scale = (1.0, 1.0, 1.0)
        self.arm.animation_data.action = act
        if getattr(act, "slots", None):
            self.arm.animation_data.action_slot = act.slots[0]
        bpy.context.scene.frame_set(int(frame))

    def points(self, *, body_only: bool = False) -> list:
        graph = bpy.context.evaluated_depsgraph_get()
        pts = []
        for obj in self.meshes:
            if body_only and len(self.meshes) > 1 and any(k in obj.name for k in NOT_BODY):
                continue
            ev = obj.evaluated_get(graph)
            mesh = ev.to_mesh()
            pts.extend(ev.matrix_world @ v.co for v in mesh.vertices)
            ev.to_mesh_clear()
        return pts

    def measure_shoulder(self) -> float:
        """前脚の付け根の骨の前後位置での胴の上端 − 足の最も低い点（モデルの単位）。"""
        bone = next((b for b in SHOULDER_BONES if b in self.arm.pose.bones), None)
        if bone is None:
            fail(f"{self.mid}: 前脚の付け根の骨が無い")
        y = (self.arm.matrix_world @ self.arm.pose.bones[bone].head).y
        pts = self.points(body_only=True)
        ys = [p.y for p in pts]
        window = 0.06 * (max(ys) - min(ys))
        top = max(p.z for p in pts if abs(p.y - y) <= window)
        ground = min(p.z for p in self.points())
        return top - ground

    def place(self, deer: dict) -> None:
        """肩の高さに拡大し、向きを変え、足を路面に置く。"""
        self.set_pose(deer["action"], deer["frame"])
        scale = deer["shoulder_m"] / self.shoulder_units
        rot = Matrix.Rotation(math.radians(deer["yaw_deg"]), 4, "Z")
        place = Matrix.Translation((deer["x"], deer["y"], 0.0)) @ rot @ Matrix.Scale(scale, 4)
        self.root.matrix_world = place @ self.base
        bpy.context.view_layer.update()
        low = min(p.z for p in self.points())
        self.root.matrix_world = Matrix.Translation((0.0, 0.0, -low)) @ self.root.matrix_world
        bpy.context.view_layer.update()

    def projected_box(self) -> list[float]:
        """評価した頂点をカメラで射影した外接矩形 [x0, y0, x1, y1]（画素。画面で切らない）。"""
        scene = bpy.context.scene
        width = scene.render.resolution_x
        height = scene.render.resolution_y
        us, vs = [], []
        for p in self.points():
            ndc = world_to_camera_view(scene, scene.camera, p)
            us.append(ndc.x * width)
            vs.append((1.0 - ndc.y) * height)
        return [min(us), min(vs), max(us), max(vs)]

    def show(self, *, visible: bool, holdout: bool = False) -> None:
        for obj in self.objects:
            obj.hide_render = not visible
            if obj.type == "MESH":
                obj.is_holdout = holdout


class Stage:
    """カメラ・ヘッドライト・空・描画の設定。"""

    def __init__(self, cfg: dict) -> None:
        scene = bpy.context.scene
        width, height = cfg["size"]
        scene.render.engine = engine_name()
        scene.render.resolution_x = width
        scene.render.resolution_y = height
        scene.render.resolution_percentage = 100
        scene.render.film_transparent = True
        scene.render.image_settings.file_format = "PNG"
        scene.render.image_settings.color_mode = "RGBA"
        scene.render.image_settings.color_depth = "8"
        scene.view_settings.view_transform = "Standard"
        scene.view_settings.look = "None"
        scene.view_settings.exposure = 0.0
        scene.view_settings.gamma = 1.0
        scene.eevee.taa_render_samples = int(cfg["render"]["samples"])
        world = bpy.data.worlds.new("synth-sky")
        world.use_nodes = True
        self.sky = world.node_tree.nodes["Background"]
        self.sky.inputs["Color"].default_value = (0.35, 0.4, 0.55, 1.0)
        scene.world = world

        cam = cfg["camera"]
        data = bpy.data.cameras.new("synth-cam")
        data.sensor_fit = "HORIZONTAL"
        data.sensor_width = 36.0
        data.lens = cam["focal_px"] * 36.0 / width
        data.clip_start = 0.5
        data.clip_end = 500.0
        self.cam = bpy.data.objects.new("synth-cam", data)
        self.cam.location = (0.0, 0.0, cam["height_m"])
        scene.collection.objects.link(self.cam)
        scene.camera = self.cam
        self.set_pitch(3.0)

        head = cfg["headlight"]
        self.lights = []
        for side in (-1.0, 1.0):
            light = bpy.data.lights.new(f"synth-head{side:+.0f}", "SPOT")
            light.spot_size = math.radians(head["spot_deg"])
            light.spot_blend = head["blend"]
            light.use_shadow = True
            # EEVEE は強さから決めた距離でライトを打ち切る（800 W で 20 m 台）。
            # 遠い鹿が急に暗くならないよう広げる
            light.use_custom_distance = True
            light.cutoff_distance = 200.0
            lobj = bpy.data.objects.new(light.name, light)
            lobj.location = (side * head["spacing_m"] / 2, head["forward_m"], head["height_m"])
            lobj.rotation_euler = Euler((math.radians(90.0 - head["tilt_deg"]), 0.0, 0.0))
            scene.collection.objects.link(lobj)
            self.lights.append(light)

    def set_pitch(self, pitch_deg: float) -> None:
        """+Y を向き、pitch_deg だけ下を向く。

        既定のカメラは -Z を向くので、X を 90° − pitch 回す。
        """
        self.cam.rotation_euler = Euler((math.radians(90.0 - pitch_deg), 0.0, 0.0))
        bpy.context.view_layer.update()

    def set_light(self, light: dict) -> None:
        for spot in self.lights:
            spot.energy = light["power_w"]
        self.sky.inputs["Strength"].default_value = light["ambient"]


def render_to(path: Path) -> None:
    bpy.context.scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    if not path.exists():
        fail(f"描画が書かれていない（{path.name}）")


def load_models(cfg: dict) -> dict[str, Deer]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return {mid: Deer(mid, spec) for mid, spec in sorted(cfg["models"].items())}


def run_render(cfg: dict, out: Path) -> None:
    models = load_models(cfg)
    stage = Stage(cfg)
    for deer in models.values():
        deer.show(visible=False)
    done = 0
    for job in cfg["jobs"]:
        stage.set_pitch(job["pitch_deg"])
        stage.set_light(job["light"])
        used = []
        boxes = []
        frames = []
        for spec in job["deer"]:
            deer = models[spec["model"]]
            # 計画は動作の中の位置（0〜1）だけを決める。フレームの範囲は Blender だけが知っている
            act = deer.actions.get(spec["action"])
            if act is None:
                fail(f"{deer.mid}: 動作 {spec['action']!r} が無い")
            lo, hi = (int(v) for v in act.frame_range)
            frame = lo + min(int(spec["phase"] * (hi - lo + 1)), hi - lo)
            deer.place({**spec, "frame": frame})
            deer.show(visible=True)
            used.append(deer)
            boxes.append(deer.projected_box())
            frames.append(frame)
        render_to(out / f"{job['id']}.png")
        if len(used) > 1:
            for k, target in enumerate(used):
                for other in used:
                    other.show(visible=True, holdout=other is not target)
                render_to(out / f"{job['id']}_m{k}.png")
        for deer in used:
            deer.show(visible=False)
        (out / f"{job['id']}.json").write_text(
            json.dumps({"boxes": boxes, "frames": frames}) + "\n", encoding="utf-8"
        )
        done += 1
    (out / "render.json").write_text(
        json.dumps({"blender": bpy.app.version_string, "jobs": done}) + "\n", encoding="utf-8"
    )


def pose_change(deer: Deer, name: str) -> dict | None:
    """動作の最初と中ほどのフレームで、骨の行列の成分の差の最大。0 なら動作が再生されていない。"""
    act = deer.actions.get(name)
    if act is None:
        return None
    lo, hi = (int(v) for v in act.frame_range)
    poses = []
    for frame in (lo, (lo + hi) // 2):
        deer.set_pose(name, frame)
        poses.append([Matrix(pb.matrix) for pb in deer.arm.pose.bones])
    change = 0.0
    for a, b in zip(poses[0], poses[1], strict=True):
        for r1, r2 in zip(a, b, strict=True):
            change = max(change, *(abs(x - y) for x, y in zip(r1, r2, strict=True)))
    return {"range": [lo, hi], "pose_change": change}


def run_check(cfg: dict, out: Path) -> None:
    models = load_models(cfg)
    result: dict = {"blender": bpy.app.version_string, "models": {}}
    for mid, deer in models.items():
        result["models"][mid] = {
            "shoulder_units": deer.shoulder_units,
            "meshes": len(deer.meshes),
            "textured": deer.textured(),
            "actions": {name: pose_change(deer, name) for name in deer.spec["actions"]},
        }
    # Python の射影との突き合わせ（W3）: 決めた点をこのカメラで射影した画素
    stage = Stage(cfg)
    scene = bpy.context.scene
    width, height = cfg["size"]
    projected = []
    for item in cfg["check_points"]:
        stage.set_pitch(item["pitch_deg"])
        ndc = world_to_camera_view(scene, scene.camera, Vector(item["point"]))
        projected.append({**item, "uv": [ndc.x * width, (1.0 - ndc.y) * height]})
    result["projection"] = projected
    # 横からの並び（肩の高さを目で確かめる）。肩 1 m にそろえて 3 m おきに並べる
    stage.set_light({"power_w": 0.0, "ambient": 1.0})
    cam = scene.camera
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 3.0 * len(models) + 1.0
    cam.location = (20.0, 1.5 * (len(models) - 1), 1.0)
    cam.rotation_euler = Euler((math.radians(90.0), 0.0, math.radians(90.0)))
    for i, deer in enumerate(models.values()):
        deer.place(
            {
                "action": deer.spec["rest_action"],
                "frame": 0,
                "x": 0.0,
                "y": 3.0 * i,
                "yaw_deg": 0.0,
                "shoulder_m": 1.0,
            }
        )
        deer.show(visible=True)
    render_to(out / "check.png")
    result["sheet"] = {"ortho_scale": cam.data.ortho_scale, "center_z": 1.0, "shoulder_m": 1.0}
    (out / "check.json").write_text(json.dumps(result, indent=1) + "\n", encoding="utf-8")


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(argv) != 3 or argv[0] not in {"render", "check"}:
        fail("使い方: -- render|check <payload.json> <out>")
    cfg = json.loads(Path(argv[1]).read_text(encoding="utf-8"))
    out = Path(argv[2])
    if argv[0] == "render":
        run_render(cfg, out)
    else:
        run_check(cfg, out)


if __name__ == "__main__":
    main()

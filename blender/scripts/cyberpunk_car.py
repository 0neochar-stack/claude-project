"""
Cyberpunk Drift - procedural base model for the player car.

Builds a game-ready, low-poly cyberpunk street racer entirely from code:
a faceted wedge body with cut wheel arches, widebody over-fenders, a black
glass canopy, a GT wing, full-width light bars, neon accent strips and four
wheels with glowing rims. Every object follows the naming contract in
docs/BLENDER_PIPELINE.md, so the game can find wheels, lights and sockets
without any per-model code.

Requires Blender 4.2 LTS or newer (tested on 4.2 and 5.0).

Running it
----------
Inside Blender:
    Scripting workspace -> Open -> cyberpunk_car.py -> Run Script.
    Builds the car plus a wet-street preview stage; re-running replaces both.

Headless (the asset pipeline):
    blender -b -P blender/scripts/cyberpunk_car.py -- \
        --export public/models/cars/player_car.glb

Preview render:
    blender -b -P blender/scripts/cyberpunk_car.py -- \
        --render docs/images/player_car_preview.jpg

Options (everything after "--"):
    --export PATH   write a .glb with only the car hierarchy
    --preview       add the preview stage (default when run from the UI)
    --no-preview    skip the preview stage
    --render PATH   render the preview camera to .png or .jpg (implies --preview)
    --samples N     Cycles samples for --render (default 96)
    --paint HEX     body colour, e.g. "#1b1530"
    --neon HEX      primary neon colour (rims, underglow, splitter)
    --accent HEX    secondary neon colour (side slash, wing)

Conventions (see docs/BLENDER_PIPELINE.md)
------------------------------------------
    1 unit = 1 metre, +Z up, car faces -Y   (-> +Z forward / +Y up in glTF)
    left side of the car is +X
    root origin = ground level, midway between the axles
"""

import argparse
import math
import os
import sys
from dataclasses import dataclass

import bpy  # first: the standalone `bpy` module only exposes bmesh/mathutils after it loads
import bmesh
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

CAR_COLLECTION = "CAR_player_car"
PREVIEW_COLLECTION = "PREVIEW_stage"
GENERATED_TAG = "cyberdrift_generated"


# --------------------------------------------------------------------------
# Specification
# --------------------------------------------------------------------------

@dataclass
class CarSpec:
    asset_id: str = "player_car"
    wheelbase: float = 2.70
    front_overhang: float = 0.95      # nose to front axle
    track_front: float = 1.68         # tyre centre to tyre centre
    track_rear: float = 1.70
    wheel_radius: float = 0.34
    rim_radius: float = 0.255         # ~20" rim
    tire_width_front: float = 0.26
    tire_width_rear: float = 0.31
    arch_clearance: float = 0.045     # gap between tyre and arch cut
    mass_kg: float = 1250.0
    paint: str = "#1b1530"
    neon: str = "#00e5ff"
    accent: str = "#ff2bd6"
    headlight: str = "#d8f6ff"
    taillight: str = "#ff1744"

    def y_at(self, s):
        """Distance from the nose (metres) -> Blender Y (front is -Y)."""
        return s - self.front_overhang - self.wheelbase / 2

    @property
    def front_axle_y(self):
        return -self.wheelbase / 2

    @property
    def rear_axle_y(self):
        return self.wheelbase / 2

    @property
    def arch_radius(self):
        return self.wheel_radius + self.arch_clearance


# Body cross-sections, nose to tail. s = metres from the nose; each profile
# point is (half_width, z) and the loft mirrors it across X = 0.
#   bottom   floor edge          sill   rocker / lower side
#   shoulder widest crease       belt   where the side turns into the top
#   top      hood / roof edge    crown  centre-line height of the top surface
# `zone` describes the segment *behind* the station and decides where glass
# goes. The table is tuned for the default wheelbase and overhang.
STATIONS = [
    # s     bottom        sill          shoulder      belt          top           crown  zone
    (0.00, (0.52, 0.17), (0.66, 0.21), (0.72, 0.34), (0.70, 0.46), (0.58, 0.48), 0.47, "nose"),
    (0.15, (0.80, 0.13), (0.90, 0.17), (0.92, 0.36), (0.90, 0.56), (0.78, 0.58), 0.55, "hood"),
    (0.55, (0.82, 0.12), (0.93, 0.18), (0.96, 0.50), (0.93, 0.74), (0.80, 0.78), 0.70, "hood"),
    (0.95, (0.82, 0.12), (0.94, 0.19), (0.97, 0.54), (0.94, 0.79), (0.82, 0.83), 0.76, "hood"),
    (1.40, (0.83, 0.12), (0.93, 0.20), (0.96, 0.56), (0.93, 0.80), (0.84, 0.84), 0.84, "windshield"),
    (2.10, (0.84, 0.12), (0.92, 0.21), (0.97, 0.56), (0.92, 0.82), (0.66, 1.13), 1.17, "roof"),
    (2.75, (0.84, 0.12), (0.92, 0.21), (0.98, 0.57), (0.93, 0.83), (0.67, 1.11), 1.15, "rearglass"),
    (3.25, (0.83, 0.12), (0.93, 0.21), (1.00, 0.58), (0.95, 0.84), (0.76, 1.00), 1.03, "fastback"),
    (3.90, (0.82, 0.13), (0.94, 0.21), (1.00, 0.58), (0.96, 0.84), (0.84, 0.89), 0.90, "deck"),
    (4.45, (0.78, 0.18), (0.90, 0.24), (0.96, 0.56), (0.94, 0.82), (0.84, 0.88), 0.89, "deck"),
    (4.60, (0.70, 0.26), (0.82, 0.30), (0.92, 0.52), (0.92, 0.80), (0.84, 0.90), 0.91, None),
]
SIDE_GLASS_ZONES = {"windshield", "roof", "rearglass"}
TOP_GLASS_ZONES = {"windshield", "rearglass", "fastback"}


# --------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------

def srgb(hex_str, alpha=1.0):
    """'#rrggbb' (sRGB, what colour pickers show) -> linear RGBA."""
    h = hex_str.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (*out, alpha)


def tag(datablock):
    datablock[GENERATED_TAG] = True
    return datablock


def rect(width, height, v0=0.0):
    """Rectangle profile, centred in u, spanning v0..v0+height."""
    return [(-width / 2, v0), (width / 2, v0), (width / 2, v0 + height), (-width / 2, v0 + height)]


def circle(radius, sides=8):
    return [(radius * math.cos(2 * math.pi * i / sides), radius * math.sin(2 * math.pi * i / sides))
            for i in range(sides)]


def sweep(bm, path, normals, profile, mat, side=None, closed=False):
    """Extrude a closed 2-D profile [(u, v)] along a 3-D path.

    The frame at each path point is: t = tangent, n = normals[i] made
    orthogonal to t, b = t x n (flipped to agree with `side` when given).
    Profile u runs along b, v along n.
    """
    count = len(path)
    if count < 2:
        return []          # e.g. a projected strip that missed the body entirely
    rings = []
    for i, p in enumerate(path):
        if closed:
            t = path[(i + 1) % count] - path[i - 1]
        elif i == 0:
            t = path[1] - path[0]
        elif i == count - 1:
            t = path[-1] - path[-2]
        else:
            t = path[i + 1] - path[i - 1]
        t.normalize()
        n = normals[i] - t * normals[i].dot(t)
        n.normalize()
        b = t.cross(n)
        if side is not None and b.dot(side) < 0:
            b.negate()
        rings.append([bm.verts.new(p + b * u + n * v) for u, v in profile])

    faces = []
    m = len(profile)
    for i in range(count if closed else count - 1):
        r0, r1 = rings[i], rings[(i + 1) % count]
        for j in range(m):
            faces.append(bm.faces.new((r0[j], r0[(j + 1) % m], r1[(j + 1) % m], r1[j])))
    if not closed:
        faces.append(bm.faces.new(rings[0]))
        faces.append(bm.faces.new(rings[-1]))
    for f in faces:
        f.material_index = mat
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    return faces


def lathe(bm, profile, segments, mat, angle_offset=0.0):
    """Revolve a closed (axial_x, radius) loop around the X axis."""
    rings = []
    for i in range(segments):
        a = angle_offset + 2 * math.pi * i / segments
        ca, sa = math.cos(a), math.sin(a)
        rings.append([bm.verts.new((x, r * ca, r * sa)) for x, r in profile])
    faces = []
    m = len(profile)
    for i in range(segments):
        r0, r1 = rings[i], rings[(i + 1) % segments]
        for j in range(m):
            faces.append(bm.faces.new((r0[j], r0[(j + 1) % m], r1[(j + 1) % m], r1[j])))
    for f in faces:
        f.material_index = mat
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    return faces


def extrude_x(bm, poly_yz, x0, x1, mat):
    """Extrude a closed polygon drawn in the YZ plane from x0 to x1."""
    a = [bm.verts.new((x0, y, z)) for y, z in poly_yz]
    b = [bm.verts.new((x1, y, z)) for y, z in poly_yz]
    m = len(poly_yz)
    faces = [bm.faces.new(a), bm.faces.new(b)]
    for j in range(m):
        faces.append(bm.faces.new((a[j], a[(j + 1) % m], b[(j + 1) % m], b[j])))
    for f in faces:
        f.material_index = mat
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    return faces


def project(bvh, samples, direction, offset=0.003):
    """Shoot rays along `direction` onto the body.

    Returns (points, normals) for the samples that hit, with points lifted
    `offset` off the surface and normals lightly smoothed so strips do not
    twist where they cross facet edges.
    """
    d = Vector(direction).normalized()
    pts, nrm = [], []
    for s in samples:
        hit, n, _, _ = bvh.ray_cast(Vector(s) - d * 3.0, d, 10.0)
        if hit is not None:
            pts.append(hit + n * offset)
            nrm.append(n.copy())
    smooth = []
    for i in range(len(nrm)):
        acc = nrm[i].copy()
        if i > 0:
            acc += nrm[i - 1]
        if i < len(nrm) - 1:
            acc += nrm[i + 1]
        smooth.append(acc.normalized())
    return pts, smooth


def line(a, b, count):
    a, b = Vector(a), Vector(b)
    return [a.lerp(b, i / (count - 1)) for i in range(count)]


class Part:
    """A bmesh plus the material slots its faces use."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.materials = []

    def mat(self, name):
        if name not in self.materials:
            self.materials.append(name)
        return self.materials.index(name)

    def to_mesh(self, materials, smooth_angle=None):
        me = tag(bpy.data.meshes.new(self.name))
        self.bm.to_mesh(me)
        self.bm.free()
        for name in self.materials:
            me.materials.append(materials[name])
        if smooth_angle is not None:
            me.shade_smooth()
            me.set_sharp_from_angle(angle=math.radians(smooth_angle))
        return me


def new_object(name, data, collection, parent=None, location=(0, 0, 0)):
    obj = bpy.data.objects.new(name, data)
    collection.objects.link(obj)
    obj.parent = parent
    obj.location = location
    return obj


def new_empty(name, collection, parent=None, location=(0, 0, 0), size=0.15, shape="PLAIN_AXES"):
    obj = new_object(name, None, collection, parent, location)
    obj.empty_display_type = shape
    obj.empty_display_size = size
    return obj


def bake_modifiers(obj):
    """Replace obj.data with its evaluated (modifier-applied) mesh."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    baked = bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph))
    old = obj.data
    obj.modifiers.clear()
    obj.data = tag(baked)
    bpy.data.meshes.remove(old)
    baked.name = obj.name


# --------------------------------------------------------------------------
# Scene housekeeping
# --------------------------------------------------------------------------

def remove_previous_build():
    """Delete everything a previous run created, leaving the user's data alone."""
    for coll_name in (CAR_COLLECTION, PREVIEW_COLLECTION):
        coll = bpy.data.collections.get(coll_name)
        if coll is None:
            continue
        for obj in list(coll.all_objects):
            bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.collections.remove(coll)
    for pool in (bpy.data.meshes, bpy.data.materials, bpy.data.lights,
                 bpy.data.cameras, bpy.data.worlds, bpy.data.node_groups):
        for block in list(pool):
            if block.get(GENERATED_TAG):
                pool.remove(block)


def clear_scene():
    """Headless runs start from Blender's default scene; drop its cube/light/camera."""
    for obj in list(bpy.context.scene.objects):
        bpy.data.objects.remove(obj, do_unlink=True)


def new_collection(name):
    coll = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(coll)
    return coll


# --------------------------------------------------------------------------
# Materials - Principled BSDF only, so everything survives glTF export.
# Names are part of the game contract: the game drives LIGHT_* and NEON_*
# emissive intensity at runtime (brake lights, pulses, liveries).
# --------------------------------------------------------------------------

def principled_material(name, base, metallic=0.0, roughness=0.5, coat=0.0,
                        coat_roughness=0.03, emission=None, strength=0.0):
    mat = bpy.data.materials.get(name)
    if mat is not None:
        bpy.data.materials.remove(mat)
    mat = tag(bpy.data.materials.new(name))
    if bpy.app.version < (5, 0, 0):
        mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    out = nodes.new("ShaderNodeOutputMaterial")
    out.location = (300, 0)
    mat.node_tree.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    bsdf.inputs["Base Color"].default_value = base
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Coat Weight"].default_value = coat
    bsdf.inputs["Coat Roughness"].default_value = coat_roughness
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = emission
        bsdf.inputs["Emission Strength"].default_value = strength
    mat.diffuse_color = emission if emission is not None else base   # solid-view colour
    mat.metallic = metallic
    mat.roughness = roughness
    return mat


def build_materials(spec):
    neon, accent = srgb(spec.neon), srgb(spec.accent)
    head, tail = srgb(spec.headlight), srgb(spec.taillight)

    def dim(c, k):
        return (c[0] * k, c[1] * k, c[2] * k, 1.0)

    return {
        "CAR_Paint": principled_material("CAR_Paint", srgb(spec.paint), metallic=0.7,
                                         roughness=0.32, coat=1.0, coat_roughness=0.03),
        # Opaque black glass: sharp reflections, no transparency sorting, no interior needed.
        "CAR_Glass": principled_material("CAR_Glass", srgb("#05070c"), roughness=0.02),
        "CAR_Trim": principled_material("CAR_Trim", srgb("#121216"), metallic=0.3, roughness=0.45),
        "CAR_Underbody": principled_material("CAR_Underbody", srgb("#0b0b0d"), roughness=0.9),
        "WHEEL_Tire": principled_material("WHEEL_Tire", srgb("#1a1a1d"), roughness=0.85),
        "WHEEL_Rim": principled_material("WHEEL_Rim", srgb("#5a5c66"), metallic=1.0, roughness=0.22),
        "NEON_Primary": principled_material("NEON_Primary", dim(neon, 0.3), roughness=0.3,
                                            emission=neon, strength=12.0),
        "NEON_Secondary": principled_material("NEON_Secondary", dim(accent, 0.3), roughness=0.3,
                                              emission=accent, strength=12.0),
        "LIGHT_Head": principled_material("LIGHT_Head", dim(head, 0.5), roughness=0.2,
                                          emission=head, strength=18.0),
        "LIGHT_Tail": principled_material("LIGHT_Tail", dim(tail, 0.4), roughness=0.2,
                                          emission=tail, strength=7.0),
    }


# --------------------------------------------------------------------------
# Body
# --------------------------------------------------------------------------

def build_body(spec, mats, coll, root):
    """Loft the stations into a closed shell, bevel the creases, cut the arches."""
    part = Part("BODY")
    bm = part.bm
    paint, glass = part.mat("CAR_Paint"), part.mat("CAR_Glass")
    trim, under = part.mat("CAR_Trim"), part.mat("CAR_Underbody")

    rings, hull_points = [], []
    for s, bottom, sill, shoulder, belt, top, crown, _zone in STATIONS:
        y = spec.y_at(s)
        left = [bottom, sill, shoulder, belt, top]
        ring = [(0.0, bottom[1])] + left + [(0.0, crown)] + [(-w, z) for w, z in reversed(left)]
        rings.append([bm.verts.new((x, y, z)) for x, z in ring])
        hull_points += [(x, y, z) for x, z in ring]

    # Profile edge j of a ring: 0 floor, 1 lower chamfer, 2-3 flanks,
    # 4 side glass / fender chamfer, 5 top surface (mirrored for j > 5).
    faces = []
    n = len(rings[0])
    for i in range(len(rings) - 1):
        zone = STATIONS[i][7]
        r0, r1 = rings[i], rings[i + 1]
        for j in range(n):
            f = bm.faces.new((r0[j], r0[(j + 1) % n], r1[(j + 1) % n], r1[j]))
            edge = j if j <= 5 else n - 1 - j
            if edge == 0:
                f.material_index = under
            elif edge == 1:
                f.material_index = trim
            elif edge == 4 and zone in SIDE_GLASS_ZONES:
                f.material_index = glass
            elif edge == 5 and zone in TOP_GLASS_ZONES:
                f.material_index = glass
            else:
                f.material_index = paint
            faces.append(f)
    for cap in (rings[0], rings[-1]):
        f = bm.faces.new(cap)
        f.material_index = trim
        faces.append(f)
    bmesh.ops.recalc_face_normals(bm, faces=faces)

    body = new_object("BODY", part.to_mesh(mats), coll, root)

    # Wheel-arch cutters: one cylinder per wheel, stopping short of the
    # centre-line so each arch gets an inner wall instead of a tunnel.
    cut = bmesh.new()
    for y, track, width in ((spec.front_axle_y, spec.track_front, spec.tire_width_front),
                            (spec.rear_axle_y, spec.track_rear, spec.tire_width_rear)):
        x_in = track / 2 - width / 2 - 0.05
        x_out = 1.4
        for side in (1, -1):
            centre = Vector((side * (x_in + x_out) / 2, y, spec.wheel_radius))
            geom = bmesh.ops.create_cone(
                cut, cap_ends=True, segments=40, radius1=spec.arch_radius,
                radius2=spec.arch_radius, depth=x_out - x_in,
                matrix=Matrix.Translation(centre) @ Matrix.Rotation(math.pi / 2, 4, "Y"))
            for f in {f for v in geom["verts"] for f in v.link_faces}:
                f.material_index = under          # arch liners use the underbody slot
    cutter_mesh = tag(bpy.data.meshes.new("ARCH_cutter"))
    cut.to_mesh(cutter_mesh)
    cut.free()
    cutter = new_object("ARCH_cutter", cutter_mesh, coll)
    cutter.hide_render = True
    cutter.display_type = "WIRE"

    bevel = body.modifiers.new("crease_bevel", "BEVEL")
    bevel.width = 0.012
    bevel.segments = 2
    bevel.limit_method = "ANGLE"
    bevel.angle_limit = math.radians(28)
    boolean = body.modifiers.new("wheel_arches", "BOOLEAN")
    boolean.operation = "DIFFERENCE"
    boolean.solver = "EXACT"
    boolean.material_mode = "INDEX"
    boolean.object = cutter
    bake_modifiers(body)
    bpy.data.objects.remove(cutter, do_unlink=True)
    bpy.data.meshes.remove(cutter_mesh)

    body.data.shade_smooth()
    body.data.set_sharp_from_angle(angle=math.radians(30))
    return body, hull_points


def body_bvh(body):
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bvh = BVHTree.FromBMesh(bm)
    bm.free()
    return bvh


# --------------------------------------------------------------------------
# Aero + trim: over-fenders, splitter, diffuser, GT wing
# --------------------------------------------------------------------------

def build_aero(spec, mats, coll, root):
    part = Part("BODY_aero")
    bm = part.bm
    trim, paint = part.mat("CAR_Trim"), part.mat("CAR_Paint")

    # Widebody over-fenders framing each arch. Profile u = X (outward), v = radial.
    for y, track, width in ((spec.front_axle_y, spec.track_front, spec.tire_width_front),
                            (spec.rear_axle_y, spec.track_rear, spec.tire_width_rear)):
        x_out = track / 2 + width / 2 + 0.025
        x_in = 0.86
        r_in = spec.arch_radius - 0.004
        profile = [(x_in, 0.0), (x_out - 0.012, 0.0), (x_out, 0.012),
                   (x_out, 0.03), (x_out - 0.03, 0.058), (x_in, 0.058)]
        for side in (1, -1):
            path, normals = [], []
            for k in range(25):
                a = math.radians(-18 + 216 * k / 24)
                radial = Vector((0.0, math.cos(a), math.sin(a)))
                path.append(Vector((0.0, y, spec.wheel_radius)) + radial * r_in)
                normals.append(radial)
            sweep(bm, path, normals, profile, paint, side=Vector((side, 0, 0)))

    # Front splitter: a thin blade under the nose, with end plates tying it to the body.
    nose_y = spec.y_at(0.0)
    splitter = [(nose_y - 0.06, 0.095), (nose_y + 0.40, 0.095), (nose_y + 0.40, 0.118),
                (nose_y + 0.02, 0.118), (nose_y - 0.06, 0.108)]
    extrude_x(bm, splitter, -0.86, 0.86, trim)
    end_plate = [(nose_y - 0.06, 0.095), (nose_y + 0.30, 0.095), (nose_y + 0.30, 0.22), (nose_y + 0.10, 0.24)]
    for side in (1, -1):
        extrude_x(bm, end_plate, side * 0.84, side * 0.855, trim)

    # Mirror pods on short stalks at the base of the A-pillar.
    mirror_y = spec.y_at(1.55)
    pod = [(mirror_y - 0.05, 0.875), (mirror_y + 0.07, 0.865), (mirror_y + 0.055, 0.915), (mirror_y - 0.02, 0.92)]
    stalk = [(mirror_y + 0.0, 0.79), (mirror_y + 0.05, 0.79), (mirror_y + 0.04, 0.88), (mirror_y + 0.01, 0.88)]
    for side in (1, -1):
        extrude_x(bm, pod, side * 0.93, side * 1.035, paint)
        extrude_x(bm, stalk, side * 0.90, side * 0.95, trim)

    # Rear diffuser: five vertical strakes under the tail.
    tail_y = spec.y_at(STATIONS[-1][0])
    for x in (-0.52, -0.26, 0.0, 0.26, 0.52):
        strake = [(tail_y - 0.55, 0.13), (tail_y + 0.02, 0.10), (tail_y + 0.02, 0.27), (tail_y - 0.55, 0.15)]
        extrude_x(bm, strake, x - 0.008, x + 0.008, trim)

    # GT wing: inverted aerofoil, end plates, swan-neck uprights.
    chord, le_y, le_z, aoa = 0.34, spec.y_at(4.02), 1.09, math.radians(-9)
    foil = [(0.0, 0.0), (0.04, -0.018), (0.14, -0.025), (0.34, -0.004),
            (0.34, 0.004), (0.14, 0.008), (0.04, 0.008)]
    foil = [(le_y + u * math.cos(aoa) - v * math.sin(aoa), le_z - u * math.sin(aoa) + v * math.cos(aoa))
            for u, v in ((u * chord / 0.34, v) for u, v in foil)]
    extrude_x(bm, foil, -0.86, 0.86, trim)
    plate = [(le_y - 0.06, 1.02), (le_y + chord + 0.06, 1.05), (le_y + chord + 0.04, 1.21), (le_y + 0.02, 1.16)]
    for side in (1, -1):
        extrude_x(bm, plate, side * 0.86, side * 0.875, trim)
        neck = [(le_y + 0.16, 0.86), (le_y + 0.30, 0.86), (le_y + 0.20, 1.06), (le_y + 0.10, 1.07)]
        extrude_x(bm, neck, side * 0.40, side * 0.418, trim)

    obj = new_object("BODY_aero", part.to_mesh(mats, smooth_angle=30), coll, root)
    return obj, dict(wing_te=(le_y + chord * math.cos(aoa), le_z - chord * math.sin(aoa)))


# --------------------------------------------------------------------------
# Light bars and neon strips, projected onto the finished body
# --------------------------------------------------------------------------

def build_lights(spec, mats, coll, root, bvh):
    part = Part("BODY_lights")
    bm = part.bm
    head, tail = part.mat("LIGHT_Head"), part.mat("LIGHT_Tail")

    # Full-width headlight blade across the nose, wrapping the corners.
    pts, nrm = project(bvh, line((-0.80, -4, 0.43), (0.80, -4, 0.43), 33), (0, 1, 0))
    sweep(bm, pts, nrm, rect(0.032, 0.012, -0.004), head)
    # Angled "eye" slits above the blade, sweeping up into the fenders.
    for side in (1, -1):
        pts, nrm = project(bvh, line((side * 0.46, -4, 0.49), (side * 0.84, -4, 0.555), 12), (0, 1, 0))
        sweep(bm, pts, nrm, rect(0.014, 0.012, -0.004), head)

    # Full-width tail bar plus a thinner second line below it.
    for z, h in ((0.74, 0.04), (0.665, 0.012)):
        pts, nrm = project(bvh, line((-0.86, 4, z), (0.86, 4, z), 33), (0, -1, 0))
        sweep(bm, pts, nrm, rect(h, 0.012, -0.004), tail)

    return new_object("BODY_lights", part.to_mesh(mats), coll, root)


def build_neon(spec, mats, coll, root, bvh, wing_te):
    part = Part("BODY_neon")
    bm = part.bm
    primary, secondary = part.mat("NEON_Primary"), part.mat("NEON_Secondary")

    front_gap = spec.front_axle_y + spec.arch_radius + 0.12
    rear_gap = spec.rear_axle_y - spec.arch_radius - 0.12
    for side in (1, -1):
        inward = (-side, 0, 0)
        # Diagonal slash across the door, rising toward the rear.
        pts, nrm = project(bvh, line((side * 2, front_gap + 0.05, 0.30),
                                     (side * 2, rear_gap - 0.02, 0.60), 24), inward)
        sweep(bm, pts, nrm, rect(0.02, 0.008, -0.004), secondary)
        # Underglow strip on the lower chamfer between the arches.
        pts, nrm = project(bvh, line((side * 2, front_gap, 0.16), (side * 2, rear_gap, 0.16), 24), inward)
        sweep(bm, pts, nrm, rect(0.016, 0.008, -0.004), primary)

    # Splitter lip and wing trailing edge.
    nose_y = spec.y_at(0.0)
    tube = circle(0.006, 8)
    lip = line((-0.84, nose_y - 0.072, 0.101), (0.84, nose_y - 0.072, 0.101), 2)
    sweep(bm, lip, [Vector((0, 0, 1))] * 2, tube, primary)
    te_y, te_z = wing_te
    te = line((-0.85, te_y + 0.004, te_z), (0.85, te_y + 0.004, te_z), 2)
    sweep(bm, te, [Vector((0, 0, 1))] * 2, tube, secondary)

    return new_object("BODY_neon", part.to_mesh(mats), coll, root)


# --------------------------------------------------------------------------
# Wheels - one mesh per axle, shared by left and right. Outer face is +X;
# right-side wheels rotate the mesh node 180 deg about Z (never negative scale).
# --------------------------------------------------------------------------

def build_wheel_mesh(spec, mats, name, width):
    part = Part(name)
    bm = part.bm
    tire, rim = part.mat("WHEEL_Tire"), part.mat("WHEEL_Rim")
    brake, neon = part.mat("CAR_Trim"), part.mat("NEON_Primary")
    R, rb, hw = spec.wheel_radius, spec.rim_radius, width / 2

    # Tyre with two circumferential grooves.
    lathe(bm, [
        (-hw + 0.014, rb - 0.004), (-hw + 0.002, rb + 0.018), (-hw - 0.004, rb + 0.050),
        (-hw + 0.006, R - 0.014), (-hw + 0.026, R),
        (-0.055, R), (-0.055, R - 0.008), (-0.040, R - 0.008), (-0.040, R),
        (0.040, R), (0.040, R - 0.008), (0.055, R - 0.008), (0.055, R),
        (hw - 0.026, R), (hw - 0.006, R - 0.014), (hw + 0.004, rb + 0.050),
        (hw - 0.002, rb + 0.018), (hw - 0.014, rb - 0.004),
    ], 48, tire)
    # Rim barrel, outer lip, brake disc, hub and centre-lock nut.
    lathe(bm, [(-hw + 0.02, rb - 0.018), (hw - 0.035, rb - 0.018),
               (hw - 0.035, rb - 0.006), (-hw + 0.02, rb - 0.006)], 48, rim)
    lathe(bm, [(hw - 0.036, rb - 0.03), (hw - 0.012, rb - 0.03), (hw - 0.004, rb - 0.018),
               (hw - 0.004, rb + 0.006), (hw - 0.02, rb + 0.012), (hw - 0.036, rb + 0.006)], 48, rim)
    lathe(bm, [(hw - 0.15, 0.09), (hw - 0.12, 0.09), (hw - 0.12, 0.20), (hw - 0.15, 0.20)], 32, brake)
    lathe(bm, [(hw - 0.10, 0.02), (hw - 0.058, 0.02), (hw - 0.058, 0.085), (hw - 0.10, 0.085)], 24, rim)
    lathe(bm, [(hw - 0.06, 0.004), (hw - 0.03, 0.004), (hw - 0.03, 0.032), (hw - 0.06, 0.032)], 6, rim)
    # Glowing ring on the lip face.
    ring = [(hw - 0.002 + u, rb - 0.006 + v) for u, v in circle(0.005, 6)]
    lathe(bm, ring, 48, neon)

    # Six curved, dished spokes: recessed at the hub, flush at the lip.
    for k in range(6):
        base = 2 * math.pi * k / 6
        path = []
        for i in range(8):
            t = i / 7
            r = 0.07 + (rb - 0.095) * t
            a = base + 0.35 * t
            x = hw - 0.075 + 0.045 * math.sin(t * math.pi / 2)
            path.append(Vector((x, r * math.cos(a), r * math.sin(a))))
        sweep(bm, path, [Vector((1, 0, 0))] * len(path), rect(0.03, 0.028, -0.016), rim)

    return part.to_mesh(mats, smooth_angle=40)


def build_wheels(spec, mats, coll, root):
    front = build_wheel_mesh(spec, mats, "wheel_front", spec.tire_width_front)
    rear = build_wheel_mesh(spec, mats, "wheel_rear", spec.tire_width_rear)
    corners = [
        ("FL", 1, spec.front_axle_y, spec.track_front, front),
        ("FR", -1, spec.front_axle_y, spec.track_front, front),
        ("RL", 1, spec.rear_axle_y, spec.track_rear, rear),
        ("RR", -1, spec.rear_axle_y, spec.track_rear, rear),
    ]
    for corner, side, y, track, mesh in corners:
        # Pivot = suspension/steer node; its child mesh node is what spins.
        pivot = new_empty(f"WHEEL_{corner}", coll, root, (side * track / 2, y, spec.wheel_radius),
                          size=0.25, shape="CIRCLE")
        wheel = new_object(f"WHEEL_{corner}_mesh", mesh, coll, pivot)
        if side < 0:
            wheel.rotation_euler = (0, 0, math.pi)


# --------------------------------------------------------------------------
# Game data: collider, sockets, root metadata
# --------------------------------------------------------------------------

def build_collider(hull_points, coll, root):
    bm = bmesh.new()
    for p in hull_points:
        bm.verts.new(p)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.001)
    result = bmesh.ops.convex_hull(bm, input=bm.verts)
    dead = {g for g in result["geom_interior"] + result["geom_unused"] if isinstance(g, bmesh.types.BMVert)}
    bmesh.ops.delete(bm, geom=list(dead), context="VERTS")
    me = tag(bpy.data.meshes.new("COL_body"))
    bm.to_mesh(me)
    bm.free()
    col = new_object("COL_body", me, coll, root)
    col.display_type = "WIRE"
    col.hide_render = True
    col["collider"] = "convex_hull"
    return col


def build_sockets(spec, coll, root):
    nose_y, tail_y = spec.y_at(0.0), spec.y_at(STATIONS[-1][0])
    sockets = {
        "SOCKET_headlight_L": (0.62, nose_y + 0.04, 0.43),
        "SOCKET_headlight_R": (-0.62, nose_y + 0.04, 0.43),
        "SOCKET_taillight": (0.0, tail_y + 0.02, 0.74),
        "SOCKET_underglow": (0.0, 0.0, 0.08),
        "SOCKET_exhaust_L": (0.36, tail_y + 0.02, 0.22),
        "SOCKET_exhaust_R": (-0.36, tail_y + 0.02, 0.22),
        "SOCKET_cam_target": (0.0, 0.3, 0.95),
    }
    for name, loc in sockets.items():
        new_empty(name, coll, root, loc, size=0.08, shape="SPHERE")


def write_metadata(spec, root):
    """Custom properties -> glTF `extras` -> three.js `userData`."""
    root["asset_type"] = "vehicle"
    root["asset_id"] = spec.asset_id
    root["pipeline_version"] = 1
    root["mass_kg"] = spec.mass_kg
    root["wheelbase"] = spec.wheelbase
    root["track_front"] = spec.track_front
    root["track_rear"] = spec.track_rear
    root["wheel_radius"] = spec.wheel_radius
    root["tire_width_front"] = spec.tire_width_front
    root["tire_width_rear"] = spec.tire_width_rear


# --------------------------------------------------------------------------
# Build + export
# --------------------------------------------------------------------------

def build_car(spec):
    coll = new_collection(CAR_COLLECTION)
    mats = build_materials(spec)
    root = new_empty(spec.asset_id, coll, size=0.6, shape="ARROWS")
    write_metadata(spec, root)

    body, hull_points = build_body(spec, mats, coll, root)
    bvh = body_bvh(body)
    _, info = build_aero(spec, mats, coll, root)
    build_lights(spec, mats, coll, root, bvh)
    build_neon(spec, mats, coll, root, bvh, info["wing_te"])
    build_wheels(spec, mats, coll, root)
    build_collider(hull_points, coll, root)
    build_sockets(spec, coll, root)
    return root, coll


def export_glb(path, coll, root):
    path = os.path.abspath(path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    for obj in bpy.context.view_layer.objects:
        obj.select_set(False)
    for obj in coll.all_objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_extras=True,       # custom properties -> userData
        export_cameras=False,
        export_lights=False,
        export_animations=False,
    )
    print(f"[cyberpunk_car] exported {path}")


# --------------------------------------------------------------------------
# Preview stage - wet street, neon signage, camera. Never exported.
# --------------------------------------------------------------------------

def build_preview(spec):
    coll = new_collection(PREVIEW_COLLECTION)
    scene = bpy.context.scene

    world = tag(bpy.data.worlds.new("PREVIEW_night"))
    if bpy.app.version < (5, 0, 0):
        world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = srgb("#07080f")
    bg.inputs["Strength"].default_value = 0.5
    scene.world = world

    # Wet asphalt: noise-driven puddles (mirror-smooth) in rough tarmac.
    ground = principled_material("PREVIEW_WetAsphalt", srgb("#101014"), roughness=0.4)
    nt = ground.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    coords = nt.nodes.new("ShaderNodeTexCoord")
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 0.35
    noise.inputs["Detail"].default_value = 6.0
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.46
    ramp.color_ramp.elements[0].color = (0.03, 0.03, 0.03, 1)
    ramp.color_ramp.elements[1].position = 0.56
    ramp.color_ramp.elements[1].color = (0.42, 0.42, 0.42, 1)
    grain = nt.nodes.new("ShaderNodeTexNoise")
    grain.inputs["Scale"].default_value = 60.0
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.08
    nt.links.new(coords.outputs["Object"], noise.inputs["Vector"])
    nt.links.new(coords.outputs["Object"], grain.inputs["Vector"])
    nt.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Roughness"])
    nt.links.new(grain.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])

    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=40.0)
    me = tag(bpy.data.meshes.new("PREVIEW_ground"))
    bm.to_mesh(me)
    bm.free()
    me.materials.append(ground)
    new_object("PREVIEW_ground", me, coll)

    # Background: a dark building face with neon signage to reflect in the paint.
    def slab(name, size, loc, mat):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Translation(loc) @ Matrix.Diagonal((*size, 1)))
        me = tag(bpy.data.meshes.new(name))
        bm.to_mesh(me)
        bm.free()
        me.materials.append(mat)
        new_object(name, me, coll)

    wall = principled_material("PREVIEW_Wall", srgb("#0d0e14"), roughness=0.7)
    pink = principled_material("PREVIEW_SignPink", srgb("#ff2bd6"), emission=srgb("#ff2bd6"), strength=25)
    cyan = principled_material("PREVIEW_SignCyan", srgb("#00e5ff"), emission=srgb("#00e5ff"), strength=25)
    amber = principled_material("PREVIEW_SignAmber", srgb("#ffb000"), emission=srgb("#ffb000"), strength=20)
    slab("PREVIEW_wall", (30, 1, 16), (0, 9, 8), wall)
    slab("PREVIEW_sign_a", (0.35, 0.2, 5.0), (-4.5, 8.4, 4.5), pink)
    slab("PREVIEW_sign_b", (6.0, 0.2, 0.3), (3.5, 8.4, 5.8), cyan)
    slab("PREVIEW_sign_c", (0.25, 0.2, 2.2), (6.8, 8.4, 3.0), amber)
    slab("PREVIEW_sign_d", (3.0, 0.2, 0.2), (-1.0, 8.4, 2.6), cyan)

    def area(name, colour, energy, size, loc, target, size_y=None):
        light = tag(bpy.data.lights.new(name, "AREA"))
        light.color = srgb(colour)[:3]
        light.energy = energy
        light.size = size
        if size_y is not None:
            light.shape = "RECTANGLE"
            light.size_y = size_y
        obj = new_object(name, light, coll, location=loc)
        obj.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()

    area("PREVIEW_key_cyan", "#27d8ff", 600, 3.0, (6.0, -3.5, 3.0), (0, 0, 0.5))
    area("PREVIEW_rim_pink", "#ff2bd6", 600, 2.0, (-5.0, 6.0, 3.2), (0, 0, 0.6))
    # Long soft strip the flanks reflect toward the camera - shows the body shape.
    area("PREVIEW_flank", "#3a6bff", 350, 7.0, (6.5, 6.0, 1.6), (0, 0, 0.5), size_y=1.0)
    area("PREVIEW_top", "#8a7dff", 300, 4.0, (0, 1.5, 4.5), (0, 0.5, 0), size_y=2.0)

    cam_data = tag(bpy.data.cameras.new("PREVIEW_camera"))
    cam_data.lens = 42
    cam = new_object("PREVIEW_camera", cam_data, coll, location=(5.2, -6.0, 1.25))
    cam.rotation_euler = (Vector((0.3, 0.25, 0.45)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
    return coll


def setup_render(scene, samples):
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 900
    scene.view_settings.view_transform = "AgX"
    try:
        scene.view_settings.look = "AgX - Punchy" if bpy.app.version < (4, 3, 0) else "Punchy"
    except TypeError:
        pass
    add_bloom(scene)


def add_bloom(scene):
    """Neon needs bloom. Cycles has none, so add a compositor glare pass."""
    if hasattr(scene, "compositing_node_group"):            # Blender 5.0+
        tree = tag(bpy.data.node_groups.new("PREVIEW_bloom", "CompositorNodeTree"))
        tree.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        layers = tree.nodes.new("CompositorNodeRLayers")
        glare = tree.nodes.new("CompositorNodeGlare")
        glare.inputs["Type"].default_value = "Bloom"
        glare.inputs["Threshold"].default_value = 1.0
        glare.inputs["Size"].default_value = 0.4
        glare.inputs["Strength"].default_value = 0.8
        out = tree.nodes.new("NodeGroupOutput")
        tree.links.new(layers.outputs["Image"], glare.inputs["Image"])
        tree.links.new(glare.outputs["Image"], out.inputs["Image"])
        scene.compositing_node_group = tree
    else:
        scene.use_nodes = True
        tree = scene.node_tree
        tree.nodes.clear()
        layers = tree.nodes.new("CompositorNodeRLayers")
        glare = tree.nodes.new("CompositorNodeGlare")
        glare.glare_type = "FOG_GLOW"
        glare.threshold = 1.0
        glare.size = 7
        glare.quality = "HIGH"
        out = tree.nodes.new("CompositorNodeComposite")
        tree.links.new(layers.outputs["Image"], glare.inputs["Image"])
        tree.links.new(glare.outputs["Image"], out.inputs["Image"])


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------

def parse_args(argv):
    # Blender passes its own arguments through sys.argv; ours follow "--".
    # Without "--" (standalone `bpy` module, or Run Script in the UI) take what
    # we recognise and ignore the rest, e.g. the path of the open .blend file.
    argv = argv[argv.index("--") + 1:] if "--" in argv else argv[1:]
    parser = argparse.ArgumentParser(prog="cyberpunk_car.py", allow_abbrev=False)
    parser.add_argument("--export", metavar="PATH")
    parser.add_argument("--preview", action="store_true", default=None)
    parser.add_argument("--no-preview", dest="preview", action="store_false")
    parser.add_argument("--render", metavar="PATH")
    parser.add_argument("--samples", type=int, default=96)
    parser.add_argument("--paint")
    parser.add_argument("--neon")
    parser.add_argument("--accent")
    return parser.parse_known_args(argv)[0]


def main(argv=None):
    if bpy.app.version < (4, 2, 0):
        raise RuntimeError("cyberpunk_car.py needs Blender 4.2 LTS or newer")
    args = parse_args(sys.argv if argv is None else argv)

    spec = CarSpec()
    for field_name in ("paint", "neon", "accent"):
        if getattr(args, field_name):
            setattr(spec, field_name, getattr(args, field_name))

    if bpy.app.background:
        clear_scene()
    remove_previous_build()
    root, coll = build_car(spec)

    if args.export:
        export_glb(args.export, coll, root)

    preview = args.preview
    if preview is None:
        preview = bool(args.render) or not bpy.app.background
    if preview:
        build_preview(spec)
    if args.render:
        scene = bpy.context.scene
        setup_render(scene, args.samples)
        scene.render.filepath = os.path.abspath(args.render)
        if args.render.lower().endswith((".jpg", ".jpeg")):
            scene.render.image_settings.file_format = "JPEG"
            scene.render.image_settings.quality = 90
        bpy.ops.render.render(write_still=True)
        print(f"[cyberpunk_car] rendered {scene.render.filepath}")


if __name__ == "__main__":
    main()

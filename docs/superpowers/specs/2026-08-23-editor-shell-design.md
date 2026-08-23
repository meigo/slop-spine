# Editor shell — design

Status: approved for implementation, 2026-08-23.
Amends `2026-08-23-unified-view-design.md`: this **replaces increment 2**. Do not build the
Drawing/Rig tree toggle.

## The problem

Increment 1 made the *canvas* one place (bone is a tool). The *panels* still mode-switch:
`App.svelte` shows `RigPanel` xor `LayerPanel` based on `ui.tool`. Binding lives on the rig
panel as a per-layer checkbox list, so the layer it refers to is hidden at the only moment
the list is on screen. The inspector then talks about two objects at once — a leftover layer
and the bone you just clicked — so selection feels desynced even when the data is fine.

The checkboxes lie: empty means “all bones, reach does the scoping,” which reads as “nothing
is bound.” Binding is working; the UI says it isn’t.

A real redraw bug sits under that. Canvas’s `$effect` lists `doc.bones`, `doc.density`, and
layer pixels, but not `doc.binds` or `slot.density`. Ticking a bind box or dragging the
per-slot density slider does not schedule a redraw.

Layer-row `draggable="true"` captures the opacity slider. Delete is a tiny ✕ next to the
bone name, only on that swapped panel. Bone edits are not on the undo stack.

## What it is

The editor becomes one place you can see and edit:

- **Canvas** shows drawings, bones, and meshes as three independent overlays.
- **Layer list** never goes away.
- **Inspector** shows whichever subject you last clicked — a layer or a bone — never both.
- Bone edits undo. Delete is a real action.

The tool still only decides what a click on the canvas *does*.

## Canvas overlays

Three flags on `ui`, not saved:

| Flag | Default | What it hides |
|---|---|---|
| `showDrawings` | true | all layer pixels (per-layer eyes still apply when this is on) |
| `showBones` | true | bone sticks |
| `showMeshes` | false | mesh wireframes |

Toolbar: three toggles, next to the tools. They replace the single eye.

**Bone-tool exception:** bones stay drawn under the bone tool even if `showBones` is off —
you cannot edit what you cannot see. Drawings and meshes follow their toggles under every
tool, including bone.

Bones stay faint under a paint tool, full opacity under the bone tool (already the case).

**Bone-tool chrome, not a fourth overlay:** weight tint (selected bone) and the reach
capsule/handle. Off when the tool is not `bone`. Independent of `showMeshes`.

Slot derivation still skips when nothing needs a mesh: run it when `showMeshes` is on or
when bone-tool chrome (tint) is on. Bones-only still passes no slots.

## Panels

Right dock, stacked, always both:

```
[ canvas                    ] [ layer list ]
                              [ inspector  ]
```

`App.svelte` stops picking a panel by tool. The bone tool does not replace the layer list.

### Layer list

Same data as today. Interaction copied from slop-animator’s *grip*, not its 1000-line panel:

- A grip handle is the only `draggable` target. Opacity slider, name, eye, delete, clear
  are not.
- Native HTML5 drag-and-drop as today — do not add `sortablejs` (no groups to justify it).
- Selected layer stays highlighted as the **paint target**, even while the inspector is
  showing a bone.

### Inspector — one subject

Two selections exist because painting needs a layer while you click bones:

- `ui.selectedLayerId` — paint target; highlighted in the list.
- `ui.selectedBone` — canvas bone pick.

The inspector shows **one** of them, inferred, no extra flag:

- `selectedBone` set → bone inspector
- else if `selectedLayerId` set → layer inspector
- else blank

| Last click | Effect |
|---|---|
| a layer row | select that layer, **clear** `selectedBone` → layer inspector |
| a bone on canvas | select that bone, paint target unchanged → bone inspector |
| empty canvas (bone tool) | clear `selectedBone` → layer inspector if a layer is still selected |

Clicking a layer never opens bone fields. Clicking a bone never shows density or any
layer/slot controls.

**Layer inspector:** density slider writes that slot's override; the reset control clears
it so the slot inherits `doc.density`. Opacity stays on the layer row. Changing the
document-wide default is not a control in this increment (new layers still inherit 24).

**Bone inspector:** name, parent dropdown, wobble, a real Delete button (not ✕). Reach stays
the on-canvas handle.

## Bind checkboxes

Removed from the UI. Reach scopes weights. `doc.binds` stays in the document (empty arrays,
existing override lists still honoured by `deriveSlot`) so project files do not migrate.
`setBind` can stay. No control writes it.

Overlapping geometry that reach cannot separate is out of this increment. So is a “layer
hangs from” control for `Slot.bone` (still `"root"` for user-created layers).

## Delete and undo

**Delete/Backspace** removes the selected bone (and its descendants, same as `removeBone`
today) when:

- a bone is selected, and
- the focus is not in a text field (name input).

Layer delete stays the trash button. Do not add a keyboard shortcut for layers in this
increment.

**Undo/redo covers bone mutations.** One history stack, already used for pixels and layer
delete. Wrap: `addBone`, `moveBone`, `setBoneLength`, `setBoneRotation`, `removeBone`,
`setParent`, `renameBone`, `setWobble`, `setReach`.

A pointer-drag is **one** undo step, not one per `pointermove`. Snapshot on pointerdown;
push on pointerup if anything changed. Shift-drag create is one step covering the new
bone, its final length/rotation, and the reach seed at drag end. Same coalesce for the
wobble slider: one step per press-drag-release, not per `input` event.

Layer reorder: push one undo step on drop, while the grip-drag is being rewritten.

## Redraw

Canvas’s `$effect` stops listing fields by hand. Walk the document the same way
`App.svelte` already does for autosave (`JSON.stringify(doc)`), plus the UI flags
(`tool`, the three `show*` toggles, `selectedBone`, `selectedLayerId`), `poseDrag`, and
container size. A bind change, a density override, or a new bone field added next month
must redraw without anyone remembering to name it.

`layer.canvas` still contributes `{}`; pixels stay tracked by `layer.revision`.

## Out of scope

Select/transform/lasso, pose as a tool (alt-drag stays), dynamics, insert-a-bone-in-a-chain,
drag-to-reparent, the Drawing/Rig tree, mesh rows, bind override UI, `Slot.bone` dropdown,
export `boneCount: 0` guard.

## Verification

Look at it:

1. Bone tool does not hide the layer list. Opacity slider moves opacity, not the row.
2. Three toggles hide drawings / bones / meshes independently. Bone tool still shows bones
   when the bones toggle is off.
3. Click a layer → inspector is density. Click a bone → inspector is that bone, layer row
   stays highlighted, no bind checkboxes anywhere.
4. Delete/Backspace removes the selected bone; undo brings it back. Drag a bone, undo once
   — the whole drag reverts, not one pointermove.
5. Change a slot density slider: mesh overlay updates without nudging a bone.

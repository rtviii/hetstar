import type { FC } from "react";
import { DefaultPluginUISpec, type PluginUISpec } from "molstar/lib/mol-plugin-ui/spec";
import { PluginSpec } from "molstar/lib/mol-plugin/spec";
import { PluginBehaviors } from "molstar/lib/mol-plugin/behavior";

// A component that renders nothing, used to strip Mol*'s viewport button strip
// (reset / expand / settings / screenshot / illumination) off the canvas entirely.
const NoViewportControls: FC = () => null;

// The viewer's plugin spec: Mol*'s default spec with every panel and the viewport control
// strip hidden, and the default
// behavior list REPLACED so clicks belong to the app. Omitted on purpose:
//  - Representation.FocusLoci + StructureFocusRepresentation (click focus + the
//    ball-and-stick "neighborhood" overlay it draws),
//  - Camera.FocusLoci (the camera fly-to on every click),
//  - DefaultLociLabelProvider (the hover label toast; the lab renders its own readout),
//  - State.SnapshotControls, Camera.CameraControls (keyboard shortcuts) and the optional
//    CustomProps providers the lab never reads.
// Kept: hover highlight marking, SelectLoci (inert outside selection mode; harmless and
// available for programmatic marking later), the axes gizmo, StructureInfo, and
// CustomProps.Interactions — it registers the InteractionsProvider custom property and
// the "interactions" representation the selection-bonds overlay uses (autoAttach off:
// the property computes on demand for the overlay component only, never for a whole
// ensemble frame; tooltip off: the lab renders its own hover readout).
export const labViewerSpec: PluginUISpec = {
  ...DefaultPluginUISpec(),
  layout: {
    initial: { isExpanded: false, showControls: false, controlsDisplay: "reactive" },
  },
  behaviors: [
    // mark: false — the behavior keeps feeding hover events, but the MARKING moves to
    // the app (HetstarViewer's hover subscription): the raw pick loci include the
    // transparency-hidden ghost conformers, which the outline postprocessing would
    // trace; the app marks visibility-filtered loci instead.
    PluginSpec.Behavior(PluginBehaviors.Representation.HighlightLoci, { mark: false }),
    PluginSpec.Behavior(PluginBehaviors.Representation.SelectLoci),
    PluginSpec.Behavior(PluginBehaviors.Camera.CameraAxisHelper),
    PluginSpec.Behavior(PluginBehaviors.CustomProps.StructureInfo),
    PluginSpec.Behavior(PluginBehaviors.CustomProps.Interactions, { autoAttach: false, showTooltip: false }),
  ],
  components: {
    controls: { top: "none", bottom: "none", left: "none", right: "none" },
    viewport: { controls: NoViewportControls },
    remoteState: "none",
  },
};

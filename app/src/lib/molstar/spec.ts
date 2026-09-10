import type { FC } from "react";
import { DefaultPluginUISpec, type PluginUISpec } from "molstar/lib/mol-plugin-ui/spec";
import { PluginSpec } from "molstar/lib/mol-plugin/spec";
import { PluginBehaviors } from "molstar/lib/mol-plugin/behavior";

// Default plugin spec with the surrounding UI chrome hidden — we drive the plugin
// programmatically and only want the 3D canvas + its viewport controls. Keeps all
// of Mol*'s default behaviours (HighlightLoci, SelectLoci, etc.).
export const viewerSpec: PluginUISpec = {
  ...DefaultPluginUISpec(),
  layout: {
    initial: { isExpanded: false, showControls: false, controlsDisplay: "reactive" },
  },
  components: {
    controls: { bottom: "none" },
    remoteState: "none",
  },
};

// A component that renders nothing — used to strip Mol*'s viewport button strip
// (reset / expand / settings / screenshot / illumination) off the canvas entirely.
const NoViewportControls: FC = () => null;

// Chrome-free spec for the proposal explainer's inline figures: on top of the default
// hidden panels, the viewport control strip is removed. The camera axes gizmo is turned
// off separately (canvas3d props, viewer.ts) since it lives on the canvas, not the UI.
export const proposalViewerSpec: PluginUISpec = {
  ...viewerSpec,
  components: {
    controls: { top: "none", bottom: "none", left: "none", right: "none" },
    viewport: { controls: NoViewportControls },
    remoteState: "none",
  },
};

// Spec for the compare lab: chrome-free like the proposal spec, but with the default
// behavior list REPLACED so clicks belong to the app. Omitted on purpose:
//  - Representation.FocusLoci + StructureFocusRepresentation (click focus + the
//    ball-and-stick "neighborhood" overlay it draws),
//  - Camera.FocusLoci (the camera fly-to on every click),
//  - DefaultLociLabelProvider (the hover label toast; the lab renders its own readout),
//  - State.SnapshotControls, Camera.CameraControls (keyboard shortcuts) and the optional
//    CustomProps providers the lab never reads.
// Kept: hover highlight marking, SelectLoci (inert outside selection mode; harmless and
// available for programmatic marking later), the axes gizmo, StructureInfo.
export const labViewerSpec: PluginUISpec = {
  ...viewerSpec,
  behaviors: [
    PluginSpec.Behavior(PluginBehaviors.Representation.HighlightLoci, { mark: true }),
    PluginSpec.Behavior(PluginBehaviors.Representation.SelectLoci),
    PluginSpec.Behavior(PluginBehaviors.Camera.CameraAxisHelper),
    PluginSpec.Behavior(PluginBehaviors.CustomProps.StructureInfo),
  ],
  components: {
    controls: { top: "none", bottom: "none", left: "none", right: "none" },
    viewport: { controls: NoViewportControls },
    remoteState: "none",
  },
};

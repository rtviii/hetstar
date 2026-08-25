import type { FC } from "react";
import { DefaultPluginUISpec, type PluginUISpec } from "molstar/lib/mol-plugin-ui/spec";

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

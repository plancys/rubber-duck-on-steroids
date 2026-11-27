import { useReactFlow } from "@xyflow/react";
import { Maximize, ZoomIn, ZoomOut } from "lucide-react";
import type { LayoutBounds } from "@/lib/topic-map-layout";

interface Props {
  // The area of the map. The fit button shows all of it, also the arcs that React Flow does not count.
  bounds: LayoutBounds;
}

const MOVE_MS = 200;
const buttonClass =
  "flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full border border-border bg-card px-3 text-sm font-semibold text-card-foreground transition-colors hover:bg-secondary";

/**
 * The zoom and fit buttons of the map. They replace the controls of React Flow, which are smaller than 44 px.
 * The component must be inside a ReactFlowProvider.
 */
export default function MapControls({ bounds }: Props) {
  const { zoomIn, zoomOut, fitBounds } = useReactFlow();

  return (
    <div role="group" aria-label="Map view" data-testid="topic-map-controls" className="flex flex-wrap gap-2">
      <button
        type="button"
        aria-label="Zoom in"
        title="Zoom in"
        className={buttonClass}
        onClick={() => void zoomIn({ duration: MOVE_MS })}
      >
        <ZoomIn className="size-5" aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label="Zoom out"
        title="Zoom out"
        className={buttonClass}
        onClick={() => void zoomOut({ duration: MOVE_MS })}
      >
        <ZoomOut className="size-5" aria-hidden="true" />
      </button>
      <button
        type="button"
        className={buttonClass}
        onClick={() => void fitBounds(bounds, { padding: 0.05, duration: MOVE_MS })}
      >
        <Maximize className="size-5" aria-hidden="true" />
        Whole map
      </button>
    </div>
  );
}

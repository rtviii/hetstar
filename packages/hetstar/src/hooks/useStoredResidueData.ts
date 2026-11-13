"use client";
import { useCallback, useMemo, useRef, useState } from "react";
import { storedResidueTracks } from "@dynamic-pdb/hetkit/metrics";
import { fetchModelResidueData } from "../lib/dpdb/client";
import type { StoredTracks } from "../lib/lab/metric-engine";

export interface StoredResidueData {
  /** by model id: no entry until the catalogue has answered, null when the model has no stored rows */
  tracks: ReadonlyMap<string, StoredTracks | null>;
  /** fetch a model's stored residue data unless it is already here or on its way */
  request(entryId: string, modelId: string): void;
}

/** The catalogue's stored per-residue values of the models in use, fetched once each and one
 * request at a time. Most models have none: only deposited models carry rows. */
export function useStoredResidueData(): StoredResidueData {
  const [tracks, setTracks] = useState<ReadonlyMap<string, StoredTracks | null>>(new Map());
  const claimed = useRef(new Set<string>());
  const queue = useRef<Promise<void>>(Promise.resolve());

  const request = useCallback((entryId: string, modelId: string) => {
    if (claimed.current.has(modelId)) return;
    claimed.current.add(modelId);
    queue.current = queue.current.then(async () => {
      let stored: StoredTracks | null = null;
      try {
        const rows = await fetchModelResidueData(entryId, modelId);
        const built = storedResidueTracks(rows);
        stored = Object.keys(built).length ? built : null;
      } catch (e) {
        console.warn(`stored residue data of ${modelId} could not be read:`, e);
      }
      setTracks((prev) => new Map(prev).set(modelId, stored));
    });
  }, []);

  return useMemo(() => ({ tracks, request }), [tracks, request]);
}

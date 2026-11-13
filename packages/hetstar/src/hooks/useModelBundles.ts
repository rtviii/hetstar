"use client";
import { useCallback, useMemo, useRef, useState } from "react";
import type { LoadableModel } from "../lib/dpdb/types";
import { loadModelBundle, type ModelBundle } from "../lib/lab/model-bundle";

export type BundleState =
  | { status: "loading" }
  | { status: "ready"; bundle: ModelBundle }
  | { status: "error"; message: string };

export interface ModelBundles {
  /** by model id, for the entry loaded since the last reset */
  states: ReadonlyMap<string, BundleState>;
  /** drop everything (a new entry is loading); returns the token later seeds must present */
  reset(): number;
  /** hand over a bundle built elsewhere (the main view's own models); ignored after a newer reset */
  seed(bundle: ModelBundle, token: number): void;
  /** fetch and build a model's bundle unless it is already here or on its way */
  request(model: LoadableModel): void;
}

/** The parsed model files of the loaded entry, fetched once each and shared by every consumer. */
export function useModelBundles(): ModelBundles {
  const [states, setStates] = useState<ReadonlyMap<string, BundleState>>(new Map());
  const generation = useRef(0);
  const claimed = useRef(new Set<string>());

  const put = useCallback((id: string, state: BundleState) => {
    setStates((prev) => new Map(prev).set(id, state));
  }, []);

  const reset = useCallback(() => {
    generation.current += 1;
    claimed.current.clear();
    setStates(new Map());
    return generation.current;
  }, []);

  const seed = useCallback(
    (bundle: ModelBundle, token: number) => {
      if (token !== generation.current) return;
      claimed.current.add(bundle.model.id);
      put(bundle.model.id, { status: "ready", bundle });
    },
    [put],
  );

  const request = useCallback(
    (model: LoadableModel) => {
      if (claimed.current.has(model.id)) return;
      claimed.current.add(model.id);
      const token = generation.current;
      put(model.id, { status: "loading" });
      loadModelBundle(model).then(
        (bundle) => {
          if (token === generation.current) put(model.id, { status: "ready", bundle });
        },
        (e) => {
          if (token !== generation.current) return;
          // unclaimed again, so the next request retries
          claimed.current.delete(model.id);
          put(model.id, { status: "error", message: e instanceof Error ? e.message : String(e) });
        },
      );
    },
    [put],
  );

  return useMemo(() => ({ states, reset, seed, request }), [states, reset, seed, request]);
}

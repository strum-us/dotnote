import { useCallback, useEffect, useState } from "react";

import {
  DEFAULT_IMAGE_OPTIMIZATION_SETTINGS,
  loadImageSettingsFromStorage,
  saveImageSettingsToStorage,
  type ImageOptimizationSettings,
} from "@/lib/image-settings";

type Listener = (settings: ImageOptimizationSettings) => void;

let cached: ImageOptimizationSettings | null = null;
const listeners = new Set<Listener>();

function publish(settings: ImageOptimizationSettings): void {
  cached = settings;
  for (const listener of listeners) listener(settings);
}

export function useImageSettings() {
  const [settings, setSettings] = useState<ImageOptimizationSettings>(
    () => cached ?? loadImageSettingsFromStorage(),
  );
  const [loading, setLoading] = useState(!cached);

  useEffect(() => {
    const listener: Listener = (next) => setSettings(next);
    listeners.add(listener);
    if (!cached) {
      const loaded = loadImageSettingsFromStorage();
      cached = loaded;
      setSettings(loaded);
      setLoading(false);
    }
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const save = useCallback(async (patch: Partial<ImageOptimizationSettings>) => {
    const next = saveImageSettingsToStorage({
      ...(cached ?? DEFAULT_IMAGE_OPTIMIZATION_SETTINGS),
      ...patch,
    });
    publish(next);
    return next;
  }, []);

  return { settings, loading, save };
}

/** Display width of the markdown page (`max-w-3xl` minus horizontal padding). */
export const IMAGE_CONTENT_MAX_WIDTH_CSS_PX = 740;
export const RETINA_DEVICE_PIXEL_RATIO = 2;
export const IMAGE_MAX_WIDTH_MIN_PX = 320;
export const IMAGE_MAX_WIDTH_MAX_PX = 4000;
export const IMAGE_OPTIMIZE_DIMENSION_TOLERANCE_PX = 4;

export const IMAGE_SIZE_LEVELS = ["original", "1x", "2x"] as const;
export type ImageSizeLevel = (typeof IMAGE_SIZE_LEVELS)[number];

export const IMAGE_QUALITY_PRESETS = [0.95, 0.9, 0.75, 0.6] as const;
export type ImageQuality = (typeof IMAGE_QUALITY_PRESETS)[number];

export const IMAGE_OUTPUT_FORMATS = ["webp", "png"] as const;
export type ImageOutputFormat = (typeof IMAGE_OUTPUT_FORMATS)[number];

export type ImageOptimizationSettings = {
  format: ImageOutputFormat;
  sizeLevel: ImageSizeLevel;
  quality: ImageQuality;
  maxWidth: number;
};

export const DEFAULT_IMAGE_OPTIMIZATION_SETTINGS: ImageOptimizationSettings = {
  format: "webp",
  sizeLevel: "2x",
  quality: 0.9,
  maxWidth: IMAGE_CONTENT_MAX_WIDTH_CSS_PX,
};

const STORAGE_KEY = "dotnote:image-settings";

export function clampImageMaxWidth(value: number): number {
  return Math.min(IMAGE_MAX_WIDTH_MAX_PX, Math.max(IMAGE_MAX_WIDTH_MIN_PX, Math.round(value)));
}

export function isImageSizeLevel(value: unknown): value is ImageSizeLevel {
  return (IMAGE_SIZE_LEVELS as readonly string[]).includes(value as string);
}

export function isImageOutputFormat(value: unknown): value is ImageOutputFormat {
  return (IMAGE_OUTPUT_FORMATS as readonly string[]).includes(value as string);
}

export function isImageQuality(value: unknown): value is ImageQuality {
  if (typeof value === "number") {
    return (IMAGE_QUALITY_PRESETS as readonly number[]).includes(value);
  }
  if (typeof value === "string") {
    return isImageQuality(Number.parseFloat(value));
  }
  return false;
}

export function parseImageSettings(value: unknown): ImageOptimizationSettings {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_IMAGE_OPTIMIZATION_SETTINGS };
  }
  const raw = value as Record<string, unknown>;
  const format = isImageOutputFormat(raw.format)
    ? raw.format
    : DEFAULT_IMAGE_OPTIMIZATION_SETTINGS.format;
  const sizeLevel = isImageSizeLevel(raw.sizeLevel)
    ? raw.sizeLevel
    : DEFAULT_IMAGE_OPTIMIZATION_SETTINGS.sizeLevel;
  const quality = isImageQuality(raw.quality)
    ? ((typeof raw.quality === "number"
        ? raw.quality
        : Number.parseFloat(String(raw.quality))) as ImageQuality)
    : DEFAULT_IMAGE_OPTIMIZATION_SETTINGS.quality;
  const parsedWidth =
    typeof raw.maxWidth === "number"
      ? raw.maxWidth
      : typeof raw.maxWidth === "string"
        ? Number.parseFloat(raw.maxWidth)
        : Number.NaN;
  const maxWidth = Number.isFinite(parsedWidth)
    ? clampImageMaxWidth(parsedWidth)
    : DEFAULT_IMAGE_OPTIMIZATION_SETTINGS.maxWidth;
  return { format, sizeLevel, quality, maxWidth };
}

export function loadImageSettingsFromStorage(): ImageOptimizationSettings {
  if (typeof window === "undefined") return { ...DEFAULT_IMAGE_OPTIMIZATION_SETTINGS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_IMAGE_OPTIMIZATION_SETTINGS };
    return parseImageSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_IMAGE_OPTIMIZATION_SETTINGS };
  }
}

export function saveImageSettingsToStorage(settings: ImageOptimizationSettings): ImageOptimizationSettings {
  const next = parseImageSettings(settings);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
  return next;
}

export function shouldResizeImageToTargetWidth(
  widthPx: number,
  targetWidthPx: number | undefined,
  tolerancePx: number = IMAGE_OPTIMIZE_DIMENSION_TOLERANCE_PX,
): boolean {
  if (targetWidthPx === undefined) return false;
  return widthPx > targetWidthPx + tolerancePx;
}

export function maxWidthOrHeightForTargetWidthPx(
  widthPx: number,
  heightPx: number,
  targetWidthPx: number,
): number {
  if (widthPx <= 0) return targetWidthPx;
  const scale = targetWidthPx / widthPx;
  return Math.max(targetWidthPx, Math.round(heightPx * scale));
}

export function maxWidthForSizeLevel(
  level: ImageSizeLevel,
  pageMaxWidth: number = DEFAULT_IMAGE_OPTIMIZATION_SETTINGS.maxWidth,
): number | undefined {
  const width = clampImageMaxWidth(pageMaxWidth);
  switch (level) {
    case "original":
      return undefined;
    case "1x":
      return width;
    case "2x":
      return width * RETINA_DEVICE_PIXEL_RATIO;
  }
}

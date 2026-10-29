import { SettingsField, SettingsSectionShell } from "@/components/settings/SettingsSectionShell";
import { FieldSelect } from "@/components/ui/field-select";
import { Input } from "@/components/ui/input";
import { useImageSettings } from "@/hooks/useImageSettings";
import {
  IMAGE_MAX_WIDTH_MAX_PX,
  IMAGE_MAX_WIDTH_MIN_PX,
  type ImageOutputFormat,
  type ImageQuality,
  type ImageSizeLevel,
} from "@/lib/image-settings";

const qualityOptions = [
  { value: "0.95", label: "High (95%)" },
  { value: "0.9", label: "Balanced (90%)" },
  { value: "0.75", label: "Medium (75%)" },
  { value: "0.6", label: "Small (60%)" },
];

export function ImageSettings() {
  const { settings, save } = useImageSettings();
  const isWebp = settings.format === "webp";

  return (
    <SettingsSectionShell
      title="Images"
      description="Format and compression applied when pasting or uploading images into notes."
    >
      <SettingsField
        label="Format"
        hint="Original keeps PNG without resizing. WebP compresses and can scale down by width."
      >
        <FieldSelect
          value={settings.format}
          onValueChange={(v) => void save({ format: v as ImageOutputFormat })}
          options={[
            { value: "webp", label: "WebP (compressed)" },
            { value: "png", label: "Original (PNG)" },
          ]}
        />
      </SettingsField>
      {isWebp ? (
        <>
          <SettingsField
            label="Max width"
            hint="Page content width in CSS pixels. Standard uses this width; Retina uses 2×."
          >
            <Input
              type="number"
              min={IMAGE_MAX_WIDTH_MIN_PX}
              max={IMAGE_MAX_WIDTH_MAX_PX}
              value={settings.maxWidth}
              onChange={(e) => {
                const next = Number.parseInt(e.target.value, 10);
                if (Number.isFinite(next)) void save({ maxWidth: next });
              }}
            />
          </SettingsField>
          <SettingsField label="Resolution" hint="Images wider than this limit are scaled down before saving as WebP.">
            <FieldSelect
              value={settings.sizeLevel}
              onValueChange={(v) => void save({ sizeLevel: v as ImageSizeLevel })}
              options={[
                { value: "original", label: "Original (no resize)" },
                { value: "1x", label: `Standard (${settings.maxWidth}px wide)` },
                { value: "2x", label: `Retina (${settings.maxWidth * 2}px wide)` },
              ]}
            />
          </SettingsField>
          <SettingsField label="WebP quality" hint="Higher quality keeps more detail and a larger file.">
            <FieldSelect
              value={String(settings.quality)}
              onValueChange={(v) => void save({ quality: Number.parseFloat(v) as ImageQuality })}
              options={qualityOptions}
            />
          </SettingsField>
        </>
      ) : null}
    </SettingsSectionShell>
  );
}

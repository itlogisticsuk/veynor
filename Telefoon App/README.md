# Veynor AR Volume Scanner - iPhone MVP

Native iPhone MVP for measuring furniture volume with ARKit.

## What this version does

This is not fully automatic yet. It is the first realistic native step:

1. Open scanner.
2. Tap 2 points for length.
3. Tap 2 points for width/depth.
4. Tap 2 points for height.
5. App calculates m³ automatically.
6. Save result to Supabase/Veynor.

This avoids manual tape-measure entry, but still keeps the user in control.

## Requirements

- Mac with Xcode
- iPhone with ARKit support
- For best results: iPhone Pro with LiDAR
- Real device required. ARKit does not work properly in simulator.

## Xcode setup

1. Create a new Xcode project:
   - iOS App
   - Interface: SwiftUI
   - Language: Swift
   - Name: VeynorARVolumeScanner

2. Add these files to the project:
   - VeynorARVolumeScannerApp.swift
   - ContentView.swift
   - ARMeasureView.swift
   - SupabaseConfig.swift

3. In `Info.plist`, add:

```xml
<key>NSCameraUsageDescription</key>
<string>Camera is required to measure product dimensions using AR.</string>
```

4. In `SupabaseConfig.swift`, fill in:
   - SUPABASE_URL
   - SUPABASE_ANON_KEY

5. Supabase table:

```sql
create table if not exists public.volume_scans (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  sku_reference text,
  length_cm numeric,
  width_cm numeric,
  height_cm numeric,
  volume_m3 numeric,
  confidence text,
  source text,
  created_at timestamptz default now()
);
```

## Important

This MVP measures distances between tapped AR points. It does not yet automatically detect the full object.

Next step after this MVP:
- automatic object bounding box
- LiDAR mesh scan
- photo + depth storage
- direct product/order linking

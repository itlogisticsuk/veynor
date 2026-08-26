import SwiftUI

struct MeasurementResult {
    var lengthCm: Double = 0
    var widthCm: Double = 0
    var heightCm: Double = 0

    var volumeM3: Double {
        (lengthCm * widthCm * heightCm) / 1_000_000
    }
}

struct ContentView: View {
    @State private var sku: String = ""
    @State private var result = MeasurementResult()
    @State private var currentMode: MeasureMode = .length
    @State private var message: String = ""
    @State private var isSaving = false

    var body: some View {
        ZStack(alignment: .bottom) {
            ARMeasureView(
                currentMode: $currentMode,
                result: $result,
                message: $message
            )
            .ignoresSafeArea()

            VStack(spacing: 12) {
                headerCard
                modeButtons
                resultCard
                saveCard
            }
            .padding()
        }
    }

    private var headerCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Veynor Volume Scanner")
                .font(.title2)
                .fontWeight(.black)

            Text("Tap two points for length, width/depth and height. The app calculates loading m³ automatically.")
                .font(.caption)
                .foregroundColor(.secondary)

            TextField("Product / SKU", text: $sku)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .padding(12)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .padding()
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 20))
    }

    private var modeButtons: some View {
        HStack(spacing: 8) {
            modeButton(.length, "Length")
            modeButton(.width, "Width")
            modeButton(.height, "Height")
        }
    }

    private func modeButton(_ mode: MeasureMode, _ title: String) -> some View {
        Button {
            currentMode = mode
            message = "Tap 2 points for \(title.lowercased())."
        } label: {
            Text(title)
                .font(.caption)
                .fontWeight(.black)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .background(currentMode == mode ? Color.blue : Color.white)
                .foregroundColor(currentMode == mode ? .white : .primary)
                .clipShape(RoundedRectangle(cornerRadius: 14))
        }
    }

    private var resultCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(message.isEmpty ? "Ready to measure." : message)
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundColor(.secondary)

            HStack {
                valueBox("L", result.lengthCm)
                valueBox("W", result.widthCm)
                valueBox("H", result.heightCm)
            }

            HStack {
                VStack(alignment: .leading) {
                    Text("Calculated loading volume")
                        .font(.caption)
                        .fontWeight(.black)
                        .foregroundColor(.secondary)

                    Text(String(format: "%.3f m³", result.volumeM3))
                        .font(.largeTitle)
                        .fontWeight(.black)
                }

                Spacer()

                Button("Reset") {
                    result = MeasurementResult()
                    message = "Measurements cleared."
                }
                .font(.caption)
                .fontWeight(.black)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }
        }
        .padding()
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 20))
    }

    private func valueBox(_ label: String, _ value: Double) -> some View {
        VStack(spacing: 3) {
            Text(label)
                .font(.caption2)
                .fontWeight(.black)
                .foregroundColor(.secondary)

            Text(String(format: "%.1f cm", value))
                .font(.caption)
                .fontWeight(.black)
        }
        .frame(maxWidth: .infinity)
        .padding(10)
        .background(Color.white.opacity(0.88))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private var saveCard: some View {
        Button {
            Task { await saveScan() }
        } label: {
            HStack {
                if isSaving {
                    ProgressView()
                        .tint(.white)
                }

                Text(isSaving ? "Saving..." : "Save Volume Scan")
                    .fontWeight(.black)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 15)
            .background(Color.blue)
            .foregroundColor(.white)
            .clipShape(RoundedRectangle(cornerRadius: 16))
        }
        .disabled(isSaving || result.volumeM3 <= 0 || sku.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        .opacity((result.volumeM3 <= 0 || sku.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) ? 0.55 : 1)
    }

    private func saveScan() async {
        guard !sku.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            message = "Enter SKU first."
            return
        }

        isSaving = true
        defer { isSaving = false }

        do {
            try await SupabaseVolumeService.saveVolumeScan(
                sku: sku,
                result: result
            )

            message = "Saved to Supabase: \(String(format: "%.3f", result.volumeM3)) m³"
        } catch {
            message = "Save failed: \(error.localizedDescription)"
        }
    }
}

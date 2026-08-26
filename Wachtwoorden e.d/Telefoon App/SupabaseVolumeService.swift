import Foundation

enum SupabaseVolumeError: Error {
    case invalidUrl
    case badResponse(String)
}

struct SupabaseVolumeService {
    static func saveVolumeScan(sku: String, result: MeasurementResult) async throws {
        guard !SupabaseConfig.supabaseUrl.contains("YOUR_PROJECT"),
              !SupabaseConfig.anonKey.contains("PASTE_") else {
            throw SupabaseVolumeError.badResponse("Fill in SupabaseConfig.swift first.")
        }

        guard let url = URL(string: "\(SupabaseConfig.supabaseUrl)/rest/v1/volume_scans") else {
            throw SupabaseVolumeError.invalidUrl
        }

        var payload: [String: Any] = [
            "sku_reference": sku,
            "length_cm": result.lengthCm,
            "width_cm": result.widthCm,
            "height_cm": result.heightCm,
            "volume_m3": result.volumeM3,
            "confidence": "ar_measurement",
            "source": "ios_arkit"
        ]

        if let companyId = SupabaseConfig.companyId {
            payload["company_id"] = companyId
        }

        let body = try JSONSerialization.data(withJSONObject: payload)

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.httpBody = body
        request.setValue("Bearer \(SupabaseConfig.anonKey)", forHTTPHeaderField: "Authorization")
        request.setValue(SupabaseConfig.anonKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("return=representation", forHTTPHeaderField: "Prefer")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let http = response as? HTTPURLResponse else {
            throw SupabaseVolumeError.badResponse("No HTTP response.")
        }

        guard (200...299).contains(http.statusCode) else {
            let text = String(data: data, encoding: .utf8) ?? "Unknown error"
            throw SupabaseVolumeError.badResponse(text)
        }
    }
}

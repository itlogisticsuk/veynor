import SwiftUI
import ARKit
import SceneKit

enum MeasureMode: String {
    case length
    case width
    case height

    var label: String {
        switch self {
        case .length: return "Length"
        case .width: return "Width"
        case .height: return "Height"
        }
    }
}

struct ARMeasureView: UIViewRepresentable {
    @Binding var currentMode: MeasureMode
    @Binding var result: MeasurementResult
    @Binding var message: String

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeUIView(context: Context) -> ARSCNView {
        let view = ARSCNView(frame: .zero)
        view.delegate = context.coordinator
        view.automaticallyUpdatesLighting = true
        view.scene = SCNScene()

        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handleTap(_:)))
        view.addGestureRecognizer(tap)

        let configuration = ARWorldTrackingConfiguration()
        configuration.planeDetection = [.horizontal, .vertical]

        if ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) {
            configuration.sceneReconstruction = .mesh
        }

        if ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) {
            configuration.frameSemantics.insert(.sceneDepth)
        }

        view.session.run(configuration, options: [.resetTracking, .removeExistingAnchors])

        DispatchQueue.main.async {
            message = "Move iPhone slowly. Tap 2 points for \(currentMode.label.lowercased())."
        }

        return view
    }

    func updateUIView(_ uiView: ARSCNView, context: Context) {
        context.coordinator.parent = self
    }

    final class Coordinator: NSObject, ARSCNViewDelegate {
        var parent: ARMeasureView
        private var pointsByMode: [MeasureMode: [SCNVector3]] = [
            .length: [],
            .width: [],
            .height: []
        ]

        init(_ parent: ARMeasureView) {
            self.parent = parent
        }

        @objc func handleTap(_ recognizer: UITapGestureRecognizer) {
            guard let view = recognizer.view as? ARSCNView else { return }

            let location = recognizer.location(in: view)
            guard let worldPoint = worldPosition(from: location, in: view) else {
                parent.message = "No surface found. Move slower or aim at a visible edge."
                return
            }

            addMarker(at: worldPoint, in: view)

            var points = pointsByMode[parent.currentMode] ?? []
            if points.count >= 2 {
                points.removeAll()
            }

            points.append(worldPoint)
            pointsByMode[parent.currentMode] = points

            if points.count == 1 {
                parent.message = "\(parent.currentMode.label): first point set. Tap second point."
            }

            if points.count == 2 {
                let distanceMeters = distance(points[0], points[1])
                let distanceCm = Double(distanceMeters * 100)

                drawLine(from: points[0], to: points[1], in: view)

                DispatchQueue.main.async {
                    switch self.parent.currentMode {
                    case .length:
                        self.parent.result.lengthCm = distanceCm
                        self.parent.currentMode = .width
                        self.parent.message = "Length saved. Now tap 2 points for width/depth."
                    case .width:
                        self.parent.result.widthCm = distanceCm
                        self.parent.currentMode = .height
                        self.parent.message = "Width saved. Now tap 2 points for height."
                    case .height:
                        self.parent.result.heightCm = distanceCm
                        self.parent.message = "Height saved. Volume calculated."
                    }
                }
            }
        }

        private func worldPosition(from screenPoint: CGPoint, in view: ARSCNView) -> SCNVector3? {
            if let result = view.raycastQuery(from: screenPoint, allowing: .estimatedPlane, alignment: .any)
                .flatMap({ view.session.raycast($0).first }) {
                let t = result.worldTransform
                return SCNVector3(t.columns.3.x, t.columns.3.y, t.columns.3.z)
            }

            let hitResults = view.hitTest(screenPoint, types: [.featurePoint, .estimatedHorizontalPlane, .estimatedVerticalPlane])
            guard let hit = hitResults.first else { return nil }
            let t = hit.worldTransform
            return SCNVector3(t.columns.3.x, t.columns.3.y, t.columns.3.z)
        }

        private func addMarker(at position: SCNVector3, in view: ARSCNView) {
            let sphere = SCNSphere(radius: 0.012)
            sphere.firstMaterial?.diffuse.contents = UIColor.systemBlue

            let node = SCNNode(geometry: sphere)
            node.position = position
            view.scene.rootNode.addChildNode(node)
        }

        private func drawLine(from start: SCNVector3, to end: SCNVector3, in view: ARSCNView) {
            let source = SCNGeometrySource(vertices: [start, end])
            let element = SCNGeometryElement(indices: [Int32(0), Int32(1)], primitiveType: .line)
            let geometry = SCNGeometry(sources: [source], elements: [element])
            geometry.firstMaterial?.diffuse.contents = UIColor.systemYellow
            geometry.firstMaterial?.isDoubleSided = true

            let node = SCNNode(geometry: geometry)
            view.scene.rootNode.addChildNode(node)
        }

        private func distance(_ a: SCNVector3, _ b: SCNVector3) -> Float {
            let dx = a.x - b.x
            let dy = a.y - b.y
            let dz = a.z - b.z
            return sqrt(dx * dx + dy * dy + dz * dz)
        }
    }
}

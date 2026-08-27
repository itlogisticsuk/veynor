//
//  DriverLocationManager.swift
//  Veynor Driver
//
//  Native background GPS tracking for Veynor.
//
//  Purpose:
//  - Continue location tracking while app is in background
//  - Maintain current live location
//  - Store driven-route GPS history
//  - Avoid unnecessary duplicate GPS points
//  - Detect arrival / unloading / departure near delivery stops
//  - Keep an offline queue if Supabase cannot be reached
//

import Foundation
import CoreLocation
import Combine


// ============================================================
// MARK: - Driver Tracking Context
// ============================================================

struct DriverTrackingContext: Codable, Equatable {

    var driverUserId: String
    var companyId: String

    var routeId: String

    var vehicleId: String?
    var driverName: String?
    var vehicleName: String?


    var isValid: Bool {

        !driverUserId.isEmpty &&
        !companyId.isEmpty &&
        !routeId.isEmpty
    }
}


// ============================================================
// MARK: - Delivery Stop
// ============================================================

struct DriverTrackingStop: Codable, Identifiable, Equatable {

    var id: String

    var orderId: String?

    var stopNumber: Int?

    var customerName: String?

    var latitude: Double
    var longitude: Double


    var location: CLLocation {

        CLLocation(
            latitude: latitude,
            longitude: longitude
        )
    }
}


// ============================================================
// MARK: - GPS History Payload
// ============================================================

struct DriverGPSHistoryPayload: Codable, Identifiable {

    var id: UUID = UUID()

    var driverUserId: String

    var companyId: String

    var routeId: String

    var vehicleId: String?

    var driverName: String?

    var vehicleName: String?

    var latitude: Double

    var longitude: Double

    var accuracyM: Double?

    var speedMps: Double?

    var heading: Double?

    var recordedAt: String


    enum CodingKeys: String, CodingKey {

        case id

        case driverUserId = "driver_user_id"
        case companyId = "company_id"
        case routeId = "route_id"

        case vehicleId = "vehicle_id"

        case driverName = "driver_name"
        case vehicleName = "vehicle_name"

        case latitude
        case longitude

        case accuracyM = "accuracy_m"
        case speedMps = "speed_mps"

        case heading

        case recordedAt = "recorded_at"
    }
}


// ============================================================
// MARK: - Live Location Payload
// ============================================================

struct DriverLiveLocationPayload: Codable {

    var driverUserId: String

    var companyId: String

    var routeId: String

    var vehicleId: String?

    var driverName: String?

    var vehicleName: String?

    var latitude: Double

    var longitude: Double

    var accuracyM: Double?

    var speedMps: Double?

    var heading: Double?

    var trackingActive: Bool

    var recordedAt: String

    var updatedAt: String


    enum CodingKeys: String, CodingKey {

        case driverUserId = "driver_user_id"
        case companyId = "company_id"
        case routeId = "route_id"

        case vehicleId = "vehicle_id"

        case driverName = "driver_name"
        case vehicleName = "vehicle_name"

        case latitude
        case longitude

        case accuracyM = "accuracy_m"
        case speedMps = "speed_mps"

        case heading

        case trackingActive = "tracking_active"

        case recordedAt = "recorded_at"
        case updatedAt = "updated_at"
    }
}


// ============================================================
// MARK: - Stop Tracking State
// ============================================================

private struct StopTrackingState {

    var enteredRadiusAt: Date

    var stationarySince: Date?

    var unloadingDetectedAt: Date?

    var lastDistanceFromStop: CLLocationDistance

    var arrivedReported: Bool = false

    var unloadingReported: Bool = false

    var departedReported: Bool = false
}


// ============================================================
// MARK: - Stop Event
// ============================================================

enum DriverStopEventType: String {

    case arrived

    case unloadingDetected

    case departed
}


struct DriverStopEvent {

    let type: DriverStopEventType

    let stop: DriverTrackingStop

    let date: Date

    let distanceFromStop: CLLocationDistance

    let onSiteSeconds: TimeInterval?
}


// ============================================================
// MARK: - Location Manager
// ============================================================

@MainActor
final class DriverLocationManager:
    NSObject,
    ObservableObject,
    CLLocationManagerDelegate
{

    // ========================================================
    // MARK: Published State
    // ========================================================

    @Published
    private(set)
    var isTracking: Bool = false


    @Published
    private(set)
    var authorizationStatus:
        CLAuthorizationStatus = .notDetermined


    @Published
    private(set)
    var currentLocation: CLLocation?


    @Published
    private(set)
    var pendingGPSCount: Int = 0


    @Published
    private(set)
    var lastError: String?


    // ========================================================
    // MARK: Public callbacks
    // ========================================================

    var onStopEvent:
        ((DriverStopEvent) -> Void)?


    // ========================================================
    // MARK: Core Location
    // ========================================================

    private let locationManager =
        CLLocationManager()


    // ========================================================
    // MARK: Current Route Context
    // ========================================================

    private var trackingContext:
        DriverTrackingContext?


    private var deliveryStops:
        [DriverTrackingStop] = []


    // ========================================================
    // MARK: Supabase
    // ========================================================

    private var supabaseURL: URL?

    private var supabaseAnonKey:
        String = ""

    private var supabaseAccessToken:
        String = ""


    // ========================================================
    // MARK: Tracking Configuration
    // ========================================================

    /// Evaluate route-history storage no more often than
    /// approximately every 10 seconds.
    private let historyMinimumInterval:
        TimeInterval = 10


    /// A new route-history point is stored after at least
    /// this amount of movement.
    private let historyMinimumDistance:
        CLLocationDistance = 20


    /// Current live position can be refreshed every 30 sec.
    private let liveLocationMinimumInterval:
        TimeInterval = 30


    /// Delivery stop detection radius.
    ///
    /// We deliberately use 200m rather than 100m because
    /// delivery locations / warehouses may have large sites
    /// and GPS positions are not always exact.
    private let stopRadius:
        CLLocationDistance = 200


    /// Vehicle must remain effectively stationary for
    /// three minutes before unloading is confirmed.
    private let unloadingDwellTime:
        TimeInterval = 3 * 60


    /// Movement smaller than this is treated as effectively
    /// stationary for unloading detection.
    private let stationaryMovementThreshold:
        CLLocationDistance = 20


    /// Speed below this is considered effectively stationary.
    /// Approximately 2.2 mph.
    private let stationarySpeedThresholdMps:
        CLLocationSpeed = 1.0


    /// Departure is confirmed once sufficiently outside
    /// the stop radius.
    private let departureRadius:
        CLLocationDistance = 230


    /// Ignore very inaccurate GPS fixes.
    private let maximumAcceptableAccuracy:
        CLLocationAccuracy = 100


    // ========================================================
    // MARK: Tracking Runtime State
    // ========================================================

    private var lastHistoryLocation:
        CLLocation?


    private var lastHistorySavedAt:
        Date?


    private var lastLiveSentAt:
        Date?


    private var lastStopEvaluationLocation:
        CLLocation?


    private var stopStates:
        [String: StopTrackingState] = [:]


    // ========================================================
    // MARK: Offline Queue
    // ========================================================

    private var gpsQueue:
        [DriverGPSHistoryPayload] = []


    private let queueFileName =
        "veynor-driver-gps-queue.json"


    // ========================================================
    // MARK: Init
    // ========================================================

    override init() {

        super.init()


        locationManager.delegate =
            self


        locationManager.desiredAccuracy =
            kCLLocationAccuracyBest


        locationManager.activityType =
            .automotiveNavigation


        /*
         * iOS decides when actual GPS callbacks are required.
         *
         * Setting distanceFilter lower than our storage
         * threshold gives us enough information to detect
         * movement without necessarily storing everything.
         */
        locationManager.distanceFilter =
            10


        /*
         * Required for continuous native location tracking
         * while the app is in the background.
         */
        locationManager.allowsBackgroundLocationUpdates =
            true


        /*
         * We are controlling when the route is active,
         * so don't let iOS automatically pause tracking.
         */
        locationManager.pausesLocationUpdatesAutomatically =
            false


        /*
         * Shows the blue iOS location indicator when
         * background tracking is active.
         */
        locationManager.showsBackgroundLocationIndicator =
            true


        authorizationStatus =
            locationManager.authorizationStatus


        loadOfflineQueue()
    }


    // ========================================================
    // MARK: Configure Supabase
    // ========================================================

    func configureSupabase(
        url: String,
        anonKey: String,
        accessToken: String
    ) {

        self.supabaseURL =
            URL(string: url)


        self.supabaseAnonKey =
            anonKey


        self.supabaseAccessToken =
            accessToken
    }


    func updateAccessToken(
        _ accessToken: String
    ) {

        self.supabaseAccessToken =
            accessToken


        Task {

            await syncOfflineGPS()
        }
    }


    // ========================================================
    // MARK: Route Context
    // ========================================================

    func setTrackingContext(
        _ context:
            DriverTrackingContext,
        stops:
            [DriverTrackingStop]
    ) {

        let routeChanged =
            trackingContext?.routeId !=
            context.routeId


        trackingContext =
            context


        deliveryStops =
            stops


        if routeChanged {

            /*
             * Reset route-specific runtime state.
             */
            lastHistoryLocation =
                nil

            lastHistorySavedAt =
                nil

            lastStopEvaluationLocation =
                nil

            stopStates.removeAll()
        }
    }


    func clearTrackingContext() {

        trackingContext =
            nil

        deliveryStops =
            []

        lastHistoryLocation =
            nil

        lastHistorySavedAt =
            nil

        lastStopEvaluationLocation =
            nil

        stopStates.removeAll()
    }


    // ========================================================
    // MARK: Permissions
    // ========================================================

    func requestLocationPermission() {

    let status =
        locationManager.authorizationStatus

    authorizationStatus =
        status

    switch status {

    case .notDetermined:

        /*
         * First request normal foreground permission.
         * iOS handles the upgrade to Always afterwards.
         */
        locationManager
            .requestWhenInUseAuthorization()


    case .authorizedWhenInUse:

        /*
         * Upgrade permission so route tracking can
         * continue while Veynor is in the background.
         */
        locationManager
            .requestAlwaysAuthorization()


    case .authorizedAlways:

        /*
         * Permission already complete.
         */
        break


    case .denied,
         .restricted:

        lastError =
            "Location permission is not available. Please enable Location Services for Veynor Driver in iPhone Settings."


    @unknown default:

        break
    }
}


    // ========================================================
    // MARK: Start Tracking
    // ========================================================

    func startTracking() {

        guard
            let context =
                trackingContext,
            context.isValid
        else {

            lastError =
                "Cannot start tracking: route context is missing."

            return
        }


        let status =
            locationManager
                .authorizationStatus


        authorizationStatus =
            status


        guard
            status ==
                .authorizedAlways ||
            status ==
                .authorizedWhenInUse
        else {

            requestLocationPermission()

            return
        }


        guard
            CLLocationManager
                .locationServicesEnabled()
        else {

            lastError =
                "Location Services are disabled."

            return
        }


        lastError =
            nil


        isTracking =
            true


        locationManager
            .startUpdatingLocation()


        Task {

            await syncOfflineGPS()
        }
    }


    // ========================================================
    // MARK: Stop Tracking
    // ========================================================

    func stopTracking() {

        isTracking =
            false


        locationManager
            .stopUpdatingLocation()


        Task {

            await markLiveLocationInactive()
        }
    }


    // ========================================================
    // MARK: CLLocationManagerDelegate
    // ========================================================

    func locationManagerDidChangeAuthorization(
    _ manager: CLLocationManager
) {

    authorizationStatus =
        manager.authorizationStatus

    switch authorizationStatus {

    case .authorizedWhenInUse:

        /*
         * Foreground permission has been granted.
         * Now request background / Always permission.
         */
        manager
            .requestAlwaysAuthorization()


    case .authorizedAlways:

        /*
         * We can now continue tracking in the background.
         */
        if isTracking {

            manager
                .startUpdatingLocation()
        }


    case .denied,
         .restricted:

        lastError =
            "Location permission denied. Enable Always Location access for Veynor Driver in iPhone Settings."


    case .notDetermined:

        break


    @unknown default:

        break
    }
}


    func locationManager(
        _ manager:
            CLLocationManager,
        didUpdateLocations locations:
            [CLLocation]
    ) {

        guard isTracking else {

            return
        }


        guard
            let location =
                locations.last
        else {

            return
        }


        guard isUsableLocation(
            location
        ) else {

            return
        }


        currentLocation =
            location


        /*
         * Stop detection runs on every usable callback.
         * It is separate from history storage.
         */
        evaluateDeliveryStops(
            location
        )


        /*
         * History and live updates happen asynchronously.
         */
        Task {

            await processLocation(
                location
            )
        }
    }


    func locationManager(
        _ manager:
            CLLocationManager,
        didFailWithError error:
            Error
    ) {

        lastError =
            error.localizedDescription
    }


    // ========================================================
    // MARK: Validate GPS
    // ========================================================

    private func isUsableLocation(
        _ location:
            CLLocation
    ) -> Bool {

        guard
            location
                .horizontalAccuracy >= 0
        else {

            return false
        }


        guard
            location
                .horizontalAccuracy <=
                maximumAcceptableAccuracy
        else {

            return false
        }


        /*
         * Reject very old cached GPS fixes.
         */
        let age =
            abs(
                location
                    .timestamp
                    .timeIntervalSinceNow
            )


        guard age <= 60 else {

            return false
        }


        return true
    }


    // ========================================================
    // MARK: Process GPS
    // ========================================================

    private func processLocation(
        _ location:
            CLLocation
    ) async {

        guard
            let context =
                trackingContext,
            context.isValid
        else {

            return
        }


        /*
         * LIVE LOCATION
         */
        if shouldSendLiveLocation(
            location
        ) {

            await sendLiveLocation(
                location,
                context:
                    context
            )
        }


        /*
         * ROUTE HISTORY
         */
        if shouldStoreHistoryLocation(
            location
        ) {

            let payload =
                makeHistoryPayload(
                    location,
                    context:
                        context
                )


            do {

                try await insertHistoryPayload(
                    payload
                )


                lastHistoryLocation =
                    location


                lastHistorySavedAt =
                    location.timestamp


            } catch {

                /*
                 * Keep the point locally.
                 */
                queueGPSPayload(
                    payload
                )


                lastHistoryLocation =
                    location


                lastHistorySavedAt =
                    location.timestamp
            }
        }


        /*
         * Opportunistically retry offline GPS.
         */
        if !gpsQueue.isEmpty {

            await syncOfflineGPS()
        }
    }


    // ========================================================
    // MARK: Decide History Storage
    // ========================================================

    private func shouldStoreHistoryLocation(
        _ location:
            CLLocation
    ) -> Bool {

        guard
            let previous =
                lastHistoryLocation,
            let previousDate =
                lastHistorySavedAt
        else {

            return true
        }


        let elapsed =
            location
                .timestamp
                .timeIntervalSince(
                    previousDate
                )


        /*
         * Never save faster than about
         * once every 10 seconds.
         */
        guard
            elapsed >=
                historyMinimumInterval
        else {

            return false
        }


        let distance =
            location.distance(
                from:
                    previous
            )


        /*
         * If the vehicle hasn't moved at least
         * 20 metres, don't create another point.
         *
         * When it drives away later, the new point
         * provides the end-time of the stationary period.
         */
        guard
            distance >=
                historyMinimumDistance
        else {

            return false
        }


        return true
    }


    // ========================================================
    // MARK: Decide Live Location
    // ========================================================

    private func shouldSendLiveLocation(
        _ location:
            CLLocation
    ) -> Bool {

        guard
            let last =
                lastLiveSentAt
        else {

            return true
        }


        return
            location
                .timestamp
                .timeIntervalSince(
                    last
                ) >=
            liveLocationMinimumInterval
    }


    // ========================================================
    // MARK: Create GPS History Payload
    // ========================================================

    private func makeHistoryPayload(
        _ location:
            CLLocation,
        context:
            DriverTrackingContext
    ) -> DriverGPSHistoryPayload {

        DriverGPSHistoryPayload(

            driverUserId:
                context
                    .driverUserId,

            companyId:
                context
                    .companyId,

            routeId:
                context
                    .routeId,

            vehicleId:
                context
                    .vehicleId,

            driverName:
                context
                    .driverName,

            vehicleName:
                context
                    .vehicleName,

            latitude:
                location
                    .coordinate
                    .latitude,

            longitude:
                location
                    .coordinate
                    .longitude,

            accuracyM:
                location
                    .horizontalAccuracy >= 0
                    ? location
                        .horizontalAccuracy
                    : nil,

            speedMps:
                location
                    .speed >= 0
                    ? location
                        .speed
                    : nil,

            heading:
                location
                    .course >= 0
                    ? location
                        .course
                    : nil,

            recordedAt:
                isoString(
                    location
                        .timestamp
                )
        )
    }


    // ========================================================
    // MARK: Send GPS History
    // ========================================================

    private func insertHistoryPayload(
        _ payload:
            DriverGPSHistoryPayload
    ) async throws {

        guard
            let baseURL =
                supabaseURL
        else {

            throw TrackingError
                .supabaseNotConfigured
        }


        let url =
            baseURL
                .appendingPathComponent(
                    "rest/v1/driver_location_history"
                )


        var request =
            URLRequest(
                url: url
            )


        request.httpMethod =
            "POST"


        /*
         * Don't send the local UUID "id".
         * Supabase will create its own UUID.
         */
        let body =
            SupabaseGPSInsertPayload(
                payload
            )


        request.httpBody =
            try JSONEncoder()
                .encode(body)


        addSupabaseHeaders(
            to:
                &request
        )


        request.setValue(
            "application/json",
            forHTTPHeaderField:
                "Content-Type"
        )


        request.setValue(
            "return=minimal",
            forHTTPHeaderField:
                "Prefer"
        )


        let (
            data,
            response
        ) =
            try await URLSession
                .shared
                .data(
                    for:
                        request
                )


        try validateResponse(
            data:
                data,
            response:
                response
        )
    }


    // ========================================================
    // MARK: Live Location
    // ========================================================

    private func sendLiveLocation(
        _ location:
            CLLocation,
        context:
            DriverTrackingContext
    ) async {

        guard
            let baseURL =
                supabaseURL
        else {

            return
        }


        let timestamp =
            isoString(
                location
                    .timestamp
            )


        let payload =
            DriverLiveLocationPayload(

                driverUserId:
                    context
                        .driverUserId,

                companyId:
                    context
                        .companyId,

                routeId:
                    context
                        .routeId,

                vehicleId:
                    context
                        .vehicleId,

                driverName:
                    context
                        .driverName,

                vehicleName:
                    context
                        .vehicleName,

                latitude:
                    location
                        .coordinate
                        .latitude,

                longitude:
                    location
                        .coordinate
                        .longitude,

                accuracyM:
                    location
                        .horizontalAccuracy >= 0
                        ? location
                            .horizontalAccuracy
                        : nil,

                speedMps:
                    location
                        .speed >= 0
                        ? location
                            .speed
                        : nil,

                heading:
                    location
                        .course >= 0
                        ? location
                            .course
                        : nil,

                trackingActive:
                    true,

                recordedAt:
                    timestamp,

                updatedAt:
                    timestamp
            )


        let url =
            baseURL
                .appendingPathComponent(
                    "rest/v1/driver_live_locations"
                )


        var components =
            URLComponents(
                url: url,
                resolvingAgainstBaseURL:
                    false
            )


        /*
         * Supabase REST upsert using driver_user_id.
         */
        components?.queryItems = [

            URLQueryItem(
                name:
                    "on_conflict",
                value:
                    "driver_user_id"
            )
        ]


        guard
            let finalURL =
                components?.url
        else {

            return
        }


        var request =
            URLRequest(
                url:
                    finalURL
            )


        request.httpMethod =
            "POST"


        request.httpBody =
            try? JSONEncoder()
                .encode(
                    payload
                )


        addSupabaseHeaders(
            to:
                &request
        )


        request.setValue(
            "application/json",
            forHTTPHeaderField:
                "Content-Type"
        )


        request.setValue(
            "resolution=merge-duplicates,return=minimal",
            forHTTPHeaderField:
                "Prefer"
        )


        do {

            let (
                data,
                response
            ) =
                try await URLSession
                    .shared
                    .data(
                        for:
                            request
                    )


            try validateResponse(
                data:
                    data,
                response:
                    response
            )


            lastLiveSentAt =
                location
                    .timestamp


        } catch {

            /*
             * Live marker failure isn't critical.
             * History is the important permanent data.
             */
            lastError =
                "Live location update failed: \(error.localizedDescription)"
        }
    }


    // ========================================================
    // MARK: Mark Live Location Inactive
    // ========================================================

    private func markLiveLocationInactive() async {

        guard
            let context =
                trackingContext,
            let baseURL =
                supabaseURL
        else {

            return
        }


        var components =
            URLComponents(
                url:
                    baseURL
                        .appendingPathComponent(
                            "rest/v1/driver_live_locations"
                        ),
                resolvingAgainstBaseURL:
                    false
            )


        components?.queryItems = [

            URLQueryItem(
                name:
                    "driver_user_id",
                value:
                    "eq.\(context.driverUserId)"
            )
        ]


        guard
            let url =
                components?.url
        else {

            return
        }


        var request =
            URLRequest(
                url: url
            )


        request.httpMethod =
            "PATCH"


        let payload =
            LiveInactivePayload(

                trackingActive:
                    false,

                updatedAt:
                    isoString(
                        Date()
                    )
            )


        request.httpBody =
            try? JSONEncoder()
                .encode(
                    payload
                )


        addSupabaseHeaders(
            to:
                &request
        )


        request.setValue(
            "application/json",
            forHTTPHeaderField:
                "Content-Type"
        )


        _ =
            try? await URLSession
                .shared
                .data(
                    for:
                        request
                )
    }


    // ========================================================
    // MARK: Delivery Stop Detection
    // ========================================================

    private func evaluateDeliveryStops(
        _ location:
            CLLocation
    ) {

        guard
            !deliveryStops
                .isEmpty
        else {

            return
        }


        let now =
            location.timestamp


        let movementSincePrevious =
            lastStopEvaluationLocation
                .map {
                    location.distance(
                        from: $0
                    )
                } ?? 0


        let speed =
            location.speed >= 0
                ? location.speed
                : 0


        let effectivelyStationary =
            movementSincePrevious <=
                stationaryMovementThreshold &&
            speed <=
                stationarySpeedThresholdMps


        for stop in deliveryStops {

            let distance =
                location.distance(
                    from:
                        stop.location
                )


            /*
             * Inside stop radius.
             */
            if distance <= stopRadius {

                var state =
                    stopStates[
                        stop.id
                    ] ??
                    StopTrackingState(

                        enteredRadiusAt:
                            now,

                        stationarySince:
                            nil,

                        unloadingDetectedAt:
                            nil,

                        lastDistanceFromStop:
                            distance
                    )


                /*
                 * ARRIVED
                 *
                 * First time inside 200m.
                 */
                if !state.arrivedReported {

                    state.arrivedReported =
                        true


                    emitStopEvent(

                        type:
                            .arrived,

                        stop:
                            stop,

                        date:
                            now,

                        distance:
                            distance,

                        onSiteSeconds:
                            nil
                    )
                }


                /*
                 * Detect stationary period.
                 */
                if effectivelyStationary {

                    if
                        state.stationarySince ==
                            nil
                    {

                        state.stationarySince =
                            now
                    }

                } else {

                    /*
                     * Small movement inside the customer site
                     * resets the stationary countdown until
                     * unloading has actually been confirmed.
                     */
                    if
                        state.unloadingDetectedAt ==
                            nil
                    {

                        state.stationarySince =
                            nil
                    }
                }


                /*
                 * UNLOADING DETECTED
                 *
                 * Inside 200m + effectively stationary
                 * for at least 3 minutes.
                 */
                if
                    !state
                        .unloadingReported,
                    let stationarySince =
                        state
                            .stationarySince,
                    now.timeIntervalSince(
                        stationarySince
                    ) >=
                        unloadingDwellTime
                {

                    state
                        .unloadingReported =
                        true


                    state
                        .unloadingDetectedAt =
                        now


                    emitStopEvent(

                        type:
                            .unloadingDetected,

                        stop:
                            stop,

                        date:
                            now,

                        distance:
                            distance,

                        onSiteSeconds:
                            now
                                .timeIntervalSince(
                                    state
                                        .enteredRadiusAt
                                )
                    )
                }


                state
                    .lastDistanceFromStop =
                    distance


                stopStates[
                    stop.id
                ] =
                    state
            }


            /*
             * Outside departure radius.
             */
            else if
                distance >
                    departureRadius,
                var state =
                    stopStates[
                        stop.id
                    ],
                state
                    .arrivedReported,
                !state
                    .departedReported
            {

                state
                    .departedReported =
                    true


                let onSiteSeconds =
                    now.timeIntervalSince(
                        state
                            .enteredRadiusAt
                    )


                emitStopEvent(

                    type:
                        .departed,

                    stop:
                        stop,

                    date:
                        now,

                    distance:
                        distance,

                    onSiteSeconds:
                        onSiteSeconds
                )


                stopStates[
                    stop.id
                ] =
                    state
            }
        }


        lastStopEvaluationLocation =
            location
    }


    // ========================================================
    // MARK: Emit Stop Event
    // ========================================================

    private func emitStopEvent(
        type:
            DriverStopEventType,
        stop:
            DriverTrackingStop,
        date:
            Date,
        distance:
            CLLocationDistance,
        onSiteSeconds:
            TimeInterval?
    ) {

        let event =
            DriverStopEvent(

                type:
                    type,

                stop:
                    stop,

                date:
                    date,

                distanceFromStop:
                    distance,

                onSiteSeconds:
                    onSiteSeconds
            )


        onStopEvent?(
            event
        )


        print(
            """
            [Veynor GPS]
            \(type.rawValue)
            stop: \(stop.customerName ?? stop.id)
            distance: \(Int(distance))m
            """
        )
    }


    // ========================================================
    // MARK: Offline GPS Queue
    // ========================================================

    private func queueGPSPayload(
        _ payload:
            DriverGPSHistoryPayload
    ) {

        /*
         * Prevent accidental duplicates in the local queue.
         */
        guard
            !gpsQueue.contains(
                where: {
                    $0.id ==
                    payload.id
                }
            )
        else {

            return
        }


        gpsQueue.append(
            payload
        )


        pendingGPSCount =
            gpsQueue.count


        saveOfflineQueue()
    }


    func syncOfflineGPS() async {

        guard
            !gpsQueue
                .isEmpty
        else {

            pendingGPSCount =
                0

            return
        }


        guard
            supabaseURL !=
                nil,
            !supabaseAccessToken
                .isEmpty
        else {

            return
        }


        var remaining:
            [DriverGPSHistoryPayload] =
                []


        for payload in gpsQueue {

            do {

                try await insertHistoryPayload(
                    payload
                )

            } catch {

                /*
                 * Keep failed record and everything that
                 * follows. We'll retry later.
                 */
                remaining.append(
                    payload
                )


                lastError =
                    "GPS sync failed: \(error.localizedDescription)"
            }
        }


        gpsQueue =
            remaining


        pendingGPSCount =
            gpsQueue.count


        saveOfflineQueue()
    }


    // ========================================================
    // MARK: Offline Queue File
    // ========================================================

    private var queueFileURL:
        URL? {

        let manager =
            FileManager.default


        guard
            let directory =
                manager.urls(
                    for:
                        .applicationSupportDirectory,
                    in:
                        .userDomainMask
                ).first
        else {

            return nil
        }


        let appDirectory =
            directory
                .appendingPathComponent(
                    "VeynorDriver",
                    isDirectory:
                        true
                )


        try? manager
            .createDirectory(

                at:
                    appDirectory,

                withIntermediateDirectories:
                    true
            )


        return appDirectory
            .appendingPathComponent(
                queueFileName
            )
    }


    private func saveOfflineQueue() {

        guard
            let fileURL =
                queueFileURL
        else {

            return
        }


        do {

            let data =
                try JSONEncoder()
                    .encode(
                        gpsQueue
                    )


            try data.write(

                to:
                    fileURL,

                options:
                    .atomic
            )

        } catch {

            lastError =
                "Unable to save offline GPS queue."
        }
    }


    private func loadOfflineQueue() {

        guard
            let fileURL =
                queueFileURL
        else {

            return
        }


        guard
            FileManager
                .default
                .fileExists(
                    atPath:
                        fileURL.path
                )
        else {

            return
        }


        do {

            let data =
                try Data(
                    contentsOf:
                        fileURL
                )


            gpsQueue =
                try JSONDecoder()
                    .decode(
                        [
                            DriverGPSHistoryPayload
                        ].self,
                        from:
                            data
                    )


            pendingGPSCount =
                gpsQueue.count

        } catch {

            gpsQueue =
                []

            pendingGPSCount =
                0
        }
    }


    // ========================================================
    // MARK: Supabase Headers
    // ========================================================

    private func addSupabaseHeaders(
        to request:
            inout URLRequest
    ) {

        request.setValue(
            supabaseAnonKey,
            forHTTPHeaderField:
                "apikey"
        )


        let token =
            !supabaseAccessToken
                .isEmpty
                ? supabaseAccessToken
                : supabaseAnonKey


        request.setValue(
            "Bearer \(token)",
            forHTTPHeaderField:
                "Authorization"
        )
    }


    // ========================================================
    // MARK: Validate HTTP
    // ========================================================

    private func validateResponse(
        data:
            Data,
        response:
            URLResponse
    ) throws {

        guard
            let http =
                response as?
                    HTTPURLResponse
        else {

            throw TrackingError
                .invalidResponse
        }


        guard
            (200...299)
                .contains(
                    http.statusCode
                )
        else {

            let text =
                String(
                    data:
                        data,
                    encoding:
                        .utf8
                ) ??
                "Unknown Supabase error"


            throw TrackingError
                .serverError(
                    statusCode:
                        http.statusCode,
                    message:
                        text
                )
        }
    }


    // ========================================================
    // MARK: Date
    // ========================================================

    private func isoString(
        _ date:
            Date
    ) -> String {

        Self
            .isoFormatter
            .string(
                from:
                    date
            )
    }


    private static let isoFormatter:
        ISO8601DateFormatter = {

        let formatter =
            ISO8601DateFormatter()


        formatter.formatOptions = [
            .withInternetDateTime,
            .withFractionalSeconds
        ]


        return formatter
    }()
}


// ============================================================
// MARK: - Supabase-only GPS Insert Payload
// ============================================================

private struct SupabaseGPSInsertPayload:
    Codable
{

    var driverUserId:
        String

    var companyId:
        String

    var routeId:
        String

    var vehicleId:
        String?

    var driverName:
        String?

    var vehicleName:
        String?

    var latitude:
        Double

    var longitude:
        Double

    var accuracyM:
        Double?

    var speedMps:
        Double?

    var heading:
        Double?

    var recordedAt:
        String


    init(
        _ payload:
            DriverGPSHistoryPayload
    ) {

        driverUserId =
            payload.driverUserId

        companyId =
            payload.companyId

        routeId =
            payload.routeId

        vehicleId =
            payload.vehicleId

        driverName =
            payload.driverName

        vehicleName =
            payload.vehicleName

        latitude =
            payload.latitude

        longitude =
            payload.longitude

        accuracyM =
            payload.accuracyM

        speedMps =
            payload.speedMps

        heading =
            payload.heading

        recordedAt =
            payload.recordedAt
    }


    enum CodingKeys:
        String,
        CodingKey
    {

        case driverUserId =
            "driver_user_id"

        case companyId =
            "company_id"

        case routeId =
            "route_id"

        case vehicleId =
            "vehicle_id"

        case driverName =
            "driver_name"

        case vehicleName =
            "vehicle_name"

        case latitude
        case longitude

        case accuracyM =
            "accuracy_m"

        case speedMps =
            "speed_mps"

        case heading

        case recordedAt =
            "recorded_at"
    }
}


// ============================================================
// MARK: - Live Inactive Payload
// ============================================================

private struct LiveInactivePayload:
    Codable
{

    var trackingActive:
        Bool

    var updatedAt:
        String


    enum CodingKeys:
        String,
        CodingKey
    {

        case trackingActive =
            "tracking_active"

        case updatedAt =
            "updated_at"
    }
}


// ============================================================
// MARK: - Errors
// ============================================================

enum TrackingError:
    LocalizedError
{

    case supabaseNotConfigured

    case invalidResponse

    case serverError(
        statusCode:
            Int,
        message:
            String
    )


    var errorDescription:
        String?
    {

        switch self {

        case .supabaseNotConfigured:

            return
                "Supabase tracking has not been configured."


        case .invalidResponse:

            return
                "Invalid response from Supabase."


        case let .serverError(
            statusCode,
            message
        ):

            return
                "Supabase error \(statusCode): \(message)"
        }
    }
}
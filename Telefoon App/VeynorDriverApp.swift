//
//  VeynorDriverApp.swift
//  Veynor Driver
//
//  Main entry point for the native
//  Veynor Driver iPhone application.
//

import SwiftUI


// ============================================================
// MARK: - Native App Configuration
// ============================================================

enum VeynorDriverConfig {

    // ========================================================
    // DRIVER WEB APP
    // ========================================================

    /*
     * IMPORTANT:
     *
     * Replace this with the URL of the existing
     * Veynor Driver PWA.
     *
     * This must point to the DRIVER APP,
     * not to the normal Veynor admin portal.
     */

static let driverAppURLString =
    "https://jazzy-tulumba-f137f8.netlify.app/"


    // ========================================================
    // SUPABASE
    // ========================================================

    /*
     * Same Supabase project currently used
     * by the Driver PWA.
     */

    static let supabaseURL =
        "https://giwzwmoaowabhxxxymho.supabase.co"


    /*
     * The Supabase anon key is a public client key.
     *
     * The actual authenticated driver access token
     * will later be supplied by app.js through
     * DriverWebView.swift.
     */

    static let supabaseAnonKey =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdpd3p3bW9hb3dhYmh4eHh5bWhvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxNzg3NzgsImV4cCI6MjA5MTc1NDc3OH0.Iy35MjUDsEOnzlRyqFC1YjxamjGOPSpdUjGiB8rAxV0"


    // ========================================================
    // URL
    // ========================================================

    static var driverAppURL: URL {

        guard
            let url =
                URL(
                    string:
                        driverAppURLString
                )
        else {

            fatalError(
                "Invalid Veynor Driver App URL."
            )
        }


        return url
    }
}


// ============================================================
// MARK: - Veynor Driver App
// ============================================================

@main
struct VeynorDriverApp: App {

    // ========================================================
    // MARK: Native GPS Manager
    // ========================================================

    /*
     * One location manager is created for the whole
     * lifetime of the application.
     *
     * This is important because GPS tracking must not
     * be recreated whenever SwiftUI redraws the screen.
     */

    @StateObject
    private var locationManager =
        DriverLocationManager()


    // ========================================================
    // MARK: App Scene
    // ========================================================

    var body: some Scene {

        WindowGroup {

            VeynorDriverRootView(
                locationManager:
                    locationManager
            )
        }
    }
}


// ============================================================
// MARK: - Root View
// ============================================================

struct VeynorDriverRootView: View {

    @ObservedObject
    var locationManager:
        DriverLocationManager


    var body: some View {

        ZStack {

            // =================================================
            // EXISTING VEYNOR DRIVER PWA
            // =================================================

            DriverWebView(

                locationManager:
                    locationManager,

                driverAppURL:
                    VeynorDriverConfig
                        .driverAppURL
            )
            .ignoresSafeArea()


            // =================================================
            // OPTIONAL NATIVE STATUS OVERLAY
            // =================================================

            /*
             * We deliberately keep this very small.
             *
             * The real user interface remains the
             * existing Driver PWA.
             */

            VStack {

                Spacer()


                if
                    locationManager
                        .pendingGPSCount > 0
                {

                    NativeTrackingStatusView(

                        text:
                            "\(locationManager.pendingGPSCount) GPS points waiting",

                        type:
                            .waiting
                    )
                    .padding(
                        .horizontal,
                        16
                    )
                    .padding(
                        .bottom,
                        88
                    )
                }


                if
                    let error =
                        locationManager
                            .lastError,
                    !error.isEmpty
                {

                    NativeTrackingStatusView(

                        text:
                            error,

                        type:
                            .error
                    )
                    .padding(
                        .horizontal,
                        16
                    )
                    .padding(
                        .bottom,
                        88
                    )
                }
            }
            .allowsHitTesting(
                false
            )
        }


        // =====================================================
        // CONFIGURE NATIVE SUPABASE
        // =====================================================

        .task {

            locationManager
                .configureSupabase(

                    url:
                        VeynorDriverConfig
                            .supabaseURL,

                    anonKey:
                        VeynorDriverConfig
                            .supabaseAnonKey,

                    accessToken:
                        ""
                )
        }
    }
}


// ============================================================
// MARK: - Native Tracking Status
// ============================================================

private enum NativeTrackingStatusType {

    case waiting

    case error
}


private struct NativeTrackingStatusView: View {

    let text:
        String

    let type:
        NativeTrackingStatusType


    var body: some View {

        HStack(
            spacing:
                8
        ) {

            Image(
                systemName:
                    iconName
            )


            Text(
                text
            )
            .font(
                .system(
                    size:
                        12,
                    weight:
                        .bold
                )
            )


            Spacer(
                minLength:
                    0
            )
        }
        .padding(
            .horizontal,
            13
        )
        .padding(
            .vertical,
            10
        )
        .background(
            backgroundColor
        )
        .foregroundColor(
            foregroundColor
        )
        .clipShape(
            RoundedRectangle(
                cornerRadius:
                    12,
                style:
                    .continuous
            )
        )
        .shadow(

            color:
                Color
                    .black
                    .opacity(
                        0.10
                    ),

            radius:
                10,

            x:
                0,

            y:
                4
        )
    }


    private var iconName:
        String
    {

        switch type {

        case .waiting:

            return
                "location.circle"


        case .error:

            return
                "exclamationmark.triangle.fill"
        }
    }


    private var backgroundColor:
        Color
    {

        switch type {

        case .waiting:

            return
                Color
                    .blue
                    .opacity(
                        0.94
                    )


        case .error:

            return
                Color
                    .red
                    .opacity(
                        0.94
                    )
        }
    }


    private var foregroundColor:
        Color
    {

        .white
    }
}
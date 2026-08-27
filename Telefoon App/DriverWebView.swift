//
//  DriverWebView.swift
//  Veynor Driver
//
//  Native WKWebView wrapper around the existing
//  Veynor Driver PWA.
//
//  Responsibilities:
//  - Display existing Driver PWA
//  - Keep normal web/POD functionality
//  - Receive active route context from JavaScript
//  - Receive Supabase access token from JavaScript
//  - Start / stop native background GPS tracking
//  - Pass delivery stops to DriverLocationManager
//

import SwiftUI
import WebKit


// ============================================================
// MARK: - Driver WebView
// ============================================================

struct DriverWebView: UIViewRepresentable {

    @ObservedObject
    var locationManager:
        DriverLocationManager


    /*
     * Change this only if the actual Driver App URL differs.
     *
     * This should point to the DRIVER PWA,
     * not the normal Veynor admin portal.
     */
    let driverAppURL:
        URL


    // ========================================================
    // MARK: Coordinator
    // ========================================================

    func makeCoordinator() -> Coordinator {

        Coordinator(
            locationManager:
                locationManager
        )
    }


    // ========================================================
    // MARK: Create WKWebView
    // ========================================================

    func makeUIView(
        context:
            Context
    ) -> WKWebView {

        let configuration =
            WKWebViewConfiguration()


        configuration
            .allowsInlineMediaPlayback =
            true


        /*
         * Normal persistent website storage.
         *
         * Cookies / Supabase auth / local storage remain
         * available between app launches.
         */
        configuration
            .websiteDataStore =
            .default()


        let contentController =
            WKUserContentController()


        /*
         * Bridge used by app.js:
         *
         * window.webkit.messageHandlers
         *      .veynorNative
         *      .postMessage(...)
         */
        contentController
            .add(
                context
                    .coordinator,
                name:
                    "veynorNative"
            )


        configuration
            .userContentController =
            contentController


        /*
         * Inject a small helper so app.js can easily
         * determine that it is running inside the
         * native iPhone wrapper.
         */
        let nativeBridgeScript =
            WKUserScript(

                source:
                    """
                    window.VEYNOR_NATIVE_APP = true;

                    window.VeynorNative = {

                      post: function(payload) {

                        try {

                          if (
                            window.webkit &&
                            window.webkit.messageHandlers &&
                            window.webkit.messageHandlers.veynorNative
                          ) {

                            window.webkit.messageHandlers
                              .veynorNative
                              .postMessage(payload);

                            return true;
                          }

                        } catch (error) {

                          console.warn(
                            "[Veynor Native Bridge]",
                            error
                          );
                        }

                        return false;
                      },

                      setTrackingContext: function(payload) {

                        return this.post({
                          type: "setTrackingContext",
                          payload: payload
                        });
                      },

                      startTracking: function() {

                        return this.post({
                          type: "startTracking"
                        });
                      },

                      stopTracking: function() {

                        return this.post({
                          type: "stopTracking"
                        });
                      },

                      updateAccessToken: function(token) {

                        return this.post({
                          type: "updateAccessToken",
                          token: token
                        });
                      },

                      clearTrackingContext: function() {

                        return this.post({
                          type: "clearTrackingContext"
                        });
                      }

                    };
                    """,

                injectionTime:
                    .atDocumentStart,

                forMainFrameOnly:
                    true
            )


        contentController
            .addUserScript(
                nativeBridgeScript
            )


        let webView =
            WKWebView(

                frame:
                    .zero,

                configuration:
                    configuration
            )


        webView
            .navigationDelegate =
            context
                .coordinator


        webView
            .uiDelegate =
            context
                .coordinator


        webView
            .allowsBackForwardNavigationGestures =
            true


        webView
            .scrollView
            .contentInsetAdjustmentBehavior =
            .never


        /*
         * Useful for debugging while developing.
         */
        #if DEBUG

        if #available(
            iOS 16.4,
            *
        ) {

            webView
                .isInspectable =
                true
        }

        #endif


        /*
         * Keep reference so native Swift can later send
         * messages back into JavaScript if needed.
         */
        context
            .coordinator
            .webView =
            webView


        let request =
            URLRequest(

                url:
                    driverAppURL,

                cachePolicy:
                    .reloadRevalidatingCacheData,

                timeoutInterval:
                    30
            )


        webView
            .load(
                request
            )


        return webView
    }


    // ========================================================
    // MARK: Update
    // ========================================================

    func updateUIView(
        _ webView:
            WKWebView,
        context:
            Context
    ) {

        /*
         * Nothing required here yet.
         *
         * Route context is supplied via
         * the JavaScript bridge.
         */
    }


    // ========================================================
    // MARK: Cleanup
    // ========================================================

    static func dismantleUIView(
        _ webView:
            WKWebView,
        coordinator:
            Coordinator
    ) {

        webView
            .configuration
            .userContentController
            .removeScriptMessageHandler(
                forName:
                    "veynorNative"
            )
    }
}


// ============================================================
// MARK: - Coordinator
// ============================================================

extension DriverWebView {

    @MainActor
    final class Coordinator:
        NSObject,
        WKScriptMessageHandler,
        WKNavigationDelegate,
        WKUIDelegate
    {

        // ====================================================
        // MARK: Properties
        // ====================================================

        let locationManager:
            DriverLocationManager


        weak var webView:
            WKWebView?


        // ====================================================
        // MARK: Init
        // ====================================================

        init(
            locationManager:
                DriverLocationManager
        ) {

            self.locationManager =
                locationManager


            super.init()


            /*
             * Native stop events can later be reflected
             * back into the web UI.
             *
             * We already install this now.
             */
            self
                .locationManager
                .onStopEvent =
                { [weak self] event in

                    self?
                        .sendStopEventToWeb(
                            event
                        )
                }
        }


        // ====================================================
        // MARK: JavaScript Message Handler
        // ====================================================

        func userContentController(
            _ userContentController:
                WKUserContentController,
            didReceive message:
                WKScriptMessage
        ) {

            guard
                message.name ==
                    "veynorNative"
            else {

                return
            }


            guard
                let body =
                    message.body as?
                        [String: Any]
            else {

                print(
                    "[Veynor Native] Invalid bridge message."
                )

                return
            }


            let type =
                String(
                    describing:
                        body["type"] ??
                        ""
                )


            switch type {


            // ================================================
            // TRACKING CONTEXT
            // ================================================

            case "setTrackingContext":

                handleTrackingContext(
                    body
                )


            // ================================================
            // START TRACKING
            // ================================================

            case "startTracking":

                locationManager
                    .startTracking()


            // ================================================
            // STOP TRACKING
            // ================================================

            case "stopTracking":

                locationManager
                    .stopTracking()


            // ================================================
            // ACCESS TOKEN
            // ================================================

            case "updateAccessToken":

                if
                    let token =
                        body["token"] as?
                            String,
                    !token.isEmpty
                {

                    locationManager
                        .updateAccessToken(
                            token
                        )
                }


            // ================================================
            // CLEAR ROUTE
            // ================================================

            case "clearTrackingContext":

                locationManager
                    .stopTracking()


                locationManager
                    .clearTrackingContext()


            // ================================================
            // REQUEST PERMISSION
            // ================================================

            case "requestLocationPermission":

                locationManager
                    .requestLocationPermission()


            // ================================================
            // SYNC OFFLINE
            // ================================================

            case "syncOfflineGPS":

                Task {

                    await locationManager
                        .syncOfflineGPS()
                }


            default:

                print(
                    "[Veynor Native] Unknown bridge message:",
                    type
                )
            }
        }


        // ====================================================
        // MARK: Parse Tracking Context
        // ====================================================

        private func handleTrackingContext(
            _ body:
                [String: Any]
        ) {

            guard
                let payload =
                    body["payload"] as?
                        [String: Any]
            else {

                print(
                    "[Veynor Native] Tracking context payload missing."
                )

                return
            }


            // ================================================
            // REQUIRED IDs
            // ================================================

            guard
                let driverUserId =
                    stringValue(
                        payload[
                            "driver_user_id"
                        ]
                    ),
                let companyId =
                    stringValue(
                        payload[
                            "company_id"
                        ]
                    ),
                let routeId =
                    stringValue(
                        payload[
                            "route_id"
                        ]
                    )
            else {

                print(
                    "[Veynor Native] Tracking context missing required IDs."
                )

                return
            }


            // ================================================
            // CONTEXT
            // ================================================

            let context =
                DriverTrackingContext(

                    driverUserId:
                        driverUserId,

                    companyId:
                        companyId,

                    routeId:
                        routeId,

                    vehicleId:
                        stringValue(
                            payload[
                                "vehicle_id"
                            ]
                        ),

                    driverName:
                        stringValue(
                            payload[
                                "driver_name"
                            ]
                        ),

                    vehicleName:
                        stringValue(
                            payload[
                                "vehicle_name"
                            ]
                        )
                )


            // ================================================
            // STOPS
            // ================================================

            var parsedStops:
                [DriverTrackingStop] = []


            if
                let rawStops =
                    payload[
                        "stops"
                    ] as?
                        [[String: Any]]
            {

                parsedStops =
                    rawStops
                        .compactMap {
                            parseStop(
                                $0
                            )
                        }
            }


            locationManager
                .setTrackingContext(

                    context,

                    stops:
                        parsedStops
                )


            print(
                """
                [Veynor Native]
                Tracking context received.
                Route: \(routeId)
                Stops: \(parsedStops.count)
                """
            )


            /*
             * Automatically start native GPS once
             * a valid active route has been received.
             *
             * If permission hasn't been granted yet,
             * DriverLocationManager will request it.
             */
            locationManager
                .startTracking()
        }


        // ====================================================
        // MARK: Parse Stop
        // ====================================================

        private func parseStop(
            _ raw:
                [String: Any]
        ) -> DriverTrackingStop? {

            guard
                let id =
                    stringValue(
                        raw["id"] ??
                        raw[
                            "route_stop_id"
                        ]
                    )
            else {

                return nil
            }


            guard
                let latitude =
                    doubleValue(
                        raw["latitude"] ??
                        raw["lat"] ??
                        raw[
                            "delivery_latitude"
                        ]
                    ),
                let longitude =
                    doubleValue(
                        raw["longitude"] ??
                        raw["lng"] ??
                        raw["lon"] ??
                        raw[
                            "delivery_longitude"
                        ]
                    )
            else {

                /*
                 * Native unloading detection requires
                 * actual coordinates.
                 *
                 * Stops without coordinates remain
                 * available normally in the PWA.
                 */
                return nil
            }


            return DriverTrackingStop(

                id:
                    id,

                orderId:
                    stringValue(
                        raw[
                            "order_id"
                        ]
                    ),

                stopNumber:
                    intValue(
                        raw[
                            "stop_number"
                        ] ??
                        raw[
                            "stop_sequence"
                        ]
                    ),

                customerName:
                    stringValue(
                        raw[
                            "customer_name"
                        ] ??
                        raw[
                            "retailer_name"
                        ] ??
                        raw[
                            "stop_name"
                        ]
                    ),

                latitude:
                    latitude,

                longitude:
                    longitude
            )
        }


        // ====================================================
        // MARK: Native → JavaScript Stop Event
        // ====================================================

        private func sendStopEventToWeb(
            _ event:
                DriverStopEvent
        ) {

            guard
                let webView =
                    webView
            else {

                return
            }


            let formatter =
                ISO8601DateFormatter()


            formatter
                .formatOptions = [
                    .withInternetDateTime,
                    .withFractionalSeconds
                ]


            let payload:
                [String: Any] = [

                    "type":
                        event
                            .type
                            .rawValue,

                    "stop_id":
                        event
                            .stop
                            .id,

                    "order_id":
                        event
                            .stop
                            .orderId ??
                        NSNull(),

                    "customer_name":
                        event
                            .stop
                            .customerName ??
                        NSNull(),

                    "timestamp":
                        formatter
                            .string(
                                from:
                                    event.date
                            ),

                    "distance_m":
                        event
                            .distanceFromStop,

                    "on_site_seconds":
                        event
                            .onSiteSeconds ??
                        NSNull()
                ]


            guard
                JSONSerialization
                    .isValidJSONObject(
                        payload
                    ),
                let data =
                    try?
                        JSONSerialization
                            .data(
                                withJSONObject:
                                    payload
                            ),
                let json =
                    String(
                        data:
                            data,
                        encoding:
                            .utf8
                    )
            else {

                return
            }


            let script =
                """
                window.dispatchEvent(
                  new CustomEvent(
                    "veynorNativeStopEvent",
                    {
                      detail: \(json)
                    }
                  )
                );
                """


            webView
                .evaluateJavaScript(
                    script
                ) {
                    _,
                    error in

                    if
                        let error =
                            error
                    {

                        print(
                            "[Veynor Native] Stop event JS error:",
                            error
                                .localizedDescription
                        )
                    }
                }
        }


        // ====================================================
        // MARK: Navigation
        // ====================================================

        func webView(
            _ webView:
                WKWebView,
            decidePolicyFor navigationAction:
                WKNavigationAction,
            decisionHandler:
                @escaping (
                    WKNavigationActionPolicy
                ) -> Void
        ) {

            guard
                let url =
                    navigationAction
                        .request
                        .url
            else {

                decisionHandler(
                    .allow
                )

                return
            }


            /*
             * Keep normal http(s) content inside
             * the Driver WebView.
             *
             * Tel / mailto / other schemes are handed
             * to iOS.
             */
            if
                url.scheme ==
                    "http" ||
                url.scheme ==
                    "https"
            {

                decisionHandler(
                    .allow
                )

                return
            }


            UIApplication
                .shared
                .open(
                    url
                )


            decisionHandler(
                .cancel
            )
        }


        // ====================================================
        // MARK: JavaScript Alerts
        // ====================================================

        func webView(
            _ webView:
                WKWebView,
            runJavaScriptAlertPanelWithMessage message:
                String,
            initiatedByFrame frame:
                WKFrameInfo,
            completionHandler:
                @escaping () -> Void
        ) {

            guard
                let controller =
                    webView
                        .window?
                        .rootViewController
            else {

                completionHandler()

                return
            }


            let alert =
                UIAlertController(

                    title:
                        "Veynor",

                    message:
                        message,

                    preferredStyle:
                        .alert
                )


            alert
                .addAction(

                    UIAlertAction(

                        title:
                            "OK",

                        style:
                            .default
                    ) {
                        _ in

                        completionHandler()
                    }
                )


            controller
                .present(
                    alert,
                    animated:
                        true
                )
        }


        // ====================================================
        // MARK: JavaScript Confirm
        // ====================================================

        func webView(
            _ webView:
                WKWebView,
            runJavaScriptConfirmPanelWithMessage message:
                String,
            initiatedByFrame frame:
                WKFrameInfo,
            completionHandler:
                @escaping (
                    Bool
                ) -> Void
        ) {

            guard
                let controller =
                    webView
                        .window?
                        .rootViewController
            else {

                completionHandler(
                    false
                )

                return
            }


            let alert =
                UIAlertController(

                    title:
                        "Veynor",

                    message:
                        message,

                    preferredStyle:
                        .alert
                )


            alert
                .addAction(

                    UIAlertAction(

                        title:
                            "Cancel",

                        style:
                            .cancel
                    ) {
                        _ in

                        completionHandler(
                            false
                        )
                    }
                )


            alert
                .addAction(

                    UIAlertAction(

                        title:
                            "OK",

                        style:
                            .default
                    ) {
                        _ in

                        completionHandler(
                            true
                        )
                    }
                )


            controller
                .present(
                    alert,
                    animated:
                        true
                )
        }


        // ====================================================
        // MARK: Conversion Helpers
        // ====================================================

        private func stringValue(
            _ value:
                Any?
        ) -> String? {

            guard
                let value =
                    value
            else {

                return nil
            }


            if value is NSNull {

                return nil
            }


            let string =
                String(
                    describing:
                        value
                )
                .trimmingCharacters(
                    in:
                        .whitespacesAndNewlines
                )


            return string
                .isEmpty
                ? nil
                : string
        }


        private func doubleValue(
            _ value:
                Any?
        ) -> Double? {

            guard
                let value =
                    value
            else {

                return nil
            }


            if
                let number =
                    value as?
                        NSNumber
            {

                return number
                    .doubleValue
            }


            if
                let string =
                    value as?
                        String
            {

                return Double(
                    string
                        .replacingOccurrences(
                            of:
                                ",",
                            with:
                                "."
                        )
                )
            }


            return nil
        }


        private func intValue(
            _ value:
                Any?
        ) -> Int? {

            guard
                let value =
                    value
            else {

                return nil
            }


            if
                let number =
                    value as?
                        NSNumber
            {

                return number
                    .intValue
            }


            if
                let string =
                    value as?
                        String
            {

                return Int(
                    string
                )
            }


            return nil
        }
    }
}
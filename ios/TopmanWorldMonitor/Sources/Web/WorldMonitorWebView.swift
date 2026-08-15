import SwiftUI
import UIKit
import WebKit

@MainActor
final class BrowserController: ObservableObject {
    let webView: WKWebView
    @Published private(set) var isLoading = true
    @Published private(set) var canGoBack = false
    @Published private(set) var canGoForward = false
    @Published private(set) var errorMessage: String?

    init() {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0.024, green: 0.063, blue: 0.125, alpha: 1)
        self.webView = webView
    }

    func loadDashboard(languageMode: AppLanguageMode) {
        errorMessage = nil
        webView.load(URLRequest(
            url: languageMode.dashboardURL,
            cachePolicy: .reloadRevalidatingCacheData,
            timeoutInterval: 30
        ))
    }

    func reload() {
        errorMessage = nil
        webView.reload()
    }

    func goBack() {
        webView.goBack()
    }

    func goForward() {
        webView.goForward()
    }

    fileprivate func updateNavigationState() {
        isLoading = webView.isLoading
        canGoBack = webView.canGoBack
        canGoForward = webView.canGoForward
    }

    fileprivate func fail(with message: String) {
        errorMessage = message
        updateNavigationState()
    }
}

struct WorldMonitorWebView: UIViewRepresentable {
    @ObservedObject var controller: BrowserController
    let languageMode: AppLanguageMode

    func makeCoordinator() -> Coordinator {
        Coordinator(controller: controller)
    }

    func makeUIView(context: Context) -> WKWebView {
        let webView = controller.webView
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator

        let refresh = UIRefreshControl()
        refresh.tintColor = UIColor(named: "AccentColor")
        refresh.addTarget(context.coordinator, action: #selector(Coordinator.refresh), for: .valueChanged)
        webView.scrollView.refreshControl = refresh

        if webView.url == nil {
            controller.loadDashboard(languageMode: languageMode)
        }
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        private let controller: BrowserController
        private let internalHost = "topmanidmb-world-monitor.vercel.app"

        init(controller: BrowserController) {
            self.controller = controller
        }

        @objc func refresh() {
            controller.reload()
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            Task { @MainActor in
                controller.updateNavigationState()
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            webView.scrollView.refreshControl?.endRefreshing()
            Task { @MainActor in
                controller.updateNavigationState()
            }
        }

        func webView(
            _ webView: WKWebView,
            didFail navigation: WKNavigation!,
            withError error: Error
        ) {
            handle(error: error, in: webView)
        }

        func webView(
            _ webView: WKWebView,
            didFailProvisionalNavigation navigation: WKNavigation!,
            withError error: Error
        ) {
            handle(error: error, in: webView)
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }

            // Embedded panels (map tiles, chart widgets, media embeds) load in a
            // subframe and belong to the dashboard itself. Bouncing those to
            // Safari kicks the user out of the app whenever a panel loads.
            if navigationAction.targetFrame?.isMainFrame != true {
                decisionHandler(.allow)
                return
            }

            if url.scheme == "about" || url.host == internalHost {
                decisionHandler(.allow)
                return
            }

            if url.scheme == "https" || url.scheme == "http" {
                // Only a deliberate tap opens Safari; a stray redirect is dropped.
                if navigationAction.navigationType == .linkActivated {
                    UIApplication.shared.open(url)
                }
                decisionHandler(.cancel)
                return
            }

            decisionHandler(.allow)
        }

        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            guard navigationAction.targetFrame == nil,
                  let url = navigationAction.request.url else { return nil }
            if url.host == internalHost {
                webView.load(navigationAction.request)
            } else {
                UIApplication.shared.open(url)
            }
            return nil
        }

        private func handle(error: Error, in webView: WKWebView) {
            webView.scrollView.refreshControl?.endRefreshing()
            let nsError = error as NSError
            if nsError.code == NSURLErrorCancelled { return }
            Task { @MainActor in
                controller.fail(with: error.localizedDescription)
            }
        }
    }
}
